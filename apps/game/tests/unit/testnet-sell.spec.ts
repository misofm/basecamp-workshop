import { expect, test } from "@playwright/test";
import type { ChainRecord } from "../../src/miso/testnet/chain";
import { FUSD_TYPE } from "../../src/miso/testnet/config";
import { offerFor, sellRecord, type PendingSale, type SellDeps } from "../../src/miso/testnet/sell";

/**
 * sellRecord() decision logic against an in-memory fake chain: who owns the Record,
 * which digests landed, and the pending-sale store (localStorage in the app).
 */

const PLAYER = `0x${"a".repeat(64)}`;
const GAME = `0x${"b".repeat(64)}`;
const STRANGER = `0x${"c".repeat(64)}`;
const RECORD_ID = `0x${"1".repeat(64)}`;
const FUSD = (n: number) => BigInt(n) * 1_000_000n;

type Status = "success" | "failed" | "unknown";

class FakeChain {
  owner: string | null = PLAYER;
  record: ChainRecord | null = {
    recordId: RECORD_ID,
    releaseId: "0xrelease",
    pressingId: "0xpressing",
    edition: 1,
    number: 7,
    purchasePrice: FUSD(8),
    // as the fullnode returns it: no 0x prefix
    purchaseCurrency: FUSD_TYPE.replace(/^0x/, ""),
    purchasedAtMs: 1,
  };
  txs = new Map<string, Status>();
  transfers = 0;
  payouts: bigint[] = [];
  paidToPlayer = 0n;
  /** Next payout: throw after the digest is known, leaving it "failed" or "unknown" on chain. */
  failNextPayout: Status | null = null;
  store = new Map<string, PendingSale>();
  private n = 0;

  deps(): SellDeps {
    return {
      player: PLAYER,
      game: GAME,
      getRecord: async () => ({ record: this.record, owner: this.owner }),
      transfer: async (_id, onDigest) => {
        const digest = `transfer-${++this.n}`;
        onDigest(digest);
        this.transfers++;
        this.owner = GAME;
        this.txs.set(digest, "success");
        return { digest };
      },
      pay: async (amount, onDigest) => {
        const digest = `payout-${++this.n}`;
        onDigest(digest);
        if (this.failNextPayout) {
          this.txs.set(digest, this.failNextPayout);
          this.failNextPayout = null;
          throw Object.assign(new Error("fetch failed"), {});
        }
        this.payouts.push(amount);
        this.paidToPlayer += amount;
        this.txs.set(digest, "success");
        return { digest };
      },
      txStatus: async (digest) => this.txs.get(digest) ?? "unknown",
      pending: {
        get: (id) => this.store.get(id),
        set: (id, sale) => (sale ? this.store.set(id, sale) : this.store.delete(id)),
      },
      describe: (id, r) => ({ recordId: id, shopRecordId: r.releaseId, title: "T", artist: "A", coverUrl: "", serial: r.number, maxSupply: 10, acquiredAt: 1 }),
    };
  }
}

test("offer is floor(price * 3/2), capped at 150 FUSD", () => {
  expect(offerFor(FUSD(8))).toBe(FUSD(12));
  expect(offerFor(FUSD(200))).toBe(FUSD(150));
  expect(offerFor(FUSD(100))).toBe(FUSD(150));
  expect(offerFor(3n)).toBe(4n);
});

test("happy path: transfer to the GAME, GAME pays 1.5x, pending cleared", async () => {
  const chain = new FakeChain();
  const result = await sellRecord(RECORD_ID, chain.deps());
  expect(result).toEqual({ digest: "payout-2", paid: FUSD(12) });
  expect(chain.owner).toBe(GAME);
  expect(chain.transfers).toBe(1);
  expect(chain.payouts).toEqual([FUSD(12)]);
  expect(chain.store.size).toBe(0);
});

test("payout is capped at 150 FUSD for a 200 FUSD record", async () => {
  const chain = new FakeChain();
  chain.record!.purchasePrice = FUSD(200);
  expect((await sellRecord(RECORD_ID, chain.deps())).paid).toBe(FUSD(150));
  expect(chain.paidToPlayer).toBe(FUSD(150));
});

test("pending entry holds the transfer digest before the payout is attempted", async () => {
  const chain = new FakeChain();
  chain.failNextPayout = "unknown";
  const deps = chain.deps();
  const seen: (PendingSale | undefined)[] = [];
  const origPay = deps.pay;
  deps.pay = (amount, onDigest) => {
    seen.push(chain.store.get(RECORD_ID));
    return origPay(amount, onDigest);
  };
  await expect(sellRecord(RECORD_ID, deps)).rejects.toThrow(/^The collector has your record but hasn't paid yet: .*Press Retry/);
  expect(seen[0]).toMatchObject({ player: PLAYER, transferDigest: "transfer-1" });
  expect(seen[0]!.payoutDigest).toBeUndefined();
  expect(chain.store.get(RECORD_ID)).toMatchObject({ transferDigest: "transfer-1", payoutDigest: "payout-2" });
});

test("retry after a failed payout pays exactly once and never transfers again", async () => {
  const chain = new FakeChain();
  chain.failNextPayout = "failed";
  await expect(sellRecord(RECORD_ID, chain.deps())).rejects.toThrow(/hasn't paid yet/);
  expect(chain.paidToPlayer).toBe(0n);
  expect(chain.owner).toBe(GAME);

  const result = await sellRecord(RECORD_ID, chain.deps());
  expect(result.paid).toBe(FUSD(12));
  expect(chain.transfers).toBe(1);
  expect(chain.payouts).toEqual([FUSD(12)]);
  expect(chain.store.size).toBe(0);
});

test("retry after a payout that never reached the node pays again", async () => {
  const chain = new FakeChain();
  chain.failNextPayout = "unknown";
  await expect(sellRecord(RECORD_ID, chain.deps())).rejects.toThrow(/hasn't paid yet/);
  const result = await sellRecord(RECORD_ID, chain.deps());
  expect(result.digest).not.toBe("payout-2");
  expect(chain.payouts).toEqual([FUSD(12)]);
});

test("retry whose stored payout digest landed returns it without paying", async () => {
  const chain = new FakeChain();
  chain.owner = GAME;
  chain.txs.set("transfer-x", "success").set("payout-x", "success");
  const owned = chain.deps().describe(RECORD_ID, chain.record!);
  chain.store.set(RECORD_ID, { player: PLAYER, transferDigest: "transfer-x", payoutDigest: "payout-x", owned });
  const result = await sellRecord(RECORD_ID, chain.deps());
  expect(result).toEqual({ digest: "payout-x", paid: FUSD(12) });
  expect(chain.payouts).toEqual([]);
  expect(chain.transfers).toBe(0);
  expect(chain.store.size).toBe(0);
});

test("GAME already owns the record and there is no pending sale: refuse", async () => {
  const chain = new FakeChain();
  chain.owner = GAME;
  await expect(sellRecord(RECORD_ID, chain.deps())).rejects.toThrow("The collector already has this record.");
  expect(chain.payouts).toEqual([]);
});

test("a pending sale started by another player key is ignored", async () => {
  const chain = new FakeChain();
  chain.owner = GAME;
  const owned = chain.deps().describe(RECORD_ID, chain.record!);
  chain.store.set(RECORD_ID, { player: STRANGER, transferDigest: "t", owned });
  await expect(sellRecord(RECORD_ID, chain.deps())).rejects.toThrow("The collector already has this record.");
});

test("not owned by the player: notOwned, nothing moves", async () => {
  const chain = new FakeChain();
  chain.owner = STRANGER;
  const error = await sellRecord(RECORD_ID, chain.deps()).catch((e: unknown) => e);
  expect(error).toMatchObject({ kind: "notOwned", message: "You don't own that record any more." });
  expect(chain.transfers).toBe(0);
});

test("record bought in another currency: refused before the transfer", async () => {
  const chain = new FakeChain();
  chain.record!.purchaseCurrency = "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
  await expect(sellRecord(RECORD_ID, chain.deps())).rejects.toThrow("The collector only buys records that were bought with FakeUSD.");
  expect(chain.transfers).toBe(0);
  expect(chain.owner).toBe(PLAYER);
});

test("not a live Record type: refused before the transfer", async () => {
  const chain = new FakeChain();
  chain.record = null;
  await expect(sellRecord(RECORD_ID, chain.deps())).rejects.toThrow("The collector only buys Miso records.");
  expect(chain.transfers).toBe(0);
});

test("player still owns it but a stale pending entry exists: start over with one transfer", async () => {
  const chain = new FakeChain();
  const owned = chain.deps().describe(RECORD_ID, chain.record!);
  chain.store.set(RECORD_ID, { player: PLAYER, transferDigest: "never-landed", owned });
  const result = await sellRecord(RECORD_ID, chain.deps());
  expect(result.paid).toBe(FUSD(12));
  expect(chain.transfers).toBe(1);
  expect(chain.payouts).toEqual([FUSD(12)]);
});

test("a timed-out transfer keeps the pending entry so Retry re-checks it", async () => {
  const chain = new FakeChain();
  const deps = chain.deps();
  deps.transfer = async (_id, onDigest) => {
    onDigest("transfer-slow");
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  };
  await expect(sellRecord(RECORD_ID, deps)).rejects.toThrow(/didn't answer in time/);
  expect(chain.store.get(RECORD_ID)?.transferDigest).toBe("transfer-slow");
  // It landed after all: Retry only pays.
  chain.owner = GAME;
  chain.txs.set("transfer-slow", "success");
  const result = await sellRecord(RECORD_ID, chain.deps());
  expect(result.paid).toBe(FUSD(12));
  expect(chain.transfers).toBe(0);
  expect(chain.payouts).toEqual([FUSD(12)]);
});
