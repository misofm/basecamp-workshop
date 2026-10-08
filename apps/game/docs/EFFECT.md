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
   └─ AppLayer: a linear Layer.provideMerge chain, built top to bottom (same DOM /
      listener order as before the port)
        Config ─────────────► URL params, parsed once with Schema
        PendingSales ───────► localStorage pending-sale entries, Schema-validated
        Shell ──────────────► #app, <main id="world"> appended
        Chain ──────────────► MisoAdapter wrapped: typed errors, timeouts, read retries
        World (scoped) ─────► GameWorld via acquireRelease (dispose on scope close)
        UiParts ────────────► Hud, Minimap, Dialogs, Intro (DOM)
        Audio (scoped) ─────► RecordDeck, ShopAmbience, gesture unlock, AudioContext close
        GameState ──────────► SubscriptionRef<GameState>; every change through step()
        Ui ─────────────────► UiParts + TitleCard (constructed here, as before)
        ErrorBoundary ──────► report(context, cause): console.error + plain-language toast
        Input (scoped) ─────► guarded listeners via acquireRelease in the app scope
        Loading ────────────► intro progress derived from the loading Effects themselves
        Controller ─────────► GameController + flows; flows run as fibers in a FiberSet
        DebugHooks (scoped) ► window.__game (deleted on scope close)
```

## Services and files (`src/app/`)

| Service | File | Notes |
| --- | --- | --- |
| `Config` | `app/config.ts` | `parseConfig(search)` decodes every URL param once with `Schema` (latency, fail, mockhls (e2e test build only), quality, backend, adapt, exposure, ui, cameo, debug, gallery, particles, rain, hide, shadows). Invalid values fall back exactly as before (same console warnings). `urlConfig()` is the memoised parse of `location.search`; the low-level readers (quality.ts, atmosphere.ts, world.ts, cameo.ts, ui-visibility.ts, select.ts, debug.ts, main.ts) read it instead of `URLSearchParams`. |
| `Chain` | `app/chain.ts`, `app/errors.ts` | Wraps a `MisoAdapter`. Every operation is an `Effect<A, ChainError>`. Methods call the adapter lazily (`adapter.purchase(...)` at run time) so test spies on the adapter still count calls. |
| `PendingSales` | `app/pending-sales.ts` | Schema for `PendingSale`; localStorage with an in-memory fallback. Corrupt JSON or an invalid entry is dropped and logged, never thrown. Exposes a synchronous `PendingStore` for adapter code that must save a digest *before* submission. Injected into `TestnetAdapter` (select.ts). |
| `GameState` | `app/game-state.ts` | `SubscriptionRef<GameState>`; `dispatch(action)` runs the pure `step()` (unchanged, still in `game/state.ts`), logs refusals and, in dev builds, `invariantViolations()` exactly as before. `changes` is a `Stream` for observers. |
| `Flows` | `game/flows/*` | purchase / sell / withdraw / smash / exit beat are `Effect`s run in the controller's `FiberSet` (started synchronously, so the pending screen still swaps in within the same key press). |
| `Audio` | `app/audio.ts` | `start()` (called by the controller on the Enter gesture) is the old unlock: resume + ambience now, capture-phase keydown / pointerdown retry listeners until it works. Release: drop those listeners, `closeAudio()` (audio/context.ts; also removes its visibility listener). Visibility suspend/resume unchanged. |
| `World` | `app/world.ts` | `acquireRelease(make(host), w => w.dispose())`; `main.ts` passes `host => new GameWorld(host)` (`World.layerWith`), so unit tests can use the tag without loading Three.js. `dispose()` stops the loop, removes the world's own four listeners, disposes the renderer. Scene code stays imperative. World callbacks (`onMove`, `onNear`, …) are wrapped by the error boundary so an app-layer throw can never kill the render loop. |
| `Shell`, `UiParts`, `Ui` | `app/ui.ts` | DOM pieces, split only so construction order stays exactly as before (TitleCard after the audio objects). |
| `Input` | `app/input.ts` | `listen(target, type, handler, options?)`: `addEventListener` now, guarded (report context = event type), removed on scope close; `listenSync` for the controller constructor (see deviations). |
| `Loading` | `app/loading.ts` | `step(weight, tauMs, deferred?)` registers an `Intro.track` task at once; `.run(effect)` starts a deferred step when the effect starts and marks it done on any exit. |
| `ErrorBoundary` | `app/boundary.ts` | Defects: `console.error("[app] <context>", cause)` + one toast, rate-limited. One instance, shared by the controller's FiberSet, guarded callbacks, Input and the top-level `fatal` handler in main.ts (context `fatal`; console only if the Hud was never built). |

## Error types (`app/errors.ts`)

All are `Data.TaggedError`s with `{ op, message, cause }`; `message` is always the
player-safe text the adapter produced (or the existing timeout copy), so the dialogs show
exactly the words they showed before.

| Tag | When |
| --- | --- |
| `InsufficientFunds` | short on FakeUSD (`PlayerError.kind === "fusd"`) |
| `SoldOut` | every copy minted (`soldOut`) |
| `Network` | connection dropped (`network`); the only error reads retry on |
| `Timeout` | a read (or our outer safety timeout on a read) took too long |
| `ResponseLost` | a transaction's answer was lost (adapter timeout on purchase / sell / withdraw, the test MockAdapter's `*-lost`, or our outer safety timeout): it may have landed; Retry is idempotent in the adapter |
| `Rejected` | everything else the adapter refused (gas / keys / disabled / price changed / not owned / injected MockAdapter failures in tests) |

### Timeouts

Outer safety nets only, for an adapter promise that never settles (before the port that
left the op `pending` forever). Each must stay well above the slowest path an adapter
can take before it gives up on its own, so they never fire on a slow-but-working call.
Firing early would be worse than useless: the transaction keeps running, and a Retry
could start a second one.

| Op | Net |
| --- | --- |
| reads | 90 s |
| purchase | 300 s |
| withdraw | 300 s |
| sell | 420 s |

Retry: reads only (catalog, wallet, collection, collector), on `Network` only, 2 retries,
exponential from 250 ms. Transactions are **never** retried automatically; idempotency
per operation stays inside the adapters (mock: lost-result maps).

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
3. `errors.ts`, `chain.ts`, `pending-sales.ts` with unit tests.
4. `config.ts` + readers, `game-state.ts`, with unit tests.
5. Controller + flows on `Chain` / `GameState` / `FiberSet`; harness `makeGame()` rewired.
6. `World`, `Ui`, `Audio`, `Input`, `Loading`, `ErrorBoundary`; `main.ts` = one Layer graph + `Effect.runFork`.
7. Parity: build, unit, e2e (loop, state-safety, ui-shots), visual diff vs `baseline-pre-effect`, bundle size.
