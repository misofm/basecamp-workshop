import { expect, test } from "@playwright/test";
import { Effect } from "effect";
import { makePendingSalesStore, memoryStorage, PENDING_SALES_KEY, PendingSales, parsePendingSales, type PendingSale, type StorageLike } from "../../src/app/pending-sales";

const PLAYER = `0x${"a".repeat(64)}`;

function sale(n: number, extra: Partial<PendingSale> = {}): PendingSale {
  return {
    player: PLAYER,
    transferDigest: `transfer-${n}`,
    owned: {
      recordId: `0x${String(n).repeat(64)}`,
      shopRecordId: "release",
      title: "Title",
      artist: "Artist",
      coverUrl: "",
      serial: n,
      maxSupply: 100,
      acquiredAt: 1_700_000_000_000 + n,
    },
    ...extra,
  };
}

/** Collect console.warn calls while `fn` runs. */
async function captureWarnings<T>(fn: () => T | Promise<T>): Promise<{ result: T; warnings: unknown[][] }> {
  const original = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => void warnings.push(args);
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = original;
  }
}

/** Install a fake `localStorage` on globalThis for `fn`, then restore whatever was there. */
async function withLocalStorage<T>(storage: StorageLike, fn: () => T | Promise<T>): Promise<T> {
  const g = globalThis as { localStorage?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, "localStorage");
  const previous = g.localStorage;
  g.localStorage = storage;
  try {
    return await fn();
  } finally {
    if (had) g.localStorage = previous;
    else delete g.localStorage;
  }
}

test("round trip through the service (memory layer): save, get, all, clear", async () => {
  const program = Effect.gen(function* () {
    const pending = yield* PendingSales;
    expect(yield* pending.all).toEqual({});
    yield* pending.save("r1", sale(1));
    yield* pending.save("r2", sale(2, { payoutDigest: "payout-2" }));
    expect(yield* pending.get("r1")).toEqual(sale(1));
    expect((yield* pending.get("r2"))?.payoutDigest).toBe("payout-2");
    expect(Object.keys(yield* pending.all).sort()).toEqual(["r1", "r2"]);
    // the synchronous face sees the same data
    expect(pending.store.get("r2")).toEqual(sale(2, { payoutDigest: "payout-2" }));
    pending.store.set("r2", null);
    yield* pending.save("r1", null);
    expect(yield* pending.all).toEqual({});
    expect(yield* pending.get("r1")).toBeUndefined();
  });
  await Effect.runPromise(program.pipe(Effect.provide(PendingSales.memory)));
});

test("PendingSales.layer uses localStorage under the testnet key; saving rewrites the whole map", async () => {
  const storage = memoryStorage();
  await withLocalStorage(storage, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const pending = yield* PendingSales;
        yield* pending.save("r1", sale(1));
        yield* pending.save("r2", sale(2));
      }).pipe(Effect.provide(PendingSales.layer)),
    ),
  );
  expect(PENDING_SALES_KEY).toBe("miso-game:pending-sales:testnet");
  expect(JSON.parse(storage.getItem(PENDING_SALES_KEY)!)).toEqual({ r1: sale(1), r2: sale(2) });
});

test("corrupt JSON reads as empty and is logged, never thrown", async () => {
  const storage = memoryStorage();
  storage.setItem(PENDING_SALES_KEY, "{not json");
  const store = makePendingSalesStore(() => storage);
  const { result, warnings } = await captureWarnings(() => store.all());
  expect(result).toEqual({});
  expect(warnings.length).toBeGreaterThan(0);
  // A save afterwards replaces the corrupt blob.
  await captureWarnings(() => store.set("r1", sale(1)));
  expect(JSON.parse(storage.getItem(PENDING_SALES_KEY)!)).toEqual({ r1: sale(1) });
  expect(await captureWarnings(() => parsePendingSales("[1,2]")).then((r) => r.result)).toEqual({});
  expect(await captureWarnings(() => parsePendingSales("null")).then((r) => r.result)).toEqual({});
});

test("one invalid entry next to a valid one: the valid one is kept, the invalid one dropped and logged", async () => {
  const storage = memoryStorage();
  const invalid = { player: PLAYER, transferDigest: 7, owned: sale(2).owned };
  const noOwned = { ...sale(4), owned: null };
  // A partial `owned` (e.g. a serial sent as a string) is KEPT as stored, so Retry can
  // still pay that sale.
  const partialOwned = { ...sale(3), owned: { recordId: "0x3", serial: "3" } };
  storage.setItem(PENDING_SALES_KEY, JSON.stringify({ good: sale(1), bad: invalid, none: noOwned, partial: partialOwned }));
  const store = makePendingSalesStore(() => storage);
  const { result, warnings } = await captureWarnings(() => store.all());
  expect(result).toEqual({ good: sale(1), partial: partialOwned });
  expect(warnings).toHaveLength(2);
  expect((await captureWarnings(() => store.get("good"))).result).toEqual(sale(1));
});

test("storage that throws falls back to memory", async () => {
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  await withLocalStorage(throwing, async () => {
    const pending = await Effect.runPromise(Effect.gen(function* () {
      return yield* PendingSales;
    }).pipe(Effect.provide(PendingSales.layer)));
    expect(pending.store.all()).toEqual({});
    pending.store.set("r1", sale(1));
    expect(pending.store.get("r1")).toEqual(sale(1));
    pending.store.set("r2", sale(2));
    expect(Object.keys(pending.store.all()).sort()).toEqual(["r1", "r2"]);
    pending.store.set("r1", null);
    expect(pending.store.all()).toEqual({ r2: sale(2) });
  });
  // No localStorage at all (plain Node) behaves the same.
  const store = makePendingSalesStore();
  store.set("r1", sale(1));
  expect(store.get("r1")).toEqual(sale(1));
});

test("corrupt JSON reads as the in-memory copy of the last save (as before the port)", async () => {
  const storage = memoryStorage();
  const store = makePendingSalesStore(() => storage);
  await captureWarnings(() => store.set("r1", sale(1)));
  storage.setItem(PENDING_SALES_KEY, "{not json");
  const { result, warnings } = await captureWarnings(() => store.all());
  expect(result).toEqual({ r1: sale(1) });
  expect(warnings).toHaveLength(1);
});
