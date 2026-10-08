# Nozomi · Playback

**Buy a record. Smash a car with it. Sell it on.** (On Sui, under the hood.)

A small third-person Three.js game for the Miso Basecamp workshop, set in **Nozomi**, the
dystopian city of Studio Mirai's Tamashi story, at dusk on the afternoon of Book 3
"As The World Shook". You are **Gamer** (Tamashi #95). You leave the old hotel at the west
end of a grungy, retrofuturist back street (only three blocks still have power), walk east
to **Saisei Records**, dig through ten releases, spin one on the listening deck (30-second
previews) next to Inicio, pay **Jazz** at the counter (a Record object minted to your
wallet), smash the **dead Triangle self-driving sedan** across the street with it
(heavyweight 180g vinyl: still mint) and sell it to **Stonks** at his BUYING table for more
than you paid. Then you head home with Inicio, and the ground starts shaking. A GTA-style
HUD tracks your FakeUSD, mission, minimap and the record in your hands.

All chain access goes through one interface, `MisoAdapter`. The game always runs on
`TestnetAdapter` (real Sui testnet, real Records, real FakeUSD; see [Connecting the shop to Miso testnet](#connecting-the-shop-to-miso-testnet));
there is no offline or mock mode. `MockAdapter` (in-memory, fake ids, no network) exists only
for the automated tests: unit tests construct it directly and the e2e suite runs on a
`vite build --mode e2e` test build, the only build that contains it.
There is no server: everything runs in the browser.

## Run

```sh
npm install
npm run dev          # http://localhost:5173  (Sui testnet; keys from .env.local)
npm run build && npm run preview   # production build, for rehearsals
npm run stage        # Sui TESTNET: keyed build (.env.local) + vite preview on http://localhost:4173
npm run deploy       # npm run build && wrangler deploy (see "Hosted build" first!)
npm run typecheck    # tsc --noEmit
```

### Play

Open the page: a small loading screen ("NOZOMI · 再生") fills a bar while the street compiles,
then shows **Press Enter to continue** (a click works too). That press unlocks audio and starts
the game; any later key or click also unlocks audio silently if the browser still refuses it.
**U** hides all overlays (HUD, minimap, prompts, markers) for clean gameplay screenshots; `?ui=0`
starts hidden (after the loading screen). Look and copy rules: `docs/UI-STYLE.md`.

### URL parameters

| Param | Values | What it does |
| --- | --- | --- |
| `?quality=` | `high` \| `medium` \| `low` | `high` is the default on WebGPU (2K textures, full post-processing); `medium` is the WebGL2 fallback tier; `low` = 1K textures, tone mapping only, lowest render scale, low Tamashi detail, fewer particles (weak GPUs, projectors on battery). Automated browsers (`navigator.webdriver`, e.g. Playwright) start at `low` unless a tier is given. |
| `?backend=` | `webgpu` \| `webgl` | Forces the renderer backend (default: WebGPU when available, else WebGL2). The game logic never depends on it. |
| `?debug=1` | | Developer overlay (top centre): active backend, quality tier, render scale / AO / bloom, FPS / frame time, draw calls. Never shown otherwise. |
| `?ui=0` | | Starts with the overlay hidden (press **U** to show it). The loading screen still appears first. |
| `?exposure=` | `0.3`–`4` | Overrides the dusk exposure (default `2.1`, tuned on the WebGL2 fallback). Use it to match the look on the stage machine and projector, e.g. `?exposure=1.6`. |
| `?adapt=0` | | Pins adaptive quality as started (no render-scale / bloom changes), for screenshots and perf runs. |
| `?rain=1` | | Enables drizzle over the dusk street (off by default). |
| `?gallery=` | `1` \| `<id>` (1–100) | Visual QA for the Tamashi characters instead of the game (`src/tamashi/gallery.ts`): `1` shows all 100 in a grid, an id shows that one up close next to its artwork. |

Example: `/?quality=low&ui=0`.

The e2e test build (`vite build --mode e2e`, see [Verify](#verify)) also reads test-only knobs
for its MockAdapter (`?latency=`, `?fail=`, `?mockhls=1`, `?chain=testnet`; documented in
`src/miso/select.ts`). Every other build ignores them.

### Rerunning the demo

- Stonks comes back about 20 s after buying from you (walks back out to his BUYING
  table), and the sold release is back on the shelf, so you can run the whole loop again
  without reloading. The exit beat (heading home) happens once per session; the loop
  keeps working afterwards.
- **H → Reset demo (reload page)** reloads with the same URL parameters. The wallet is the
  baked-in testnet player key, so a reload keeps its balance and collection.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Walk · **Shift** sprint |
| Arrows | Turn / tilt the camera (keyboard-only camera; menus use arrows to move the selection) |
| Space | Jump |
| E / Enter | Interact (record, deck, counter, the sedan, Stonks, ATM, the hotel door) |
| N | Next track on the deck (while playing, or standing at the deck) |
| I | Inspect the record in your hands |
| C | Your collection, read from the chain (`listOwnedRecords()`) |
| M | Mute / unmute |
| H | Help (and **Reset demo**) |
| U | Hide / show the overlay (HUD, minimap, prompts, markers) for clean screenshots |
| Esc | Close the open menu (never does anything else; Enter / Esc / click also dismiss the chapter title card) |
| Arrows or W A S D, Tab, Enter / E / Space | Menus: move the selection (wraps; Tab stays in the dialog), confirm |
| L or drag, + / −, Home | Mouse look, zoom, reset camera |

C, H and I toggle their screen (press again to close). Menus can't open during the smash
swing or the exit beat. While a purchase, sale or withdrawal is pending the overlay stays
visible (U is ignored) and Help's *Reset demo* is disabled. Full audit:
[docs/CONTROLS-AUDIT.md](docs/CONTROLS-AUDIT.md); states, transitions and invariants:
[docs/STATE-MODEL.md](docs/STATE-MODEL.md).

## The loop

The street (`src/world/layout.ts`), west to east: the old hotel (Order's HQ, Gamer's home;
spawn at its side door), the shuttered Tamashi fitting center, **Saisei Records** (the shop,
door at the origin), **TriMart** (looted; the ATM in its open vestibule), the poster wall
with dead vending machines, and the back of the casino closing the east end (smoldering roof,
the band on the curb by its fire exit). Across the street: the diner, **Stonks's walk-up** with
his BUYING table, the scorched block and a rubble lot. The dead Triangle sedan sits at the south
curb across from the shop.

0. Short on FakeUSD? The mission points you to the **ATM in TriMart, next door**:
   **E** → *Withdraw 50* (its CRT greeting glitches on Gamer's real name, then reads
   "ACCOUNT HOLDER: GAMER") →
   "済 CASH OUT +50.00 FUSD" + *View receipt ↗* (devxplorer). The balance counter counts up.
1. Spawn at the hotel side door, walk east and into Saisei Records.
2. **E** on a record → a price tag: title, "Artist · #106/250" (the copy you would get), price → *Pick up*.
3. **E** on the deck → place it → *Drop the needle* (30 s from mid-track) → *Next track* → *Take it back*.
4. **E** at the counter (Jazz) → *Pay* → "PROCESSING ▮▮▮▯▯" → "領収 PAID" + *View receipt ↗*
   (devxplorer). Fails? Short message + *Retry* ("Jazz frowns: short on cash." when broke; the
   mission points at the ATM). Walking out with unpaid stock is blocked: "Oi! Pay for that first."
5. Outside, **E** on the dead Triangle sedan (`car:0`) while holding the record → smash →
   **RECORD CONDITION: STILL MINT**.
6. **E** on Stonks → "Stonks wants it: N FUSD for *title*" (1.5× shop price, capped at 150) → "済 SOLD" → the
   Record moves to his wallet, FakeUSD comes to yours, the cash counter counts up and he
   takes it inside.
7. **C** → your collection and sales history, read back via `listOwnedRecords()`.
8. **Exit beat**: "Head home with Inicio." **E** at the hotel
   door → the boom from the facility (camera shake, brown-out), iron footsteps far away →
   title card *Book 3 — Dawn of the Machin* → the mission reads "Home. Press H to reset." You can still walk around.
9. ~20 s after the sale Stonks is back at his table: pick another record and go again.

Everything the player sees reads like a normal game: no "Sui", "chain", "testnet", "wallet",
"digest" or "object" in the HUD, dialogs, toasts or errors (developer detail goes to the
console). The HUD shows no connection indicator at all;
receipts link out with one *View receipt ↗* (devxplorer). See `docs/UX.md`.

## Architecture

```
src/
  main.ts            bootstrap only: adapter, world, audio, UI → GameController
  debug.ts           window.__game test hook (Playwright + console)
  game/
    controller.ts    THE glue: world events → state → render() → world/audio/UI.  Read this first.
                     Also the exit beat (goHome) and the per-frame ambience mix (fire/diner/band/vending/street).
    flows/           the per-station screens + chain calls, each given a small FlowContext
      shop-flow.ts       record menu, inspect, listening deck
      checkout-flow.ts   cashier: pay → pending → receipt | error + Retry  (adapter.purchase)
      atm-flow.ts        the FakeUSD ATM: withdraw → pending → receipt | error + Retry  (adapter.withdrawFakeUsd)
      street-flow.ts     smash the sedan, sell to Stonks, Stonks returns  (adapter.sellToNpc)
      collection-flow.ts C collection, H help + Reset demo
      context.ts         FlowContext: exactly what a flow may touch
    state.ts         PURE state machine (where each record is, ownership cache, pending op, wentHome)
    objectives.ts    PURE mission text + waypoint target from state
    npc-buyers.ts    the collector (Stonks): display address + offer (1.5× price)
    jazz-notes.ts    Jazz's one-line note per catalog section (record dialog)
  miso/              ALL chain access. Nothing outside this folder knows about Sui.
    adapter.ts       interface MisoAdapter
    types.ts         ShopRecord, OwnedRecord, Wallet, NpcBuyer, WithdrawResult, …
    select.ts        createAdapter(): TestnetAdapter (MockAdapter only in the e2e test build)
    mock-adapter.ts  MockAdapter, TESTS ONLY (deterministic fake chain, latency + failure injection)
    testnet-adapter.ts  TestnetAdapter (a stub in this starter: implement it)
    format.ts explorer.ts mock-catalog.ts
  world/             Three.js rendering + simulation behind WorldApi (api.ts); no money, no menus
    layout.ts        every coordinate of the street (buildings, ATM, sedan, Stonks, hotel door, sound sources)
    city.ts          street, sidewalks, buildings · street-props.ts  poles, wires, festival bulbs, vending, debris
    atmosphere.ts    dusk sky, low western sun, fog, fire embers/smoke/ash, the brown-out dimming
    signage.ts       ALL Japanese strings (SIGNS) + the bilingual sign atlas (docs/SIGNAGE.md)
    environment-map.ts  HDRI image-based lighting · quality.ts  quality tiers (?quality=, ?backend=, adaptive, ?adapt=0)
    shop.ts atm.ts cars.ts npcs.ts player.ts …  (there is no traffic any more: traffic.ts is gone)
  tamashi/           the procedural Tamashi characters (player, clerk, collector, street crowd)
    character.ts     createTamashi(id): TV head + screen + body, procedural rig (walk, carry, swing, cheer)
    tv-head.ts screen.ts body.ts …  the parts character.ts assembles
    cast.ts          who plays whom: Gamer #95, Jazz the shopkeeper, Stonks the collector, the named story NPCs (spots in world/layout.ts CAST_SPOTS), the crowd
    traits.ts/.json  per-token traits hand-read from the artwork (© Studio Mirai, see NOTICE.md)
    gallery.ts       ?gallery= visual QA page
  audio/             deck.ts (HLS/synth previews), sfx.ts, ambience.ts, context.ts (master bus/mute)
  ui/                DOM only: hud.ts, minimap.ts, dialogs.ts, intro.ts (loading screen), title-card.ts (exit beat), ui-visibility.ts (U toggle), style.css
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
  readonly network: "mock" | "testnet"; // "mock" only in tests
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

## Connecting the shop to Miso testnet

The game runs on `src/miso/testnet-adapter.ts`, which is a **stub** in this starter: the
street, the shop, the deck and the smash all work, but every chain call (shelves, wallet,
buying, the ATM, the collection, selling to Stonks) fails with "Shop not connected yet."
Implement `MisoAdapter` in that file; the contract is in its header comment and in
`src/miso/adapter.ts` (data shapes in `src/miso/types.ts`). `public/shop.testnet.json` lists
the shelves (up to 10 `{ releaseId, edition, section }` entries).

The game runs **entirely in the browser** (no server, no `/api`)
on two testnet keys that are compiled into the build:

| Env var | Who | Signs |
| --- | --- | --- |
| `VITE_PLAYER_SUI_PRIVATE_KEY` | the player (one shared wallet) | ATM withdrawals, purchases, the Record transfer of a sale |
| `VITE_GAME_SUI_PRIVATE_KEY` | the game world = the collector NPC | the FakeUSD payout of a sale |

> [!WARNING]
> **`VITE_*` values are baked into the built JavaScript.** Anyone who can load a build made
> with these keys can read both of them from the bundle. Use testnet keys only, never a key
> that holds anything of value. **A hosted keyed build MUST be behind access control
> (Cloudflare Access). Never deploy a keyed build publicly.**
> Everyone who gets through Access shares one player wallet and one collection.

Setup:

1. Create the two keys from the repo root (they go to `keys/<name>.key` at the repo root,
   which is gitignored, and the address is printed):

   ```sh
   bun scripts/new-key.ts player
   bun scripts/new-key.ts game
   ```

2. Fund **both** addresses with testnet SUI at <https://faucet.sui.io> (each pays its own
   gas). FakeUSD needs no funding: the player gets it at the in-game ATM.
3. In `apps/game`, copy `.env.example` to `.env.local` (gitignored) and paste each key file's
   `suiprivkey1…` line:

   ```sh
   cp .env.example .env.local   # then edit: VITE_PLAYER_SUI_PRIVATE_KEY=…, VITE_GAME_SUI_PRIVATE_KEY=…
   ```

4. Build and serve on testnet (keys are read at build time, so rebuild after changing them):

   ```sh
   npm run stage    # vite build && vite preview → http://localhost:4173
   ```

   `npm run dev` also picks up `.env.local`.

## Verify

```sh
npm run typecheck                 # tsc --noEmit (strict)
npm run build                     # typecheck + vite build
npm run test:unit                 # state machine (every state × event), input routing (DOM), mock adapter, Effect services
npx playwright install chromium   # first time only
npm test                          # e2e: tests/e2e/*.spec.ts (MockAdapter test build)
```

The e2e suite builds the app with `vite build --mode e2e` (the only build that contains the
MockAdapter: deterministic data, `?latency=`, `?fail=` failure injection), serves it with `vite preview` on port 5287 and drives the
whole loop with the keyboard at 1600×900 on SwiftShader (slow: several minutes; it runs
at `quality=low` automatically). `loop.spec.ts` covers the full loop including the ATM,
the exit beat (title card), Stonks's return and the failure/Retry paths; `state-safety.spec.ts`
covers the nasty sequences (double confirm, Esc / tab switch / U / Reset during a pending
transaction, lost answers and Retry, keys during the smash and the exit beat, keys on the
loading screen); `hls.spec.ts` plays a real HLS preview
(the MockAdapter's `?mockhls=1`, needs network access to `cdn.miso.fm`) and checks the deck's `<audio>`
time advances from mid-track. It saves a screenshot per step to `$SHOTS_DIR` (default:
`test-results/shots-loop/`, gitignored and cleared by Playwright at the start of each run). `window.__game` (see `src/debug.ts`)
offers `teleportTo`, `interact`, `press`, `failNext`, `setFailureMode`, `setLatency` (the last three: e2e mock build only),
`state()`, `measure()`, `deckDebug()`, `buyerReturnNow()`, `crowdStats()` (street crowd:
on screen now, distinct Tamashi ids shown so far, and the named cast with id, name, spot, onScreen) and `tamashiGallery()` (opens `?gallery=1`).

## Assets

See [docs/ASSETS.md](docs/ASSETS.md). UX notes: [docs/UX.md](docs/UX.md). Every Japanese sign, with its English and where it hangs: [docs/SIGNAGE.md](docs/SIGNAGE.md) (`node scripts/gen-signage-doc.mjs` regenerates it; all Japanese is still awaiting native-speaker review). Tamashi and Nozomi © Studio Mirai.
In the MockAdapter (tests only) all releases, artists and prices are fictional. Mock ids and
digests are fake; their explorer (devxplorer) links will not resolve.

## Hosted build

`wrangler.jsonc` deploys `dist/` to Cloudflare Workers as static assets (`npm run deploy` =
`npm run build && npx wrangler deploy`). No server runs there.

**What gets deployed depends on whether `.env.local` holds keys when you build:**

- **No keys:** no secrets in the bundle. Safe to host publicly.
- **Keys:** both testnet keys are inside the deployed JavaScript in `dist/`. **Only deploy this behind Cloudflare Access**
  (or equivalent access control on the whole hostname, including `/assets/*`). Everyone behind
  Access shares the one player wallet and its collection; anyone who can load the page can
  extract the keys.
