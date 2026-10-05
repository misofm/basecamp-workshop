# Miso Records · After Hours

**Buy a record on Sui. Smash a car with it. Sell it on.**

A small third-person Three.js game for the Miso Basecamp workshop. You walk into a
record shop at night, dig through ten fictional releases, spin one on the listening
deck (30-second previews), buy it at the counter (a Record object minted to your
wallet), carry it outside, smash a parked car with it (heavyweight 180g vinyl: still
mint) and sell it to a collector on the street for more than you paid. A GTA-style HUD
tracks your FakeUSD, mission, minimap and the record in your hands.

All chain access goes through one interface, `MisoAdapter`. `npm run dev` runs on
`MockAdapter` (in-memory, fake ids, no network); `npm run stage` builds and serves the game on
`TestnetAdapter` (real Sui testnet, real Records, real FakeUSD; see [Sui testnet](#sui-testnet)).
There is no server: everything runs in the browser.

## Run

```sh
npm install
npm run dev          # http://localhost:5173  (mock chain by default)
npm run build && npm run preview   # production build, for rehearsals
npm run stage        # Sui TESTNET: keyed build (.env.local) + vite preview on http://localhost:4173
npm run deploy       # npm run build && wrangler deploy (see "Hosted build" first!)
npm run typecheck    # tsc --noEmit
```

### URL parameters

| Param | Values | What it does |
| --- | --- | --- |
| `?chain=` | `mock` (default) \| `testnet` | Picks the adapter (`src/miso/select.ts`). Fallback: `VITE_MISO_CHAIN` at build time, then `mock`. |
| `?latency=` | ms (default 800) | Mock only: simulated latency for every adapter call. |
| `?fail=` | `purchase` \| `sell` \| `withdraw` \| `all` | Mock only: those transactions fail, to show the error + Retry UI. |
| `?mockhls=1` | | Mock only: every track streams a real testnet HLS quilt from `cdn.miso.fm` instead of the synth loop. |
| `?quality=` | `low` \| `high` | `low` starts at the lowest render scale (0.6) with bloom off and low Tamashi detail, for weak GPUs and projectors on battery. Automated browsers (`navigator.webdriver`, e.g. Playwright) get `low` automatically; `high` opts out. Without it, quality adapts to the frame rate. |

| `?gallery=` | `1` \| `<id>` (1–100) | Visual QA for the Tamashi characters instead of the game (`src/tamashi/gallery.ts`): `1` shows all 100 in a grid, an id shows that one up close next to its artwork. |

Example: `/?chain=mock&latency=1500&fail=purchase`.

### Rerunning the demo

- The collector comes back about 20 s after buying from you (walks back to the bench,
  "Got any wax?"), and the sold release is back on the shelf, so you can run the whole
  loop again without reloading.
- **H → Reset demo (reload page)** reloads with the same URL parameters. The mock chain
  lives in memory, so that is a fresh wallet with 100 FUSD. On testnet the wallet is the
  baked-in player key, so a reload keeps its balance and collection.

## Controls

| Key | Action |
| --- | --- |
| W A S D (or arrows) | Walk · **Shift** sprint |
| E / Enter | Interact (record, deck, counter, car, collector, ATM) |
| N | Next track on the deck (while playing, or standing at the deck) |
| I | Inspect the record in your hands |
| C | Your collection, read from the chain |
| M | Mute / unmute |
| H | Help (and **Reset demo**) |
| Esc | Close a menu |
| ↑ ↓ / W S, Enter / E / Space | Select and confirm in menus |
| L or drag, + / −, Home | Mouse look, zoom, reset camera |

## The loop

0. Short on FakeUSD? The mission points you to the **FakeUSD ATM** by the shop door:
   **E** → *Withdraw 50 FUSD* (minted from the testnet faucet; on mock, from thin air) →
   receipt with the transaction digest. The balance counter counts up.
1. Spawn on the sidewalk, walk through the shop door.
2. **E** on a record → sleeve, liner notes, price, edition (minted / max supply) → *Pick up*.
3. **E** on the deck → place it → *Drop the needle* (30 s from mid-track) → *Next track* → *Take it back*.
4. **E** at the counter → *Pay* → "Processing on Sui…" → receipt with the Record object id,
   transaction digest and explorer links. Fails? Friendly message + *Retry* (not enough
   FakeUSD: "The ATM outside dispenses testnet dollars.").
   Walking out with unpaid stock is blocked: "Oi! Pay for that first."
5. Outside, **E** on a parked car while holding the record → smash → **RECORD CONDITION: STILL MINT**.
6. **E** on the collector → "Sell *title* for N FUSD" (1.5× shop price, capped at 150) → the
   Record moves to their wallet, FakeUSD comes to yours, the cash counter counts up and they
   walk off with it.
7. **C** → your collection and sales history, read back via `listOwnedRecords()`.
8. ~20 s later the collector is back on the spot: pick another record and go again.

## Architecture

```
src/
  main.ts            bootstrap only: adapter, world, audio, UI → GameController
  debug.ts           window.__game test hook (Playwright + console)
  game/
    controller.ts    THE glue: world events → state → render() → world/audio/UI.  Read this first.
    flows/           the per-station screens + chain calls, each given a small FlowContext
      shop-flow.ts       record menu, inspect, listening deck
      checkout-flow.ts   cashier: pay → pending → receipt | error + Retry  (adapter.purchase)
      atm-flow.ts        the FakeUSD ATM: withdraw → pending → receipt | error + Retry  (adapter.withdrawFakeUsd)
      street-flow.ts     smash a car, sell to the collector, collector returns  (adapter.sellToNpc)
      collection-flow.ts C collection, H help + Reset demo
      context.ts         FlowContext: exactly what a flow may touch
    state.ts         PURE state machine (where each record is, ownership cache, pending op)
    objectives.ts    PURE mission text + waypoint target from state
    npc-buyers.ts    the collector: display address + offer (1.5× price)
  miso/              ALL chain access. Nothing outside this folder knows about Sui.
    adapter.ts       interface MisoAdapter
    types.ts         ShopRecord, OwnedRecord, Wallet, NpcBuyer, WithdrawResult, …
    select.ts        createAdapter() from ?chain=
    mock-adapter.ts  MockAdapter (deterministic fake chain, latency + failure injection)
    testnet-adapter.ts  TestnetAdapter (lazy-loads testnet/: keys, catalog, chain, sell)
    format.ts explorer.ts mock-catalog.ts
  world/             Three.js rendering + simulation behind WorldApi (api.ts); no money, no menus
                     (the shop, street, cars, NPCs, the ATM)
  tamashi/           the procedural Tamashi characters (player, clerk, collector, street crowd)
    character.ts     createTamashi(id): TV head + screen + body, procedural rig (walk, carry, swing, cheer)
    tv-head.ts screen.ts body.ts …  the parts character.ts assembles
    cast.ts          who plays whom: Gamer #95, Jazz the shopkeeper, Stonks the collector, the named story NPCs (spots in world/layout.ts CAST_SPOTS), the crowd
    traits.ts/.json  per-token traits hand-read from the artwork (© Studio Mirai, see NOTICE.md)
    gallery.ts       ?gallery= visual QA page
  audio/             deck.ts (HLS/synth previews), sfx.ts, ambience.ts, context.ts (master bus/mute)
  ui/                DOM only: hud.ts, minimap.ts, dialogs.ts, intro.ts, style.css
```

Module boundaries (each file's header comment says what it owns and must not do):

- **world/** draws and reports (`onNear`, `onInteract`, `onMove`, `onZoneChange`,
  `onExitBlockedBump`); the controller tells it what to show (`setRecordPlace`,
  `setExitBlocked`, `setWaypoint`, `smashCar`, `buyerLeave`, `buyerReturn`, …).
- **game/state.ts** decides what is legal. `transition()` returns the same object when
  an action is refused, so the controller can tell.
- **ui/** never reads state or calls the adapter; the controller passes view data and
  action callbacks in.
- **miso/** is the only place a chain could be touched.

Every chain call follows one pattern (in `game/flows/`):
`dispatch(xStart)` → pending UI → `await adapter.x()` (never on the render loop) →
`dispatch(xSuccess)` + re-read wallet/collection | `dispatch(xFail)` → message + Retry.

### The MisoAdapter interface

```ts
interface MisoAdapter {
  readonly network: "mock" | "testnet";
  loadShopCatalog(): Promise<ShopRecord[]>;
  getWallet(): Promise<Wallet>;
  purchase(record: ShopRecord): Promise<{ recordId: string; digest: string }>; // resolves after finality
  withdrawFakeUsd(amount: bigint): Promise<{ digest: string; amount: bigint }>; // the ATM; after finality
  listOwnedRecords(): Promise<OwnedRecord[]>;
  sellToNpc(recordId: string, npc: NpcBuyer): Promise<{ digest: string; paid: bigint }>;
  collectorAddress(): Promise<string>; // where sold Records go (shown in the sell dialog)
  explorerTxUrl(digest: string): string;
  explorerObjectUrl(objectId: string): string;
}
```

Money is `bigint` base units (FakeUSD, 6 decimals); display with `formatAmount()`.
Rejections must carry a message that is safe to show the player.

## Sui testnet

Mock mode needs nothing. Testnet mode runs **entirely in the browser** (no server, no `/api`)
on two testnet keys that are compiled into the build:

| Env var | Who | Signs |
| --- | --- | --- |
| `VITE_PLAYER_SUI_PRIVATE_KEY` | the player (one shared wallet) | ATM withdrawals, purchases, the Record transfer of a sale |
| `VITE_GAME_SUI_PRIVATE_KEY` | the game world = the collector NPC | the FakeUSD payout of a sale |

> [!WARNING]
> **`VITE_*` values are baked into the built JavaScript.** Anyone who can load a build made
> with these keys can read both of them from the bundle (they sit in the lazily loaded testnet
> chunk). Use testnet keys only, never a key that holds anything of value. **A hosted keyed
> build MUST be behind access control (Cloudflare Access). Never deploy a keyed build publicly.**
> Everyone who gets through Access shares one player wallet and one collection.

Setup:

1. Create the two keys from the repo root (they go to `keys/<name>.key` at the repo root,
   which is gitignored, and the address is printed):

   ```sh
   bun scripts/new-key.ts player
   bun scripts/new-key.ts game
   ```

2. Fund **both** addresses with testnet SUI at <https://faucet.sui.io> (each pays its own
   gas). FakeUSD needs no funding: the ATM and the collector's payout mint it from the
   permissionless testnet FakeUSD faucet.
3. In `apps/game`, copy `.env.example` to `.env.local` (gitignored) and paste each key file's
   `suiprivkey1…` line:

   ```sh
   cp .env.example .env.local   # then edit: VITE_PLAYER_SUI_PRIVATE_KEY=…, VITE_GAME_SUI_PRIVATE_KEY=…
   ```

4. Build and serve on testnet (keys are read at build time, so rebuild after changing them):

   ```sh
   npm run stage    # VITE_MISO_CHAIN=testnet vite build && vite preview → http://localhost:4173
   ```

   `npm run dev` also picks up `.env.local`; open it with `?chain=testnet`.

Without keys the testnet build still loads the live catalog, and the intro says
"Wallet: Testnet keys missing: set VITE_PLAYER_SUI_PRIVATE_KEY and VITE_GAME_SUI_PRIVATE_KEY
in apps/game/.env.local, then rebuild." Buying, the ATM and selling stay unavailable.

Costs per loop: gas only, four transactions (ATM mint, purchase, Record transfer: player;
payout: game). FakeUSD is free.

Measured on testnet (one full loop, net gas after storage rebates):

| Transaction | Signer | Gas (SUI) |
| --- | --- | --- |
| ATM: withdraw 50 FUSD | player | 0.0024 |
| Purchase (8 FUSD record) | player | 0.0050 |
| Transfer Record to the collector | player | 0.0010 |
| Payout (12 FUSD) | game | 0.0024 |
| **Whole loop** | | **≈ 0.011** (player ≈ 0.0085, game ≈ 0.0024) |

So 1 testnet SUI in the player wallet covers roughly 100 loops.

When the player wallet runs out of gas the game says "The player wallet is out of testnet SUI
for gas. Fund VITE_PLAYER_SUI_PRIVATE_KEY's address at faucet.sui.io."; the collector's is the
same with `VITE_GAME_SUI_PRIVATE_KEY`.

### What lives where

| Piece | Where | Notes |
| --- | --- | --- |
| Shop catalog | `public/shop.testnet.json` | Thin list `[{ releaseId, edition, section }]`, up to 10 (one stand per entry; fewer leaves stands empty). `section` is one of the ten in-store bins. Everything else (title, artist, cover, tracks/quilts, price, minted / max supply) is read live. |
| Adapter | `src/miso/testnet-adapter.ts` | Thin class; lazy-loads `src/miso/testnet/*` so mock mode never downloads the Sui SDK or reads the keys. |
| Keys | `src/miso/testnet/keys.ts` | Parses the two `VITE_*` keys (ED25519 `suiprivkey`), cached. Missing / invalid → a player-safe message that never contains key text. |
| Catalog reads | `src/miso/testnet/catalog.ts`, `miso-api.ts` | Keyless `api.testnet.miso.fm`: release, pressing, FakeUSD listing (cached). Covers and HLS from `cdn.miso.fm`. |
| Chain calls | `src/miso/testnet/chain.ts` | gRPC fullnode (`fullnode.testnet.sui.io`). Purchase = `purchaseRecord()` from `@misofm/platform/pressing`; ATM and payout = `faucet::mint<FakeUsd>` → `coin::from_balance` → transfer. One transaction at a time per signer. |
| Sell | `src/miso/testnet/sell.ts` | The two-transaction sale and its retry rules (pure, injected chain; unit-tested in `tests/unit/testnet-sell.spec.ts`). |
| Session state | `src/miso/testnet/backend.ts` | Catalog cache, recent purchases / sales merged into lagging chain reads, pending sales in `localStorage` (`miso-game:pending-sales:testnet`). |
| Constants | `src/miso/testnet/config.ts` | Package ids, FakeUSD faucet + treasury ids, ATM max (100 FUSD), payout rule (3/2, cap 150 FUSD). |

### Trust model (honest version)

Selling to the collector is **not an atomic swap**. It is two transactions:

1. the **player** key transfers the Record to the GAME address;
2. the **GAME** key mints `min(floor(purchase_price × 3/2), 150 FUSD)` FakeUSD to the player.
   The price and currency (must be FakeUSD) are read from the Record on chain, never from the
   caller.

A Sui transaction has one sender (plus at most a gas sponsor) and owned objects can only be
spent by their owner, so neither key can move both the Record and the payment in one
transaction. Making it atomic needs a shared escrow, kiosk or offer contract, which is out of
scope for a workshop demo on permissionless FakeUSD. Since both keys are in the same bundle,
this protects against nothing anyway: it is about the game behaving correctly, not security.

Retry safety: a pending-sale entry in `localStorage` (`miso-game:pending-sales:testnet`, in
memory if storage is blocked) stores the transfer digest **before** the transfer is submitted
and the payout digest **before** the payout is submitted. On Retry:

- the player still owns the Record → if the stored transfer landed after all, skip to payment;
  otherwise start over (one transfer);
- the GAME owns it and no payout was attempted → pay now;
- the GAME owns it and a payout digest is stored → if it landed, return it (paid once); if it
  failed, pay again; if the node still doesn't know it after ~10 s, pay again. That last case
  is the one double-pay window (a payout that was submitted but not visible yet can land
  later); it only ever over-pays testnet FakeUSD, so it is accepted;
- the GAME owns it and there is no pending entry → "The collector already has this record."

A payout failure reads "The collector has your record but hasn't paid yet: … Press Retry to
ask again; the record won't be sent twice." Until it is paid the Record keeps showing in your
collection so you can Retry. The entry is cleared after a confirmed payout.

### Testing on testnet

`tests/e2e/testnet.spec.ts` runs read-only checks by default (no gas): the real catalog, gRPC
from the browser, the purchase PTB resolving for a funded sender (simulate only), and that
mock mode never loads the SDK. Built without keys it checks the "Testnet keys missing"
message; with keys, the HUD's player address. The full ATM → buy → smash → sell loop spends
testnet gas and is opt-in; it needs a keyed build with both addresses funded:

```sh
npm run stage    # in one shell (keyed build + vite preview on :4173)
# use the URL vite preview prints (4173, or the next free port)
MISO_E2E_BASE_URL=http://127.0.0.1:4173 MISO_TESTNET_E2E=1 npx playwright test tests/e2e/testnet.spec.ts
```

It buys the cheapest record on the shelves (`MISO_TESTNET_RECORD=<releaseId>` to choose) and
logs the ATM digest, purchase digest, Record id, sale digest and payout. Without
`MISO_E2E_BASE_URL`, Playwright builds its own copy with `vite build`, which reads `.env.local`
too.

## Verify

```sh
npm run typecheck                 # tsc --noEmit (strict)
npm run build                     # typecheck + vite build
npm run test:unit                 # state machine, mock adapter, testnet keys + sell logic (no browser)
npx playwright install chromium   # first time only
npm test                          # e2e: tests/e2e/*.spec.ts (mock mode + read-only testnet)
```

The e2e suite builds the app, serves it with `vite preview` on port 5287 and drives the
whole loop with the keyboard at 1600×900 on SwiftShader (slow: several minutes; it runs
at `quality=low` automatically). `loop.spec.ts` covers the full loop including the ATM,
the collector's return and the failure/Retry paths; `hls.spec.ts` plays a real HLS preview
(`?mockhls=1`, needs network access to `cdn.miso.fm`) and checks the deck's `<audio>`
time advances from mid-track. It saves a screenshot per step to `$SHOTS_DIR` (default:
`test-results/shots-loop/`, gitignored and cleared by Playwright at the start of each run;
the testnet spec uses `test-results/shots-testnet/`). `window.__game` (see `src/debug.ts`)
offers `teleportTo`, `interact`, `press`, `failNext`, `setFailureMode`, `setLatency`,
`state()`, `measure()`, `deckDebug()`, `buyerReturnNow()`, `crowdStats()` (street crowd:
on screen now, distinct Tamashi ids shown so far, and the named cast with id, name, spot, onScreen) and `tamashiGallery()` (opens `?gallery=1`).

## Assets

See [docs/ASSETS.md](docs/ASSETS.md). UX notes: [docs/UX.md](docs/UX.md).
In mock mode all releases, artists and prices are fictional. Mock ids and digests are fake; their
explorer links will not resolve.

## Hosted build

`wrangler.jsonc` deploys `dist/` to Cloudflare Workers as static assets (`npm run deploy` =
`npm run build && npx wrangler deploy`). No server runs there.

**What gets deployed depends on whether `.env.local` holds keys when you build:**

- **No keys:** mock mode by default; `?chain=testnet` shows the live catalog and plays real
  previews, and says "Testnet keys missing" for the wallet. Safe to host publicly.
- **Keys:** both testnet keys are inside the deployed JavaScript (even if the default chain is
  mock: the testnet chunk ships in `dist/`). **Only deploy this behind Cloudflare Access**
  (or equivalent access control on the whole hostname, including `/assets/*`). Everyone behind
  Access shares the one player wallet and its collection; anyone who can load the page can
  extract the keys. Set `VITE_MISO_CHAIN=testnet` when building to make testnet the default.
