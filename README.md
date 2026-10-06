# Miso at Sui Basecamp: workshop repo

This is the take-home repo of the Miso workshop at Sui Basecamp. It contains a 50-track
fictional catalog (10 releases by 10 invented artists) published on Sui testnet with open
rights data, a keyless web app that reads that catalog straight from public endpoints, and
a small record-shop game where the records you buy are real on-chain objects paid for in
FakeUsd. Everything targets **Sui testnet**. Reading needs no account and no API key;
anything that writes to the chain needs a testnet wallet with a little SUI for gas.

The tools used throughout are public: [misofm/cli](https://github.com/misofm/cli) (the
`miso` command) and [misofm/skills](https://github.com/misofm/skills) (agent skills and
small scripts for Claude Code or any agent that reads `SKILL.md` files).

## What the workshop showed

### 1. Publishing fresh music

The catalog in this repo was generated, mastered, stored and published with the pipeline
described [below](#how-the-catalog-was-made). Each release folder shows the three questions
a release answers: what the music is (`release.json`), who is credited and paid
(`release-config.testnet.json`), and where the audio came from (`generation.json`). The
publication log (`publication-*.testnet.log`) shows the four transactions a publish takes:
share packages, share init, and one atomic catalog transaction.

On stage, the presenter then built a single live in Claude Code with only misofm/skills and
misofm/cli: generate a 30-second track, create a party for a new artist named by the room,
publish it as a single with a 5 FakeUsd pressing of 50, and buy the first record. From a fresh
wallet that takes about 2.5 minutes of commands and about 0.15 SUI of gas. The skills'
`scripts/scaffold-single.ts` writes the two release files.

### 2. Open music infrastructure, no API key

The catalog is readable by anyone from a browser with no signup: discovery from Sui
GraphQL (every object of the Release type), data from the open Miso API
(`api.testnet.miso.fm`), media from the Miso CDN (`cdn.miso.fm`) with the public Walrus
aggregator as fallback.

- [`apps/spa`](apps/spa/README.md) is the finished reference app: release grid, release page
  with credits and 30-second previews, artist and collection pages, and a "How this works"
  drawer that logs every public request it makes.
- [`examples/live-mini-spa`](examples/live-mini-spa/README.md) is what was built live from a
  one-sentence prompt during the session.

### 3. Miso inside a game

[`apps/game`](apps/game/README.md) is a third-person Three.js game: walk into a record shop,
dig through crates of the ten releases, preview a track on the listening deck, buy a Record
at the counter (minted to your wallet on testnet), smash a parked car with it, and sell it to
a collector on the street for 1.5× what you paid.

Two changes to the game were shown as patches you can apply yourself:

- [`examples/billboard`](examples/billboard/README.md): a billboard outside the shop that shows
  the newest release, read live from the Miso API. Built live on stage.
- [`examples/second-collector`](examples/second-collector/README.md): a second street buyer who
  pays 2× for HOUSE records. Shown from a prepared branch, because it touches more than it seems.

## What's on Sui testnet

- **10 releases, 50 tracks** (5 per release), defined in [`catalog/catalog.json`](catalog/catalog.json).
- **31 fictional parties** (artists, band members, producers, labels), defined in
  [`parties/parties.json`](parties/parties.json), with their on-chain ids in
  [`parties/parties.testnet.json`](parties/parties.testnet.json).
- **One FakeUsd pressing per release**: edition 1, max supply 250, fixed prices between 8 and 20
  FakeUsd. FakeUsd is a testnet dollar with a public faucet.

Release, pressing and listing ids, publish digests and gas used are in
[`releases/registry.testnet.json`](releases/registry.testnet.json). Use those files rather
than copying ids from anywhere else; the apps read the same data.

Each release lives in `releases/<artist>-<release>/`:

| File | What it is |
|---|---|
| `release.json` | Network-neutral release intent (the `miso` CLI schema): title, artists, tracks. |
| `release-config.testnet.json` | Testnet bindings: party ids, Walrus ids, credits, the FakeUsd pressing. |
| `masters.json` | Stored media: master blob ids, PCM digests, HLS quilt ids. |
| `generation.json` | ElevenLabs Music prompt and song id per track (plus any gain change). |
| `publication-*.testnet.{json,log}` | CLI result and log of the publish. |
| `assets/` | Cover and FLAC masters. Not committed (gitignored); fetch them with `scripts/fetch-masters.ts`. |

## Quick starts

All of these need [Node.js](https://nodejs.org) and npm; the repo scripts need [Bun](https://bun.sh).

### The catalog app (no key)

```sh
cd apps/spa && npm install && npm run dev     # http://localhost:5173
```

### The game (Sui testnet)

```sh
cd apps/game && npm install && npm run dev    # http://localhost:5173
```

The game always runs on Sui testnet; there is no offline or mock mode (an in-memory mock
adapter exists only for the game's automated tests). Without keys it shows the live catalog
and real previews, but the till stays closed. It runs fully in the browser on two testnet keys you create and fund yourself (a
player wallet and the game's collector), baked into the build from `apps/game/.env.local`.
FakeUSD comes from an in-game ATM that mints from the public faucet. The keys end up in the
built JavaScript, so a hosted keyed build must sit behind access control; see
[apps/game/README.md, "Sui testnet"](apps/game/README.md#sui-testnet).

### Explore the catalog with misofm/skills

Clone [misofm/skills](https://github.com/misofm/skills) and work inside the checkout, or
install it as a Claude Code plugin (see its README). Its scripts cover what the workshop
did:

- Catalog reads, no key: `bun scripts/releases.ts list | show <releaseId> | records <address>`.
- A testnet wallet and FakeUsd: `bun scripts/wallet.ts new`, then SUI from
  <https://faucet.sui.io>, then `bun scripts/fakeusd.ts 100`.
- Music generation: `bun scripts/generate-track.ts "<prompt>" --seconds 30` (needs your own
  ElevenLabs API key).
- A single's release files: `bun scripts/scaffold-single.ts`.
- Buying and moving Records: `bun scripts/buy-record.ts <releaseId>` and
  `bun scripts/transfer-record.ts <recordId> <toAddress>`.

Or ask an agent with the skills installed, for example: "Use the miso skills to list every
release on Miso testnet and show me the credits for one of them."

## How the catalog was made

The pipeline is reproducible with public tools. The scripts that talk to the chain or to
Walrus shell out to the `miso` CLI, found through the `MISO_CLI` environment variable
(a command string; default `miso` on your `PATH`). A shell alias is not visible to scripts,
so set the variable:

```sh
git clone https://github.com/misofm/cli && cd cli && bun install
export MISO_CLI="bun $PWD/src/index.ts"          # for the scripts in this repo
alias miso="bun $PWD/src/index.ts"               # optional, for your own shell
```

The signer is `SUI_PRIVATE_KEY` (a `suiprivkey…` string; **testnet only**), and it pays its
own gas. `bun scripts/new-key.ts <name>` writes a fresh key to `keys/<name>.key` (gitignored)
and prints its address. Install the repo's own dependencies with `bun install` at the root.

```sh
bun catalog/scripts/generate-audio.ts      # ElevenLabs Music → PCM (ELEVENLABS_API_KEY in .env; see .env.example)
bun catalog/scripts/generate-covers.ts     # procedural covers
bun scripts/organize-releases.ts           # PCM → STREAMINFO-only FLAC masters in releases/*/assets
python3 scripts/remaster-hot-tracks.py     # gain down masters that peak above −2 dBTP (transcoder ceiling)
bun scripts/create-parties.ts              # 31 parties, profiles, band memberships
bun scripts/store-media.ts                 # blob ids, stems, Walrus storage, HLS transcode → releases/*/masters.json
bun scripts/build-release-intents.ts       # release.json + release-config.testnet.json
bun scripts/publish-releases.ts            # dry run → publish → releases/registry.testnet.json
bun scripts/export-app-config.ts           # registry → apps/game/public/shop.testnet.json
```

Notes on individual steps:

- `store-media.ts [--only <folder>] [--epochs 53]` runs `miso blobs id`, `miso stems identify`,
  `miso blobs store` through the public Walrus publisher
  (`https://publisher.walrus-testnet.walrus.space`) and `miso transcode --to-walrus`, and
  records the results in `releases/*/masters.json`.
- `build-release-intents.ts [--only <folder>] [--owner 0x…]`: the owner defaults to the
  address of `SUI_PRIVATE_KEY`.
- `publish-releases.ts [--only <folder>] [--dry-run]`: run with `--dry-run` first.

**Shortcut without ElevenLabs.** `bun scripts/fetch-masters.ts` downloads the 50 FLAC masters
and the covers from the public Walrus aggregator
(`https://aggregator.walrus-testnet.walrus.space`) by blob id into `releases/*/assets/`, and
verifies each file with `miso blobs id` (or by byte length when the CLI is not available).
Options: `--only <folder>`, `--track <NN-slug>`, `--no-cover`, `--out <dir>`. From there you
can run the steps from `create-parties.ts` onward.

**Re-running on this checkout.** Every chain and storage step is resumable and records its
results in the committed files: `create-parties.ts` skips parties already in
`parties/parties.testnet.json`, `store-media.ts` skips steps already in `masters.json`, and
`publish-releases.ts` skips releases already in `releases/registry.testnet.json`. On a fresh
clone they therefore do nothing until you move the relevant file aside (or use a copy of the
repo). Re-publishing creates **new** releases owned by your address; the originals stay as
they are.

**Costs and limits.**

- Generating audio needs your own ElevenLabs API key and its usage limits.
- Creating parties and publishing need testnet SUI: about 0.5 SUI per release for the publish
  (see `gasUsedMist` in the registry), plus a little per party. The faucet gives limited
  amounts per request.
- Storage through the public Walrus publisher is free on testnet but bounded in time. The
  workshop media was stored on 2026-10-04 for 53 epochs (one day each on testnet), so it
  expires on Walrus around 2026-11-26. After that the public aggregator stops serving it.

**Where media is served from.** `cdn.miso.fm` serves only media Miso uploaded itself; anything
else 404s there, and the apps fall back to the public Walrus aggregator. The ten workshop
releases are served by both. Media you store yourself is served by the aggregator only.

## Repository layout

```text
catalog/            catalog.json (10 releases × 5 tracks: prompts, palettes), generation and cover scripts
parties/            parties.json (31 fictional parties) + parties.testnet.json (on-chain ids)
releases/           one folder per release (table above) + registry.testnet.json
scripts/            the pipeline, new-key.ts and fetch-masters.ts
apps/spa/           keyless catalog web app (React + Vite)
apps/game/          record-shop game (Three.js), static, Sui testnet
examples/           live-mini-spa, billboard.patch, second-collector.patch
keys/               your own testnet keys (gitignored; created by scripts/new-key.ts)
```

## Licensing

- Code is licensed under Apache-2.0; see [LICENSE](LICENSE).
- The generated catalog media and data (audio, covers, release and party metadata, prompts)
  are © Miso Labs, Inc., all rights reserved, and are not covered by the code license; see
  [NOTICE.md](NOTICE.md).
- Third-party assets in the game (textures, character models, fonts) keep their own licenses;
  see [apps/game/docs/ASSETS.md](apps/game/docs/ASSETS.md).

## Limitations

This is Sui testnet only. Testnet can be reset, which would remove the releases, parties and
Records; the files in this repo would then describe objects that no longer exist. The game's
two testnet keys are compiled into its JavaScript bundle: anyone who can load a keyed build has
them, so they are for testnet only and a hosted keyed build belongs behind access control.
FakeUsd has no value. The
TypeScript `miso` CLI is the current tool; a Rust core will eventually replace it.
