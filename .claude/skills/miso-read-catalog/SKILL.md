---
name: miso-read-catalog
description: Read the Miso music catalog on Sui testnet with no API key — discover releases, fetch titles, credits, genres, lyrics, cover art, HLS audio, pressings, listings and the Records a wallet owns — and build web apps on top. Use when building or debugging a Miso catalog app, player, or collection viewer.
---

# Read the Miso catalog (no key, no signup)

Three public services cover every read. All send `Access-Control-Allow-Origin: *`, so
a browser app can call them directly with no backend.

| Need | Service |
|---|---|
| Which releases exist | Sui GraphQL `https://graphql.testnet.sui.io/graphql` |
| Release, track, credit, party, pressing, listing, Record data | Miso read API `https://api.testnet.miso.fm/v1` |
| Cover images and audio | Miso CDN `https://cdn.miso.fm/v1`, then the Walrus testnet aggregator on a 404 |

`references/endpoints.md` lists every endpoint with a sample response.

## Setup

```sh
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
git clone https://github.com/misofm/cli ~/miso-cli && (cd ~/miso-cli && bun install && bun link)
miso --help
```

`bun link` installs the `miso` command from the CLI's `bin` entry into `~/.bun/bin`; the
`export PATH` line puts it on `PATH`.

```sh
miso deployment --json     # ids, Move types and endpoints for your app's config file
miso releases              # every release: id, title, artist
miso release show <id>     # one release with tracks, cover, streams, pressing and price
miso records <address>     # Records an address owns
```

Use these to see what the API returns before you write app code. Confirm the endpoints
in your app against `endpoints` in the `miso deployment --json` output.

## 1. Discover releases

There is no "list releases" endpoint. Ask the chain for every object of the Release
type and paginate. Read the type string from `result.types.release` in
`miso deployment --json` and put it in your app's one config file, next to the
endpoints, as a literal.

```graphql
query($type: String!, $after: String) {
  objects(first: 50, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes { address }
  }
}
```

## 2. Load a release in one call

`GET /v1/protocol/releases/{id}?include=trackCredits` returns title, kind, description,
genres, release credits, the cover blob id, and every track with its recording and
composition ids, master metadata (`samples`, `sample_rate_hz`), `transcodeQuiltId`, and
per-track recording and composition credits, plus `state` (`{ type: "Published", … }`),
`publishedAtMs`, and `primaryArtists` (display names, the easiest artist label). Keep
releases whose `state.type` is `Published`, sort by `publishedAtMs` (newest first), and
cache responses in memory.

- Duration of a track: `master.samples / master.sample_rate_hz`.
- Lyrics: `GET /v1/compositions/{compositionId}/lyrics` (decoded text).
- Artist: `GET /v1/parties/{partyId}` plus `/profile`, `/members`, `/links`.

## 3. Media URLs

```text
cover   https://cdn.miso.fm/v1/blobs/{coverBlobId}?w=512&f=webp      (w: 256 | 512 | 1024)
stream  https://cdn.miso.fm/v1/blobs/by-quilt-id/{transcodeQuiltId}/master.m3u8
preview https://cdn.miso.fm/v1/blobs/by-quilt-id/{transcodeQuiltId}/aac-96.m3u8
```

Streams are HLS (fMP4 AAC; renditions `aac-96`, `aac-160`, `aac-256`, 6 s segments).
Play them with `hls.js` (the full package ships TypeScript types; `hls.js/light` is
smaller but needs a `.d.ts` shim); Safari plays them natively. Headless Chromium
(Playwright) decodes AAC too, so playback is testable. The
official app previews 30 seconds from the middle of the track at `aac-96`, with a 1 s
fade-in and a 5 s fade-out:

```ts
const duration = Number(track.master.samples) / track.master.sample_rate_hz;
const start = Math.max(0, duration / 2 - 15);            // 30 s window around the middle
const hls = new Hls({ startPosition: start });
hls.loadSource(`${CDN}/blobs/by-quilt-id/${track.transcodeQuiltId}/aac-96.m3u8`);
hls.attachMedia(audio);
audio.volume = 0;
audio.addEventListener("timeupdate", () => {
  const t = audio.currentTime - start;
  if (t >= 30) return audio.pause();
  audio.volume = Math.max(0, Math.min(1, t, (30 - t) / 5)); // 1 s fade in, 5 s fade out
});
audio.play();
```

The Miso CDN serves only media that Miso hosts (the workshop catalog and Miso releases).
Media published by anyone else, including releases published with `publish-release`,
lives on Walrus and returns 404 from the CDN. Request the CDN first; on a 404, request
the same path once from the public Walrus testnet aggregator (CORS ok; no `?w=`
resizing, slower). Do that in `<img onError>` for covers and on a fatal hls.js network
error for HLS (segment URLs are relative, so switching the playlist URL is enough):

```text
cover   https://aggregator.walrus-testnet.walrus.space/v1/blobs/{coverBlobId}
preview https://aggregator.walrus-testnet.walrus.space/v1/blobs/by-quilt-id/{transcodeQuiltId}/aac-96.m3u8
```

## 4. Commerce data

- A Pressing id is derived, not looked up. `pressingKey` is `result.types.pressingKey` in
  `miso deployment --json`; keep it in your config file:

  ```ts
  import { bcs } from "@mysten/sui/bcs";
  import { deriveObjectID } from "@mysten/sui/utils";
  const pressingId = deriveObjectID(releaseId, PRESSING_KEY, bcs.u16().serialize(edition).toBytes());
  ```

  Try editions 1, 2, … until a 404. Add the SDK with `bun add @mysten/sui@2.29.0`.
- `GET /v1/platform/pressings/{pressingId}` → edition, supply, max supply.
- `GET /v1/platform/pressings/{pressingId}/listing?currencyType={FakeUsd type}` → listing id,
  pricing (`fixed` or `floor` amount in base units), currency symbol and decimals, state.
  `currencyType` is required; the FakeUsd type is `result.fakeUsd.type` in
  `miso deployment --json`.
- `GET /v1/platform/wallets/{address}/records` → every Record an address owns, with
  release, pressing, edition number, price and buyer. Poll it to show purchases live.

## Gotchas

- Unknown query parameters return **400** (so no cache busters; only `v=` is accepted).
- Do not send a `Cache-Control` request header from the browser; it is not in the
  CORS allow-list.
- About 300 requests per minute per IP. A room full of attendees behind one NAT can
  hit it: one release call per release, cache, and avoid tight polling loops.
- IDs are 0x-prefixed 64-hex Sui addresses; Walrus ids are 43-character base64url.
- Testnet holds a few older test releases besides the workshop catalog, including the
  same EP published three times; that is real chain data, not an app bug.
