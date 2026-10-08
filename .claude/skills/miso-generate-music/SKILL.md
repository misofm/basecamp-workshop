---
name: miso-generate-music
description: Generate original tracks with the ElevenLabs Music API and turn them into Miso-ready masters (lossless STREAMINFO-only FLAC) plus mock release metadata. Use when someone wants AI-generated source material to publish on Miso, or needs to prepare a FLAC master correctly.
---

# Generate a track for Miso

Miso masters are lossless FLAC whose only metadata block is STREAMINFO. ElevenLabs
returns raw 16-bit/44.1 kHz PCM for `output_format=pcm_44100`, so the master is
genuinely lossless: PCM → `miso master` → FLAC.

## Setup

```sh
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
git clone https://github.com/misofm/cli ~/miso-cli && (cd ~/miso-cli && bun install && bun link)
miso --help
```

`bun link` installs the `miso` command from the CLI's `bin` entry into `~/.bun/bin`; the
`export PATH` line puts it on `PATH`.

Install ffmpeg (it includes ffprobe): `brew install ffmpeg` on macOS,
`sudo apt-get install -y ffmpeg` on Debian or Ubuntu.

Export `ELEVENLABS_API_KEY` (an ElevenLabs key with music generation enabled) in the
shell that runs the script. Ask the user for it; never print it or write it into a
tracked file.

## Generate

Save this as `generate-track.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const prompt = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.match(/^--(seconds|out)$/));
if (!prompt) throw new Error('usage: bun generate-track.ts "<prompt>" [--seconds 45] [--instrumental] [--out out/track]');
const seconds = Number(opt("--seconds", "45"));
const out = opt("--out", `out/${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`)!;
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("Set ELEVENLABS_API_KEY.");

mkdirSync(out, { recursive: true });
let res: Response;
for (let attempt = 1; ; attempt++) {
  res = await fetch("https://api.elevenlabs.io/v1/music?output_format=pcm_44100", {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ prompt, music_length_ms: seconds * 1000, force_instrumental: args.includes("--instrumental") }),
  });
  if (res.ok || res.status < 429 || attempt === 4) break;
  console.error(`ElevenLabs busy (${res.status}), retrying...`);
  await Bun.sleep(5000 * attempt);
}
if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);

writeFileSync(join(out, "master.pcm"), new Uint8Array(await res.arrayBuffer()));
writeFileSync(join(out, "generation.json"), JSON.stringify({ provider: "elevenlabs-music", songId: res.headers.get("song-id"), seconds, prompt }, null, 2) + "\n");
console.log(`wrote ${join(out, "master.pcm")}`);
```

Run it, then master the PCM:

```sh
bun generate-track.ts "dreamy city pop, slap bass, glossy electric piano, female vocals about a summer radio station" \
  --seconds 45 --out out/coastline-fm        # add --instrumental to forbid vocals
miso master out/coastline-fm/master.pcm --pcm-format s16le --rate 44100 --channels 2 \
  --out out/coastline-fm/master.flac > out/coastline-fm/master.json
rm out/coastline-fm/master.pcm
```

`miso master` writes `out/coastline-fm/master.flac` (STREAMINFO-only FLAC) and prints the
recording's `master` fragment, saved to `master.json`. Generated audio often peaks at or
above 0 dBFS and the Miso transcoder rejects masters whose AAC renditions would clip
("Second-pass AAC ladder exceeds the final true-peak or decoded sample ceiling"), so
`miso master` turns the track down with a plain gain change, no limiter, to its true-peak
target (`-4` dBTP by default; see `miso master --help`). If publishing later fails with
that transcoder error, remaster that track with `--true-peak -5 --force` and publish again.

Keep workshop tracks to 30–60 s: masters store faster on the public Walrus publisher
and the whole release flow stays quick.

## Writing prompts

- Name a genre, tempo (BPM), key, instrumentation, mood, and, if vocals, who sings and
  what the song is about. ElevenLabs writes the lyrics itself.
- Do not name real artists or quote copyrighted lyrics; the API rejects them.
- The API allows few concurrent requests (two on smaller plans) and sometimes answers
  429 "system busy"; the script retries. Generate ahead of any live demo.

## Mock metadata

A release also needs metadata. For a fictional catalog, invent and record it alongside
the audio:

- Release: title, kind (`Single`, `ExtendedPlay`, `Album`), description (≤ 8 KB), one
  primary genre plus up to five secondary from the on-chain vocabulary (`ALTERNATIVE`,
  `CHRISTIAN`, `CLASSICAL`, `COUNTRY`, `DANCE`, `ELECTRONIC`, `GOSPEL`, `HIP_HOP`, `LATIN`,
  `OPERA`, `POP`, `RAP`, `REGGAE`, `ROCK`, `R_AND_B`, `SOUNDTRACK`). Map styles without
  their own entry (jazz, folk, ambient, afrobeats) to the nearest.
- Per track: title, advisory (`NotExplicit`), languages (`{ "codes": ["en"] }`) or
  `{ "instrumental": true }`.
- Parties to credit: the act, its members, writers, producer, mastering engineer, label.
  Invent names that do not belong to real people.

## Next

Put the FLAC under `<package>/audio/`, write `manifest.json` and `parties.json` (`miso schema
package`, `miso schema parties`), then use `verify-release` and `publish-release`.
