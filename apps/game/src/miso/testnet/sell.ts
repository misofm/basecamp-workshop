/**
 * Selling a Record to the collector (the GAME wallet): the decision logic, with the chain
 * and storage injected so it can be unit-tested without Sui (tests/unit/testnet-sell.spec.ts).
 *
 * A sale is two transactions, because a Sui transaction has one sender and the Record and
 * the FakeUSD belong to different keys:
 *   1. transfer  (player-signed)  the Record → GAME address
 *   2. payout    (GAME-signed)    faucet mint of offerFor(purchase_price) FakeUSD → player
 * The price and currency are read from the Record on chain, never from the caller.
 *
 * A pending-sale entry (localStorage via `deps.pending`) makes Retry safe:
 *   - `{ transferDigest }` is saved BEFORE the transfer is submitted;
 *   - `{ payoutDigest }` is saved BEFORE the payout is submitted (the digest is known once
 *     the tx is built and signed);
 *   - the entry is cleared after a confirmed payout.
 * On a call, by who owns the Record now:
 *   - player, no entry                → transfer, then pay.
 *   - player, entry                   → the earlier transfer may still land: wait briefly; if it
 *                                       did, continue as "GAME owns it", else start over.
 *   - GAME, entry without payoutDigest → pay now.
 *   - GAME, entry with payoutDigest    → look it up: landed → return it (paid once);
 *                                       failed → pay again; unknown after a short wait → pay again.
 *     That last case is the one double-pay window: a payout submitted but not visible to the
 *     node within PAYOUT_LOOKUP_MS can land after we pay again. It only ever over-pays
 *     testnet FakeUSD from the permissionless faucet, so we accept it rather than strand a sale.
 *   - GAME, no entry                  → "The collector already has this record."
 *   - anyone else                     → notOwned.
 *
 * Must not: touch the Sui SDK, keys or localStorage directly (all injected).
 */
import type { OwnedRecord, SellResult } from "../types";
import type { ChainRecord } from "./chain";
import { FUSD_TYPE, MAX_PAYOUT, OFFER_DENOMINATOR, OFFER_NUMERATOR } from "./config";
import { MESSAGES, PlayerError, toPlayerError } from "./errors";

export interface PendingSale {
  /** Player address that started the sale (entries for another key are ignored). */
  player: string;
  /** Player → GAME transfer, saved before it was submitted. */
  transferDigest: string;
  /** GAME → player payout, saved before it was submitted. */
  payoutDigest?: string;
  /** What the collection view keeps showing until the sale is paid. */
  owned: OwnedRecord;
}

export interface PendingStore {
  get(recordId: string): PendingSale | undefined;
  set(recordId: string, sale: PendingSale | null): void;
}

export interface SellDeps {
  player: string;
  game: string;
  /** The Record (null if the object isn't a live record::Record) and its address owner. */
  getRecord(recordId: string): Promise<{ record: ChainRecord | null; owner: string | null }>;
  /** Player-signed transfer of the Record to the GAME. `onDigest` fires before submission. */
  transfer(recordId: string, onDigest: (digest: string) => void): Promise<{ digest: string }>;
  /** GAME-signed FakeUSD mint of `amount` to the player. `onDigest` fires before submission. */
  pay(amount: bigint, onDigest: (digest: string) => void): Promise<{ digest: string }>;
  /** Digest status after waiting up to `waitMs`. */
  txStatus(digest: string, waitMs: number): Promise<"success" | "failed" | "unknown">;
  pending: PendingStore;
  /** Collection entry for a Record about to be transferred. */
  describe(recordId: string, record: ChainRecord): OwnedRecord;
}

/** How long Retry waits for an earlier transfer / payout digest before deciding. */
export const TRANSFER_LOOKUP_MS = 8_000;
export const PAYOUT_LOOKUP_MS = 10_000;

/** The collector's offer: floor(price * 3 / 2), capped at MAX_PAYOUT. */
export function offerFor(purchasePrice: bigint): bigint {
  const offer = (purchasePrice * OFFER_NUMERATOR) / OFFER_DENOMINATOR;
  return offer > MAX_PAYOUT ? MAX_PAYOUT : offer;
}

/** `77774c…::fakeusd::FakeUsd` and `0x0…77774c…::fakeusd::FakeUsd` compare equal. */
export function normalizeType(type: string): string {
  const m = /^(?:0x)?([0-9a-f]+)::(.+)$/i.exec(type.trim());
  return m ? `0x${m[1].toLowerCase().padStart(64, "0")}::${m[2]}` : type.trim();
}

export const sameAddress = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/** Validate the on-chain Record and work out what the collector pays for it. */
function payoutFor(record: ChainRecord | null): bigint {
  if (!record) throw new PlayerError("Stonks only buys records from here.");
  if (!record.purchaseCurrency || normalizeType(record.purchaseCurrency) !== normalizeType(FUSD_TYPE)) {
    throw new PlayerError("Stonks only buys records you paid for.");
  }
  const paid = offerFor(record.purchasePrice);
  if (paid <= 0n) throw new PlayerError("No price on this one. No offer.");
  return paid;
}

const unanswered = (e: PlayerError) => e.kind === "timeout" || e.kind === "network";

export async function sellRecord(recordId: string, deps: SellDeps): Promise<SellResult> {
  let pending = deps.pending.get(recordId);
  if (pending && !sameAddress(pending.player, deps.player)) pending = undefined;

  let owner: string | null;
  let paid: bigint;
  try {
    const read = await deps.getRecord(recordId);
    owner = read.owner;
    paid = payoutFor(read.record);

    if (sameAddress(owner, deps.player) && pending) {
      // An earlier transfer may still be landing; never sign a second one blindly.
      const status = await deps.txStatus(pending.transferDigest, TRANSFER_LOOKUP_MS);
      if (status === "success") owner = deps.game;
      else {
        deps.pending.set(recordId, null);
        pending = undefined;
      }
    }

    if (sameAddress(owner, deps.player)) {
      const owned = deps.describe(recordId, read.record!);
      try {
        await deps.transfer(recordId, (transferDigest) => {
          pending = { player: deps.player, transferDigest, owned };
          deps.pending.set(recordId, pending);
        });
      } catch (error) {
        const mapped = toPlayerError(error, "sell");
        // An unanswered submission may still land (Retry re-checks); anything else is final.
        if (!unanswered(mapped)) deps.pending.set(recordId, null);
        throw mapped;
      }
    } else if (sameAddress(owner, deps.game)) {
      if (!pending) throw new PlayerError(MESSAGES.alreadyCollected, "notOwned");
    } else {
      throw new PlayerError(MESSAGES.notOwned, "notOwned");
    }
  } catch (error) {
    throw toPlayerError(error, "sell");
  }

  // The GAME has the Record and `pending` describes the sale.
  const sale = pending!;
  try {
    if (sale.payoutDigest) {
      const status = await deps.txStatus(sale.payoutDigest, PAYOUT_LOOKUP_MS);
      if (status === "success") {
        deps.pending.set(recordId, null);
        return { digest: sale.payoutDigest, paid };
      }
      // "failed": pay again. "unknown": never landed (or still might: see the header).
    }
    const { digest } = await deps.pay(paid, (payoutDigest) => {
      pending = { ...sale, payoutDigest };
      deps.pending.set(recordId, pending);
    });
    deps.pending.set(recordId, null);
    return { digest, paid };
  } catch (error) {
    const mapped = toPlayerError(error, "payout");
    throw new PlayerError(
      `Stonks hasn't paid yet. ${mapped.message}`,
      mapped.kind,
    );
  }
}
