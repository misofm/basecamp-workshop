/**
 * TestnetBackend: the heavy half of TestnetAdapter (loaded lazily with the Sui SDK).
 *
 * Owns: session state that makes the chain feel instant and retries safe:
 *  - the hydrated catalog + raw listing terms (purchase passes them as expectedPricing),
 *  - locally-known recent purchases / sales, merged into chain reads until the
 *    fullnode's owned-object index agrees (LOCAL_MERGE_TTL_MS),
 *  - the in-flight purchase digest per release (Retry after a timeout first checks
 *    whether the earlier attempt landed instead of buying twice),
 *  - pending sales in localStorage (Record transferred, collector not yet paid), so
 *    Retry skips the transfer and only re-asks the bank server for payment,
 *  - one auto-fund attempt per session (and again after a gas / FakeUSD shortfall).
 * Must not: return Sui SDK types; everything leaving here is ../types data or PlayerError.
 */
import type { NpcBuyer, OwnedRecord, PurchaseResult, SellResult, ShopRecord, Wallet } from "../types";
import { collectorBuy, fund, getCollector, type CollectorBuyResponse } from "./bank";
import { getBurner } from "./burner";
import { artistOf, loadCatalog, releaseCoverUrl, type SaleTerms } from "./catalog";
import {
  getBalances,
  getRecord,
  isRecordType,
  listRecords,
  purchaseTransaction,
  signAndRun,
  simulatePurchase,
  transferTransaction,
  waitFor,
  type ChainRecord,
} from "./chain";
import { FUSD_DECIMALS, LOCAL_MERGE_TTL_MS, MIN_FUSD, MIN_SUI, PENDING_SALES_KEY } from "./config";
import { MESSAGES, PlayerError, toPlayerError, type Phase } from "./errors";
import { getPressing, getRelease } from "./miso-api";
import { sleep } from "./net";

interface PendingSale {
  digest: string;
  owned: OwnedRecord;
}

const sameAddress = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

export class TestnetBackend {
  private catalogPromise: Promise<{ records: ShopRecord[]; terms: Map<string, SaleTerms> }> | null = null;
  private recentPurchases = new Map<string, { owned: OwnedRecord; at: number }>();
  private recentSales = new Map<string, number>();
  private pendingPurchases = new Map<string, string>();
  private knownOwned = new Map<string, OwnedRecord>();
  private fundTried = false;
  private funding: Promise<boolean> | null = null;

  private get address(): string {
    return getBurner().toSuiAddress();
  }

  // ───────────────────────────── catalog ─────────────────────────────

  private catalog() {
    if (!this.catalogPromise) {
      this.catalogPromise = loadCatalog();
      this.catalogPromise.catch(() => (this.catalogPromise = null));
    }
    return this.catalogPromise;
  }

  async loadShopCatalog(): Promise<ShopRecord[]> {
    try {
      return (await this.catalog()).records;
    } catch (error) {
      throw toPlayerError(error, "read");
    }
  }

  // ───────────────────────────── wallet ─────────────────────────────

  async getWallet(): Promise<Wallet> {
    const address = this.address;
    let balances: { sui: bigint; fakeUsd: bigint };
    try {
      balances = await getBalances(address);
    } catch (error) {
      throw toPlayerError(error, "read");
    }
    if (!this.fundTried && (balances.sui < MIN_SUI || balances.fakeUsd < MIN_FUSD)) {
      this.fundTried = true;
      if (await this.requestFunds()) balances = await getBalances(address).catch(() => balances);
    }
    return { address, fakeUsd: balances.fakeUsd, fakeUsdDecimals: FUSD_DECIMALS, sui: balances.sui };
  }

  /** Ask the bank server to top the burner up. Never throws; true if a funding tx landed. */
  private requestFunds(): Promise<boolean> {
    this.funding ??= (async () => {
      try {
        const res = await fund(this.address);
        if (!res.funded) {
          console.info(`[miso testnet] bank: not funded (${res.reason ?? "no reason"})`);
          return false;
        }
        if (res.digest) await waitFor(res.digest, 20_000).catch(() => {});
        return true;
      } catch (error) {
        console.warn(`[miso testnet] bank top-up failed: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      } finally {
        this.funding = null;
      }
    })();
    return this.funding;
  }

  /** Map an error and, for a gas / FakeUSD shortfall, ask the bank for a top-up in the background. */
  private fail(error: unknown, phase: Phase): PlayerError {
    const mapped = toPlayerError(error, phase);
    if (mapped.kind === "gas" || mapped.kind === "fusd") void this.requestFunds();
    return mapped;
  }

  // ───────────────────────────── purchase ─────────────────────────────

  async purchase(record: ShopRecord): Promise<PurchaseResult> {
    let terms: SaleTerms | undefined;
    try {
      terms = (await this.catalog()).terms.get(record.id);
    } catch (error) {
      throw toPlayerError(error, "read");
    }
    if (!terms) throw new PlayerError(MESSAGES.notListed);
    const signer = getBurner();
    const buyer = signer.toSuiAddress();
    try {
      // Retry after a timeout: did the earlier attempt land after all?
      const earlier = this.pendingPurchases.get(record.id);
      if (earlier) {
        this.pendingPurchases.delete(record.id);
        const landed = await waitFor(earlier, 8_000).catch(() => null);
        const id = landed?.created.find((c) => isRecordType(c.type))?.objectId;
        if (landed && id) return await this.afterPurchase(record, id, landed.digest);
      }
      const executed = await signAndRun(purchaseTransaction(terms, buyer), signer, (digest) => this.pendingPurchases.set(record.id, digest));
      this.pendingPurchases.delete(record.id);
      const recordId = executed.created.find((c) => isRecordType(c.type))?.objectId;
      if (!recordId) {
        throw new PlayerError("The purchase went through but the Record didn't show up yet. Check your collection (C).");
      }
      return await this.afterPurchase(record, recordId, executed.digest);
    } catch (error) {
      const mapped = this.fail(error, "purchase");
      // Only an unanswered submission can still land; anything else is final.
      if (mapped.kind !== "timeout" && mapped.kind !== "network") this.pendingPurchases.delete(record.id);
      throw mapped;
    }
  }

  private async afterPurchase(record: ShopRecord, recordId: string, digest: string): Promise<PurchaseResult> {
    const chainRecord = await getRecord(recordId).then((r) => r.record).catch(() => null);
    const owned: OwnedRecord = {
      recordId,
      shopRecordId: record.id,
      title: record.title,
      artist: record.artist,
      coverUrl: record.coverUrl,
      serial: chainRecord?.number ?? record.minted + 1,
      maxSupply: record.maxSupply,
      acquiredAt: chainRecord?.purchasedAtMs || Date.now(),
    };
    this.recentPurchases.set(recordId, { owned, at: Date.now() });
    this.recentSales.delete(recordId);
    this.knownOwned.set(recordId, owned);
    return { recordId, digest };
  }

  // ───────────────────────────── owned records ─────────────────────────────

  async listOwnedRecords(): Promise<OwnedRecord[]> {
    const address = this.address;
    let chainRecords: ChainRecord[];
    try {
      chainRecords = await listRecords(address);
    } catch (error) {
      throw toPlayerError(error, "read");
    }
    const catalog = await this.catalog().then((c) => new Map(c.records.map((r) => [r.id, r]))).catch(() => new Map<string, ShopRecord>());
    const now = Date.now();
    const onChain = new Set(chainRecords.map((r) => r.recordId));
    const result = new Map<string, OwnedRecord>();

    const mapped = await Promise.all(chainRecords.map((r) => this.toOwned(r, catalog)));
    for (const o of mapped) {
      const soldAt = this.recentSales.get(o.recordId);
      if (soldAt !== undefined && now - soldAt < LOCAL_MERGE_TTL_MS) continue; // chain read lags our sale
      result.set(o.recordId, o);
    }
    for (const [id, at] of this.recentSales) if (!onChain.has(id) || now - at >= LOCAL_MERGE_TTL_MS) this.recentSales.delete(id);
    for (const [id, p] of this.recentPurchases) {
      if (onChain.has(id) || now - p.at >= LOCAL_MERGE_TTL_MS) this.recentPurchases.delete(id);
      else if (!this.recentSales.has(id)) result.set(id, p.owned); // chain read lags our purchase
    }
    // Transferred to the collector but not yet paid: still yours as far as the game goes,
    // so you can hold it and press Retry on the sale.
    for (const [id, pending] of Object.entries(this.loadPendingSales())) if (!result.has(id)) result.set(id, pending.owned);

    const list = [...result.values()].sort((a, b) => b.acquiredAt - a.acquiredAt);
    for (const o of list) this.knownOwned.set(o.recordId, o);
    return list;
  }

  private async toOwned(r: ChainRecord, catalog: Map<string, ShopRecord>): Promise<OwnedRecord> {
    const shop = catalog.get(r.releaseId);
    const base = { recordId: r.recordId, shopRecordId: r.releaseId, serial: r.number, acquiredAt: r.purchasedAtMs };
    if (shop) return { ...base, title: shop.title, artist: shop.artist, coverUrl: shop.coverUrl, maxSupply: shop.maxSupply };
    // A Record of a release that isn't in the shop file: look it up (cached).
    const [release, pressing] = await Promise.all([getRelease(r.releaseId).catch(() => null), getPressing(r.pressingId).catch(() => null)]);
    return {
      ...base,
      title: release?.title ?? "Unknown release",
      artist: release ? artistOf(release) : "",
      coverUrl: release ? releaseCoverUrl(release) : "",
      maxSupply: pressing?.maxSupply ?? r.number,
    };
  }

  // ───────────────────────────── sell ─────────────────────────────

  async sellToNpc(recordId: string, _npc: NpcBuyer): Promise<SellResult> {
    // npc.address is the game's display-only collector; the real one comes from the bank server.
    const signer = getBurner();
    const seller = signer.toSuiAddress();
    let pending: PendingSale | undefined = this.loadPendingSales()[recordId];
    try {
      const { owner, record } = await getRecord(recordId);
      if (pending && sameAddress(owner, seller)) {
        // The earlier transfer never landed: start over.
        this.savePendingSale(recordId, null);
        pending = undefined;
      }
      if (!pending) {
        if (!sameAddress(owner, seller)) throw new PlayerError(MESSAGES.notOwned, "notOwned");
        const collector = await getCollector(); // fail before moving anything if the bank is down
        const owned: OwnedRecord = this.knownOwned.get(recordId) ?? {
          recordId,
          shopRecordId: record?.releaseId ?? "",
          title: "Record",
          artist: "",
          coverUrl: "",
          serial: record?.number ?? 0,
          maxSupply: record?.number ?? 0,
          acquiredAt: record?.purchasedAtMs ?? Date.now(),
        };
        try {
          // Persist the digest before submitting so a Retry never transfers twice.
          await signAndRun(transferTransaction(recordId, seller, collector.address), signer, (digest) => {
            pending = { digest, owned };
            this.savePendingSale(recordId, pending);
          });
        } catch (error) {
          const mapped = this.fail(error, "sell");
          // An unanswered submission may still land (Retry re-checks the owner); anything else is final.
          if (mapped.kind !== "timeout" && mapped.kind !== "network") this.savePendingSale(recordId, null);
          throw mapped;
        }
      }
    } catch (error) {
      throw this.fail(error, "sell");
    }
    try {
      const paid = await this.collectPayment(recordId, pending!.digest);
      this.savePendingSale(recordId, null);
      this.recentPurchases.delete(recordId);
      this.recentSales.set(recordId, Date.now());
      this.knownOwned.delete(recordId);
      return { digest: paid.digest, paid: BigInt(paid.paid) };
    } catch (error) {
      const mapped = this.fail(error, "sell");
      throw new PlayerError(
        `The collector has your record but hasn't paid yet: ${mapped.message} Press Retry to ask again; the record won't be sent twice.`,
        mapped.kind,
      );
    }
  }

  /**
   * Debug only (not part of MisoAdapter): build the purchase PTB for `shopRecordId` with
   * any sender address and simulate it, or report the player-safe error the build hit.
   * Nothing is signed or executed.
   */
  async debugSimulatePurchase(shopRecordId: string, sender?: string): Promise<{ built: boolean; success: boolean; createsRecord: boolean; error: string | null; playerMessage: string | null }> {
    const terms = (await this.catalog()).terms.get(shopRecordId);
    if (!terms) return { built: false, success: false, createsRecord: false, error: "not in catalog", playerMessage: MESSAGES.notListed };
    try {
      const r = await simulatePurchase(terms, sender ?? this.address);
      return { built: true, ...r, playerMessage: r.success ? null : toPlayerError(Object.assign(new Error(r.error ?? ""), {}), "purchase").message };
    } catch (error) {
      return { built: false, success: false, createsRecord: false, error: error instanceof Error ? error.message : String(error), playerMessage: toPlayerError(error, "purchase").message };
    }
  }

  /** POST /api/collector/buy, retried with backoff while the server or chain catches up. */
  private async collectPayment(recordId: string, digest: string): Promise<CollectorBuyResponse> {
    const delays = [1500, 3000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await collectorBuy(recordId, digest);
      } catch (error) {
        const retryable = (error as { retryable?: boolean }).retryable === true;
        if (!retryable || attempt >= delays.length) throw error;
        await sleep(delays[attempt]);
      }
    }
  }

  private loadPendingSales(): Record<string, PendingSale> {
    try {
      const raw = localStorage.getItem(PENDING_SALES_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      return parsed && typeof parsed === "object" ? (parsed as Record<string, PendingSale>) : {};
    } catch {
      return this.memoryPending;
    }
  }
  private memoryPending: Record<string, PendingSale> = {};

  private savePendingSale(recordId: string, sale: PendingSale | null): void {
    const all = { ...this.loadPendingSales() };
    if (sale) all[recordId] = sale;
    else delete all[recordId];
    this.memoryPending = all;
    try {
      localStorage.setItem(PENDING_SALES_KEY, JSON.stringify(all));
    } catch {
      // in-memory only
    }
  }
}
