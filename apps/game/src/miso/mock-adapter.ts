/**
 * MockAdapter: a FAKE, in-memory MisoAdapter. Nothing here touches a chain.
 *
 * Owns: a pretend wallet, pretend shop supply and pretend Record objects, with
 * simulated latency and optional failure injection so the pending/error UI can
 * be exercised by automated tests without a network. TEST INFRASTRUCTURE ONLY: the
 * game never uses it; select.ts picks it only in e2e test builds (`vite build --mode e2e`),
 * and unit tests construct it directly.
 * Must not: do network I/O, import Sui SDKs, or know about rendering.
 *
 * Everything is deterministic for a given seed: ids and digests come from a
 * seeded PRNG, so tests and demos are repeatable. Ids look like Sui object ids
 * (0x + 64 hex) and digests look like base58 transaction digests (44 chars), but
 * none of them exist anywhere; explorer links for them will not resolve.
 *
 * URL knobs (e2e test builds, parsed in select.ts): ?latency=ms, ?fail=purchase|sell|withdraw|all, ?mockhls=1.
 *
 * "Lost answer" failures (?fail=purchase-lost|sell-lost|withdraw-lost, or failNext): the
 * transaction LANDS (money moves, the Record is minted / handed over), then the call rejects
 * with the timeout message, like a testnet transaction whose response never arrived. Retry
 * semantics match the TestnetAdapter: a purchase or sale retried after a lost answer returns
 * the earlier result (charged / paid once); a withdrawal retried after a lost answer
 * dispenses again (testnet has no ATM idempotency either; it is play money).
 */
import type { MisoAdapter } from "./adapter";
import { explorerObjectUrl, explorerTxUrl } from "./explorer";
import { formatAmount } from "./format";
import { MOCK_CATALOG, MOCK_HLS_QUILT } from "./mock-catalog";
import { COLLECTOR } from "../game/npc-buyers";
import type {
  NpcBuyer,
  OwnedRecord,
  PurchaseResult,
  SellResult,
  ShopRecord,
  Wallet,
  WithdrawResult,
} from "./types";

type TxKind = "purchase" | "sell" | "withdraw";
/** A transaction that lands on chain but whose answer is lost (rejects with a timeout). */
export type LostKind = `${TxKind}-lost`;
/** Which transactions are forced to fail. "all" = purchase, sell and withdraw. Reads never fail. */
export type FailureMode = "none" | TxKind | "all" | LostKind;
/** For failNext(): "any" = the next purchase, sell OR withdraw, whichever comes first. */
export type FailKind = TxKind | "any" | LostKind;

export interface MockAdapterOptions {
  /** Simulated network latency per call, ms. Default 800. */
  latencyMs?: number;
  failureMode?: FailureMode;
  /** Attach the real testnet quilt to every track (test real HLS with a fake chain). */
  mockHls?: boolean;
  /** PRNG seed for ids/digests. Default 1. */
  seed?: number;
  /** Starting balances (base units). Defaults: 100 FUSD, 1.5 SUI. */
  startFakeUsd?: bigint;
  startSui?: bigint;
}

const FUSD_DECIMALS = 6;
const FUSD_SYMBOL = "FUSD";
/** Fixed fake player address. */
export const MOCK_WALLET_ADDRESS =
  "0x5ca1ab1e000000000000000000000000000000000000000000000000c0ffee01";

// Player-facing (shown in the error dialogs): plain game language, no chain terms.
const TX_FAILED_MESSAGE =
  "Register jammed. Try again.";
const SELL_FAILED_MESSAGE =
  "Deal fell through. You still own it.";

const WITHDRAW_FAILED_MESSAGE =
  "Card reader jammed. Try again.";
/** Same words as the testnet adapter's timeout (src/miso/testnet/errors.ts MESSAGES.timeout). */
const TIMEOUT_MESSAGE = "Shop took too long. Try again.";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** mulberry32: tiny deterministic PRNG returning [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class MockAdapter implements MisoAdapter {
  readonly network = "mock" as const;

  private latencyMs: number;
  private failureMode: FailureMode;
  private pendingFailures: FailKind[] = [];
  private readonly random: () => number;
  private readonly catalog: ShopRecord[];
  private fakeUsd: bigint;
  private sui: bigint;
  /** Newest first. */
  private owned: OwnedRecord[] = [];
  private clock = 0;
  /** Purchases that landed but whose answer was lost, by shop record id (Retry returns them). */
  private lostPurchases = new Map<string, PurchaseResult>();
  /**
   * Sales that landed but whose answer was lost, by Record id. Like the testnet adapter's
   * pending sales, the Record keeps showing in the collection until a Retry returns the result.
   */
  private lostSales = new Map<string, { result: SellResult; owned: OwnedRecord }>();

  constructor(options: MockAdapterOptions = {}) {
    this.latencyMs = options.latencyMs ?? 800;
    this.failureMode = options.failureMode ?? "none";
    this.random = mulberry32(options.seed ?? 1);
    this.fakeUsd = options.startFakeUsd ?? 100_000_000n; // 100.00 FUSD
    this.sui = options.startSui ?? 1_500_000_000n; // 1.5 SUI in MIST
    this.catalog = MOCK_CATALOG.map((record) => ({
      ...record,
      palette: [...record.palette],
      price: { ...record.price },
      synth: { ...record.synth, notes: [...record.synth.notes] },
      tracks: record.tracks.map((track) =>
        options.mockHls
          ? { ...track, quiltId: MOCK_HLS_QUILT.quiltId, durationSec: MOCK_HLS_QUILT.durationSec }
          : { ...track },
      ),
    }));
  }

  // ---- Debug / test controls (not part of MisoAdapter) ----

  /** Make every matching call fail until changed. */
  setFailureMode(mode: FailureMode): void {
    this.failureMode = mode;
  }
  /** Make only the next matching transaction fail (queued; one per call). */
  failNext(kind: FailKind): void {
    this.pendingFailures.push(kind);
  }
  setLatency(ms: number): void {
    this.latencyMs = Math.max(0, ms);
  }

  // ---- MisoAdapter ----

  async loadShopCatalog(): Promise<ShopRecord[]> {
    await this.simulate("read");
    return this.catalog.map((record) => ({ ...record, tracks: record.tracks.map((t) => ({ ...t })) }));
  }

  async getWallet(): Promise<Wallet> {
    await this.simulate("read");
    return {
      address: MOCK_WALLET_ADDRESS,
      fakeUsd: this.fakeUsd,
      fakeUsdDecimals: FUSD_DECIMALS,
      sui: this.sui,
    };
  }

  async purchase(record: ShopRecord): Promise<PurchaseResult> {
    await sleep(this.latencyMs);
    // Retry after a lost answer: the earlier purchase landed, return it (never buy twice).
    const earlier = this.lostPurchases.get(record.id);
    if (earlier) {
      this.lostPurchases.delete(record.id);
      // Only while that Record is still yours (sold meanwhile = this is a new purchase), as on testnet.
      if (this.owned.some((r) => r.recordId === earlier.recordId)) return earlier;
    }
    this.injectFailure("purchase");
    const stock = this.catalog.find((r) => r.id === record.id);
    if (!stock) throw new Error("Not for sale here.");
    if (stock.minted >= stock.maxSupply) throw new Error("Sold out. Every copy's gone.");
    const price = stock.price.amount;
    if (this.fakeUsd < price) {
      throw new Error("Jazz frowns: short on cash.");
    }
    this.fakeUsd -= price;
    this.sui -= 2_000_000n; // pretend gas
    stock.minted += 1;
    const recordId = this.fakeObjectId();
    this.owned.unshift({
      recordId,
      shopRecordId: stock.id,
      title: stock.title,
      artist: stock.artist,
      coverUrl: stock.coverUrl,
      serial: stock.minted,
      maxSupply: stock.maxSupply,
      acquiredAt: this.now(),
    });
    const result = { recordId, digest: this.fakeDigest() };
    if (this.takeLost("purchase")) {
      this.lostPurchases.set(record.id, result);
      throw new Error(TIMEOUT_MESSAGE);
    }
    return result;
  }

  async withdrawFakeUsd(amount: bigint): Promise<WithdrawResult> {
    if (amount <= 0n) throw new Error("The ATM won't dispense nothing.");
    await this.simulate("withdraw");
    this.fakeUsd += amount;
    this.sui -= 1_000_000n; // pretend gas
    const result = { digest: this.fakeDigest(), amount };
    if (this.takeLost("withdraw")) throw new Error(TIMEOUT_MESSAGE);
    return result;
  }

  async listOwnedRecords(): Promise<OwnedRecord[]> {
    await this.simulate("read");
    const pending = [...this.lostSales.values()].map((s) => s.owned);
    return [...this.owned, ...pending].sort((a, b) => b.acquiredAt - a.acquiredAt).map((r) => ({ ...r }));
  }

  async collectorAddress(): Promise<string> {
    return COLLECTOR.address;
  }

  async sellToNpc(recordId: string, npc: NpcBuyer): Promise<SellResult> {
    await sleep(this.latencyMs);
    // Retry after a lost answer: the earlier sale landed, return it (paid once).
    const earlier = this.lostSales.get(recordId);
    if (earlier) {
      this.lostSales.delete(recordId);
      return earlier.result;
    }
    this.injectFailure("sell");
    const index = this.owned.findIndex((r) => r.recordId === recordId);
    if (index < 0) throw new Error("You don't own that any more.");
    const [sold] = this.owned.splice(index, 1);
    this.fakeUsd += npc.offer;
    this.sui -= 2_000_000n;
    const result = { digest: this.fakeDigest(), paid: npc.offer };
    if (this.takeLost("sell") && sold) {
      this.lostSales.set(recordId, { result, owned: sold });
      throw new Error(TIMEOUT_MESSAGE);
    }
    return result;
  }

  explorerTxUrl(digest: string): string {
    return explorerTxUrl(digest);
  }
  explorerObjectUrl(objectId: string): string {
    return explorerObjectUrl(objectId);
  }

  // ---- internals ----

  /** Wait the simulated latency, then throw if failure injection says so. */
  private async simulate(kind: "read" | TxKind): Promise<void> {
    await sleep(this.latencyMs);
    if (kind !== "read") this.injectFailure(kind);
  }

  /** Throw a plain "nothing happened" failure if injection says so (before any effect). */
  private injectFailure(kind: TxKind): void {
    const queued = this.pendingFailures.findIndex((k) => k === kind || k === "any");
    if (queued >= 0) {
      this.pendingFailures.splice(queued, 1);
      throw new Error(kind === "sell" ? SELL_FAILED_MESSAGE : kind === "withdraw" ? WITHDRAW_FAILED_MESSAGE : TX_FAILED_MESSAGE);
    }
    const mode = this.failureMode;
    if (mode === "all" || mode === kind) {
      throw new Error(kind === "sell" ? SELL_FAILED_MESSAGE : kind === "withdraw" ? WITHDRAW_FAILED_MESSAGE : TX_FAILED_MESSAGE);
    }
  }

  /** After the effect: should this answer be "lost" (reject with a timeout although it landed)? */
  private takeLost(kind: TxKind): boolean {
    const lost: LostKind = `${kind}-lost`;
    const queued = this.pendingFailures.indexOf(lost);
    if (queued >= 0) {
      this.pendingFailures.splice(queued, 1);
      return true;
    }
    return this.failureMode === lost;
  }

  private fusd(amount: bigint): string {
    return formatAmount(amount, FUSD_DECIMALS, FUSD_SYMBOL);
  }

  private fakeObjectId(): string {
    let hex = "0x";
    for (let i = 0; i < 64; i++) hex += Math.floor(this.random() * 16).toString(16);
    return hex;
  }

  private fakeDigest(): string {
    let digest = "";
    for (let i = 0; i < 44; i++) digest += BASE58[Math.floor(this.random() * BASE58.length)];
    return digest;
  }

  /** Monotonic timestamps so "newest first" ordering is stable even within one ms. */
  private now(): number {
    this.clock = Math.max(this.clock + 1, Date.now());
    return this.clock;
  }
}
