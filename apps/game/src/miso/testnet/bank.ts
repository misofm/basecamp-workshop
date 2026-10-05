/**
 * Client for the workshop bank server (apps/game/server, proxied at /api by Vite).
 * It holds the operator (gas bank) and collector keys; the browser never sees them.
 *
 * Owns: POST /api/fund, GET /api/collector, POST /api/collector/buy and turning their
 * failures into player-safe PlayerErrors ("bank server isn't running", the server's own
 * `{ error }` text, …).
 * Must not: sign anything.
 */
import { READ_TIMEOUT_MS, TX_TIMEOUT_MS } from "./config";
import { MESSAGES, PlayerError } from "./errors";
import { HttpError, fetchJson } from "./net";

export interface FundResponse {
  funded: boolean;
  digest?: string;
  sui?: string;
  fakeUsd?: string;
  reason?: string;
}
export interface CollectorInfo {
  address: string;
  offerNumerator: number;
  offerDenominator: number;
}
export interface CollectorBuyResponse {
  digest: string;
  paid: string;
  seller: string;
}

/** Map a failed /api call to a PlayerError. `retryable` = worth trying again automatically. */
export function bankError(error: unknown): PlayerError & { retryable: boolean } {
  let out: PlayerError;
  let retryable = false;
  if (error instanceof HttpError) {
    const msg = (error.body as { error?: unknown } | null)?.error;
    if (typeof msg === "string" && msg) {
      out = new PlayerError(msg, error.status >= 500 ? "server" : "other");
      retryable = error.status >= 500 || error.status === 409;
    } else if (error.status >= 500 || error.status === 404) {
      // The Vite proxy answers 500/502/504 without our JSON body when nothing listens on :8787.
      out = new PlayerError(MESSAGES.serverDown, "server");
      retryable = true;
    } else {
      out = new PlayerError(`The bank server said no (HTTP ${error.status}).`, "server");
    }
  } else if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    out = new PlayerError("The bank server didn't answer in time. Try again.", "timeout");
    retryable = true;
  } else {
    out = new PlayerError(MESSAGES.serverDown, "server");
    retryable = true;
  }
  return Object.assign(out, { retryable });
}

async function call<T>(path: string, init: RequestInit & { timeoutMs: number }): Promise<T> {
  try {
    return await fetchJson<T>(path, init);
  } catch (error) {
    throw bankError(error);
  }
}

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const fund = (address: string) => call<FundResponse>("/api/fund", { ...post({ address }), timeoutMs: TX_TIMEOUT_MS });

let collector: Promise<CollectorInfo> | null = null;
export function getCollector(): Promise<CollectorInfo> {
  collector ??= call<CollectorInfo>("/api/collector", { timeoutMs: READ_TIMEOUT_MS }).then((c) => {
    if (!/^0x[0-9a-f]{64}$/i.test(c?.address ?? "")) throw new PlayerError("The bank server sent a bad collector address.", "server");
    return c;
  });
  collector.catch(() => (collector = null)); // don't cache failures
  return collector;
}

export const collectorBuy = (recordId: string, digest: string) =>
  call<CollectorBuyResponse>("/api/collector/buy", { ...post({ recordId, digest }), timeoutMs: 45_000 });
