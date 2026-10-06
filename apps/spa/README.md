# Open Catalog

A small music catalog web app that reads [Miso](https://miso.fm)'s catalog on **Sui testnet** straight from the
browser. No signup, no API key, no backend: every request goes from your browser to a public endpoint.
Reading needs no wallet; connect one (testnet) to buy a record with FakeUSD test money.

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
Sui GraphQL ── objects(filter: { type: Release }) ──> release ids
   (polled every 15 s while the tab is visible)
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

Write path (only with a connected wallet; reading never needs one):

Your wallet (Wallet Standard, via dApp Kit) ── signs ──> listing::purchase   (buy the next copy, pays FakeUSD)
                                                    └─> faucet::mint       (100 FakeUSD, testnet only)
Sui fullnode (gRPC-web) <── balances (every 15 s), simulate before signing, wait for the transaction
```

There is no "list releases" endpoint, so the chain itself is the index. The app pages through every live object of
the Release type on testnet. The home page re-runs discovery every 15 s (paused while the tab is
hidden, one request at a time); new releases appear at the top marked "new". Each release is fetched from the Miso
API once and cached, so a poll costs one GraphQL request plus one call per new release. Everything else comes from the Miso read API and CDN.

`cdn.miso.fm` serves only media that Miso uploaded itself, which includes the ten workshop releases. Anything
else (for example a release you published yourself through the public Walrus publisher) 404s there, so covers
(`<img onError>`) and HLS (a fatal hls.js network error) retry once from the public Walrus aggregator
(`WALRUS_AGGREGATOR` in `src/config.ts`). It serves the same `/blobs/...` paths, without `?w=` resizing, and is
slower. See `src/lib/media.ts`.

## Wallet (write path)

Buying a record and the Faucet page are the only writes. They use dApp Kit 2.x (`@mysten/dapp-kit-react`),
testnet only. The wallet picker lists every Wallet Standard browser wallet plus the Slush web wallet.

- **What is signed:** `listing::purchase` on the record shop (a FakeUSD payment of exactly the listed price, the
  price you expect, and the pressing; the new Record goes to you), or `faucet::mint` + `coin::from_balance` for
  100 FakeUSD. See `src/lib/transactions.ts`. The app never sees a key; the wallet signs.
- **Simulate before sign:** before the wallet opens, the app re-reads the pressing and listing (bypassing the
  cache), checks your FakeUSD, and simulates the transaction on the fullnode. That catches "sold out" and
  "paused" and estimates gas, so a wallet with too little SUI gets a clear message and a link to the Sui faucet
  instead of a failed transaction.
- **After a purchase:** the app reads your Record's number from the chain, refreshes the pressing until the API
  shows the new supply, and refreshes your balances and collection.
- **Faucet page:** mints FakeUSD to the connected wallet. Testnet SUI for gas comes from the official Sui
  faucet, which can't be prefilled: paste your address.
- **Code-split:** the kit and the transaction code load as a separate chunk after the page (`src/wallet/`), so
  the read-only app's first load barely grows.
- `npm run simulate` dry-runs both transactions from node without a wallet (`scripts/simulate.ts`).

## Why `@mysten/dapp-kit-react`?

It is the current dApp Kit for `@mysten/sui` 2.x: small, framework-agnostic core (nanostores + web components)
with thin React bindings. The older `@mysten/dapp-kit` (1.x) is the legacy kit; it pulls in react-query, Radix and
vanilla-extract.

## Why plain `fetch` and not `@misofm/api-client`?

- Every request is a visible URL you can copy into a browser or `curl`.
- Nothing extra to learn: one file (`src/lib/miso.ts`) holds every endpoint as a small typed function.
- The live request log in the "How this works" drawer is trivial when all calls go through one wrapper.
- The endpoints are documented by the live OpenAPI document at `https://api.testnet.miso.fm/v1/openapi.json`.
  `@misofm/api-client@0.26.0` wraps the same endpoints if you prefer typed methods.

## Why `@mysten/sui`?

For reading, one function. A Pressing's object id is derived deterministically from its release id and edition number
(`deriveObjectID` + `bcs.u16`), so the app computes it locally instead of needing an indexer.
See `derivePressingId` in `src/lib/sui.ts`. The wallet path also uses it to build and simulate transactions.

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
src/lib/http.ts                   fetch wrapper: in-memory cache (or "reload"), 404 -> null, request logging
src/lib/requestLog.ts             request log store + useRequestLog(); media + fullnode requests via PerformanceObserver
src/lib/sui.ts                    listReleaseIds() (GraphQL, every Release) and derivePressingId()
src/lib/miso.ts                   typed read functions for the Miso API + small release helpers
src/lib/useCatalog.ts            catalog with 15 s polling and "new" ids
src/lib/media.ts                  CDN URLs, aggregator fallback and formatting (time, kind, roles, ids)
src/lib/types.ts                  API response types (only the fields used)
src/lib/useAsync.ts               { data, error, loading, retry } for an async function
src/lib/transactions.ts           purchase + faucet transactions, balances, simulation, the bought record
src/lib/txErrors.ts               any transaction error -> a short message (cancelled, sold out, gas, ...)
src/wallet/store.ts               wallet state + useWallet() (main bundle, no wallet code)
src/wallet/WalletRuntime.tsx      lazy chunk: dApp Kit, connect modal, balance polling
src/wallet/actions.ts             lazy chunk: buy / mint flows (fresh checks, simulate, sign, read result)
src/player/PlayerProvider.tsx     one <audio> + hls.js, queue, preview window, fades
src/player/PlayerBar.tsx          persistent bottom player
src/components/Layout.tsx         header, nav, page outlet, player bar, drawer
src/components/HowItWorks.tsx     drawer: steps, endpoint list, live request log
src/components/ReleaseCard.tsx    cover + title + artist card
src/components/ReleaseGrid.tsx    grid of cards with loading skeletons
src/components/TrackRow.tsx       tracklist row: play, credits, lazy lyrics
src/components/RecordBox.tsx      pressings and price for a release
src/components/BuyPanel.tsx       Buy button and its states (lazy)
src/components/WalletButton.tsx   header: Connect wallet, or address + FakeUSD balance with a menu
src/components/GasNote.tsx        "not enough SUI for gas" + Sui faucet link
src/components/CopyAddressButton.tsx  copy an address to the clipboard
src/components/RecordCard.tsx     an owned record on the Collection page
src/components/CreditList.tsx     credited names linking to artist pages
src/components/ErrorMessage.tsx   error with a retry button
src/components/Icons.tsx          inline SVG icons and the equalizer
src/pages/*.tsx                   Home, Release, Artist, Collection, Faucet (lazy), 404
scripts/simulate.ts               npm run simulate: dry-run both transactions without a wallet
tests/smoke.spec.ts               Playwright smoke tests against the live testnet
tests/wallet.spec.ts              wallet UI, buy/faucet states (live simulation) with a mock wallet that rejects signing
tests/mockWallet.ts               a minimal Wallet Standard wallet for tests (what dApp Kit needs from a wallet)
```
