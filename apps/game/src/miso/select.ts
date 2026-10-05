/**
 * Adapter selection: the only place that decides mock vs testnet.
 *
 * Owns: reading `?chain=`, `VITE_MISO_CHAIN` and the mock debug knobs from the URL.
 * Must not: hold state or be imported by world/ code.
 *
 * URL params:
 *   ?chain=mock|testnet   (fallback: import.meta.env.VITE_MISO_CHAIN, then "mock")
 *   ?latency=<ms>         mock only: simulated latency per call (default 800)
 *   ?fail=purchase|sell|withdraw|all  mock only: force those transactions to fail
 *   ?fail=purchase-lost|sell-lost|withdraw-lost  mock only: they land, then the answer is
 *                         lost (timeout message); Retry returns the earlier purchase / sale
 *   ?mockhls=1            mock only: every track streams a real testnet HLS quilt
 */
import type { MisoAdapter } from "./adapter";
import { MockAdapter, type FailureMode, type MockAdapterOptions } from "./mock-adapter";
import { TestnetAdapter } from "./testnet-adapter";
import type { PendingSalesStore } from "../app/pending-sales";

function params(search?: string): URLSearchParams {
  const query = search ?? (typeof location !== "undefined" ? location.search : "");
  return new URLSearchParams(query);
}

/** Mock knobs from the URL (pass `search` to parse something other than location.search). */
export function adapterOptionsFromUrl(search?: string): MockAdapterOptions {
  const p = params(search);
  const options: MockAdapterOptions = {};
  const latency = p.get("latency");
  if (latency !== null && Number.isFinite(Number(latency))) {
    options.latencyMs = Math.max(0, Number(latency));
  }
  const fail = p.get("fail");
  const modes: readonly FailureMode[] = ["purchase", "sell", "withdraw", "all", "purchase-lost", "sell-lost", "withdraw-lost"];
  if (fail !== null && (modes as readonly string[]).includes(fail)) {
    options.failureMode = fail as FailureMode;
  } else if (fail !== null) {
    console.warn(`[miso] ignoring ?fail=${fail} (expected ${modes.join("|")})`);
  }
  const hls = p.get("mockhls");
  if (hls === "1" || hls === "true") options.mockHls = true;
  return options;
}

/** `deps.pending`: the pending-sale store handed to the TestnetAdapter (default: its own). */
export function createAdapter(search?: string, deps: { pending?: PendingSalesStore } = {}): MisoAdapter {
  const requested =
    params(search).get("chain") ?? (import.meta.env?.VITE_MISO_CHAIN as string | undefined) ?? "mock";
  switch (requested) {
    case "testnet":
      return new TestnetAdapter({ pending: deps.pending });
    case "mock":
      return new MockAdapter(adapterOptionsFromUrl(search));
    default:
      console.warn(`[miso] unknown chain "${requested}", using mock`);
      return new MockAdapter(adapterOptionsFromUrl(search));
  }
}
