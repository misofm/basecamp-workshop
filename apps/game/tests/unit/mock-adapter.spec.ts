import { expect, test } from "@playwright/test";
import { MockAdapter } from "../../src/miso/mock-adapter";
import { MOCK_HLS_QUILT } from "../../src/miso/mock-catalog";
import { formatAmount, shortId } from "../../src/miso/format";
import type { NpcBuyer } from "../../src/miso/types";
import { adapterOptionsFromUrl } from "../../src/miso/select";

const collector: NpcBuyer = {
  id: "buyer:collector",
  name: "Collector",
  address: "0x" + "c".repeat(64),
  offer: 20_000_000n,
};

test("catalog has 10 releases with covers, sections and fake ids", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const catalog = await adapter.loadShopCatalog();
  expect(catalog).toHaveLength(10);
  expect(new Set(catalog.map((r) => r.section)).size).toBe(10);
  for (const r of catalog) {
    expect(r.coverUrl).toBe(`/covers/${r.id}.png`);
    expect(r.releaseId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.tracks).toHaveLength(5);
    expect(r.tracks.every((t) => t.quiltId === null)).toBe(true);
    expect(r.price.decimals).toBe(6);
    expect(r.minted).toBeLessThan(r.maxSupply);
    expect(r.synth.notes).toHaveLength(4);
  }
});

test("?mockhls assigns the real quilt to every track", async () => {
  const catalog = await new MockAdapter({ latencyMs: 0, mockHls: true }).loadShopCatalog();
  expect(catalog.flatMap((r) => r.tracks).every((t) => t.quiltId === MOCK_HLS_QUILT.quiltId)).toBe(true);
});

test("purchase deducts the price and returns ids", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  const before = await adapter.getWallet();
  expect(before.fakeUsd).toBe(100_000_000n);
  const result = await adapter.purchase(record);
  expect(result.recordId).toMatch(/^0x[0-9a-f]{64}$/);
  expect(result.digest).toMatch(/^[1-9A-HJ-NP-Za-km-z]{44}$/);
  const after = await adapter.getWallet();
  expect(after.fakeUsd).toBe(before.fakeUsd - record.price.amount);
  const ownedList = await adapter.listOwnedRecords();
  expect(ownedList).toHaveLength(1);
  expect(ownedList[0]).toMatchObject({ recordId: result.recordId, shopRecordId: record.id, serial: record.minted + 1 });
  expect(adapter.explorerTxUrl(result.digest)).toBe(`https://devxplorer.io/?search=${encodeURIComponent(result.digest)}&network=testnet`);
});

test("insufficient funds error is player friendly", async () => {
  const adapter = new MockAdapter({ latencyMs: 0, startFakeUsd: 5_000_000n });
  const [record] = await adapter.loadShopCatalog();
  await expect(adapter.purchase(record)).rejects.toThrow("Jazz frowns: short on cash.");
  expect((await adapter.getWallet()).fakeUsd).toBe(5_000_000n);
});

test("failNext fails exactly one transaction without spending", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  adapter.failNext("purchase");
  await expect(adapter.purchase(record)).rejects.toThrow(/Register jammed/);
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n);
  await expect(adapter.purchase(record)).resolves.toBeTruthy();

  adapter.setFailureMode("all");
  await expect(adapter.purchase(record)).rejects.toThrow(/Register jammed/);
  adapter.setFailureMode("none");
});

test("sell credits balance and removes the record", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  const { recordId } = await adapter.purchase(record);
  const result = await adapter.sellToNpc(recordId, collector);
  expect(result.paid).toBe(20_000_000n);
  expect(result.digest).toHaveLength(44);
  expect(await adapter.listOwnedRecords()).toHaveLength(0);
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n - record.price.amount + 20_000_000n);
  await expect(adapter.sellToNpc(recordId, collector)).rejects.toThrow(/don't own/);
});

test("deterministic ids for the same seed", async () => {
  const a = new MockAdapter({ latencyMs: 0, seed: 7 });
  const b = new MockAdapter({ latencyMs: 0, seed: 7 });
  const [ra] = await a.loadShopCatalog();
  expect((await a.purchase(ra)).recordId).toBe((await b.purchase(ra)).recordId);
});

test("formatAmount and shortId", () => {
  expect(formatAmount(12_500_000n, 6, "FUSD")).toBe("12.50 FUSD");
  expect(formatAmount(1_234_567_891_000n, 6)).toBe("1,234,567.89");
  expect(formatAmount(1_500_000_000n, 9, "SUI")).toBe("1.50 SUI");
  expect(formatAmount(9_995_000n, 6)).toBe("10.00");
  expect(formatAmount(-2_000_000n, 6)).toBe("-2.00");
  expect(formatAmount(5n, 0, "X", 2)).toBe("5 X");
  expect(shortId("0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f9f0e")).toBe("0x1a2b…9f0e");
});

test("withdrawFakeUsd credits the balance and returns a digest", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const result = await adapter.withdrawFakeUsd(50_000_000n);
  expect(result.amount).toBe(50_000_000n);
  expect(result.digest).toMatch(/^[1-9A-HJ-NP-Za-km-z]{44}$/);
  expect((await adapter.getWallet()).fakeUsd).toBe(150_000_000n);
  expect(adapter.explorerTxUrl(result.digest)).toBe(`https://devxplorer.io/?search=${encodeURIComponent(result.digest)}&network=testnet`);
  // A withdrawal tops up enough to buy what a short wallet couldn't.
  const poor = new MockAdapter({ latencyMs: 0, startFakeUsd: 5_000_000n });
  const [record] = await poor.loadShopCatalog();
  await expect(poor.purchase(record)).rejects.toThrow(/short on cash/);
  await poor.withdrawFakeUsd(50_000_000n);
  await expect(poor.purchase(record)).resolves.toBeTruthy();
  expect((await poor.getWallet()).fakeUsd).toBe(55_000_000n - record.price.amount);
});

test("withdrawFakeUsd failure injection and invalid amounts", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  await expect(adapter.withdrawFakeUsd(0n)).rejects.toThrow();
  await expect(adapter.withdrawFakeUsd(-1n)).rejects.toThrow();
  adapter.failNext("withdraw");
  await expect(adapter.withdrawFakeUsd(50_000_000n)).rejects.toThrow(/Card reader jammed/);
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n);
  await expect(adapter.withdrawFakeUsd(50_000_000n)).resolves.toMatchObject({ amount: 50_000_000n });
  // failNext("purchase") does not hit withdrawals.
  adapter.failNext("purchase");
  await expect(adapter.withdrawFakeUsd(1n)).resolves.toBeTruthy();
  adapter.setFailureMode("withdraw");
  await expect(adapter.withdrawFakeUsd(1n)).rejects.toThrow(/Card reader/);
  adapter.setFailureMode("all");
  await expect(adapter.withdrawFakeUsd(1n)).rejects.toThrow();
  adapter.setFailureMode("none");
  expect((await adapter.getWallet()).fakeUsd).toBe(150_000_001n);
});

// ---------------------------------------------------------------- lost answers
// "x-lost": the transaction lands (money moves, Record minted / handed over), then the call
// rejects with the timeout message. Retry of a purchase / sale returns the earlier result.

const TIMEOUT = "Shop took too long. Try again.";

test("failNext('purchase-lost'): charges and mints, rejects, Retry returns the same result without charging again", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  adapter.failNext("purchase-lost");
  await expect(adapter.purchase(record)).rejects.toThrow(TIMEOUT);
  // It landed: charged once, one Record minted.
  const afterLost = (await adapter.getWallet()).fakeUsd;
  expect(afterLost).toBe(100_000_000n - record.price.amount);
  const ownedAfterLost = await adapter.listOwnedRecords();
  expect(ownedAfterLost).toHaveLength(1);
  expect(ownedAfterLost[0].shopRecordId).toBe(record.id);

  const retry = await adapter.purchase(record);
  expect(retry.recordId).toBe(ownedAfterLost[0].recordId);
  expect(retry.digest).toMatch(/^[1-9A-HJ-NP-Za-km-z]{44}$/);
  expect((await adapter.getWallet()).fakeUsd).toBe(afterLost);
  expect(await adapter.listOwnedRecords()).toHaveLength(1);

  // The stored result is consumed: a later purchase is a real, new one.
  const again = await adapter.purchase(record);
  expect(again.recordId).not.toBe(retry.recordId);
  expect(again.digest).not.toBe(retry.digest);
  expect((await adapter.getWallet()).fakeUsd).toBe(afterLost - record.price.amount);
  expect(await adapter.listOwnedRecords()).toHaveLength(2);
});

test("purchase-lost Retry returns the same {recordId, digest} as the lost call would have", async () => {
  // Same seed, one adapter loses the answer, the other doesn't: the Retry result equals the
  // direct result (same ids drawn from the PRNG).
  const lost = new MockAdapter({ latencyMs: 0, seed: 3 });
  const direct = new MockAdapter({ latencyMs: 0, seed: 3 });
  const [record] = await lost.loadShopCatalog();
  lost.failNext("purchase-lost");
  await expect(lost.purchase(record)).rejects.toThrow(TIMEOUT);
  expect(await lost.purchase(record)).toEqual(await direct.purchase(record));
});

test("a lost purchase of one release does not answer a purchase of another", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [a, b] = await adapter.loadShopCatalog();
  adapter.failNext("purchase-lost");
  await expect(adapter.purchase(a)).rejects.toThrow(TIMEOUT);
  const lostId = (await adapter.listOwnedRecords())[0].recordId;
  const forB = await adapter.purchase(b);
  expect(forB.recordId).not.toBe(lostId);
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n - a.price.amount - b.price.amount);
  // The Retry for A still gets its stored result.
  expect((await adapter.purchase(a)).recordId).toBe(lostId);
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n - a.price.amount - b.price.amount);
});

test("sticky 'purchase-lost' mode still charges only once across a Retry", async () => {
  const adapter = new MockAdapter({ latencyMs: 0, failureMode: "purchase-lost" });
  const [record] = await adapter.loadShopCatalog();
  await expect(adapter.purchase(record)).rejects.toThrow(TIMEOUT);
  const first = await adapter.purchase(record); // Retry: the stored result, no new charge
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n - record.price.amount);
  expect(await adapter.listOwnedRecords()).toEqual([expect.objectContaining({ recordId: first.recordId })]);
  // Reads never fail in lost mode, and sells / withdrawals are unaffected.
  await expect(adapter.sellToNpc(first.recordId, collector)).resolves.toMatchObject({ paid: collector.offer });
  await expect(adapter.withdrawFakeUsd(1n)).resolves.toMatchObject({ amount: 1n });
});

test("plain failNext('purchase') and ?fail=purchase charge nothing and mint nothing", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  adapter.failNext("purchase");
  await expect(adapter.purchase(record)).rejects.toThrow(/Register jammed/);
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n);
  expect(await adapter.listOwnedRecords()).toHaveLength(0);

  const sticky = new MockAdapter({ latencyMs: 0, ...adapterOptionsFromUrl("?fail=purchase") });
  for (let i = 0; i < 2; i++) await expect(sticky.purchase(record)).rejects.toThrow(/Register jammed/);
  expect((await sticky.getWallet()).fakeUsd).toBe(100_000_000n);
  expect(await sticky.listOwnedRecords()).toHaveLength(0);
});

test("failNext('sell-lost'): pays and removes the Record, rejects, Retry returns the same result without paying again", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  const { recordId } = await adapter.purchase(record);
  const before = (await adapter.getWallet()).fakeUsd;
  adapter.failNext("sell-lost");
  await expect(adapter.sellToNpc(recordId, collector)).rejects.toThrow(TIMEOUT);
  expect((await adapter.getWallet()).fakeUsd).toBe(before + collector.offer);
  // Like testnet pending sales (4badb77): the Record keeps showing in the collection until a
  // Retry returns the earlier result, so a player who closed the error can finish the sale.
  expect((await adapter.listOwnedRecords()).map((r) => r.recordId)).toEqual([recordId]);

  const retry = await adapter.sellToNpc(recordId, collector);
  expect(retry.paid).toBe(collector.offer);
  expect(retry.digest).toHaveLength(44);
  expect((await adapter.getWallet()).fakeUsd).toBe(before + collector.offer);
  expect(await adapter.listOwnedRecords()).toHaveLength(0);
  // Consumed: a third attempt is a real sale of a Record you no longer own.
  await expect(adapter.sellToNpc(recordId, collector)).rejects.toThrow(/don't own/);
  expect((await adapter.getWallet()).fakeUsd).toBe(before + collector.offer);
});

test("sell-lost Retry returns the same {digest, paid} as the lost call would have", async () => {
  const lost = new MockAdapter({ latencyMs: 0, seed: 9 });
  const direct = new MockAdapter({ latencyMs: 0, seed: 9 });
  const [record] = await lost.loadShopCatalog();
  const a = await lost.purchase(record);
  const b = await direct.purchase(record);
  expect(a).toEqual(b);
  lost.failNext("sell-lost");
  await expect(lost.sellToNpc(a.recordId, collector)).rejects.toThrow(TIMEOUT);
  expect(await lost.sellToNpc(a.recordId, collector)).toEqual(await direct.sellToNpc(b.recordId, collector));
});

test("sticky 'sell-lost' mode pays only once across a Retry", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  const { recordId } = await adapter.purchase(record);
  const before = (await adapter.getWallet()).fakeUsd;
  adapter.setFailureMode("sell-lost");
  await expect(adapter.sellToNpc(recordId, collector)).rejects.toThrow(TIMEOUT);
  expect(await adapter.listOwnedRecords()).toHaveLength(1);
  await expect(adapter.sellToNpc(recordId, collector)).resolves.toMatchObject({ paid: collector.offer });
  expect((await adapter.getWallet()).fakeUsd).toBe(before + collector.offer);
  expect(await adapter.listOwnedRecords()).toHaveLength(0);
});

test("failNext('withdraw-lost'): credits, rejects, and a Retry dispenses again", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  adapter.failNext("withdraw-lost");
  await expect(adapter.withdrawFakeUsd(50_000_000n)).rejects.toThrow(TIMEOUT);
  expect((await adapter.getWallet()).fakeUsd).toBe(150_000_000n);
  const retry = await adapter.withdrawFakeUsd(50_000_000n);
  expect(retry.amount).toBe(50_000_000n);
  expect((await adapter.getWallet()).fakeUsd).toBe(200_000_000n);
});

test("lost-answer kinds only hit their own transaction", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  adapter.failNext("withdraw-lost");
  // The queued withdraw-lost does not touch a purchase or a sale.
  const { recordId } = await adapter.purchase(record);
  await expect(adapter.sellToNpc(recordId, collector)).resolves.toBeTruthy();
  await expect(adapter.withdrawFakeUsd(1n)).rejects.toThrow(TIMEOUT);
  await expect(adapter.withdrawFakeUsd(1n)).resolves.toBeTruthy();
});

test("adapterOptionsFromUrl parses the fail modes, latency and mockhls", () => {
  for (const mode of ["purchase", "sell", "withdraw", "all", "purchase-lost", "sell-lost", "withdraw-lost"] as const) {
    expect(adapterOptionsFromUrl(`?fail=${mode}`)).toEqual({ failureMode: mode });
  }
  expect(adapterOptionsFromUrl("?fail=purchase-lost&latency=0")).toEqual({ failureMode: "purchase-lost", latencyMs: 0 });
  expect(adapterOptionsFromUrl("?latency=-5&mockhls=1")).toEqual({ latencyMs: 0, mockHls: true });
  expect(adapterOptionsFromUrl("")).toEqual({});
  // Unknown modes are ignored (with a console warning), not passed through.
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect(adapterOptionsFromUrl("?fail=bogus-lost")).toEqual({});
    expect(adapterOptionsFromUrl("?fail=any")).toEqual({});
  } finally {
    console.warn = warn;
  }
});

test("?fail=purchase-lost through adapterOptionsFromUrl: lands once, Retry returns it", async () => {
  const adapter = new MockAdapter({ ...adapterOptionsFromUrl("?fail=purchase-lost"), latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  await expect(adapter.purchase(record)).rejects.toThrow(TIMEOUT);
  const [minted] = await adapter.listOwnedRecords();
  expect((await adapter.purchase(record)).recordId).toBe(minted.recordId);
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n - record.price.amount);
});

test("?fail=withdraw-lost through adapterOptionsFromUrl: every withdrawal lands and loses its answer", async () => {
  const adapter = new MockAdapter({ ...adapterOptionsFromUrl("?fail=withdraw-lost&latency=0") });
  await expect(adapter.withdrawFakeUsd(10_000_000n)).rejects.toThrow(TIMEOUT);
  await expect(adapter.withdrawFakeUsd(10_000_000n)).rejects.toThrow(TIMEOUT);
  expect((await adapter.getWallet()).fakeUsd).toBe(120_000_000n);
});

test("a lost purchase never retried is not handed to a later purchase once that Record was sold", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  adapter.failNext("purchase-lost");
  await expect(adapter.purchase(record!)).rejects.toThrow(/took too long/);
  const [first] = await adapter.listOwnedRecords();
  expect(first).toBeDefined();
  await adapter.sellToNpc(first!.recordId, collector);
  const before = (await adapter.getWallet()).fakeUsd;
  const again = await adapter.purchase(record!);
  expect(again.recordId).not.toBe(first!.recordId);
  expect((await adapter.getWallet()).fakeUsd).toBe(before - record!.price.amount);
  expect((await adapter.listOwnedRecords()).map((r) => r.recordId)).toEqual([again.recordId]);
});
