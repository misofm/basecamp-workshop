/**
 * Adapter selection: the only place that decides mock vs testnet.
 *
 * Owns: reading `?chain=`, `VITE_MISO_CHAIN` and the mock debug knobs from the URL.
 * Must not: hold state or be imported by world/ code.
 *
 * URL params:
 *   ?chain=mock|testnet   (fallback: import.meta.env.VITE_MISO_CHAIN, then "mock")
 *   ?latency=<ms>         mock only: simulated latency per call (default 800)
 *   ?fail=purchase|sell|all  mock only: force those transactions to fail
 *   ?mockhls=1            mock only: every track streams a real testnet HLS quilt
 */
import type { MisoAdapter } from "./adapter";
import { MockAdapter, type FailureMode, type MockAdapterOptions } from "./mock-adapter";
import { TestnetAdapter } from "./testnet-adapter";

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
  if (fail === "purchase" || fail === "sell" || fail === "withdraw" || fail === "all") {
    options.failureMode = fail satisfies FailureMode;
  } else if (fail !== null) {
    console.warn(`[miso] ignoring ?fail=${fail} (expected purchase|sell|withdraw|all)`);
  }
  const hls = p.get("mockhls");
  if (hls === "1" || hls === "true") options.mockHls = true;
  return options;
}

export function createAdapter(search?: string): MisoAdapter {
  const requested =
    params(search).get("chain") ?? (import.meta.env?.VITE_MISO_CHAIN as string | undefined) ?? "mock";
  switch (requested) {
    case "testnet":
      return new TestnetAdapter();
    case "mock":
      return new MockAdapter(adapterOptionsFromUrl(search));
    default:
      console.warn(`[miso] unknown chain "${requested}", using mock`);
      return new MockAdapter(adapterOptionsFromUrl(search));
  }
}
