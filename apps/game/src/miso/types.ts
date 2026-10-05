/**
 * Miso domain types shared by the game and every MisoAdapter implementation.
 *
 * These are plain data: no Three.js, no DOM, no Sui SDK types. The world and UI
 * only ever see these shapes, so swapping MockAdapter for TestnetAdapter never
 * touches rendering code.
 *
 * Money is always carried as bigint base units plus the coin's decimals; use
 * `formatAmount()` from ./format.ts to display it.
 */

/** One streamable track on a release. `quiltId` null means "no real audio" (mock synth fallback). */
export interface TrackRef {
  index: number;
  title: string;
  /** Walrus quilt id; HLS at https://cdn.miso.fm/v1/blobs/by-quilt-id/${quiltId}/aac-96.m3u8 */
  quiltId: string | null;
  durationSec: number;
}

/** A price in a fungible coin (FakeUSD on testnet). */
export interface Money {
  /** Base units (e.g. 12_500_000n with 6 decimals = 12.50). */
  amount: bigint;
  decimals: number;
  /** Short display symbol, e.g. "FUSD". */
  symbol: string;
}

/** A release that is for sale in the in-game shop (one record per release). */
export interface ShopRecord {
  /** Stable id used by game state and the world (release object id on chain, slug in mock). */
  id: string;
  releaseId: string;
  title: string;
  artist: string;
  genre: string;
  /** Short shelf label for the in-world genre section, e.g. "HIP HOP". */
  section: string;
  year: number;
  label: string;
  description: string;
  /** Absolute or app-relative image URL (mock: /covers/<slug>.png, testnet: cdn.miso.fm blob url). */
  coverUrl: string;
  /** Cover palette (hex) used for vinyl label tint, sleeve filler art and UI accents. */
  palette: string[];
  tracks: TrackRef[];
  pressingId: string;
  listingId: string;
  price: Money;
  /** Edition name, e.g. "First pressing". */
  edition: string;
  minted: number;
  maxSupply: number;
  /** Synth fallback parameters for when no track has a quiltId (mock audio). */
  synth: { bpm: number; notes: number[] };
}

/** A Record object owned by the player's wallet. */
export interface OwnedRecord {
  /** On-chain Record object id (0x...). */
  recordId: string;
  /** Which ShopRecord / release it was pressed from (ShopRecord.id). */
  shopRecordId: string;
  title: string;
  artist: string;
  coverUrl: string;
  /** Edition serial, e.g. 42 of maxSupply. */
  serial: number;
  maxSupply: number;
  acquiredAt: number;
}

export interface Wallet {
  address: string;
  /** FakeUSD balance in base units. */
  fakeUsd: bigint;
  fakeUsdDecimals: number;
  /** SUI balance in MIST. */
  sui: bigint;
}

/** A street NPC who will buy a Record from the player. */
export interface NpcBuyer {
  id: string;
  name: string;
  /** Sui address the Record is transferred to. */
  address: string;
  /** What the NPC pays for the record being offered (FakeUSD base units). */
  offer: bigint;
}

export interface PurchaseResult {
  recordId: string;
  digest: string;
}

/** FakeUSD withdrawn from the testnet faucet (the street ATM). */
export interface WithdrawResult {
  digest: string;
  /** FakeUSD base units credited to the player. */
  amount: bigint;
}

export interface SellResult {
  digest: string;
  paid: bigint;
}

export type Network = "mock" | "testnet";
