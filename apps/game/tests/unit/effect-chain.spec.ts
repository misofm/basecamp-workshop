import { expect, test } from "@playwright/test";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { Chain, makeChain, type ChainOptions } from "../../src/app/chain";
import { classifyChainError, TIMEOUT_MESSAGE, type ChainError, type ChainOp } from "../../src/app/errors";
import { PendingSales } from "../../src/app/pending-sales";
import type { MisoAdapter } from "../../src/miso/adapter";
import { MockAdapter } from "../../src/miso/mock-adapter";
import type { NpcBuyer, ShopRecord } from "../../src/miso/types";

/** A PlayerError look-alike (the real class lives in the lazy testnet chunk). */
function playerError(message: string, kind: string): Error {
  const error = new Error(message) as Error & { kind: string };
  error.name = "PlayerError";
  error.kind = kind;
  return error;
}

const FAST: ChainOptions = {
  readTimeoutMs: 50,
  purchaseTimeoutMs: 50,
  withdrawTimeoutMs: 50,
  sellTimeoutMs: 50,
  readRetryBaseMs: 1,
};

const collector: NpcBuyer = { id: "buyer:collector", name: "Collector", address: "0x" + "c".repeat(64), offer: 20_000_000n };

/** The typed failure of an Exit (fails the test if it succeeded or died). */
function failureOf<A>(exit: Exit.Exit<A, ChainError>): ChainError {
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${String(exit.value)}`);
  const found = exit.cause.reasons.find(Cause.isFailReason);
  if (!found) throw new Error(`expected a typed failure, got ${Cause.pretty(exit.cause)}`);
  return found.error;
}

const run = <A>(effect: Effect.Effect<A, ChainError>) => Effect.runPromiseExit(effect);

// ───────────────────────────── classification ─────────────────────────────

const TX: ChainOp[] = ["purchase", "withdraw", "sell"];
const READS: ChainOp[] = ["catalog", "wallet", "collection", "collector"];

test("classify: PlayerError kinds map to tags, message passes through", () => {
  const table: [string, string, ChainOp, string][] = [
    ["fusd", "Jazz frowns: short on cash.", "purchase", "InsufficientFunds"],
    ["soldOut", "Sold out. Every copy's gone.", "purchase", "SoldOut"],
    ["network", "Connection dropped. Try again.", "wallet", "Network"],
    ["network", "Connection dropped. Try again.", "purchase", "Network"],
    ["gas", "The till's offline. Try later.", "purchase", "Rejected"],
    ["keys", "The till's offline. Try later.", "wallet", "Rejected"],
    ["priceChanged", "Price changed. Reload the page.", "purchase", "Rejected"],
    ["notOwned", "You don't own that any more.", "sell", "Rejected"],
    ["other", "Register jammed. Try again.", "purchase", "Rejected"],
  ];
  for (const [kind, message, op, tag] of table) {
    const source = playerError(message, kind);
    const error = classifyChainError(op, source);
    expect(error._tag, `${kind}/${op}`).toBe(tag);
    expect(error.message).toBe(message);
    expect(error.op).toBe(op);
    expect(error.cause).toBe(source);
  }
});

test("classify: timeouts are ResponseLost for transactions, Timeout for reads", () => {
  for (const op of TX) {
    expect(classifyChainError(op, playerError(TIMEOUT_MESSAGE, "timeout"))._tag).toBe("ResponseLost");
    expect(classifyChainError(op, new Error(TIMEOUT_MESSAGE))._tag).toBe("ResponseLost");
  }
  for (const op of READS) {
    expect(classifyChainError(op, playerError(TIMEOUT_MESSAGE, "timeout"))._tag).toBe("Timeout");
    expect(classifyChainError(op, new Error(TIMEOUT_MESSAGE))._tag).toBe("Timeout");
  }
  expect(classifyChainError("purchase", new Error(TIMEOUT_MESSAGE)).message).toBe(TIMEOUT_MESSAGE);
});

test("classify: plain errors and non-Errors are Rejected with the same message the flows showed", () => {
  const plain = classifyChainError("purchase", new Error("Register jammed. Try again."));
  expect(plain._tag).toBe("Rejected");
  expect(plain.message).toBe("Register jammed. Try again.");
  const str = classifyChainError("sell", "boom");
  expect(str._tag).toBe("Rejected");
  expect(str.message).toBe("boom");
  expect(classifyChainError("wallet", 42).message).toBe("42");
  expect(classifyChainError("wallet", undefined).message).toBe("undefined");
  // Shape matters: an Error named PlayerError without a kind is just a plain error.
  const nameOnly = new Error("x");
  nameOnly.name = "PlayerError";
  expect(classifyChainError("purchase", nameOnly)._tag).toBe("Rejected");
  // A non-PlayerError with kind "fusd" is not trusted either.
  expect(classifyChainError("purchase", Object.assign(new Error("y"), { kind: "fusd" }))._tag).toBe("Rejected");
});

// ───────────────────────────── timeouts / retry / interruption ─────────────────────────────

/** An adapter whose every method is a counted stub (replace per test). */
function fakeAdapter(overrides: Partial<MisoAdapter>): MisoAdapter & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const never = () => new Promise<never>(() => {});
  const base: MisoAdapter = {
    network: "mock",
    loadShopCatalog: never,
    getWallet: never,
    purchase: never,
    withdrawFakeUsd: never,
    listOwnedRecords: never,
    sellToNpc: never,
    collectorAddress: never,
    explorerTxUrl: (d) => `tx:${d}`,
    explorerObjectUrl: (id) => `obj:${id}`,
    ...overrides,
  };
  const counted = { calls } as MisoAdapter & { calls: Record<string, number> };
  for (const [key, value] of Object.entries(base)) {
    (counted as unknown as Record<string, unknown>)[key] =
      typeof value === "function"
        ? (...args: unknown[]) => {
            calls[key] = (calls[key] ?? 0) + 1;
            return (value as (...a: unknown[]) => unknown)(...args);
          }
        : value;
  }
  return counted;
}

const someRecord = { id: "r1" } as ShopRecord;

test("outer timeout: a hung read fails with Timeout, a hung purchase with ResponseLost", async () => {
  const chain = makeChain(fakeAdapter({}), FAST);
  const read = failureOf(await run(chain.getWallet));
  expect(read._tag).toBe("Timeout");
  expect(read.op).toBe("wallet");
  expect(read.message).toBe(TIMEOUT_MESSAGE);
  const tx = failureOf(await run(chain.purchase(someRecord)));
  expect(tx._tag).toBe("ResponseLost");
  expect(tx.op).toBe("purchase");
  expect(tx.message).toBe(TIMEOUT_MESSAGE);
  expect(failureOf(await run(chain.sellToNpc("0x1", collector)))._tag).toBe("ResponseLost");
  expect(failureOf(await run(chain.withdrawFakeUsd(1n)))._tag).toBe("ResponseLost");
});

test("retry: a read failing with Network twice then succeeding succeeds after 3 calls", async () => {
  let n = 0;
  const adapter = fakeAdapter({
    getWallet: async () => {
      if (++n <= 2) throw playerError("Connection dropped. Try again.", "network");
      return { address: "0xabc", fakeUsd: 1n, fakeUsdDecimals: 6, sui: 2n };
    },
  });
  const exit = await run(makeChain(adapter, { ...FAST, readTimeoutMs: 2_000 }).getWallet);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(adapter.calls.getWallet).toBe(3);
});

test("retry: gives up after 2 retries with the last Network error", async () => {
  const adapter = fakeAdapter({ loadShopCatalog: async () => Promise.reject(playerError("Connection dropped. Try again.", "network")) });
  const error = failureOf(await run(makeChain(adapter, { ...FAST, readTimeoutMs: 2_000 }).loadShopCatalog));
  expect(error._tag).toBe("Network");
  expect(adapter.calls.loadShopCatalog).toBe(3);
});

test("retry: a Rejected read is not retried; a failing purchase is called exactly once", async () => {
  const adapter = fakeAdapter({
    listOwnedRecords: async () => Promise.reject(new Error("Can't reach the shop. Try again.")),
    purchase: async () => Promise.reject(playerError("Connection dropped. Try again.", "network")),
  });
  const chain = makeChain(adapter, { ...FAST, readTimeoutMs: 2_000, purchaseTimeoutMs: 2_000 });
  const read = failureOf(await run(chain.listOwnedRecords));
  expect(read._tag).toBe("Rejected");
  expect(read.message).toBe("Can't reach the shop. Try again.");
  expect(adapter.calls.listOwnedRecords).toBe(1);
  const tx = failureOf(await run(chain.purchase(someRecord)));
  expect(tx._tag).toBe("Network");
  expect(adapter.calls.purchase).toBe(1);
});

test("adapter methods are called lazily (spies installed after makeChain still count)", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const chain = makeChain(adapter);
  let calls = 0;
  const original = adapter.getWallet.bind(adapter);
  adapter.getWallet = () => {
    calls++;
    return original();
  };
  const effect = chain.getWallet;
  expect(calls).toBe(0);
  await Effect.runPromise(effect);
  await Effect.runPromise(effect);
  expect(calls).toBe(2);
});

test("interrupting a pending purchase completes promptly", async () => {
  const adapter = fakeAdapter({});
  const chain = makeChain(adapter); // default 300 s timeout
  const fiber = Effect.runFork(chain.purchase(someRecord));
  await new Promise((r) => setTimeout(r, 10));
  expect(adapter.calls.purchase).toBe(1);
  const started = Date.now();
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(Date.now() - started).toBeLessThan(1_000);
  const exit = await Effect.runPromise(Fiber.await(fiber));
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
});

// ───────────────────────────── MockAdapter end to end ─────────────────────────────

test("MockAdapter through makeChain: purchase ok, failNext → Rejected, purchase-lost → ResponseLost then Retry is idempotent", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const chain = makeChain(adapter);
  expect(chain.network).toBe("mock");
  expect(chain.adapter).toBe(adapter);
  const catalog = await Effect.runPromise(chain.loadShopCatalog);
  const [first, second] = catalog;
  const start = (await Effect.runPromise(chain.getWallet)).fakeUsd;

  const ok = await Effect.runPromise(chain.purchase(first));
  expect(ok.recordId).toMatch(/^0x[0-9a-f]{64}$/);
  expect(chain.explorerTxUrl(ok.digest)).toBe(adapter.explorerTxUrl(ok.digest));
  expect(chain.explorerObjectUrl(ok.recordId)).toBe(adapter.explorerObjectUrl(ok.recordId));

  adapter.failNext("purchase");
  const jammed = failureOf(await run(chain.purchase(second)));
  expect(jammed._tag).toBe("Rejected");
  expect(jammed.message).toBe("Register jammed. Try again.");

  adapter.failNext("purchase-lost");
  const lost = failureOf(await run(chain.purchase(second)));
  expect(lost._tag).toBe("ResponseLost");
  expect(lost.message).toBe(TIMEOUT_MESSAGE);
  const owned = await Effect.runPromise(chain.listOwnedRecords);
  const lostId = owned.find((r) => r.shopRecordId === second.id)!.recordId;
  const retry = await Effect.runPromise(chain.purchase(second));
  expect(retry.recordId).toBe(lostId);

  const end = (await Effect.runPromise(chain.getWallet)).fakeUsd;
  expect(end).toBe(start - first.price.amount - second.price.amount);
  expect(await Effect.runPromise(chain.listOwnedRecords)).toHaveLength(2);
  expect(await Effect.runPromise(chain.collectorAddress)).toMatch(/^0x/);
});

test("Chain.fromAdapter and Chain.layer provide the service", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const viaAdapter = await Effect.runPromise(
    Effect.gen(function* () {
      const chain = yield* Chain;
      return chain.adapter;
    }).pipe(Effect.provide(Chain.fromAdapter(adapter))),
  );
  expect(viaAdapter).toBe(adapter);
  const network = await Effect.runPromise(
    Effect.gen(function* () {
      const chain = yield* Chain;
      return chain.network;
    }).pipe(Effect.provide(Chain.layer.pipe(Layer.provide(PendingSales.memory)))),
  );
  expect(network).toBe("mock");
});
