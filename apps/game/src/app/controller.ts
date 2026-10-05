/**
 * makeController: builds the GameController on the app services (see docs/EFFECT.md).
 *
 * Owns: the app-scoped FiberSet the flows run in (purchase / sell / withdraw / smash /
 * exit beat / boot / chain reads) and the error boundary (defects → console + toast).
 * Closing the Scope interrupts every running flow; the transaction flows then mark their
 * op failed with the timeout copy so state is never stuck pending.
 * Must not: build the world / audio / UI (main.ts or the harness hands them in).
 */
import { Cause, Effect, Exit, FiberSet, type Scope } from "effect";
import { GameController, type ControllerDeps } from "../game/controller";
import { makeErrorBoundary } from "./boundary";

export type MakeControllerDeps = Omit<ControllerDeps, "run" | "boundary">;

export const makeController = (deps: MakeControllerDeps): Effect.Effect<GameController, never, Scope.Scope> =>
  Effect.gen(function* () {
    const boundary = makeErrorBoundary((text) => deps.hud.toast(text, { tone: "bad" }));
    const fork = yield* FiberSet.makeRuntime<never, unknown, unknown>();
    const run = <A>(name: string, effect: Effect.Effect<A>): Promise<A | undefined> =>
      new Promise<A | undefined>((resolve) => {
        // Defects are reported here and turned into `undefined`, so no failure ever reaches
        // the FiberSet (and nothing rejects). Starts synchronously.
        const safe = effect.pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
            boundary.report(name, cause);
            return Effect.succeed(undefined);
          }),
        );
        const fiber = fork(safe);
        fiber.addObserver((exit) => resolve(Exit.isSuccess(exit) ? exit.value : undefined));
      });
    return new GameController({ ...deps, run, boundary });
  });
