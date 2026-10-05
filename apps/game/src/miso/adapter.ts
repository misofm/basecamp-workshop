/**
 * THE single boundary between the game and Miso / Sui.
 *
 * Every catalog read, wallet read and transaction goes through a MisoAdapter.
 * The game never imports @mysten/* or fetches chain data anywhere else.
 *
 * Select an implementation with `?chain=mock|testnet` (default: VITE_MISO_CHAIN
 * env var, else "mock"). See mock-adapter.ts and testnet-adapter.ts.
 *
 * Contract for implementations:
 * - All methods are async and may take seconds; callers show pending UI and never
 *   block the render loop.
 * - Failures reject with an Error whose `message` is safe to show to the player.
 * - `purchase()` resolves only after the transaction is final (effects success),
 *   with the newly created Record object id.
 * - `sellToNpc()` transfers the Record to `npc.address` and the NPC pays
 *   `npc.offer` FakeUSD to the player; resolves with the digest and amount paid.
 */
import type {
  NpcBuyer,
  OwnedRecord,
  PurchaseResult,
  SellResult,
  ShopRecord,
  Wallet,
  Network,
} from "./types";

export interface MisoAdapter {
  readonly network: Network;
  loadShopCatalog(): Promise<ShopRecord[]>;
  getWallet(): Promise<Wallet>;
  purchase(record: ShopRecord): Promise<PurchaseResult>;
  listOwnedRecords(): Promise<OwnedRecord[]>;
  sellToNpc(recordId: string, npc: NpcBuyer): Promise<SellResult>;
  /** Address Records are sold to (shown in the sell dialog so the audience can check it). */
  collectorAddress(): Promise<string>;
  /** Explorer links for receipts. */
  explorerTxUrl(digest: string): string;
  explorerObjectUrl(objectId: string): string;
}

export type * from "./types";
