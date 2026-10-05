#!/usr/bin/env node
/**
 * fetch-textures.mjs - download and encode the street's PBR texture sets and dusk HDRI.
 *
 * Sources: Poly Haven (https://polyhaven.com, CC0). The public API
 * (api.polyhaven.com/files/<id>) is used only here, at asset-preparation time;
 * the game never calls it.
 *
 * Output (public/textures/):
 *   <set>_diff_<res>.ktx2    albedo, Basis ETC1S, sRGB, mipmapped
 *   <set>_orm_<res>.ktx2     glTF-style packed R=AO G=roughness B=metalness (Poly Haven "arm"),
 *                            Basis ETC1S, linear, mipmapped
 *   <set>_nor_gl_<res>.ktx2  OpenGL normal map, Basis ETC1S at max quality (see below), linear,
 *                            mipmapped and renormalised
 *   hdri/<hdri>_<res>.hdr    equirectangular Radiance HDR, bytes as published
 *   ../basis/basis_transcoder.{js,wasm}  copied from three so KTX2Loader is served locally
 * Resolutions per set: 1k + 2k for every map; hero sets also get 4k albedo.
 * All images are flipped vertically at encode time (-y_flip) so they match the
 * flipY=true orientation of the old JPG sets (KTX2 textures upload with flipY=false).
 *
 * Normals use ETC1S (quality 100) rather than UASTC: a 2K UASTC normal map with RDO and
 * Zstandard was 3.4-4.8 MB per file versus 0.9 MB for ETC1S, and on these grimy surfaces
 * the ETC1S block artefacts are not visible at play distance.
 *
 * Encoder: Basis Universal `basisu` (not an npm dependency). Point $BASISU at a binary,
 * or put `basisu` on PATH, or pass --build-basisu to download the pinned source release
 * (BinomialLLC/basis_universal v2_1_0) into the cache and build it with cmake + a C++
 * compiler (about a minute).
 *
 * Usage:
 *   node scripts/fetch-textures.mjs [--force] [--build-basisu]
 * Env: BASISU=/path/to/basisu  TEXTURE_CACHE=/dir (default ~/.cache/miso-fetch-textures)
 * Idempotent: existing outputs are skipped unless --force.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const game = join(here, "..");
const out = join(game, "public/textures");
const cache = process.env.TEXTURE_CACHE ?? join(homedir(), ".cache/miso-fetch-textures");
const force = process.argv.includes("--force");
const BASISU_TAG = "v2_1_0";

/** Poly Haven texture sets. `hero` sets also get a 4K albedo (lazy-loaded on the high tier). */
export const SETS = [
  { id: "asphalt_04", hero: true }, // street (wet asphalt + asphalt)
  { id: "cracked_concrete" }, // sidewalks / pavement
  { id: "plastered_wall_03" }, // stained render
  { id: "rusty_corrugated_iron" },
  { id: "rounded_square_tiled_wall" }, // small square facade tiles
  { id: "weathered_planks" },
  { id: "rusty_metal_shutter" }, // roll-up shutters
  { id: "dark_brick_wall" }, // dirty dark brick
  { id: "brick_wall_001", hero: true }, // shop facade (also the old 1K JPG set)
  { id: "wood_floor_worn", hero: true }, // shop floor (also the old 1K JPG set)
];
const HDRI = { id: "sunset_jhbcentral", res: ["1k", "2k"] };

const MAPS = {
  diff: { key: "Diffuse", args: ["-srgb", "-mip_srgb", "-quality", "85"] },
  orm: { key: "arm", args: ["-linear", "-mip_linear", "-quality", "80"] },
  nor_gl: { key: "nor_gl", args: ["-linear", "-mip_linear", "-normal_map", "-mip_renorm", "-quality", "100"] },
};

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
mkdirSync(cache, { recursive: true });
mkdirSync(join(out, "hdri"), { recursive: true });

async function download(url, file) {
  if (existsSync(file)) return file;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
async function filesOf(id) {
  const file = join(cache, `${id}.files.json`);
  await download(`https://api.polyhaven.com/files/${id}`, file);
  return JSON.parse(readFileSync(file, "utf8"));
}
async function checkLicense(id) {
  // Every Poly Haven asset is CC0; record the author for ASSETS.md.
  const file = join(cache, `${id}.info.json`);
  await download(`https://api.polyhaven.com/info/${id}`, file);
  const info = JSON.parse(readFileSync(file, "utf8"));
  return { name: info.name, authors: Object.keys(info.authors ?? {}).join(", "), size: info.dimensions };
}

function basisu() {
  if (process.env.BASISU) return process.env.BASISU;
  try {
    execFileSync("basisu", ["-version"], { stdio: "ignore" });
    return "basisu";
  } catch {}
  const built = join(cache, `basis_universal-${BASISU_TAG.slice(1)}`, "bin/basisu");
  if (existsSync(built)) return built;
  if (!process.argv.includes("--build-basisu"))
    throw new Error("basisu not found: set $BASISU, put basisu on PATH, or pass --build-basisu");
  const tgz = join(cache, `basis_universal-${BASISU_TAG}.tar.gz`);
  execFileSync("curl", ["-sSL", "-o", tgz, `https://github.com/BinomialLLC/basis_universal/archive/refs/tags/${BASISU_TAG}.tar.gz`], { stdio: "inherit" });
  execFileSync("tar", ["xzf", tgz, "-C", cache], { stdio: "inherit" });
  const src = dirname(dirname(built));
  execFileSync("cmake", ["-S", src, "-B", join(src, "build"), "-DCMAKE_BUILD_TYPE=Release", "-DBASISU_EXAMPLES=OFF"], { stdio: "inherit" });
  execFileSync("cmake", ["--build", join(src, "build"), "-j", "8"], { stdio: "inherit" });
  return built;
}

async function encode(bin, src, map, res, dest) {
  // Resize from the 2K/4K source with sharp (Lanczos) into a lossless PNG, then encode.
  const px = { "1k": 1024, "2k": 2048, "4k": 4096 }[res];
  const png = join(cache, `tmp_${process.pid}.png`);
  await sharp(src).resize(px, px).png({ compressionLevel: 1 }).toFile(png);
  execFileSync(bin, ["-ktx2", "-etc1s", "-effort", "5", "-mipmap", "-y_flip", ...MAPS[map].args, png, "-output_file", dest], {
    stdio: "ignore",
  });
}

const bin = basisu();
let total = 0;
for (const set of SETS) {
  const files = await filesOf(set.id);
  const info = await checkLicense(set.id);
  console.log(`${set.id}: "${info.name}" by ${info.authors} (CC0), ${info.size?.map((d) => d / 1000).join("x")} m`);
  for (const [map, spec] of Object.entries(MAPS)) {
    const resList = set.hero && map === "diff" ? ["1k", "2k", "4k"] : ["1k", "2k"];
    for (const res of resList) {
      const dest = join(out, `${set.id}_${map}_${res}.ktx2`);
      if (force || !existsSync(dest)) {
        const srcRes = res === "4k" ? "4k" : "2k";
        const url = files[spec.key][srcRes].jpg?.url ?? files[spec.key][srcRes].png.url;
        const src = await download(url, join(cache, `${set.id}_${map}_${srcRes}${url.slice(url.lastIndexOf("."))}`));
        await encode(bin, src, map, res, dest);
      }
      const size = statSync(dest).size;
      total += size;
      console.log(`  ${set.id}_${map}_${res}.ktx2  ${mb(size)}`);
    }
  }
}

const hdriFiles = await filesOf(HDRI.id);
const hdriInfo = await checkLicense(HDRI.id);
console.log(`${HDRI.id}: "${hdriInfo.name}" by ${hdriInfo.authors} (CC0)`);
for (const res of HDRI.res) {
  const dest = join(out, "hdri", `${HDRI.id}_${res}.hdr`);
  if (force || !existsSync(dest)) await download(hdriFiles.hdri[res].hdr.url, dest);
  const size = statSync(dest).size;
  total += size;
  console.log(`  hdri/${HDRI.id}_${res}.hdr  ${mb(size)}`);
}

// Basis transcoder for KTX2Loader, served from /basis/.
const require = createRequire(import.meta.url);
const basisDir = join(dirname(require.resolve("three")), "../examples/jsm/libs/basis");
mkdirSync(join(game, "public/basis"), { recursive: true });
for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
  copyFileSync(join(basisDir, f), join(game, "public/basis", f));
  total += statSync(join(game, "public/basis", f)).size;
}
console.log(`total written: ${mb(total)}`);
