/**
 * Bootstrap only: build the pieces and hand them to the GameController.
 *
 *   adapter  (src/miso)   chain access, chosen by ?chain=mock|testnet
 *   world    (src/world)  Three.js city + shop, behind WorldApi
 *   audio    (src/audio)  deck preview, sfx, ambience
 *   ui       (src/ui)     HUD, minimap, dialogs, boot cover (DOM only)
 *   controller (src/game/controller.ts) glues them; read it first.
 *
 * `?gallery=1` (all 100 Tamashi in a grid) or `?gallery=<id>` (one up close next to its
 * artwork) runs the visual-QA gallery (src/tamashi/gallery.ts) instead of the game.
 *
 * Must not: contain game logic. If you're adding behaviour, it goes in the controller.
 */
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "./ui/style.css";
import { Cause, Effect, Layer } from "effect";
import { GameWorld } from "./world/world";
import { Config, urlConfig } from "./app/config";
import { PendingSales } from "./app/pending-sales";
import { Chain } from "./app/chain";
import { GameState } from "./app/game-state";
import { Shell, Ui, UiParts } from "./app/ui";
import { World } from "./app/world";
import { Audio } from "./app/audio";
import { ErrorBoundary, type ErrorBoundaryApi } from "./app/boundary";
import { Input } from "./app/input";
import { Loading } from "./app/loading";
import { Controller, DebugHooks } from "./app/controller";

/** `prev` is built first, then `next` (with everything `prev` provides). */
const then =
  <A2, E2, R2>(next: Layer.Layer<A2, E2, R2>) =>
  <A1, E1, R1>(prev: Layer.Layer<A1, E1, R1>) =>
    Layer.provideMerge(next, prev);

/** Set once the ErrorBoundary is built, so a fatal error can toast if the Hud exists. */
let boundary: ErrorBoundaryApi | null = null;

/**
 * The app, built strictly in this order (same DOM / listener order as before the port):
 * <main id="world"> → adapter → GameWorld → Hud, Minimap, Dialogs, Intro → RecordDeck,
 * ShopAmbience → GameState → TitleCard → boundary → Input → Loading → GameController →
 * window.__game.
 */
const AppLayer = Config.layer.pipe(
  then(PendingSales.layer),
  then(Shell.layer),
  then(Chain.layer),
  then(World.layerWith((host) => new GameWorld(host))),
  then(UiParts.layer),
  then(Audio.layer),
  then(GameState.layer),
  then(Ui.layer),
  then(ErrorBoundary.layer),
  then(Layer.effectDiscard(ErrorBoundary.useSync((b) => void (boundary = b)))),
  then(Input.layer),
  then(Loading.layer),
  then(Controller.layer),
  then(DebugHooks),
);

/** The one top-level error boundary: log with context, toast if the Hud is up. */
const fatal = (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
  Effect.sync(() => {
    if (Cause.hasInterruptsOnly(cause)) return;
    if (boundary) boundary.report("fatal", cause);
    else console.error("[app] fatal", Cause.pretty(cause));
  });

/**
 * Boot (catalog / wallet / collection) and the world's assets load concurrently, then the
 * street compiles its GPU pipelines behind the loading screen; Enter appears when
 * everything is warm (and the records are on the shelves) so play never hitches. A failed
 * step never holds the intro: Enter appears regardless. Then the app lives until the page
 * goes away (its scope never closes, so the world keeps rendering).
 */
const program = Effect.gen(function* () {
  const loading = yield* Loading;
  const world = yield* World;
  const controller = yield* Controller;
  const { intro } = yield* Ui;
  const catalogStep = loading.step(2, 1500);
  const assetsStep = loading.step(5, 6000);
  const warmStep = loading.step(3, 3000, true);
  const load = Effect.all(
    [catalogStep.run(Effect.promise(() => controller.boot())), assetsStep.run(Effect.tryPromise(() => world.ready))],
    { concurrency: "unbounded", discard: true },
  ).pipe(Effect.andThen(warmStep.run(Effect.tryPromise(() => world.warmUp()))));
  yield* Effect.exit(load); // as `.catch(() => undefined)`: failures are ignored
  intro.setReady();
}).pipe(Effect.tapCause(fatal), Effect.exit, Effect.andThen(Effect.never));

const app = document.querySelector<HTMLDivElement>("#app")!;
const gallery = urlConfig().gallery;

if (gallery) {
  void import("./tamashi/gallery").then((m) => m.runGallery(app, gallery));
} else {
  Effect.runFork(program.pipe(Effect.provide(AppLayer), Effect.catchCause(fatal)));
}
