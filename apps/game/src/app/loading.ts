/**
 * Loading: the intro's progress bar driven by the loading Effects themselves.
 *
 * Owns: `step(weight, tauMs, deferred?)`, which registers an Intro.track task right away
 * (progress is weight-relative, so register every step before any runs) and returns
 * `run(effect)`: a deferred step starts creeping when the effect starts; every step is
 * marked done when the effect exits (success, failure or interruption).
 * Must not: decide what loads or in which order (main.ts does).
 */
import { Context, Effect, Layer } from "effect";
import type { Intro } from "../ui/intro";
import { Ui } from "./ui";

export interface LoadingStep {
  run<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

export interface LoadingApi {
  step(weight: number, tauMs: number, deferred?: boolean): LoadingStep;
}

export function makeLoading(intro: Pick<Intro, "track">): LoadingApi {
  return {
    step(weight, tauMs, deferred = false) {
      const task = intro.track(weight, tauMs, deferred);
      return {
        run: (effect) =>
          Effect.suspend(() => {
            if (deferred) task.start();
            return effect;
          }).pipe(Effect.onExit(() => Effect.sync(task.done))),
      };
    },
  };
}

export class Loading extends Context.Service<Loading, LoadingApi>()("app/Loading") {
  static readonly layer: Layer.Layer<Loading, never, Ui> = Layer.effect(
    Loading,
    Ui.useSync((ui) => makeLoading(ui.intro)),
  );
}
