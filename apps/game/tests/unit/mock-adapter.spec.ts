import { expect, test } from "@playwright/test";
import { MockAdapter } from "../../src/miso/mock-adapter";
import { MOCK_HLS_QUILT } from "../../src/miso/mock-catalog";
import { formatAmount, shortId } from "../../src/miso/format";
import type { NpcBuyer } from "../../src/miso/types";

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
  expect(adapter.explorerTxUrl(result.digest)).toBe(`https://suiscan.xyz/testnet/tx/${result.digest}`);
});

test("insufficient funds error is player friendly", async () => {
  const adapter = new MockAdapter({ latencyMs: 0, startFakeUsd: 5_000_000n });
  const [record] = await adapter.loadShopCatalog();
  await expect(adapter.purchase(record)).rejects.toThrow(
    "Not enough FakeUSD — you have 5.00 FUSD, this costs 12.00 FUSD.",
  );
  expect((await adapter.getWallet()).fakeUsd).toBe(5_000_000n);
});

test("failNext fails exactly one transaction without spending", async () => {
  const adapter = new MockAdapter({ latencyMs: 0 });
  const [record] = await adapter.loadShopCatalog();
  adapter.failNext("purchase");
  await expect(adapter.purchase(record)).rejects.toThrow(/Transaction rejected/);
  expect((await adapter.getWallet()).fakeUsd).toBe(100_000_000n);
  await expect(adapter.purchase(record)).resolves.toBeTruthy();

  adapter.setFailureMode("all");
  await expect(adapter.purchase(record)).rejects.toThrow(/Transaction rejected/);
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
