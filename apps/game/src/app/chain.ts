/**
 * Chain: the MisoAdapter as an Effect service (see docs/EFFECT.md).
 *
 * Every operation is an `Effect<A, ChainError>`: adapter rejections are classified
 * (./errors.ts, message unchanged), each call has an outer safety timeout (longer than the
 * adapters' own, so it never changes today's behaviour), and reads retry on `Network`
 * only. Transactions are never retried; idempotency stays inside the adapters.
 *
 * Adapter methods are called lazily at run time (`adapter.purchase(record)` inside the
 * Effect), never pre-bound, so test spies that replace methods on the instance still count.
 *
 * Must not: statically import ../miso/testnet/* beyond what ../miso/select.ts already does
 * (the testnet backend stays a lazy chunk).
 */
import { Context, Effect, Layer, Schedule } from "effect";
import type { MisoAdapter } from "../miso/adapter";
import { adapterOptionsFromUrl, createAdapter } from "../miso/select";
import type { Network as ChainNetwork, NpcBuyer, OwnedRecord, PurchaseResult, SellResult, ShopRecord, Wallet, WithdrawResult } from "../miso/types";
import { classifyChainError, isTransactionOp, ResponseLost, Timeout, TIMEOUT_MESSAGE, type ChainError, type ChainOp } from "./errors";
import { PendingSales } from "./pending-sales";

export { adapterOptionsFromUrl, createAdapter };

export interface ChainApi {
  readonly network: ChainNetwork;
  /** The raw adapter (window.__game, debug tools). */
  readonly adapter: MisoAdapter;
  readonly loadShopCatalog: Effect.Effect<ShopRecord[], ChainError>;
  readonly getWallet: Effect.Effect<Wallet, ChainError>;
  readonly listOwnedRecords: Effect.Effect<OwnedRecord[], ChainError>;
  readonly collectorAddress: Effect.Effect<string, ChainError>;
  readonly purchase: (record: ShopRecord) => Effect.Effect<PurchaseResult, ChainError>;
  readonly withdrawFakeUsd: (amount: bigint) => Effect.Effect<WithdrawResult, ChainError>;
  readonly sellToNpc: (recordId: string, npc: NpcBuyer) => Effect.Effect<SellResult, ChainError>;
  readonly explorerTxUrl: (digest: string) => string;
  readonly explorerObjectUrl: (objectId: string) => string;
}

export interface ChainOptions {
  /** Outer safety timeouts, ms. */
  readonly readTimeoutMs?: number;
  readonly purchaseTimeoutMs?: number;
  readonly withdrawTimeoutMs?: number;
  readonly sellTimeoutMs?: number;
  /** Read retries on `Network`: how many, and the first exponential delay (ms). */
  readonly readRetries?: number;
  readonly readRetryBaseMs?: number;
}

/**
 * Last-resort safety nets only: each is well above the slowest path the testnet adapter
 * can take before it gives up on its own (10 s per read, 30 s per tx step: build, submit,
 * wait), so they fire only if an adapter promise never settles. Firing earlier would turn a
 * slow-but-landing transaction into an error while it still runs, and a Retry could then
 * queue a second one behind it (docs/EFFECT.md "Timeouts").
 *   read      worst ≈ 10 s list + 10 s per-record lookups + 20 s first catalog hydrate → 90 s
 *   purchase  worst ≈ 30 s catalog + 8 s earlier-digest lookup + 90 s tx + 10 s read → 300 s
 *   withdraw  worst ≈ 90 s tx → 300 s
 *   sell      worst ≈ 10 s + 8/10 s lookups + 2 × 90 s txs ≈ 200 s → 420 s
 */
export const CHAIN_DEFAULTS = {
  readTimeoutMs: 90_000,
  purchaseTimeoutMs: 300_000,
  withdrawTimeoutMs: 300_000,
  sellTimeoutMs: 420_000,
  readRetries: 2,
  readRetryBaseMs: 250,
} as const satisfies Required<ChainOptions>;

export function makeChain(adapter: MisoAdapter, options: ChainOptions = {}): ChainApi {
  const o = { ...CHAIN_DEFAULTS, ...options };

  const call = <A>(op: ChainOp, timeoutMs: number, run: () => PromiseLike<A>): Effect.Effect<A, ChainError> => {
    const attempt = Effect.tryPromise({ try: () => run(), catch: (error) => classifyChainError(op, error) });
    const tx = isTransactionOp(op);
    const retried = tx
      ? attempt
      : attempt.pipe(
          Effect.retry({
            schedule: Schedule.exponential(o.readRetryBaseMs),
            times: o.readRetries,
            while: (error: ChainError) => error._tag === "Network",
          }),
        );
    return retried.pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.fail(tx ? new ResponseLost({ op, message: TIMEOUT_MESSAGE }) : new Timeout({ op, message: TIMEOUT_MESSAGE })),
      }),
    );
  };

  return {
    network: adapter.network,
    adapter,
    loadShopCatalog: call("catalog", o.readTimeoutMs, () => adapter.loadShopCatalog()),
    getWallet: call("wallet", o.readTimeoutMs, () => adapter.getWallet()),
    listOwnedRecords: call("collection", o.readTimeoutMs, () => adapter.listOwnedRecords()),
    collectorAddress: call("collector", o.readTimeoutMs, () => adapter.collectorAddress()),
    purchase: (record) => call("purchase", o.purchaseTimeoutMs, () => adapter.purchase(record)),
    withdrawFakeUsd: (amount) => call("withdraw", o.withdrawTimeoutMs, () => adapter.withdrawFakeUsd(amount)),
    sellToNpc: (recordId, npc) => call("sell", o.sellTimeoutMs, () => adapter.sellToNpc(recordId, npc)),
    explorerTxUrl: (digest) => adapter.explorerTxUrl(digest),
    explorerObjectUrl: (objectId) => adapter.explorerObjectUrl(objectId),
  };
}

export class Chain extends Context.Service<Chain, ChainApi>()("app/Chain") {
  /** Wrap an existing adapter (tests, harness). */
  static fromAdapter(adapter: MisoAdapter, options?: ChainOptions): Layer.Layer<Chain> {
    return Layer.sync(Chain, () => makeChain(adapter, options));
  }
  /** The adapter `createAdapter()` picks from the URL / env, with the PendingSales store injected. */
  static readonly layer: Layer.Layer<Chain, never, PendingSales> = Layer.effect(
    Chain,
    Effect.gen(function* () {
      const pending = yield* PendingSales;
      return makeChain(createAdapter(undefined, { pending: pending.store }));
    }),
  );
}
