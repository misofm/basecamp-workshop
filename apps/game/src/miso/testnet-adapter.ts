/**
 * TestnetAdapter: the game on Sui TESTNET (`?chain=testnet`).
 *
 * This file is deliberately thin and dependency-free: every method lazily imports
 * ./testnet/backend (Sui SDK, @misofm/platform, effect), so mock mode never downloads
 * that chunk. Sui SDK types never leave src/miso/; callers get ./types data, and every
 * rejection is a PlayerError with a player-safe message (./testnet/errors.ts).
 *
 * How each piece works (details in ./testnet/*):
 * - Catalog: public/shop.testnet.json lists { releaseId, edition, section } (validated,
 *   ≤10 stands). Each entry is hydrated in parallel from the keyless Miso API (release,
 *   pressing, FakeUSD listing; cached in memory); ids via deriveSaleIds. Entries without
 *   an enabled FakeUSD listing are skipped with a console warning. Palette / synth are
 *   local fallbacks by section (not on chain); label is "Miso".
 * - Cover / audio: https://cdn.miso.fm/v1/blobs/{blobId}?w=512&f=webp, tracks carry the
 *   Walrus transcode quilt id; duration = samples / sample_rate_hz. Media the CDN does not
 *   host is retried once from the Walrus aggregator (../miso/media.ts).
 * - Wallet: a TESTNET-ONLY burner Ed25519 key in localStorage (./testnet/burner.ts).
 *   Balances via gRPC getBalance (coins + address balance). On the session's first
 *   read, if SUI < 0.05 or FakeUSD < 25 the bank server is asked to top up
 *   (POST /api/fund); a failing bank never breaks the wallet read.
 * - Gas: the player self-pays from SUI the bank server sent. A gas or FakeUSD shortfall
 *   triggers another top-up request in the background.
 * - Purchase: purchaseRecord() from @misofm/platform/pressing (tx.balance FakeUsd →
 *   record_shop::listing::purchase with the listing's exact pricing → transfer to the
 *   burner), signed by the burner, executed over gRPC, waited to finality; the new
 *   Record id comes from the effects' created objects of type record::Record.
 * - Owned records: gRPC listOwnedObjects(type = record::Record, json) for the burner,
 *   merged with recent local purchases / minus recent sales until the index agrees.
 * - Sell: the player transfers the Record to the bank server's collector address
 *   (GET /api/collector; npc.address is display only), then POST /api/collector/buy
 *   { recordId, digest } makes the collector pay 1.5× the purchase price in FakeUSD.
 *   The transfer digest is kept in localStorage until paid, so Retry only re-asks.
 * - Errors / timeouts: Move aborts (sold out, listing disabled, price changed, wrong
 *   payment), FakeUSD / gas shortfalls, not-owned, timeouts (10 s reads, 30 s txs) and a
 *   missing bank server map to short messages; raw errors go to console.warn only.
 * - Explorer links: Suiscan testnet (./explorer).
 */
import type { MisoAdapter } from "./adapter";
import { suiscanObjectUrl, suiscanTxUrl } from "./explorer";
import type { NpcBuyer, OwnedRecord, PurchaseResult, SellResult, ShopRecord, Wallet } from "./types";
import type { TestnetBackend } from "./testnet/backend";

export class TestnetAdapter implements MisoAdapter {
  readonly network = "testnet" as const;
  private backend: Promise<TestnetBackend> | null = null;

  private load(): Promise<TestnetBackend> {
    if (!this.backend) {
      this.backend = import("./testnet/backend").then((m) => new m.TestnetBackend());
      this.backend.catch((error: unknown) => {
        console.warn("[miso testnet] failed to load the testnet module:", error);
        this.backend = null;
      });
    }
    return this.backend.catch(() => {
      throw new Error("Couldn't load the Sui testnet code. Check your connection and reload.");
    });
  }

  async loadShopCatalog(): Promise<ShopRecord[]> {
    return (await this.load()).loadShopCatalog();
  }
  async getWallet(): Promise<Wallet> {
    return (await this.load()).getWallet();
  }
  async purchase(record: ShopRecord): Promise<PurchaseResult> {
    return (await this.load()).purchase(record);
  }
  async listOwnedRecords(): Promise<OwnedRecord[]> {
    return (await this.load()).listOwnedRecords();
  }
  async sellToNpc(recordId: string, npc: NpcBuyer): Promise<SellResult> {
    return (await this.load()).sellToNpc(recordId, npc);
  }
  async collectorAddress(): Promise<string> {
    const { getCollector } = await import("./testnet/bank");
    return (await getCollector()).address;
  }
  /** Debug / tests only: build + simulate a purchase PTB without signing (see TestnetBackend). */
  async debugSimulatePurchase(shopRecordId: string, sender?: string) {
    return (await this.load()).debugSimulatePurchase(shopRecordId, sender);
  }
  explorerTxUrl(digest: string): string {
    return suiscanTxUrl(digest);
  }
  explorerObjectUrl(objectId: string): string {
    return suiscanObjectUrl(objectId);
  }
}
