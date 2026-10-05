// Thin chain helpers on top of SuiGrpcClient (gRPC; JSON-RPC is deprecated).
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Signer } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
import { isValidSuiAddress, normalizeSuiAddress, isValidTransactionDigest } from "@mysten/sui/utils";
import { chain } from "./config";
import { HttpError } from "./errors";

export const client = new SuiGrpcClient({ network: chain.network, baseUrl: chain.grpcUrl });

/** Strict address parse: 0x + exactly 64 hex chars (case-insensitive). Returns normalized lowercase. */
export function parseAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || !isValidSuiAddress(value)) {
    throw new HttpError(400, `"${field}" must be a Sui address (0x followed by 64 hex characters).`);
  }
  return normalizeSuiAddress(value.toLowerCase());
}

export function parseDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !isValidTransactionDigest(value)) {
    throw new HttpError(400, `"${field}" must be a Sui transaction digest.`);
  }
  return value;
}

/** Normalizes a Move type string so `77774c…::fakeusd::FakeUsd` and `0x77774c…::fakeusd::FakeUsd` compare equal. */
export function normalizeType(t: string): string {
  const m = /^(0x)?([0-9a-fA-F]+)::(.+)$/.exec(t.trim());
  if (!m) return t.trim();
  return `${normalizeSuiAddress(m[2]!.toLowerCase())}::${m[3]}`;
}

export async function getBalance(owner: string, coinType?: string): Promise<bigint> {
  const { balance } = await client.core.getBalance({ owner, coinType });
  return BigInt(balance.balance);
}

/** Simple async mutex so one signer never runs two txs at once (avoids gas-coin equivocation). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export interface ExecResult {
  digest: string;
}

/** Signs, executes, requires success and waits until the tx is visible to reads. */
export async function signExecuteAndWait(
  tx: Transaction,
  signer: Signer,
  label: string,
  /** Called as soon as the tx is known to have succeeded, before waiting for read visibility. */
  onExecuted?: (digest: string) => void,
): Promise<ExecResult> {
  const res = await client.core.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true } });
  if (res.$kind === "FailedTransaction") {
    const digest = res.FailedTransaction.digest;
    console.log(`[tx] ${label} FAILED digest=${digest} error=${JSON.stringify(res.FailedTransaction.status.error)}`);
    throw new HttpError(502, "The bank's transaction failed on Sui testnet. Try again in a moment.");
  }
  const digest = res.Transaction.digest;
  console.log(`[tx] ${label} ok digest=${digest}`);
  onExecuted?.(digest);
  await client.core.waitForTransaction({ result: res, timeout: 30_000 });
  return { digest };
}

/** Maps transport-level failures (timeouts, DNS, gRPC unavailable) to a player-safe error. */
export function networkError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  console.log(`[chain] error: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 500));
  return new HttpError(503, "Sui testnet didn't answer. Try again in a moment.");
}
