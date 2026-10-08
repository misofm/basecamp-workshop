/**
 * TestnetAdapter: the game on Miso / Sui TESTNET. The game always runs on this adapter
 * (select.ts); right now it is a STUB and every chain call fails with
 * "Shop not connected yet." Implement MisoAdapter here (see also ./adapter.ts and ./types.ts).
 *
 * CONTRACT (what the game expects from each method):
 *
 * Shelves
 * - public/shop.testnet.json is the pinned shelf list: up to 10 entries
 *   `{ releaseId, edition, section }`. `releaseId` is a Miso release on testnet, `edition`
 *   picks which of its editions is on sale, and `section` is one of the ten in-store bins:
 *   HIP HOP, SYNTHWAVE, FOLK, AFROBEATS, JAZZ, AMBIENT, CITY POP, DRUM & BASS, SURF ROCK, HOUSE.
 * - loadShopCatalog(): one ShopRecord per entry, in file order, with real data (title,
 *   artist, cover, tracks, price in FakeUSD, minted / maxSupply, ...). ShopRecord.id must be
 *   the releaseId. `palette` and `synth` are not on chain: copy them from the
 *   MOCK_CATALOG entry with the same section (./mock-catalog.ts).
 *
 * Keys (baked in at build time from apps/game/.env.local, see .env.example)
 * - import.meta.env.VITE_PLAYER_SUI_PRIVATE_KEY: the player. Buys records, uses the ATM,
 *   sells records.
 * - import.meta.env.VITE_GAME_SUI_PRIVATE_KEY: the game world = the collector NPC "Stonks".
 *   Receives sold Records and pays for them.
 * - Both are `suiprivkey1…` strings. Never log them.
 *
 * Methods
 * - getWallet(): the player's address and balances (FakeUSD base units + decimals, SUI in MIST).
 * - purchase(record): the player buys one copy of `record`. Resolves only after the
 *   transaction is final, with the new Record object id and the digest.
 * - withdrawFakeUsd(amount): the street ATM. Credits `amount` FakeUSD (base units) to the
 *   player; resolves after finality.
 * - listOwnedRecords(): the player's Records. OwnedRecord.shopRecordId = the release id
 *   (so it matches ShopRecord.id).
 * - collectorAddress(): the GAME wallet's address.
 * - sellToNpc(recordId, npc): transfers the Record from the player to collectorAddress()
 *   (`npc.address` is display only), then the game wallet pays the player `npc.offer`
 *   FakeUSD (base units). Resolves after finality with the digest and the amount paid.
 * - explorerTxUrl / explorerObjectUrl: already done (./explorer.ts).
 *
 * Errors
 * - Reject with an Error whose `message` is short and safe to show the player (dialogs show
 *   it verbatim). To get a specific reaction, give the error `name = "PlayerError"` and a
 *   `kind`: "fusd" (not enough FakeUSD: the game points at the ATM), "soldOut", "network",
 *   "timeout" or "other". See classifyChainError in ../app/errors.ts.
 *
 * ../app/pending-sales.ts is a ready-made localStorage store for sales whose Record was
 * transferred but not yet paid; it is passed in as `options.pending` if you want it.
 */
import type { MisoAdapter } from "./adapter";
import { explorerObjectUrl, explorerTxUrl } from "./explorer";
import type { NpcBuyer, OwnedRecord, PurchaseResult, SellResult, ShopRecord, Wallet, WithdrawResult } from "./types";
import type { PendingSalesStore } from "../app/pending-sales";

const notConnected = (): Promise<never> => Promise.reject(new Error("Shop not connected yet."));

export class TestnetAdapter implements MisoAdapter {
  readonly network = "testnet" as const;

  constructor(_options: { pending?: PendingSalesStore } = {}) {}

  loadShopCatalog(): Promise<ShopRecord[]> {
    return notConnected();
  }
  getWallet(): Promise<Wallet> {
    return notConnected();
  }
  purchase(_record: ShopRecord): Promise<PurchaseResult> {
    return notConnected();
  }
  withdrawFakeUsd(_amount: bigint): Promise<WithdrawResult> {
    return notConnected();
  }
  listOwnedRecords(): Promise<OwnedRecord[]> {
    return notConnected();
  }
  sellToNpc(_recordId: string, _npc: NpcBuyer): Promise<SellResult> {
    return notConnected();
  }
  collectorAddress(): Promise<string> {
    return notConnected();
  }
  explorerTxUrl(digest: string): string {
    return explorerTxUrl(digest);
  }
  explorerObjectUrl(objectId: string): string {
    return explorerObjectUrl(objectId);
  }
}
