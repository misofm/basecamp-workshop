# Miso at Sui Basecamp: workshop repo

This is the take-home repo of the Miso workshop at Sui Basecamp. It contains a 50-track
fictional catalog (10 releases by 10 invented artists) published on Sui testnet with open
rights data, a keyless web app that reads that catalog straight from public endpoints, and
a small record-shop game where the records you buy are real on-chain objects paid for in
FakeUsd. Everything targets **Sui testnet**. Reading needs no account and no API key;
anything that writes to the chain needs a testnet wallet with a little SUI for gas.

## Follow along

Everything the workshop does on stage works from this folder with [Claude Code](https://claude.com/claude-code):
the skills it needs are in [`.claude/skills`](.claude/skills), and [`AGENTS.md`](AGENTS.md) tells the agent
where things are.

1. Install [Bun](https://bun.sh), ffmpeg (`brew install ffmpeg`) and Claude Code, then clone this repo.
2. Start `claude` in the repo folder.
3. Give it the prompts below, in order. The skills install the [`miso`](https://github.com/misofm/cli) CLI
   the first time they need it. For the publishing step you need a testnet wallet: ask Claude to "create a
   Miso wallet with the miso-wallet skill" (it writes `~/.miso/wallet.key`), then fund it with testnet SUI
   from [faucet.sui.io](https://faucet.sui.io/?network=testnet).

### 1. Publish an artist's releases

[`deliveries/`](deliveries) holds what an artist hands over: 10 release packages with metadata, credits,
covers, FLAC masters and a pressing each. Their media is already stored on Walrus, so publishing only
creates the parties, the releases and their FakeUsd pressings on Sui (about 5 SUI of gas, about 5 minutes).

> Check out the release packages in ./deliveries. Verify them with the verify-release skill, then publish them with the publish-release skill.

To publish the same packages again, reset them first: `git clean -fdX deliveries/`.

### 2. Build a catalog app with a record shop

> Using the miso-read-catalog and miso-record-shop skills, build a single-page web app in examples/catalog that lists every Miso release on testnet with its cover, plays a 30-second preview of any track, and lets me connect a Sui wallet to buy a release's record with FakeUSD, with a button to get 100 FakeUSD. No API key. New releases should appear without a reload. Keep it small: Vite, React and TypeScript. Don't write tests or browser-test it yourself; when it builds, start the dev server on localhost and give me the URL.

[`apps/spa`](apps/spa/README.md) is the finished reference app: release grid, release page with credits and
previews, artist and collection pages, buying with a Sui wallet, a FakeUsd faucet page, and a "How this
works" drawer that logs every public request it makes.

### 3. Miso inside a game

[`apps/game`](apps/game/README.md) is a third-person Three.js game: walk into a record shop, dig through
crates of the ten releases, preview a track on the listening deck, buy a Record at the counter, smash a
parked car with it, and sell it to a collector on the street.

To build its Miso layer yourself, switch to the starter (the same game with `src/miso/testnet-adapter.ts`
left as a stub), put two funded testnet keys in `apps/game/.env.local` (see `apps/game/.env.example`),
and run Claude Code from `apps/game`:

```sh
git checkout stage/starter && cd apps/game && npm install && claude
```

> Use the miso-game skill to connect this game to Miso testnet: implement src/miso/testnet-adapter.ts per its contract. Real shelves from public/shop.testnet.json (covers, titles, artists, turntable previews), buying at the counter with the player wallet, the ATM via the FakeUSD faucet, selling to Stonks with the game wallet, explorer links on receipts. No tests or browser checks. When it builds, start the dev server and give me the URL.

`git checkout main` brings back the finished game.

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

### Explore the catalog

The skills in `.claude/skills` cover more than the workshop shows. Ask Claude in this folder, for example:
"list every release on Miso testnet and show me the credits for one", "buy a record with the
miso-record-shop skill", or "send that record to my friend's address". In a terminal, the `miso` CLI does
the same: `miso releases`, `miso release show <id>`, `miso wallet`, `miso fakeusd mint 100`,
`miso record buy <releaseId>`, `miso record transfer <recordId> <address>`.

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
deliveries/         an artist's 10 release packages (verify and publish them in step 1)
examples/           apps you build during the workshop (not committed)
.claude/skills/     the Miso skills Claude Code uses in this repo
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
