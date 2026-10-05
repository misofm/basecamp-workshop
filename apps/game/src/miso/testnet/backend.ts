/**
 * TestnetBackend: the heavy half of TestnetAdapter (loaded lazily with the Sui SDK).
 *
 * Runs fully client-side on two keys baked in at build time (./keys.ts): the PLAYER
 * wallet signs purchases, ATM withdrawals and the Record transfer of a sale; the GAME
 * wallet (the collector NPC) signs the sale's FakeUSD payout. No server.
 *
 * Owns: session state that makes the chain feel instant and retries safe:
 *  - the hydrated catalog + raw listing terms (purchase passes them as expectedPricing),
 *  - locally-known recent purchases / sales, merged into chain reads until the
 *    fullnode's owned-object index agrees (LOCAL_MERGE_TTL_MS),
 *  - the in-flight purchase digest per release (Retry after a timeout first checks
 *    whether the earlier attempt landed instead of buying twice),
 *  - pending sales (see ./sell.ts for the retry rules): the injected PendingSalesStore
 *    (../../app/pending-sales.ts; localStorage with an in-memory fallback by default).
 * Must not: return Sui SDK types; everything leaving here is ../types data or PlayerError.
 * Catalog reads work without keys; everything wallet-related rejects with the
 * "Testnet keys missing" PlayerError.
 */
import type { NpcBuyer, OwnedRecord, PurchaseResult, SellResult, ShopRecord, Wallet, WithdrawResult } from "../types";
import { formatAmount } from "../format";
import { artistOf, loadCatalog, releaseCoverUrl, type SaleTerms } from "./catalog";
import {
  getBalances,
  getRecord,
  isRecordType,
  listRecords,
  mintFakeUsdTransaction,
  purchaseTransaction,
  signAndRun,
  simulatePurchase,
  transferTransaction,
  txStatus,
  waitFor,
  type ChainRecord,
} from "./chain";
import { FUSD_DECIMALS, FUSD_SYMBOL, LOCAL_MERGE_TTL_MS, MAX_WITHDRAW } from "./config";
import { MESSAGES, PlayerError, toPlayerError } from "./errors";
import { getKeys } from "./keys";
import { getPressing, getRelease } from "./miso-api";
import { sellRecord } from "./sell";
import { makePendingSalesStore, type PendingSalesStore } from "../../app/pending-sales";

export class TestnetBackend {
  private catalogPromise: Promise<{ records: ShopRecord[]; terms: Map<string, SaleTerms> }> | null = null;
  private recentPurchases = new Map<string, { owned: OwnedRecord; at: number }>();
  private recentSales = new Map<string, number>();
  private pendingPurchases = new Map<string, string>();
  /** Records sold this session: never handed back as "the earlier purchase that landed". */
  private soldThisSession = new Set<string>();
  private knownOwned = new Map<string, OwnedRecord>();
  private readonly pending: PendingSalesStore;

  constructor(options: { pending?: PendingSalesStore } = {}) {
    this.pending = options.pending ?? makePendingSalesStore();
  }

  /** Player address (throws the "keys missing" PlayerError). */
  private get address(): string {
    return getKeys().player.toSuiAddress();
  }

  /** The collector NPC = the GAME wallet. */
  async collectorAddress(): Promise<string> {
    return getKeys().game.toSuiAddress();
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
    try {
      const balances = await getBalances(address);
      return { address, fakeUsd: balances.fakeUsd, fakeUsdDecimals: FUSD_DECIMALS, sui: balances.sui };
    } catch (error) {
      throw toPlayerError(error, "read");
    }
  }

  // ───────────────────────────── ATM ─────────────────────────────

  /** Player-signed faucet mint of `amount` FakeUSD to the player (≤ MAX_WITHDRAW). */
  async withdrawFakeUsd(amount: bigint): Promise<WithdrawResult> {
    if (typeof amount !== "bigint" || amount <= 0n || amount > MAX_WITHDRAW) {
      throw new PlayerError("That's too much for the ATM.");
    }
    const signer = getKeys().player;
    const address = signer.toSuiAddress();
    try {
      const executed = await signAndRun(mintFakeUsdTransaction(amount, address, address), signer);
      return { digest: executed.digest, amount };
    } catch (error) {
      throw toPlayerError(error, "withdraw");
    }
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
    const signer = getKeys().player;
    const buyer = signer.toSuiAddress();
    try {
      // Retry after a timeout: did the earlier attempt land after all?
      const earlier = this.pendingPurchases.get(record.id);
      if (earlier) {
        this.pendingPurchases.delete(record.id);
        const landed = await waitFor(earlier, 8_000).catch(() => null);
        const id = landed?.created.find((c) => isRecordType(c.type))?.objectId;
        // Only a genuine retry gets the earlier Record back; if it has been sold meanwhile this
        // is a new purchase (handing back a sold Record would be a phantom, free copy).
        if (landed && id && !this.soldThisSession.has(id)) return await this.afterPurchase(record, id, landed.digest);
      }
      const executed = await signAndRun(purchaseTransaction(terms, buyer), signer, (digest) => this.pendingPurchases.set(record.id, digest));
      this.pendingPurchases.delete(record.id);
      const recordId = executed.created.find((c) => isRecordType(c.type))?.objectId;
      if (!recordId) {
        throw new PlayerError("Paid. Record's not in your bag yet. Press C.");
      }
      return await this.afterPurchase(record, recordId, executed.digest);
    } catch (error) {
      const mapped = toPlayerError(error, "purchase");
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
    for (const [id, pending] of Object.entries(this.pending.all())) {
      if (!result.has(id) && pending.player.toLowerCase() === address.toLowerCase()) result.set(id, pending.owned);
    }

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

  /**
   * Two transactions: the player transfers the Record to the GAME, then the GAME pays
   * offerFor(purchase_price) FakeUSD by faucet mint. Decision logic and retry rules: ./sell.ts.
   * `npc.address` / `npc.offer` are display only; the real ones come from keys and chain.
   */
  async sellToNpc(recordId: string, _npc: NpcBuyer): Promise<SellResult> {
    const { player, game } = getKeys();
    const playerAddress = player.toSuiAddress();
    const result = await sellRecord(recordId, {
      player: playerAddress,
      game: game.toSuiAddress(),
      getRecord,
      transfer: (id, onDigest) => signAndRun(transferTransaction(id, playerAddress, game.toSuiAddress()), player, onDigest),
      pay: (amount, onDigest) => signAndRun(mintFakeUsdTransaction(amount, game.toSuiAddress(), playerAddress), game, onDigest),
      txStatus,
      pending: this.pending,
      describe: (id, record) => this.knownOwned.get(id) ?? this.describeChainRecord(record),
    });
    this.recentPurchases.delete(recordId);
    this.recentSales.set(recordId, Date.now());
    this.soldThisSession.add(recordId);
    this.knownOwned.delete(recordId);
    return result;
  }

  /** Collection entry for a Record we haven't seen through listOwnedRecords yet. */
  private describeChainRecord(record: ChainRecord): OwnedRecord {
    return {
      recordId: record.recordId,
      shopRecordId: record.releaseId,
      title: "Record",
      artist: "",
      coverUrl: "",
      serial: record.number,
      maxSupply: record.number,
      acquiredAt: record.purchasedAtMs || Date.now(),
    };
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
}
