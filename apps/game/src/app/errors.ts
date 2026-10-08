/**
 * Typed chain errors: what a `Chain` operation can fail with (see docs/EFFECT.md).
 *
 * Owns: the tagged error classes and `classifyChainError`, which maps whatever a
 * MisoAdapter rejected with onto one of them.
 * Must not: import adapter implementations. Adapter errors are recognised by shape
 * (`name === "PlayerError"` + `kind`), anything else by message.
 *
 * `message` is always exactly the text the flows showed before the port
 * (`error instanceof Error ? error.message : String(error)`), so dialogs keep their words.
 */
import { Data } from "effect";

/** Which adapter operation failed. Reads: catalog, wallet, collection, collector. */
export type ChainOp = "catalog" | "wallet" | "collection" | "collector" | "purchase" | "withdraw" | "sell";

/** The player-facing timeout copy (same words as the adapters' own timeouts). */
export const TIMEOUT_MESSAGE = "Shop took too long. Try again.";

interface ChainErrorFields {
  readonly op: ChainOp;
  readonly message: string;
  readonly cause?: unknown;
}

/** Short on FakeUSD. */
export class InsufficientFunds extends Data.TaggedError("InsufficientFunds")<ChainErrorFields> {}
/** Every copy minted. */
export class SoldOut extends Data.TaggedError("SoldOut")<ChainErrorFields> {}
/** Connection dropped; the only error reads retry on. */
export class Network extends Data.TaggedError("Network")<ChainErrorFields> {}
/** A read took too long. */
export class Timeout extends Data.TaggedError("Timeout")<ChainErrorFields> {}
/** A transaction's answer was lost: it may have landed (Retry is idempotent in the adapter). */
export class ResponseLost extends Data.TaggedError("ResponseLost")<ChainErrorFields> {}
/** Anything else the adapter refused. */
export class Rejected extends Data.TaggedError("Rejected")<ChainErrorFields> {}

export type ChainError = InsufficientFunds | SoldOut | Network | Timeout | ResponseLost | Rejected;

/** Transactions (never retried; a timeout means "may have landed"). */
export function isTransactionOp(op: ChainOp): boolean {
  return op === "purchase" || op === "withdraw" || op === "sell";
}

/** The player-safe message the flows show for a rejection. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function playerErrorKind(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== "PlayerError") return null;
  const kind = (error as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

/** Map an adapter rejection to a ChainError (message unchanged). */
export function classifyChainError(op: ChainOp, error: unknown): ChainError {
  const fields: ChainErrorFields = { op, message: errorMessage(error), cause: error };
  const timeout = () => (isTransactionOp(op) ? new ResponseLost(fields) : new Timeout(fields));
  const kind = playerErrorKind(error);
  if (kind !== null) {
    switch (kind) {
      case "fusd":
        return new InsufficientFunds(fields);
      case "soldOut":
        return new SoldOut(fields);
      case "network":
        return new Network(fields);
      case "timeout":
        return timeout();
      default:
        return new Rejected(fields);
    }
  }
  if (fields.message === TIMEOUT_MESSAGE) return timeout();
  return new Rejected(fields);
}
