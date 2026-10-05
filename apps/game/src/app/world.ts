/**
 * World: the Three.js GameWorld as a scoped service (see docs/EFFECT.md).
 *
 * Owns: the world's lifetime. Built with acquireRelease, so `dispose()` (stop the render
 * loop, remove the world's own listeners, free the renderer) runs when the app scope
 * closes, and only then. Scene code stays imperative and untouched.
 * The factory is injected (main.ts passes `new GameWorld(host)`) so this module never
 * pulls the Three.js graph into code that only needs the service tag (unit tests).
 */
import { Context, Effect, Layer } from "effect";
import type { GameWorld } from "../world/world";
import { Shell } from "./ui";

/** Anything with a dispose() (GameWorld, or a fake in tests). */
export const acquireWorld = <W extends { dispose(): void }>(make: () => W) =>
  Effect.acquireRelease(Effect.sync(make), (w) => Effect.sync(() => w.dispose()));

export class World extends Context.Service<World, GameWorld>()("app/World") {
  /** `make(host)` builds the world into the shell's <main id="world">. */
  static layerWith(make: (host: HTMLElement) => GameWorld): Layer.Layer<World, never, Shell> {
    return Layer.effect(
      World,
      Effect.gen(function* () {
        const { worldHost } = yield* Shell;
        return yield* acquireWorld(() => make(worldHost));
      }),
    );
  }
}
