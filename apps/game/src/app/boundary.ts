/**
 * Error boundary: where app-layer bugs (defects) end up (see docs/EFFECT.md).
 *
 * Owns: `report(context, cause)` (console.error with context, plus one plain-language toast
 * at most every TOAST_INTERVAL_MS) and `guard(context, fn)`, which wraps a callback the app
 * hands to the world / audio / UI / window so a throw never escapes into the render loop
 * or the event dispatch.
 * Must not: rethrow, or show anything on the happy path (the toast is the only new copy
 * and only appears when something is actually broken).
 */
import { Cause, Context, Layer } from "effect";
import { Ui } from "./ui";

/** The only new player-facing copy of the port: shown on bug paths only. */
export const JAMMED_TOAST = "Something jammed. Try again.";
const TOAST_INTERVAL_MS = 5000;

export interface ErrorBoundaryApi {
  /** Log a defect with its context and (rate-limited) tell the player. Never throws. */
  report(context: string, cause: unknown): void;
  /** `fn`, except that a throw is reported and the call returns undefined. */
  guard<F extends (...args: any[]) => any>(context: string, fn: F): F;
}

export function makeErrorBoundary(toast: (text: string) => void): ErrorBoundaryApi {
  let lastToast = -Infinity;
  const report = (context: string, cause: unknown): void => {
    try {
      console.error(`[app] ${context}`, Cause.isCause(cause) ? Cause.pretty(cause) : cause);
    } catch {
      // console itself failed: nothing more we can do.
    }
    const now = Date.now();
    if (now - lastToast < TOAST_INTERVAL_MS) return;
    lastToast = now;
    try {
      toast(JAMMED_TOAST);
    } catch {
      // The toast layer is broken too; the console has it.
    }
  };
  const guard = <F extends (...args: any[]) => any>(context: string, fn: F): F =>
    function (this: unknown, ...args: unknown[]) {
      try {
        return fn.apply(this, args);
      } catch (error) {
        report(context, error);
        return undefined;
      }
    } as F;
  return { report, guard };
}

/** The app's one error boundary: toasts on the Hud. */
export class ErrorBoundary extends Context.Service<ErrorBoundary, ErrorBoundaryApi>()("app/ErrorBoundary") {
  static readonly layer: Layer.Layer<ErrorBoundary, never, Ui> = Layer.effect(
    ErrorBoundary,
    Ui.useSync(({ hud }) => makeErrorBoundary((text) => hud.toast(text, { tone: "bad" }))),
  );
}
