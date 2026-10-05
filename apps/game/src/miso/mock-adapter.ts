/**
 * MockAdapter: a FAKE, in-memory MisoAdapter. Nothing here touches a chain.
 *
 * Owns: a pretend wallet, pretend shop supply and pretend Record objects, with
 * simulated latency and optional failure injection so the pending/error UI can
 * be exercised on stage without a network.
 * Must not: do network I/O, import Sui SDKs, or know about rendering.
 *
 * Everything is deterministic for a given seed: ids and digests come from a
 * seeded PRNG, so tests and demos are repeatable. Ids look like Sui object ids
 * (0x + 64 hex) and digests look like base58 transaction digests (44 chars), but
 * none of them exist anywhere; explorer links for them will not resolve.
 *
 * URL knobs (parsed in select.ts): ?latency=ms, ?fail=purchase|sell|withdraw|all, ?mockhls=1.
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

/** Which transactions are forced to fail. "all" = purchase, sell and withdraw. Reads never fail. */
export type FailureMode = "none" | "purchase" | "sell" | "withdraw" | "all";
/** For failNext(): "any" = the next purchase, sell OR withdraw, whichever comes first. */
export type FailKind = "purchase" | "sell" | "withdraw" | "any";

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
  "Couldn't complete the purchase — the shop's connection dropped. Your FakeUSD was not spent.";
const SELL_FAILED_MESSAGE =
  "The sale didn't go through — the connection dropped. You still own the record.";

const WITHDRAW_FAILED_MESSAGE =
  "The ATM couldn't reach the bank. Nothing was withdrawn.";

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
    await this.simulate("purchase");
    const stock = this.catalog.find((r) => r.id === record.id);
    if (!stock) throw new Error("That record isn't for sale here.");
    if (stock.minted >= stock.maxSupply) throw new Error("Sold out — every copy has been sold.");
    const price = stock.price.amount;
    if (this.fakeUsd < price) {
      throw new Error(
        `Not enough FakeUSD — you have ${this.fusd(this.fakeUsd)}, this costs ${this.fusd(price)}.`,
      );
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
    return { recordId, digest: this.fakeDigest() };
  }

  async withdrawFakeUsd(amount: bigint): Promise<WithdrawResult> {
    if (amount <= 0n) throw new Error("The ATM can't dispense nothing.");
    await this.simulate("withdraw");
    this.fakeUsd += amount;
    this.sui -= 1_000_000n; // pretend gas
    return { digest: this.fakeDigest(), amount };
  }

  async listOwnedRecords(): Promise<OwnedRecord[]> {
    await this.simulate("read");
    return this.owned.map((r) => ({ ...r }));
  }

  async collectorAddress(): Promise<string> {
    return COLLECTOR.address;
  }

  async sellToNpc(recordId: string, npc: NpcBuyer): Promise<SellResult> {
    await this.simulate("sell");
    const index = this.owned.findIndex((r) => r.recordId === recordId);
    if (index < 0) throw new Error("You don't own that record any more.");
    this.owned.splice(index, 1);
    this.fakeUsd += npc.offer;
    this.sui -= 2_000_000n;
    return { digest: this.fakeDigest(), paid: npc.offer };
  }

  explorerTxUrl(digest: string): string {
    return explorerTxUrl(digest);
  }
  explorerObjectUrl(objectId: string): string {
    return explorerObjectUrl(objectId);
  }

  // ---- internals ----

  /** Wait the simulated latency, then throw if failure injection says so. */
  private async simulate(kind: "read" | "purchase" | "sell" | "withdraw"): Promise<void> {
    await sleep(this.latencyMs);
    if (kind !== "read") {
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
