/**
 * Adapter selection: the only place that decides which MisoAdapter the game runs on.
 *
 * Owns: the choice of adapter. The game always runs on Sui testnet (TestnetAdapter).
 * Must not: hold state or be imported by world/ code.
 *
 * Automated tests only: a build made with `vite build --mode e2e` (the Playwright e2e
 * webServer) runs on the in-memory MockAdapter instead, with these URL knobs:
 *   ?chain=testnet        use the TestnetAdapter anyway
 *   ?latency=<ms>         simulated latency per call (default 800)
 *   ?fail=purchase|sell|withdraw|all  force those transactions to fail
 *   ?fail=purchase-lost|sell-lost|withdraw-lost  they land, then the answer is
 *                         lost (timeout message); Retry returns the earlier purchase / sale
 *   ?mockhls=1            every track streams a real testnet HLS quilt
 * In any other build the e2e check is a constant false, so the MockAdapter is tree-shaken
 * out of the bundle.
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

/**
 * True only in a `vite build --mode e2e` bundle: vite.config.ts defines `__MISO_E2E__` as
 * a literal per build, so in any other build this folds to `false` and the MockAdapter
 * branch is tree-shaken out. Outside Vite (unit tests under Node) it is undefined: false.
 */
function isE2eBuild(): boolean {
  return typeof __MISO_E2E__ !== "undefined" && __MISO_E2E__;
}

/** `deps.pending`: the pending-sale store handed to the TestnetAdapter (default: its own). */
export function createAdapter(search?: string, deps: { pending?: PendingSalesStore } = {}): MisoAdapter {
  if (isE2eBuild() && params(search).get("chain") !== "testnet") {
    return new MockAdapter(adapterOptionsFromUrl(search));
  }
  return new TestnetAdapter({ pending: deps.pending });
}
