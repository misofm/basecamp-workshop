# Miso Records · After Hours

**Buy a record on Sui. Smash a car with it. Sell it on.**

A small third-person Three.js game for the Miso Basecamp workshop. You walk into a
record shop at night, dig through ten fictional releases, spin one on the listening
deck (30-second previews), buy it at the counter (a Record object minted to your
wallet), carry it outside, smash a parked car with it (heavyweight 180g vinyl: still
mint) and sell it to a collector on the street for more than you paid. A GTA-style HUD
tracks your FakeUSD, mission, minimap and the record in your hands.

All chain access goes through one interface, `MisoAdapter`. `npm run dev` runs on
`MockAdapter` (in-memory, fake ids, no network); `npm run stage` runs on `TestnetAdapter`
(real Sui testnet, real Records, real FakeUSD; see [Sui testnet](#sui-testnet-stage-setup)).

## Run

```sh
npm install
npm run dev          # http://localhost:5173  (mock chain by default)
npm run build && npm run preview   # production build, for rehearsals
npm run stage        # Sui TESTNET: bank server (:8787) + vite dev, testnet by default
```

### URL parameters

| Param | Values | What it does |
| --- | --- | --- |
| `?chain=` | `mock` (default) \| `testnet` | Picks the adapter (`src/miso/select.ts`). Fallback: `VITE_MISO_CHAIN`, then `mock`. |
| `?latency=` | ms (default 800) | Mock only: simulated latency for every adapter call. |
| `?fail=` | `purchase` \| `sell` \| `all` | Mock only: those transactions fail, to show the error + Retry UI. |
| `?mockhls=1` | | Mock only: every track streams a real testnet HLS quilt from `cdn.miso.fm` instead of the synth loop. |
| `?quality=` | `low` \| `high` | `low` starts at the lowest render scale (0.6) with bloom off, for weak GPUs and projectors on battery. Automated browsers (`navigator.webdriver`, e.g. Playwright) get `low` automatically; `high` opts out. Without it, quality adapts to the frame rate. |

Example: `/?chain=mock&latency=1500&fail=purchase`.

### Rerunning the demo

- The collector comes back about 20 s after buying from you (walks back to the bench,
  "Got any wax?"), and the sold release is back on the shelf, so you can run the whole
  loop again without reloading.
- **H → Reset demo (reload page)** reloads with the same URL parameters. The mock chain
  lives in memory, so that is a fresh wallet with 100 FUSD.

## Controls

| Key | Action |
| --- | --- |
| W A S D (or arrows) | Walk · **Shift** sprint |
| E / Enter | Interact (record, deck, counter, car, collector) |
| N | Next track on the deck (while playing, or standing at the deck) |
| I | Inspect the record in your hands |
| C | Your collection, read from the chain |
| M | Mute / unmute |
| H | Help (and **Reset demo**) |
| Esc | Close a menu |
| ↑ ↓ / W S, Enter / E / Space | Select and confirm in menus |
| L or drag, + / −, Home | Mouse look, zoom, reset camera |

## The loop

1. Spawn on the sidewalk, walk through the shop door.
2. **E** on a record → sleeve, liner notes, price, edition (minted / max supply) → *Pick up*.
3. **E** on the deck → place it → *Drop the needle* (30 s from mid-track) → *Next track* → *Take it back*.
4. **E** at the counter → *Pay* → "Processing on Sui…" → receipt with the Record object id,
   transaction digest and explorer links. Fails? Friendly message + *Retry*.
   Walking out with unpaid stock is blocked: "Oi! Pay for that first."
5. Outside, **E** on a parked car while holding the record → smash → **RECORD CONDITION: STILL MINT**.
6. **E** on the collector → "Sell *title* for N FUSD" (1.5× shop price) → the Record moves to
   their wallet, FakeUSD comes to yours, the cash counter counts up and they walk off with it.
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
      street-flow.ts     smash a car, sell to the collector, collector returns  (adapter.sellToNpc)
      collection-flow.ts C collection, H help + Reset demo
      context.ts         FlowContext: exactly what a flow may touch
    state.ts         PURE state machine (where each record is, ownership cache, pending op)
    objectives.ts    PURE mission text + waypoint target from state
    npc-buyers.ts    the collector: fake address + offer (1.5× price)
  miso/              ALL chain access. Nothing outside this folder knows about Sui.
    adapter.ts       interface MisoAdapter
    types.ts         ShopRecord, OwnedRecord, Wallet, NpcBuyer, …
    select.ts        createAdapter() from ?chain=
    mock-adapter.ts  MockAdapter (deterministic fake chain, latency + failure injection)
    testnet-adapter.ts  TestnetAdapter (lazy-loads testnet/: catalog, burner, chain, bank client)
    format.ts explorer.ts mock-catalog.ts
  world/             Three.js rendering + simulation behind WorldApi (api.ts); no money, no menus
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
  listOwnedRecords(): Promise<OwnedRecord[]>;
  sellToNpc(recordId: string, npc: NpcBuyer): Promise<{ digest: string; paid: bigint }>;
  explorerTxUrl(digest: string): string;
  explorerObjectUrl(objectId: string): string;
}
```

Money is `bigint` base units (FakeUSD, 6 decimals); display with `formatAmount()`.
Rejections must carry a message that is safe to show the player.

## Sui testnet (stage setup)

Mock mode needs nothing. Testnet mode needs a small bank server (`server/`, Bun) because
two things cannot happen in the browser: funding a brand-new burner wallet with gas, and
paying the player when the collector buys a Record. The server holds two testnet keys, the
**operator** (gas bank: funds new players, tops up the collector) and the **collector**
(receives sold Records and pays for them). Neither key ever reaches the browser. At the
workshop these were the presenter's keys; to run testnet mode yourself you need your own.

1. Create the two keys from the repo root (they go to `keys/` at the repo root, which is
   gitignored, and the address is printed):

   ```sh
   bun scripts/new-key.ts operator
   bun scripts/new-key.ts npc-buyer
   ```

   The server looks for `../../keys/operator.key` and `../../keys/npc-buyer.key` relative to
   `apps/game`; override with `OPERATOR_KEY` / `COLLECTOR_KEY` (paths to key files).
2. Fund the **operator** address with testnet SUI from <https://faucet.sui.io>. The collector
   needs no funding: it tops itself up with gas from the operator. FakeUSD needs no funding
   either: it is minted from the public FakeUSD faucet.
3. Run it from `apps/game`:

   ```sh
   npm install
   npm run stage            # bank server on :8787 + vite dev on :5173, testnet is the default chain
   npm run stage:preview    # same, but a production testnet build served by vite preview
   npm run server           # just the bank server (then open any build with ?chain=testnet)
   ```

   Port 8787 taken? `PORT=8790 npm run stage`: the Vite `/api` proxy follows `PORT` too.

Costs: each new player costs the operator about 0.2 SUI (sent once, when the burner wallet
has under 0.05 SUI), plus gas for the collector's top-ups and payouts. A faucet drip covers a
handful of players. Other knobs: `FUND_COOLDOWN_MS` (per address, default 10 min),
`FUND_MAX_PER_HOUR` (default 30), `MAX_PAYOUT` (default 150 FUSD), `DATA_DIR` (payout ledger,
default `server/data/`, gitignored).

### What lives where

| Piece | Where | Notes |
| --- | --- | --- |
| Shop catalog | `public/shop.testnet.json` | Thin list `[{ releaseId, edition, section }]`, up to 10 (one stand per entry; fewer leaves stands empty). `section` is one of the ten in-store bins. Everything else (title, artist, cover, tracks/quilts, price, minted / max supply) is read live. |
| Adapter | `src/miso/testnet-adapter.ts` | Thin class; lazy-loads `src/miso/testnet/*` so mock mode never downloads the Sui SDK. |
| Catalog reads | `src/miso/testnet/catalog.ts`, `miso-api.ts` | Keyless `api.testnet.miso.fm`: release, pressing, FakeUSD listing (cached). Covers and HLS from `cdn.miso.fm`. |
| Player wallet | `src/miso/testnet/burner.ts` | Burner Ed25519 key generated in the browser, kept in `localStorage` (`miso-game:burner:testnet`). **Testnet only**, anyone with the browser profile has the key. Clear site data to get a new wallet. |
| Chain calls | `src/miso/testnet/chain.ts` | gRPC fullnode (`fullnode.testnet.sui.io`). Purchase = `purchaseRecord()` from `@misofm/platform/pressing` (buyer pays gas); Records are read with `listOwnedObjects`. |
| Bank server | `server/` (Bun) | Holds the operator and collector keys. They never reach the browser. |

Bank endpoints (all JSON, errors are `{ error }` with a player-safe message):

- `GET /api/health`: addresses and operator SUI balance.
- `GET /api/collector`: the collector's real address and offer (3/2). The sell dialog shows this address (via `MisoAdapter.collectorAddress()`), and the adapter sends the Record to it.
- `POST /api/fund { address }`: if the player has under 0.05 SUI, sends 0.2 SUI, and if they have under 25 FUSD, mints 100 FUSD from the FakeUSD faucet. Both happen in one operator-signed PTB. The adapter calls it on first load when balances are low. Rate limited.
- `POST /api/collector/buy { recordId, digest }`: the player has already signed a transfer of the Record to the collector. The server checks on chain that the tx succeeded, was sent by the seller, moved that existing `record::Record` from the seller to the collector, and that it was bought in FakeUSD. It then pays 1.5× the Record's stored `purchase_price` (capped), with a faucet mint signed by the collector. Idempotent per digest and per record (`server/data/paid.json`).

### Trust model (honest version)

Selling to the collector is **not an atomic swap**. The player first transfers the Record to the
collector in their own transaction, and the bank server then pays them in a second, separate
transaction after it has seen the Record arrive. If the server is down or out of gas in between,
the collector holds the record unpaid until a Retry, which the adapter remembers and re-requests.
It is built this way because a Sui transaction has one sender (plus at most a gas sponsor), and owned objects can only be
spent by their owner. The player's Record and the collector's FakeUSD belong to two independent
owners, so neither key can move both in one transaction. Making it atomic needs a shared
escrow, kiosk or offer contract that both sides interact with, and that is out of scope for a
workshop demo that uses permissionless FakeUSD.

### Testing on testnet

`tests/e2e/testnet.spec.ts` runs read-only checks by default: the real catalog, burner wallet and
gRPC from the browser, and that mock mode never loads the SDK. The full buy → smash → sell →
collection loop spends testnet gas and is opt-in. It needs the bank server running with a funded
operator, and a burner key file so reruns reuse one wallet:

```sh
npm run server &   # bank server on :8787 (or PORT=<port>, and pass the same PORT below)
MISO_TESTNET_E2E=1 MISO_BURNER_KEY_FILE=/path/to/burner.key npx playwright test tests/e2e/testnet.spec.ts
```

## Verify

```sh
npm run build                     # tsc --noEmit (strict) + vite build
npm run test:unit                 # pure state machine + mock adapter (no browser)
npx playwright install chromium   # first time only
npm test                          # e2e: tests/e2e/*.spec.ts (mock mode)
```

The e2e suite builds the app, serves it with `vite preview` on port 5287 and drives the
whole loop with the keyboard at 1600×900 on SwiftShader (slow: several minutes; it runs
at `quality=low` automatically). `loop.spec.ts` covers the full loop including the
collector's return and the failure/Retry paths; `hls.spec.ts` plays a real HLS preview
(`?mockhls=1`, needs network access to `cdn.miso.fm`) and checks the deck's `<audio>`
time advances from mid-track. It
saves a screenshot per step to `$SHOTS_DIR` (default: `test-results/shots-loop/`, gitignored
and cleared by Playwright at the start of each run; the testnet spec uses
`test-results/shots-testnet/`). `window.__game` (see `src/debug.ts`) offers `teleportTo`,
`interact`, `press`, `failNext`, `setFailureMode`, `setLatency`, `state()`, `measure()`,
`deckDebug()` and `buyerReturnNow()`.

## Assets

See [docs/ASSETS.md](docs/ASSETS.md). UX notes: [docs/UX.md](docs/UX.md).
In mock mode all releases, artists and prices are fictional. Mock ids and digests are fake; their
explorer links will not resolve.
