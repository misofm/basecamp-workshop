/**
 * Audio: the deck, the ambience and the AudioContext lifetime (see docs/EFFECT.md).
 *
 * Owns: `start()`, called by the controller on the Enter gesture: resume the context and
 * start the ambience now; if that fails (no gesture credit), retry on every key / pointer
 * down (capture phase, on window) until it works, then drop those listeners. Silent: no
 * prompt. On app scope close: drop the retry listeners and close the AudioContext.
 * Must not: make sounds (src/audio/* does).
 */
import { Context, Effect, Layer, type Scope } from "effect";
import { closeAudio, unlockAudio } from "../audio/context";
import { RecordDeck } from "../audio/deck";
import { ShopAmbience } from "../audio/ambience";

export interface AudioApi {
  readonly deck: RecordDeck;
  readonly ambience: ShopAmbience;
  /** Unlock audio + start the ambience now, retrying on the next key / pointer down. */
  readonly start: () => void;
}

export interface AudioDeps {
  readonly deck: RecordDeck;
  readonly ambience: ShopAmbience;
  /** Injected in tests; default: audio/context.ts. */
  readonly unlock?: () => Promise<void>;
  readonly close?: () => void;
  /** Where the retry listeners go (default: window). */
  readonly target?: EventTarget;
}

export const makeAudio = (deps: AudioDeps): Effect.Effect<AudioApi, never, Scope.Scope> => {
  const unlockFn = deps.unlock ?? unlockAudio;
  const close = deps.close ?? closeAudio;
  const target = deps.target ?? window;
  const unlock = () => {
    void unlockFn()
      .then(() => deps.ambience.start())
      .then(() => {
        target.removeEventListener("keydown", unlock, true);
        target.removeEventListener("pointerdown", unlock, true);
      })
      .catch(() => {});
  };
  const start = () => {
    unlock();
    target.addEventListener("keydown", unlock, true);
    target.addEventListener("pointerdown", unlock, true);
  };
  return Effect.acquireRelease(
    Effect.sync((): AudioApi => ({ deck: deps.deck, ambience: deps.ambience, start })),
    () =>
      Effect.sync(() => {
        target.removeEventListener("keydown", unlock, true);
        target.removeEventListener("pointerdown", unlock, true);
        close();
      }),
  );
};

export class Audio extends Context.Service<Audio, AudioApi>()("app/Audio") {
  static readonly layer: Layer.Layer<Audio> = Layer.effect(
    Audio,
    Effect.suspend(() => makeAudio({ deck: new RecordDeck(), ambience: new ShopAmbience() })),
  );
}
