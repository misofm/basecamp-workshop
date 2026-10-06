/**
 * TestnetAdapter: the game on Sui TESTNET (the only adapter the game ships with).
 *
 * This file is deliberately thin and dependency-free: every method lazily imports
 * ./testnet/backend (Sui SDK, @misofm/platform, effect), so the e2e mock test build never
 * downloads that chunk. Sui SDK types never leave src/miso/; callers get ./types data, and every
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
 * - Keys: TWO testnet keys baked in at build time from apps/game/.env.local
 *   (./testnet/keys.ts): VITE_PLAYER_SUI_PRIVATE_KEY (the single player wallet) and
 *   VITE_GAME_SUI_PRIVATE_KEY (the game world = the collector NPC). They are read only in
 *   the lazy testnet chunk; VITE_* values end up in the shipped JS, so a hosted keyed build
 *   must sit behind access control. Missing / invalid keys: the catalog still loads, every
 *   wallet call rejects with the player-safe "The shop's till is offline right now" (the
 *   developer hint "Testnet keys missing: …" goes to the console). No server, no /api.
 * - Wallet: the player address; balances via gRPC getBalance (coins + address balance).
 *   The player pays its own gas (fund its address at faucet.sui.io).
 * - ATM (withdrawFakeUsd): a player-signed mint from the permissionless FakeUSD faucet
 *   (faucet::mint → coin::from_balance → transfer to the player), ≤ 100 FUSD per call.
 * - Purchase: purchaseRecord() from @misofm/platform/pressing (tx.balance FakeUsd →
 *   record_shop::listing::purchase with the listing's exact pricing → transfer to the
 *   player), signed by the player, executed over gRPC, waited to finality; the new
 *   Record id comes from the effects' created objects of type record::Record. Short on
 *   FakeUSD? The error points at the ATM; nothing is minted silently.
 * - Owned records: gRPC listOwnedObjects(type = record::Record, json) for the player,
 *   merged with recent local purchases / minus recent sales until the index agrees.
 * - Sell (./testnet/sell.ts): the player transfers the Record to the GAME address
 *   (collectorAddress(); npc.address is display only), then the GAME pays
 *   min(floor(purchase_price × 3/2), 150 FUSD) from the faucet, price and currency read
 *   from the Record on chain. Both digests are kept in localStorage before submission,
 *   so Retry never transfers twice and only pays again if the earlier payout never landed.
 * - Transactions are serialized per signer (no gas-coin races between ATM, buy and sell).
 * - Errors / timeouts: Move aborts (sold out, listing disabled, price changed, wrong
 *   payment), FakeUSD / gas shortfalls, not-owned, missing keys and timeouts (10 s reads,
 *   30 s txs) map to short messages; raw errors go to console.warn only.
 * - Explorer links: devxplorer (./explorer).
 */
import type { MisoAdapter } from "./adapter";
import { explorerObjectUrl, explorerTxUrl } from "./explorer";
import type { NpcBuyer, OwnedRecord, PurchaseResult, SellResult, ShopRecord, Wallet, WithdrawResult } from "./types";
import type { TestnetBackend } from "./testnet/backend";
import type { PendingSalesStore } from "../app/pending-sales";

export class TestnetAdapter implements MisoAdapter {
  readonly network = "testnet" as const;
  private backend: Promise<TestnetBackend> | null = null;

  /** `pending`: the pending-sale store (default: localStorage, see ../app/pending-sales.ts). */
  constructor(private readonly options: { pending?: PendingSalesStore } = {}) {}

  private load(): Promise<TestnetBackend> {
    if (!this.backend) {
      this.backend = import("./testnet/backend").then((m) => new m.TestnetBackend({ pending: this.options.pending }));
      this.backend.catch((error: unknown) => {
        console.warn("[miso testnet] failed to load the testnet module:", error);
        this.backend = null;
      });
    }
    return this.backend.catch(() => {
      throw new Error("Shop won't open. Check your connection.");
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
  async withdrawFakeUsd(amount: bigint): Promise<WithdrawResult> {
    return (await this.load()).withdrawFakeUsd(amount);
  }
  async listOwnedRecords(): Promise<OwnedRecord[]> {
    return (await this.load()).listOwnedRecords();
  }
  async sellToNpc(recordId: string, npc: NpcBuyer): Promise<SellResult> {
    return (await this.load()).sellToNpc(recordId, npc);
  }
  async collectorAddress(): Promise<string> {
    return (await this.load()).collectorAddress();
  }
  /** Debug / tests only: build + simulate a purchase PTB without signing (sender defaults to the player). */
  async debugSimulatePurchase(shopRecordId: string, sender?: string) {
    return (await this.load()).debugSimulatePurchase(shopRecordId, sender);
  }
  explorerTxUrl(digest: string): string {
    return explorerTxUrl(digest);
  }
  explorerObjectUrl(objectId: string): string {
    return explorerObjectUrl(objectId);
  }
}
