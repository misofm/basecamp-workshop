// POST /api/collector/buy: verify a player's Record transfer to the collector on chain, then pay
// purchase_price * 3/2 FakeUsd (capped) back to the seller. Idempotent per digest and per recordId.
import { TransactionError } from "@mysten/sui/client";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { chain, config, policy } from "./config";
import { client, getBalance, networkError, normalizeType, signExecuteAndWait } from "./chain";
import { HttpError } from "./errors";
import { buildPayoutTx, buildSuiTransferTx } from "./ptb";
import { PaidStore } from "./store";
import { collector, collectorAddress, collectorQueue, operator, operatorAddress, operatorQueue } from "./wallets";

export interface BuyResponse {
  digest: string;
  paid: string;
  seller: string;
}

export const paidStore = new PaidStore(config.dataDir);
const inFlightByDigest = new Map<string, Promise<BuyResponse>>();
const inFlightByRecord = new Map<string, string>(); // recordId -> digest being processed

export function collectorInfo() {
  return {
    address: collectorAddress,
    offerNumerator: Number(policy.offerNumerator),
    offerDenominator: Number(policy.offerDenominator),
  };
}

/** Pure payout rule: floor(price * 3 / 2), capped at maxPayout. */
export function computePayout(purchasePrice: bigint, maxPayout: bigint = config.maxPayout): bigint {
  const offer = (purchasePrice * policy.offerNumerator) / policy.offerDenominator;
  return offer > maxPayout ? maxPayout : offer;
}

export function buy(recordId: string, digest: string): Promise<BuyResponse> {
  const done = paidStore.getByDigest(digest);
  if (done) {
    if (done.recordId !== recordId) throw new HttpError(409, "That transaction was already paid out for a different record.");
    return Promise.resolve({ digest: done.paymentDigest, paid: done.paid, seller: done.seller });
  }
  const existing = inFlightByDigest.get(digest);
  if (existing) return existing;
  const paidDigest = paidStore.digestForRecord(recordId);
  if (paidDigest) throw new HttpError(409, "The collector already paid for this record.");
  const busy = inFlightByRecord.get(recordId);
  if (busy) throw new HttpError(409, "The collector is already processing this record.");

  inFlightByRecord.set(recordId, digest);
  const p = doBuy(recordId, digest).finally(() => {
    inFlightByDigest.delete(digest);
    inFlightByRecord.delete(recordId);
  });
  inFlightByDigest.set(digest, p);
  return p;
}

async function fetchTransferTx(digest: string) {
  try {
    // Allow ~20 s for the player's transfer to become visible to this fullnode.
    return await client.core.waitForTransaction({
      digest,
      timeout: 20_000,
      include: { effects: true, objectTypes: true, transaction: true },
    });
  } catch (err) {
    if (err instanceof TransactionError && err.reason === "notFound") {
      throw new HttpError(404, "The collector can't find that transaction on Sui testnet (yet). Try again in a moment.");
    }
    const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    if (/timeout|timed out|abort/i.test(msg)) {
      console.log(`[buy] wait timeout digest=${digest}: ${msg.slice(0, 200)}`);
      throw new HttpError(404, "The collector can't find that transaction on Sui testnet (yet). Try again in a moment.");
    }
    throw networkError(err);
  }
}

async function doBuy(recordId: string, digest: string): Promise<BuyResponse> {
  const res = await fetchTransferTx(digest);
  const tx = res.$kind === "Transaction" ? res.Transaction : res.FailedTransaction;
  if (!tx || res.$kind !== "Transaction" || !tx.status.success) {
    throw new HttpError(400, "That transaction failed on chain, so the collector can't pay for it.");
  }
  const seller = tx.transaction.sender ? normalizeSuiAddress(tx.transaction.sender) : "";
  if (!seller || seller === collectorAddress || seller === operatorAddress) {
    throw new HttpError(400, "That transaction wasn't sent by a player.");
  }

  // The record must be an existing object that moved from the seller to the collector in this tx
  // (not freshly minted straight to the collector).
  const change = tx.effects.changedObjects.find((c) => normalizeSuiAddress(c.objectId) === recordId);
  const toCollector =
    change &&
    change.outputState === "ObjectWrite" &&
    change.outputOwner?.$kind === "AddressOwner" &&
    normalizeSuiAddress(change.outputOwner.AddressOwner) === collectorAddress;
  if (!change || !toCollector) {
    throw new HttpError(400, "That transaction doesn't hand this record to the collector.");
  }
  const wasSellers =
    change.idOperation === "None" &&
    change.inputState === "Exists" &&
    change.inputOwner?.$kind === "AddressOwner" &&
    normalizeSuiAddress(change.inputOwner.AddressOwner) === seller;
  if (!wasSellers) {
    throw new HttpError(400, "The collector only buys records the seller already owned.");
  }
  const txType = Object.entries(tx.objectTypes).find(([id]) => normalizeSuiAddress(id) === recordId)?.[1];
  if (!txType || normalizeType(txType) !== normalizeType(chain.recordType)) {
    throw new HttpError(400, "The collector only buys Miso records.");
  }

  // Read the Record itself from chain for its price (never trust the client).
  let obj;
  try {
    ({ object: obj } = await client.core.getObject({ objectId: recordId, include: { json: true } }));
  } catch (err) {
    throw networkError(err);
  }
  if (normalizeType(obj.type) !== normalizeType(chain.recordType)) {
    throw new HttpError(400, "The collector only buys Miso records.");
  }
  const json = obj.json ?? {};
  const currency = typeof json.purchase_currency === "string" ? json.purchase_currency : "";
  if (!currency || normalizeType(currency) !== normalizeType(chain.fusdType)) {
    throw new HttpError(400, "The collector only buys records that were bought with FakeUSD.");
  }
  const priceRaw = json.purchase_price;
  if (typeof priceRaw !== "string" && typeof priceRaw !== "number") {
    throw new HttpError(502, "The collector couldn't read this record's price. Try again.");
  }
  const price = BigInt(priceRaw);
  const paid = computePayout(price);
  if (paid <= 0n) throw new HttpError(400, "This record has no purchase price, so the collector can't make an offer.");

  await ensureCollectorGas();

  const paymentDigest = await collectorQueue.run(async () => {
    const payTx = buildPayoutTx({ sender: collectorAddress, seller, amount: paid });
    try {
      const { digest: d } = await signExecuteAndWait(payTx, collector, `payout record=${recordId} seller=${seller} paid=${paid} for=${digest}`, (d) =>
        // Persist as soon as the payout succeeded so a crash/retry can never pay twice.
        paidStore.put(digest, { paymentDigest: d, paid: paid.toString(), seller, recordId, at: Date.now() }),
      );
      return d;
    } catch (err) {
      throw networkError(err);
    }
  });
  return { digest: paymentDigest, paid: paid.toString(), seller };
}

async function ensureCollectorGas(): Promise<void> {
  let sui: bigint;
  try {
    sui = await getBalance(collectorAddress);
  } catch (err) {
    throw networkError(err);
  }
  if (sui >= policy.minCollectorSui) return;
  await operatorQueue.run(async () => {
    let bank: bigint;
    try {
      bank = await getBalance(operatorAddress);
    } catch (err) {
      throw networkError(err);
    }
    if (bank < policy.collectorTopUpSui + policy.gasReserve) {
      console.log(`[buy] collector out of gas (${sui} mist) and operator too (${bank} mist)`);
      throw new HttpError(503, "The collector is out of gas and the gas bank is empty. Ask the host to refill the operator wallet.");
    }
    const tx = buildSuiTransferTx({ sender: operatorAddress, recipient: collectorAddress, mist: policy.collectorTopUpSui });
    try {
      await signExecuteAndWait(tx, operator, `collector gas top-up ${policy.collectorTopUpSui}`);
    } catch (err) {
      throw networkError(err);
    }
  });
}
