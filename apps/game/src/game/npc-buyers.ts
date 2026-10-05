/**
 * Street NPCs who buy Records from the player. PURE data + arithmetic.
 *
 * Owns: who the collector is (name, id, a deterministic FAKE Sui address) and
 * what they pay (1.5x the shop price: "I pay above shop price").
 * Must not: talk to the chain, render, or hold state. The controller builds an
 * NpcBuyer with `buyerFor()` and hands it to `adapter.sellToNpc()`.
 */
import type { NpcBuyer } from "../miso/types";

export interface BuyerProfile {
  /** Matches the world interactable id ("buyer:collector"). */
  id: string;
  name: string;
  /** Sui address the Record is transferred to. Fake and fixed: nobody holds its key. */
  address: string;
  /** Offer = price * offerNumerator / offerDenominator (exact bigint math). */
  offerNumerator: bigint;
  offerDenominator: bigint;
}

export const COLLECTOR: BuyerProfile = {
  id: "buyer:collector",
  name: "The Collector",
  address: "0xc011ec7024000000000000000000000000000000000000000000000000000a11",
  offerNumerator: 3n,
  offerDenominator: 2n,
};

/** What `profile` pays for a record that cost `shopPrice` (base units). */
export function offerFor(profile: BuyerProfile, shopPrice: bigint): bigint {
  return (shopPrice * profile.offerNumerator) / profile.offerDenominator;
}

/** The NpcBuyer passed to MisoAdapter.sellToNpc for one specific record. */
export function buyerFor(profile: BuyerProfile, shopPrice: bigint): NpcBuyer {
  return { id: profile.id, name: profile.name, address: profile.address, offer: offerFor(profile, shopPrice) };
}
