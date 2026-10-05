/**
 * Input: app-scoped, guarded event listeners (see docs/EFFECT.md, "Input is not a Stream").
 *
 * Owns: `listen(target, type, handler, options?)`, which calls `addEventListener` right
 * away (synchronously, so registration order, and with it routing order, is exactly the
 * caller's) and removes the listener when the app scope closes. The handler is wrapped by
 * the error boundary: a throw is reported (context = the event type), never rethrown into
 * the event dispatch. `preventDefault()` / `stopPropagation()` inside it work as before.
 * Must not: queue or defer events (a Stream would deliver after dispatch, too late to stop
 * the event).
 */
import { Context, Effect, Layer, Scope } from "effect";
import { ErrorBoundary, type ErrorBoundaryApi } from "./boundary";

export type Listen = (target: EventTarget, type: string, handler: (e: Event) => void, options?: boolean | AddEventListenerOptions) => void;

export interface InputApi {
  /** Register now; removed when the app scope closes. */
  readonly listen: (target: EventTarget, type: string, handler: (e: Event) => void, options?: boolean | AddEventListenerOptions) => Effect.Effect<void>;
  /** `listen`, run synchronously (for the controller's constructor). */
  readonly listenSync: Listen;
}

/** Build the Input API on `scope` (the app scope). */
export function makeInput(boundary: ErrorBoundaryApi, scope: Scope.Scope): InputApi {
  const listen: InputApi["listen"] = (target, type, handler, options) => {
    const guarded = boundary.guard(type, handler);
    return Effect.acquireRelease(
      Effect.sync(() => target.addEventListener(type, guarded, options)),
      () => Effect.sync(() => target.removeEventListener(type, guarded, options)),
    ).pipe(Effect.asVoid, Scope.provide(scope));
  };
  return { listen, listenSync: (target, type, handler, options) => Effect.runSync(listen(target, type, handler, options)) };
}

export class Input extends Context.Service<Input, InputApi>()("app/Input") {
  static readonly layer: Layer.Layer<Input, never, ErrorBoundary> = Layer.effect(
    Input,
    Effect.gen(function* () {
      const boundary = yield* ErrorBoundary;
      const scope = yield* Effect.scope;
      return makeInput(boundary, scope);
    }),
  );
}
