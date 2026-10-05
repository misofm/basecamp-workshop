// Generates every track in catalog.json with ElevenLabs Music.
// Output: catalog/out/audio/<release>/<track>.pcm (s16le, 44.1 kHz, stereo) + .json sidecar.
// Resumable: tracks with an existing .pcm are skipped.
//
//   bun catalog/scripts/generate-audio.ts [--only <release-slug>] [--concurrency 3]

import { existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const catalog = await Bun.file(join(root, "catalog.json")).json();
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set (see .env.example)");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const concurrency = args.includes("--concurrency") ? Number(args[args.indexOf("--concurrency") + 1]) : 3;

type Job = { release: string; track: any };
const jobs: Job[] = catalog.releases
  .filter((r: any) => !only || r.slug === only)
  .flatMap((r: any) => r.tracks.map((track: any) => ({ release: r.slug, track })));

async function generate({ release, track }: Job) {
  const dir = join(root, "out", "audio", release);
  const out = join(dir, `${track.slug}.pcm`);
  if (existsSync(out)) return console.log(`skip  ${release}/${track.slug}`);
  mkdirSync(dir, { recursive: true });

  for (let attempt = 1; attempt <= 4; attempt++) {
    const started = Date.now();
    const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=pcm_44100", {
      method: "POST",
      headers: { "xi-api-key": key!, "content-type": "application/json" },
      body: JSON.stringify({
        prompt: track.prompt,
        music_length_ms: track.seconds * 1000,
        force_instrumental: track.instrumental,
      }),
    });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      writeFileSync(`${out}.partial`, bytes);
      renameSync(`${out}.partial`, out);
      writeFileSync(
        join(dir, `${track.slug}.json`),
        JSON.stringify({ songId: res.headers.get("song-id"), seconds: bytes.length / (44100 * 4), prompt: track.prompt }, null, 2),
      );
      return console.log(`done  ${release}/${track.slug} ${(bytes.length / 176400).toFixed(1)}s in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    const body = await res.text();
    console.error(`fail  ${release}/${track.slug} attempt ${attempt}: ${res.status} ${body.slice(0, 300)}`);
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error(`unrecoverable ${res.status} for ${track.slug}`);
    await Bun.sleep(5000 * attempt);
  }
  throw new Error(`gave up on ${release}/${track.slug}`);
}

const queue = [...jobs];
const failures: string[] = [];
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let job; (job = queue.shift()); ) {
      try { await generate(job); } catch (e) { failures.push(String(e)); console.error(String(e)); }
    }
  }),
);
console.log(`\n${jobs.length - failures.length}/${jobs.length} tracks ready`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
