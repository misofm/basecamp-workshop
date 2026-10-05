/**
 * Controller: the GameController on the app services (see docs/EFFECT.md).
 *
 * Owns: the app-scoped FiberSet the flows run in (purchase / sell / withdraw / smash /
 * exit beat / boot / chain reads), defects from it going to the ErrorBoundary, and the
 * `window.__game` debug hooks (removed on scope close). Closing the Scope interrupts every
 * running flow; the transaction flows then mark their op failed with the timeout copy so
 * state is never stuck pending.
 * `makeController` is shared by `Controller.layer` (main.ts) and the unit harness.
 * Must not: build the world / audio / UI (their own services do; the harness fakes them).
 */
import { Cause, Context, Effect, Exit, FiberSet, Layer, type Scope } from "effect";
import { GameController, type ControllerDeps } from "../game/controller";
import { installDebugHooks } from "../debug";
import { Chain } from "./chain";
import { GameState } from "./game-state";
import { ErrorBoundary } from "./boundary";
import { Input, type InputApi } from "./input";
import { Audio, type AudioApi } from "./audio";
import { Ui } from "./ui";
import { World } from "./world";

export type MakeControllerDeps = Omit<ControllerDeps, "run" | "listen" | "startAudio"> & {
  readonly input: InputApi;
  readonly audio: Pick<AudioApi, "start">;
};

export const makeController = (deps: MakeControllerDeps): Effect.Effect<GameController, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { input, audio, ...rest } = deps;
    const boundary = deps.boundary;
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
    return new GameController({ ...rest, run, listen: input.listenSync, startAudio: audio.start });
  });

export class Controller extends Context.Service<Controller, GameController>()("app/Controller") {
  static readonly layer: Layer.Layer<Controller, never, World | Chain | GameState | Audio | Ui | ErrorBoundary | Input> = Layer.effect(
    Controller,
    Effect.gen(function* () {
      const world = yield* World;
      const chain = yield* Chain;
      const gameState = yield* GameState;
      const audio = yield* Audio;
      const ui = yield* Ui;
      return yield* makeController({
        world,
        chain,
        gameState,
        deck: audio.deck,
        ambience: audio.ambience,
        hud: ui.hud,
        minimap: ui.minimap,
        dialogs: ui.dialogs,
        intro: ui.intro,
        titleCard: ui.titleCard,
        boundary: yield* ErrorBoundary,
        input: yield* Input,
        audio,
      });
    }),
  );
}

/** `window.__game` (src/debug.ts); deleted when the app scope closes. */
export const DebugHooks: Layer.Layer<never, never, World | Chain | Controller | Audio> = Layer.effectDiscard(
  Effect.gen(function* () {
    const world = yield* World;
    const chain = yield* Chain;
    const controller = yield* Controller;
    const audio = yield* Audio;
    yield* Effect.acquireRelease(
      Effect.sync(() => installDebugHooks(world, chain.adapter, controller, audio.deck)),
      () => Effect.sync(() => void delete (window as unknown as { __game?: unknown }).__game),
    );
  }),
);
