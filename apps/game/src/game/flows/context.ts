/**
 * FlowContext: the small, explicit slice of the GameController that the per-station
 * flows (shop, checkout, street, collection) are allowed to use.
 *
 * Owns: the interface itself plus tiny shared helpers (error text).
 * Must not: grow into "the whole controller". If a flow needs something new, add one
 * narrowly named member here and wire it in GameController's constructor, so a reader
 * can see at a glance what a flow can touch.
 */
import { Cause, Effect, Option } from "effect";
import type { ChainApi } from "../../app/chain";
import { TIMEOUT_MESSAGE, type ChainError } from "../../app/errors";
import type { OwnedRecord, ShopRecord, Wallet } from "../../miso/types";
import type { WorldApi } from "../../world/api";
import type { Hud } from "../../ui/hud";
import type { Dialogs } from "../../ui/dialogs";
import type { GameAction, GameState } from "../state";

export interface FlowContext {
  readonly world: WorldApi;
  /** The chain (MisoAdapter wrapped: typed errors, timeouts). */
  readonly chain: ChainApi;
  readonly hud: Hud;
  readonly dialogs: Dialogs;
  /** Shop catalog by ShopRecord.id (loaded at boot; `minted` is bumped after a purchase). */
  readonly catalog: ReadonlyMap<string, ShopRecord>;

  /** The current state (always read fresh: it changes across awaits). */
  state(): GameState;
  /** Apply an action; false if the state machine refused it. Re-renders on success. */
  dispatch(action: GameAction): boolean;
  /** Re-read the wallet from the chain; updates the balance unless told not to. */
  refreshWallet(dispatchBalance?: boolean): Effect.Effect<Wallet, ChainError>;
  /** Re-read owned Records from the chain into state.owned. */
  refreshCollection(): Effect.Effect<OwnedRecord[], ChainError>;
  /**
   * Fork an Effect into the app's FiberSet. Starts synchronously (everything up to the
   * first async step runs before this returns). Defects are reported via the error
   * boundary; resolves undefined on a defect or interruption, never rejects.
   */
  run<A>(name: string, effect: Effect.Effect<A>): Promise<A | undefined>;
  /** Report a defect (bug) to the error boundary: console + rate-limited toast. */
  report(context: string, cause: unknown): void;
  /** Re-evaluate the HUD's "E · …" prompt (e.g. while a smash animation runs). */
  renderPrompt(): void;

  /** "12.50 FUSD" */
  money(amount: bigint): string;
}

/**
 * The player-facing text for a transaction flow's failure: a ChainError's message (exactly
 * the adapter's words), or, for a defect (a bug), the op's own `jammed` copy after
 * reporting it. Interruption-only causes return null (see `failPendingOnInterrupt`).
 */
export function failureText(ctx: Pick<FlowContext, "report">, context: string, cause: Cause.Cause<ChainError>, jammed: string): string | null {
  if (Cause.hasInterruptsOnly(cause)) return null;
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) return error.value.message;
  ctx.report(context, cause);
  return jammed;
}

type TxKind = "purchase" | "sell" | "withdraw";

/**
 * The failure / interruption ending shared by the transaction flows (purchase, sell,
 * withdraw). `body` runs after xStart was dispatched:
 *  - a ChainError or a defect ends in `onFail(text)` (failureText above), exactly like the
 *    old `catch (error)` block;
 *  - interruption (only when the app scope closes) dispatches `failAction(TIMEOUT_MESSAGE)`
 *    if the op is still pending, so state is never stuck in pending.
 */
export function transaction(
  ctx: Pick<FlowContext, "report" | "state" | "dispatch">,
  options: {
    readonly name: string;
    readonly kind: TxKind;
    readonly jammed: string;
    readonly failAction: (error: string) => GameAction;
    readonly onFail: (text: string) => void;
  },
  body: Effect.Effect<void, ChainError>,
): Effect.Effect<void> {
  return body.pipe(
    Effect.catchCause((cause) => {
      const text = failureText(ctx, options.name, cause, options.jammed);
      // Interruption only (no failure, no defect): let it propagate.
      if (text === null) return Effect.failCause(cause as Cause.Cause<never>);
      return Effect.sync(() => options.onFail(text));
    }),
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        const op = ctx.state().op;
        if (op?.kind === options.kind && op.status === "pending") ctx.dispatch(options.failAction(TIMEOUT_MESSAGE));
      }),
    ),
  );
}

/** A rejection's player-safe message. */
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
