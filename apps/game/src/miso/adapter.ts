/**
 * THE single boundary between the game and Miso / Sui.
 *
 * Every catalog read, wallet read and transaction goes through a MisoAdapter.
 * The game never imports @mysten/* or fetches chain data anywhere else.
 *
 * The game runs on testnet-adapter.ts; mock-adapter.ts is for automated tests only
 * (e2e test builds, unit tests). select.ts makes the choice.
 *
 * Contract for implementations:
 * - All methods are async and may take seconds; callers show pending UI and never
 *   block the render loop.
 * - Failures reject with an Error whose `message` is safe to show to the player.
 * - `purchase()` resolves only after the transaction is final (effects success),
 *   with the newly created Record object id.
 * - `withdrawFakeUsd()` credits `amount` FakeUSD (base units) to the player (the street
 *   ATM; on testnet a player-signed faucet mint), resolving after finality.
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
  WithdrawResult,
  Network,
} from "./types";

export interface MisoAdapter {
  readonly network: Network;
  loadShopCatalog(): Promise<ShopRecord[]>;
  getWallet(): Promise<Wallet>;
  purchase(record: ShopRecord): Promise<PurchaseResult>;
  /** The street ATM: get `amount` FakeUSD (base units) from the testnet faucet. */
  withdrawFakeUsd(amount: bigint): Promise<WithdrawResult>;
  listOwnedRecords(): Promise<OwnedRecord[]>;
  sellToNpc(recordId: string, npc: NpcBuyer): Promise<SellResult>;
  /** Address Records are sold to (shown in the sell dialog so the audience can check it). */
  collectorAddress(): Promise<string>;
  /** Explorer links for receipts. */
  explorerTxUrl(digest: string): string;
  explorerObjectUrl(objectId: string): string;
}

export type * from "./types";
