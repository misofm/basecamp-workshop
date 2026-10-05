// Store every release's media on Walrus testnet with the `miso` CLI and record the ids
// in releases/<folder>/masters.json (the input to scripts/build-release-intents.ts):
//
//   1. cover.webp: offline blob id (`miso blobs id`), then `miso blobs store`
//   2. each master.flac: offline blob id and PCM identity (`miso stems identify`,
//      which must report a STREAMINFO-only FLAC), then `miso blobs store`
//   3. each master: `miso transcode --to-walrus`, which builds the verified HLS package
//      (miso.transcode-package/1) and stores it as one Walrus quilt
//
// Everything goes through a public Walrus publisher, so no wallet or signer is needed.
// The CLI defaults to https://publisher.walrus-testnet.walrus.space; set
// MISO_WALRUS_PUBLISHER to use another one. `blobs store` asserts that the publisher
// certified the offline blob id; this script checks it again.
//
// Needs the raw assets under releases/<folder>/assets/ (scripts/organize-releases.ts)
// and ffmpeg/ffprobe on PATH. Transcode work files go to catalog/out/transcode/.
// Resumable: every finished step is saved to masters.json and skipped next time.
//
//   bun scripts/store-media.ts [--only <folder>] [--epochs 53]

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { misoIn } from "./lib/miso.ts";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const epochs = args.includes("--epochs") ? args[args.indexOf("--epochs") + 1]! : "53";
const miso = (...a: string[]) => misoIn(root, ...a);

const COMMENT =
  "Media for this release. Masters are STREAMINFO-only 16-bit/44.1 kHz FLAC; transcodes are miso.transcode-package/1 HLS quilts. " +
  "All bytes are stored on Walrus testnet (see walrus.epochs); scripts/store-media.ts wrote this file and scripts/fetch-masters.ts downloads the masters by blob id.";

async function storeBlob(path: string, expected: string) {
  const [stored] = await miso("blobs", "store", path, "--epochs", epochs);
  if (stored.blobId !== expected) throw new Error(`certified ${stored.blobId} != offline ${expected} for ${path}`);
}

const folders = readdirSync(join(root, "releases"))
  .filter((f) => !f.endsWith(".json") && (!only || f === only))
  .sort();
for (const folder of folders) {
  const rel = join(root, "releases", folder);
  const mastersPath = join(rel, "masters.json");
  const state: any = existsSync(mastersPath) ? JSON.parse(readFileSync(mastersPath, "utf8")) : {};
  const save = () => writeFileSync(mastersPath, JSON.stringify(state, null, 2) + "\n");
  state._comment ??= COMMENT;
  state.walrus ??= { network: "testnet", epochs: Number(epochs) };

  // cover (written only after the store succeeds, so a blobId means it is stored)
  if (!state.cover?.blobId) {
    const coverPath = join(rel, "assets/cover.webp");
    const [{ blobId }] = await miso("blobs", "id", coverPath);
    await storeBlob(coverPath, blobId);
    state.cover = { blobId, contentType: "image/webp", stored: true };
    save();
  }

  state.tracks ??= {};
  for (const t of readdirSync(join(rel, "assets/tracks")).sort()) {
    const master = join(rel, "assets/tracks", t, "master.flac");
    const entry = (state.tracks[t] ??= {});
    if (!entry.master) {
      const [{ blobId, bytes }] = await miso("blobs", "id", master);
      const [id] = await miso("stems", "identify", master);
      if (!id.streamInfoOnly) throw new Error(`${master} has metadata beyond STREAMINFO (run scripts/strip-flac.py)`);
      entry.master = { blobId, bytes, format: "flac", channels: id.channels, bitDepth: id.bitDepth, sampleRateHz: id.sampleRateHz, samples: String(id.frames), pcmDigest: id.digest };
      save();
    }
    if (!entry.masterStored) {
      await storeBlob(master, entry.master.blobId);
      entry.masterStored = true;
      save();
    }
    if (!entry.streamingTranscode) {
      // An explicit workspace per track: the CLI's default (.miso-transcode/<file name>)
      // would collide, since every master is called master.flac. Its checkpoint makes
      // an interrupted transcode resume.
      const ws = join(root, "catalog/out/transcode", folder, t);
      mkdirSync(dirname(ws), { recursive: true });
      const result = await miso("transcode", master, "--to-walrus", "--epochs", epochs, "--workspace", ws);
      entry.streamingTranscode = result.quiltId;
      entry.transcodeDigest = result.transcodeDigest;
      save();
      rmSync(ws, { recursive: true, force: true });
    }
    console.log(`stored ${folder}/${t} master=${entry.master.blobId} quilt=${entry.streamingTranscode}`);
  }
}
