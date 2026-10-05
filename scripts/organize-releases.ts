// One-off: turn the generation scratch output (catalog/out) into the
// misofm/releases-style layout under releases/<artist>-<release>/.
//
//   releases/<folder>/assets/cover.webp
//   releases/<folder>/assets/tracks/<NN>-<slug>/master.flac   (STREAMINFO-only FLAC)
//   releases/<folder>/generation.json                          (prompts + ElevenLabs song ids)
//
// Raw assets are gitignored, as in misofm/releases. Idempotent: existing masters are kept.
//
//   bun scripts/organize-releases.ts

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { $ } from "bun";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const catalog = JSON.parse(readFileSync(join(root, "catalog/catalog.json"), "utf8"));
const out = join(root, "catalog/out");

for (const rel of catalog.releases) {
  const folder = join(root, "releases", `${rel.artist}-${rel.slug}`);
  mkdirSync(join(folder, "assets/tracks"), { recursive: true });
  copyFileSync(join(out, "covers", `${rel.slug}.webp`), join(folder, "assets/cover.webp"));
  copyFileSync(join(out, "covers", `${rel.slug}.png`), join(folder, "assets/cover-512.png"));

  const generation: any[] = [];
  for (const [i, track] of rel.tracks.entries()) {
    const pcm = join(out, "audio", rel.slug, `${track.slug}.pcm`);
    if (!existsSync(pcm)) throw new Error(`missing audio for ${rel.slug}/${track.slug}; run catalog/scripts/generate-audio.ts`);
    const dir = join(folder, "assets/tracks", `${String(i + 1).padStart(2, "0")}-${track.slug}`);
    const flac = join(dir, "master.flac");
    if (!existsSync(flac)) {
      mkdirSync(dir, { recursive: true });
      await $`ffmpeg -hide_banner -loglevel error -y -f s16le -ar 44100 -ac 2 -i ${pcm} -map_metadata -1 -c:a flac -compression_level 8 ${flac}`;
      await $`python3 ${join(root, "scripts/strip-flac.py")} ${flac}`.quiet();
    }
    const sidecar = JSON.parse(readFileSync(join(out, "audio", rel.slug, `${track.slug}.json`), "utf8"));
    generation.push({
      track: track.slug,
      title: track.title,
      provider: "elevenlabs-music",
      outputFormat: "pcm_44100",
      songId: sidecar.songId,
      requestedSeconds: track.seconds,
      seconds: Number(sidecar.seconds.toFixed(3)),
      instrumental: track.instrumental,
      prompt: track.prompt,
    });
  }
  writeFileSync(
    join(folder, "generation.json"),
    JSON.stringify({ _comment: "Provenance for AI-generated workshop audio. Masters are 16-bit/44.1 kHz PCM from ElevenLabs Music, losslessly encoded to STREAMINFO-only FLAC.", release: rel.slug, tracks: generation }, null, 2) + "\n",
  );
  console.log(`organized ${rel.artist}-${rel.slug}`);
}
