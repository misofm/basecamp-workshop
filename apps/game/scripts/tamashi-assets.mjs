#!/usr/bin/env node
/**
 * tamashi-assets.mjs - build the Tamashi image assets used by the game.
 *
 * Artwork (c) Studio Mirai, LLC. All rights reserved. Used in this repo with
 * permission; do not reuse the generated images outside this project.
 *
 * Tamashi are 100 TV-headed characters. 75 of them show a simple face on the
 * TV screen, which the game draws procedurally. The other 25 (traits
 * `screen.kind !== "face"`) get their 3D TV screen textured with a crop of the
 * real screen taken from the token's artwork. This script produces:
 *
 *   public/tamashi/screens/<n>.webp   crop of the screen glass, longest side
 *                                     256 px, natural aspect, webp q82
 *   public/tamashi/screens/index.json { "<n>": { "w": px, "h": px } }
 *   public/tamashi/portraits/<n>.webp 256 px portraits for all 100 tokens
 *                                     (bytes copied; re-encoded only if > 40 KB)
 *
 * Inputs (the source art is not checked in):
 *   <src>/img/<n>.webp           4000 px originals
 *   <src>/portraits/<n>.webp     256 px portraits
 *   <src>/tamashi-traits.json    trait objects ({ id, screen: { kind } , ... })
 *   scripts/tamashi-screen-boxes.json
 *       { "<n>": { x, y, w, h, note? } } crop rectangle of the visible screen
 *       glass in normalised image coordinates (x,y = top-left, fractions of
 *       image width/height), measured by eye from the artwork.
 *
 * Usage:
 *   node scripts/tamashi-assets.mjs [srcDir]          (default: $TAMASHI_SRC)
 *   node scripts/tamashi-assets.mjs [srcDir] --sheet out.png
 *       also tile every screen crop with its id into a review contact sheet
 *       (write it somewhere outside the repo).
 */
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = resolve(here, "..");
const outDir = join(gameDir, "public", "tamashi");
const SCREEN_MAX = 256;
const SCREEN_QUALITY = 82;
const PORTRAIT_MAX_BYTES = 40 * 1024;

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: node scripts/tamashi-assets.mjs [srcDir] [--sheet out.png]");
  console.error("       (srcDir defaults to $TAMASHI_SRC; it must contain img/, portraits/ and tamashi-traits.json)");
  process.exit(1);
}

const args = process.argv.slice(2);
let sheetOut = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--sheet") {
    sheetOut = args[++i];
    if (!sheetOut) usage("--sheet needs an output path");
  } else if (args[i] === "-h" || args[i] === "--help") usage();
  else positional.push(args[i]);
}
const src = positional[0] ?? process.env.TAMASHI_SRC;
if (!src) usage("no source directory given and TAMASHI_SRC is not set");

const traits = JSON.parse(await readFile(join(src, "tamashi-traits.json"), "utf8"));
const boxes = JSON.parse(await readFile(join(here, "tamashi-screen-boxes.json"), "utf8"));
const allIds = traits.map((t) => t.id).sort((a, b) => a - b);
if (allIds.length !== 100) throw new Error(`expected 100 traits, got ${allIds.length}`);
const screenIds = traits.filter((t) => t.screen?.kind !== "face").map((t) => t.id).sort((a, b) => a - b);

const missing = screenIds.filter((id) => !boxes[id]);
if (missing.length) throw new Error(`tamashi-screen-boxes.json has no box for: ${missing.join(", ")}`);
const extra = Object.keys(boxes).filter((id) => !screenIds.includes(Number(id)));
if (extra.length) console.warn(`warning: boxes for face tokens ignored: ${extra.join(", ")}`);

await mkdir(join(outDir, "screens"), { recursive: true });
await mkdir(join(outDir, "portraits"), { recursive: true });

// Screens.
const index = {};
const crops = [];
for (const id of screenIds) {
  const b = boxes[id];
  for (const k of ["x", "y", "w", "h"]) {
    if (typeof b[k] !== "number" || b[k] < 0 || b[k] > 1) throw new Error(`box ${id}.${k} invalid: ${b[k]}`);
  }
  if (b.x + b.w > 1 || b.y + b.h > 1) throw new Error(`box ${id} extends past the image`);
  const img = sharp(join(src, "img", `${id}.webp`));
  const { width, height } = await img.metadata();
  const left = Math.round(b.x * width);
  const top = Math.round(b.y * height);
  const cw = Math.round(b.w * width);
  const ch = Math.round(b.h * height);
  const scale = SCREEN_MAX / Math.max(cw, ch);
  const w = Math.round(cw * scale);
  const h = Math.round(ch * scale);
  const buf = await img
    .extract({ left, top, width: cw, height: ch })
    .resize(w, h, { kernel: "lanczos3" })
    .webp({ quality: SCREEN_QUALITY, effort: 6 })
    .toBuffer();
  await writeFile(join(outDir, "screens", `${id}.webp`), buf);
  index[id] = { w, h };
  crops.push({ id, buf, w, h });
}
await writeFile(join(outDir, "screens", "index.json"), JSON.stringify(index, null, 2) + "\n");

// Portraits.
let reencoded = 0;
for (const id of allIds) {
  const from = join(src, "portraits", `${id}.webp`);
  const to = join(outDir, "portraits", `${id}.webp`);
  const { size } = await stat(from);
  if (size <= PORTRAIT_MAX_BYTES) {
    await copyFile(from, to);
  } else {
    await sharp(from).resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78, effort: 6 }).toFile(to);
    reencoded++;
  }
}

console.log(`screens: ${crops.length} (${screenIds.join(", ")})`);
console.log(`portraits: ${allIds.length} (${reencoded} re-encoded)`);

// Optional review contact sheet.
if (sheetOut) {
  const cell = SCREEN_MAX + 16;
  const label = 28;
  const cols = 5;
  const rows = Math.ceil(crops.length / cols);
  const layers = [];
  crops.forEach((c, i) => {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * (cell + label);
    layers.push({ input: c.buf, left: cx + 8 + Math.floor((SCREEN_MAX - c.w) / 2), top: cy + label + Math.floor((SCREEN_MAX - c.h) / 2) });
    const svg = `<svg width="${cell}" height="${label}" xmlns="http://www.w3.org/2000/svg"><text x="8" y="21" font-family="sans-serif" font-size="20" font-weight="bold" fill="#fff">#${c.id} ${c.w}x${c.h}</text></svg>`;
    layers.push({ input: Buffer.from(svg), left: cx, top: cy });
  });
  await mkdir(dirname(resolve(sheetOut)), { recursive: true });
  await sharp({ create: { width: cols * cell, height: rows * (cell + label), channels: 3, background: "#ff00ff" } })
    .composite(layers)
    .png()
    .toFile(sheetOut);
  console.log(`sheet: ${sheetOut}`);
}
