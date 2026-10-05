# Effect port: Nozomi · Playback

The application layer (boot, chain calls, flows, state, audio/world lifetimes, input
wiring) runs as one [Effect](https://effect.website) program. The look, the copy, the
timings, the Three.js world and the MisoAdapter wire behaviour are unchanged; the tests
in `tests/` pin that down (only harness internals changed, never expectations).

Effect version: `effect@4.0.0-rc.112` (v4 RC, the one `@misofm/platform` needs). v4 APIs
used: `Context.Service`, `Layer`, `Effect.fn` / `Effect.gen`, `Schema`, `Data.TaggedError`,
`SubscriptionRef`, `Schedule`, `FiberSet`, `Scope`, `Effect.acquireRelease`.

## Shape

```
main.ts ── Effect.runFork(App) ── one top-level error boundary (log with context + toast)
   │
   └─ AppLayer (built in a fixed order: same DOM / listener order as before)
        Config ─────────────► URL params, parsed once with Schema
        PendingSales ───────► localStorage pending-sale entries, Schema-validated
        Chain (Config, PendingSales) ─► MisoAdapter wrapped: typed errors, timeouts, read retries
        World (scoped) ─────► GameWorld via acquireRelease (dispose on scope close)
        Ui ─────────────────► Hud, Minimap, Dialogs, Intro, TitleCard (DOM)
        Audio (scoped) ─────► AudioContext lifetime, RecordDeck, ShopAmbience, gesture unlock
        Input (scoped) ─────► window/document listeners via acquireRelease, guarded
        ErrorBoundary ──────► report(context, cause): console.error + plain-language toast
        GameState ──────────► SubscriptionRef<GameState>; every change through step()
        Loading (Ui) ───────► intro progress derived from the loading Effects themselves
        Controller (all) ───► GameController + flows; flows run as fibers in a FiberSet
```

## Services and files (`src/app/`)

| Service | File | Notes |
| --- | --- | --- |
| `Config` | `app/config.ts` | `parseConfig(search)` decodes every URL param once with `Schema` (chain, latency, fail, mockhls, quality, backend, adapt, exposure, ui, cameo, debug, gallery, particles, rain, hide, shadows). Invalid values fall back exactly as before (same console warnings). `urlConfig()` is the memoised parse of `location.search`; the low-level readers (quality.ts, atmosphere.ts, world.ts, cameo.ts, ui-visibility.ts, select.ts, debug.ts, main.ts) read it instead of `URLSearchParams`. |
| `Chain` | `app/chain.ts`, `app/errors.ts` | Wraps a `MisoAdapter`. Every operation is an `Effect<A, ChainError>`. Methods call the adapter lazily (`adapter.purchase(...)` at run time) so test spies on the adapter still count calls. |
| `PendingSales` | `app/pending-sales.ts` | Schema for `PendingSale`; localStorage with the in-memory fallback the testnet backend had. Corrupt JSON or an invalid entry is dropped and logged, never thrown. Exposes the synchronous `PendingStore` that `miso/testnet/sell.ts` needs (it saves the digest *before* submission, synchronously). Injected into `TestnetAdapter` → `TestnetBackend`. |
| `GameState` | `app/game-state.ts` | `SubscriptionRef<GameState>`; `dispatch(action)` runs the pure `step()` (unchanged, still in `game/state.ts`), logs refusals and, in dev builds, `invariantViolations()` exactly as before. `changes` is a `Stream` for observers. |
| `Flows` | `game/flows/*` | purchase / sell / withdraw / smash / exit beat are `Effect`s run in the controller's `FiberSet` (started synchronously, so the pending screen still swaps in within the same key press). |
| `Audio` | `app/audio.ts` | Scoped AudioContext (closed on release), resume on the Enter gesture with the same "retry on next key / pointer" fallback, visibility suspend/resume. |
| `World` | `app/world.ts` | `acquireRelease(new GameWorld(host), w => w.dispose())`. Scene code stays imperative. World callbacks (`onMove`, `onNear`, …) are wrapped by the error boundary so an app-layer throw can never kill the render loop. |
| `Input` | `app/input.ts` | Scoped, guarded listener registration (see deviations). |
| `Loading` | `app/loading.ts` | `track(effect, weight, tauMs)` drives `Intro.track` from the Effect's own start / exit. |
| `ErrorBoundary` | `app/boundary.ts` | Defects: `console.error("[app] <context>", cause)` + one toast, rate-limited. |

## Error types (`app/errors.ts`)

All are `Data.TaggedError`s with `{ op, message, cause }`; `message` is always the
player-safe text the adapter produced (or the existing timeout copy), so the dialogs show
exactly the words they showed before.

| Tag | When |
| --- | --- |
| `InsufficientFunds` | short on FakeUSD (testnet `PlayerError.kind === "fusd"`) |
| `SoldOut` | every copy minted (`soldOut`) |
| `Network` | connection dropped (`network`); the only error reads retry on |
| `Timeout` | a read (or our outer safety timeout on a read) took too long |
| `ResponseLost` | a transaction's answer was lost (adapter timeout on purchase / sell / withdraw, mock `*-lost`, or our outer safety timeout): it may have landed; Retry is idempotent in the adapter |
| `Rejected` | everything else the adapter refused (gas / keys / disabled / price changed / not owned / mock failures) |

Timeouts (outer safety nets, deliberately longer than the testnet adapter's own 10 s
read / 30 s tx timeouts and the e2e's 20 s mock latency, so they never change today's
behaviour): reads 45 s, purchase / withdraw 120 s, sell 180 s (two txs + lookups).
Retry: reads only (catalog, wallet, collection, collector), on `Network` only, 2 retries,
exponential from 250 ms. Transactions are **never** retried automatically; idempotency
per operation stays inside the adapters exactly as before (testnet in-flight digest per
release, pending sales; mock lost-result maps).

## Interruption

Nothing the player does interrupts a chain call: Esc closes the screen only, Reset demo is
disabled while a transaction is pending, tab-hide releases keys and suspends audio
(STATE-MODEL.md §3, CONTROLS-AUDIT.md #13, #17, #32, #34). The only interrupter is the
app scope closing (page teardown / HMR). If a transaction fiber is interrupted while its
op is pending, it dispatches the matching `xFail` with the existing timeout copy, so state
is never stuck in `pending`; the adapter's idempotency makes a later Retry safe.

## Deliberate deviations from the brief

- **Input is not a Stream.** Routing depends on `preventDefault()` / `stopPropagation()`
  inside the capture-phase handler (CONTROLS-AUDIT #1, #3, #26, STATE-MODEL §2). A Stream
  or Queue delivers after dispatch has finished, too late to stop the event. `Input`
  therefore registers the same synchronous listeners in the same order, scoped
  (`acquireRelease`) and guarded (a throwing handler is reported, not propagated).
- **Render is synchronous on dispatch.** `GameState.changes` exists, but `render()` still
  runs inside `dispatch()` so the DOM is current when the key handler returns (tests and
  the double-confirm guard rely on this).
- **The world's own listeners** (player movement, pointer lock, resize) stay inside the
  Three.js code; only their lifetime moved under the `World` scope.

## Migration order (each step: `npm run build` + `npm run test:unit` green)

1. Bump `@unconfirmed/sui-effect` to 0.2.2.
2. This plan.
3. `errors.ts`, `chain.ts`, `pending-sales.ts` (+ testnet backend injection) with unit tests.
4. `config.ts` + readers, `game-state.ts`, with unit tests.
5. Controller + flows on `Chain` / `GameState` / `FiberSet`; harness `makeGame()` rewired.
6. `World`, `Ui`, `Audio`, `Input`, `Loading`, `ErrorBoundary`; `main.ts` = one Layer graph + `Effect.runFork`.
7. Parity: build, unit, e2e (loop, state-safety, ui-shots), visual diff vs `baseline-pre-effect`, bundle size.
