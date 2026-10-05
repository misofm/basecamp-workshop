// Download the release masters (and cover art) from a public Walrus aggregator by the
// blob ids in releases/<folder>/masters.json:
//
//   releases/<folder>/assets/tracks/<NN-slug>/master.flac
//   releases/<folder>/assets/cover.webp
//
// The aggregator is WALRUS_AGGREGATOR (default https://aggregator.walrus-testnet.walrus.space).
// Each download is verified: when the miso CLI is runnable (MISO_CLI, see scripts/lib/miso.ts)
// `miso blobs id` must reproduce the blob id; otherwise the byte length must match
// master.bytes (covers are only checked for being non-empty). Files already present with
// the right size are skipped. cover-512.png, used by the game's mock mode, is already
// committed in apps/game/public/covers.
//
//   bun scripts/fetch-masters.ts [--only <folder>] [--track <NN-slug>] [--no-cover] [--out <dir>]

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { miso } from "./lib/miso.ts";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const arg = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const only = arg("--only");
const track = arg("--track");
const noCover = args.includes("--no-cover");
const outRoot = resolve(arg("--out") ?? root);
const aggregator = (process.env.WALRUS_AGGREGATOR ?? "https://aggregator.walrus-testnet.walrus.space").replace(/\/+$/, "");

// Use the CLI to verify blob ids if it runs at all; otherwise fall back to sizes.
let cliWorks = true;
async function offlineBlobId(path: string): Promise<string | undefined> {
  if (!cliWorks) return undefined;
  try {
    const [{ blobId }] = await miso("blobs", "id", path);
    return blobId;
  } catch (e) {
    cliWorks = false;
    console.log(`note  miso CLI not runnable (${String(e).split("\n")[0].slice(0, 160)}); checking byte lengths only`);
    return undefined;
  }
}

async function fetchBlob(blobId: string, dest: string, bytes?: number) {
  const rel = dest.slice(outRoot.length + 1);
  if (existsSync(dest) && (bytes === undefined ? statSync(dest).size > 0 : statSync(dest).size === bytes)) {
    return console.log(`have  ${rel}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  try {
    const res = await fetch(`${aggregator}/v1/blobs/${blobId}`);
    if (!res.ok) throw new Error(`GET ${blobId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    await Bun.write(tmp, res);
    const size = statSync(tmp).size;
    const id = await offlineBlobId(tmp);
    if (id !== undefined) {
      if (id !== blobId) throw new Error(`${rel}: downloaded bytes hash to ${id}, expected ${blobId}`);
    } else if (bytes === undefined ? size === 0 : size !== bytes) {
      throw new Error(`${rel}: got ${size} bytes, expected ${bytes ?? "more than 0"}`);
    }
    renameSync(tmp, dest);
    console.log(`got   ${rel} (${size} bytes, ${id ? "blob id verified" : "size checked"})`);
  } finally {
    rmSync(tmp, { force: true });
  }
}

const folders = readdirSync(join(root, "releases"))
  .filter((f) => !f.endsWith(".json") && (!only || f === only))
  .sort();
if (!folders.length) throw new Error(`no release folder ${only}`);
let matched = 0;
for (const folder of folders) {
  const masters = JSON.parse(readFileSync(join(root, "releases", folder, "masters.json"), "utf8"));
  const assets = join(outRoot, "releases", folder, "assets");
  if (!noCover && masters.cover?.blobId) await fetchBlob(masters.cover.blobId, join(assets, "cover.webp"));
  const entries = Object.entries<any>(masters.tracks ?? {}).filter(([t]) => !track || t === track);
  matched += entries.length;
  for (const [t, entry] of entries) {
    await fetchBlob(entry.master.blobId, join(assets, "tracks", t, "master.flac"), entry.master.bytes);
  }
}
if (track && !matched) throw new Error(`no track ${track} in ${only ?? "any release"}`);
