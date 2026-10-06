# Open Catalog

A small music catalog web app that reads [Miso](https://miso.fm)'s catalog on **Sui testnet** straight from the
browser. No signup, no API key, no backend: every request goes from your browser to a public endpoint.

It is the finished reference app for the workshop: plain React + TypeScript, plain `fetch`, plain CSS.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
npm run test:e2e   # Playwright smoke tests (builds and serves on port 4319)
```

## Data flow

```
Sui GraphQL ── objects(filter: { type: Release }) ── created at or after MIN_CHECKPOINT ──> release ids
   (polled every 15 s while the tab is visible; ?since=<checkpoint> overrides, ?since=0 shows all)
                                                         │
                                  one GET per release    ▼
Miso API  /protocol/releases/{id}?include=trackCredits ──> title, kind, cover blob id,
                                                           credits, tracks, track credits
   │                                                          │
   │  /compositions/{id}/lyrics      (when a track row opens) │ cover blob id, quilt id
   │  /platform/artists/{partyId}    (artist page)            ▼
   │                                               cdn.miso.fm ─> cover image (?w=512&f=webp)
   │                                                          └─> HLS audio: aac-96.m3u8 + .m4s segments
   │                                    on 404 / load error, once: Walrus aggregator, same paths (no ?w=)
   │
   │  pressing id = deriveObjectID(release id, PressingKey, edition)   (computed locally)
   ├─ /platform/pressings/{pressingId}            edition 1, 2, ... until the first 404
   ├─ /platform/pressings/{pressingId}/listing    price in FakeUSD
   └─ /platform/wallets/{address}/records         records a wallet owns (polled every 10 s)
```

There is no "list releases" endpoint, so the chain itself is the index. The catalog shows the releases created since
the demo started: the app pages through every live object of the Release type and keeps those whose creating
transaction is at or after `MIN_CHECKPOINT` in `src/config.ts` (the checkpoint of a release's first version).
`?since=<checkpoint>` picks another start and `?since=0` lists every Release on testnet. The home page re-runs discovery every 15 s (paused while the tab is
hidden, one request at a time); new releases appear at the top marked "new". Each release is fetched from the Miso
API once and cached, so a poll costs one GraphQL request plus one call per new release. Artist pages use the same
scope; the Collection page does not. Everything else comes from the Miso read API and CDN.

`cdn.miso.fm` serves only media that Miso uploaded itself, which includes the ten workshop releases. Anything
else (for example a release you published yourself through the public Walrus publisher) 404s there, so covers
(`<img onError>`) and HLS (a fatal hls.js network error) retry once from the public Walrus aggregator
(`WALRUS_AGGREGATOR` in `src/config.ts`). It serves the same `/blobs/...` paths, without `?w=` resizing, and is
slower. See `src/lib/media.ts`.

## Why plain `fetch` and not `@misofm/api-client`?

- Every request is a visible URL you can copy into a browser or `curl`.
- Nothing extra to learn: one file (`src/lib/miso.ts`) holds every endpoint as a small typed function.
- The live request log in the "How this works" drawer is trivial when all calls go through one wrapper.
- The endpoints are documented by the live OpenAPI document at `https://api.testnet.miso.fm/v1/openapi.json`.
  `@misofm/api-client@0.26.0` wraps the same endpoints if you prefer typed methods.

## Why `@mysten/sui`?

For one function. A Pressing's object id is derived deterministically from its release id and edition number
(`deriveObjectID` + `bcs.u16`), so the app computes it locally instead of needing an indexer.
See `derivePressingId` in `src/lib/sui.ts`.

## Notes

- **Rate limit:** the API allows roughly 300 requests per minute per IP. The app makes one request per release and
  caches every response in memory (`src/lib/http.ts`). Wallet records are the exception: they are never cached.
- **No cache busters:** the API rejects unknown query parameters with a 400.
- **Previews:** 30 seconds from the middle of each track, with a 1 s fade-in and 5 s fade-out.
- **On-chain ids and URLs:** see `src/config.ts`. It is the only file that contains them.

## Files

```
src/main.tsx                      routes and providers
src/config.ts                     network constants (ids, URLs, preview timing)
src/styles.css                    all styles; light and dark themes via CSS variables
src/lib/http.ts                   fetch wrapper: in-memory cache, 404 -> null, request logging
src/lib/requestLog.ts             request log store + useRequestLog(); media requests via PerformanceObserver
src/lib/sui.ts                    listReleaseIds() (GraphQL, since MIN_CHECKPOINT) and derivePressingId()
src/lib/miso.ts                   typed read functions for the Miso API + small release helpers
src/lib/useCatalog.ts            catalog with 15 s polling and "new" ids
src/lib/media.ts                  CDN URLs, aggregator fallback and formatting (time, kind, roles, ids)
src/lib/types.ts                  API response types (only the fields used)
src/lib/useAsync.ts               { data, error, loading, retry } for an async function
src/player/PlayerProvider.tsx     one <audio> + hls.js, queue, preview window, fades
src/player/PlayerBar.tsx          persistent bottom player
src/components/Layout.tsx         header, nav, page outlet, player bar, drawer
src/components/HowItWorks.tsx     drawer: steps, endpoint list, live request log
src/components/ReleaseCard.tsx    cover + title + artist card
src/components/ReleaseGrid.tsx    grid of cards with loading skeletons
src/components/TrackRow.tsx       tracklist row: play, credits, lazy lyrics
src/components/RecordBox.tsx      pressings and price for a release
src/components/RecordCard.tsx     an owned record on the Collection page
src/components/CreditList.tsx     credited names linking to artist pages
src/components/ErrorMessage.tsx   error with a retry button
src/components/Icons.tsx          inline SVG icons and the equalizer
src/pages/*.tsx                   Home, Release, Artist, Collection, 404
tests/smoke.spec.ts               Playwright smoke tests against the live testnet
```
