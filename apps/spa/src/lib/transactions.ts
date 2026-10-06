import type { ClientWithCoreApi } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { deriveObjectID, normalizeStructTag } from "@mysten/sui/utils";
import {
  EXPLORER,
  FAKEUSD_DECIMALS,
  FAKEUSD_FAUCET_PACKAGE,
  FAKEUSD_TREASURY,
  FAKEUSD_TYPE,
  RECORD_PACKAGE,
  RECORD_SHOP_PACKAGE,
} from "../config";
import { derivePressingId } from "./sui";

// The write path: the two transactions this app asks a wallet to sign (buy a record,
// mint FakeUSD), plus the reads around them (balances, gas simulation, the bought record).
// Pure functions over a Sui client: no React, no wallet, no DOM. The UI hands the
// Transaction objects to the wallet; scripts/simulate.ts dry-runs them from node.

export type Pricing = { kind: "fixed" | "floor"; amount: bigint };

// Move type of the object a purchase creates (record::Record in the Record package)
export const RECORD_TYPE = `${RECORD_PACKAGE}::record::Record`;

const SUI_TYPE = "0x2::sui::SUI";

// Gas to ask for when a simulation is impossible (e.g. the wallet lacks the FakeUSD the buy spends)
export const FALLBACK_GAS_MIST = 50_000_000n; // 0.05 SUI

// Each Pressing has one Listing per currency, at an id derived from the pressing id and the
// currency type. Like derivePressingId, this lets us find it without an indexer.
// The key is ListingKey<T> with no fields, which BCS-encodes as a single zero byte.
export function deriveListingId(pressingId: string): string {
  return deriveObjectID(
    pressingId,
    `${RECORD_SHOP_PACKAGE}::listing::ListingKey<${normalizeStructTag(FAKEUSD_TYPE)}>`,
    new Uint8Array([0]),
  );
}

/**
 * Buy one Record: pay with FakeUSD, get the next numbered copy of the pressing.
 * listing::purchase checks the pricing we pass against the listing's current pricing and
 * aborts if they differ, so a price change between page load and signing can't overcharge.
 */
export function buildPurchaseTransaction(p: {
  releaseId: string;
  edition: number;
  pricing: Pricing;
  buyer: string;
}): Transaction {
  const pressingId = derivePressingId(p.releaseId, p.edition);
  const tx = new Transaction();
  tx.setSender(p.buyer);

  // A Balance<FakeUsd> of exactly the price. This is an "intent": the SDK picks the buyer's
  // coins (or address balance) when the transaction is built. Fixed price: the price.
  // Floor price: pay the floor (paying more is allowed, but we never do).
  const payment = tx.balance({ balance: p.pricing.amount, type: FAKEUSD_TYPE, useGasCoin: false });
  const expectedPricing = tx.moveCall({
    target: `${RECORD_SHOP_PACKAGE}::listing::${p.pricing.kind}`,
    arguments: [tx.pure.u64(p.pricing.amount)],
  });
  const record = tx.moveCall({
    target: `${RECORD_SHOP_PACKAGE}::listing::purchase`,
    typeArguments: [FAKEUSD_TYPE],
    arguments: [
      tx.object(deriveListingId(pressingId)),
      tx.object(pressingId),
      payment,
      expectedPricing,
      tx.object.clock(), // the record stores its purchase time
    ],
  });
  tx.transferObjects([record], p.buyer);
  return tx;
}

/**
 * Mint test FakeUSD from the permissionless faucet: faucet::mint returns a Balance,
 * coin::from_balance wraps it in a Coin, and the coin goes to the recipient.
 * The sender only pays gas (in SUI).
 */
export function buildMintFakeUsdTransaction(p: { amount: bigint; recipient: string }): Transaction {
  const tx = new Transaction();
  tx.setSender(p.recipient);
  const balance = tx.moveCall({
    target: `${FAKEUSD_FAUCET_PACKAGE}::faucet::mint`,
    typeArguments: [FAKEUSD_TYPE],
    arguments: [tx.pure.u64(p.amount), tx.object(FAKEUSD_TREASURY)],
  });
  const coin = tx.moveCall({
    target: "0x2::coin::from_balance",
    typeArguments: [FAKEUSD_TYPE],
    arguments: [balance],
  });
  tx.transferObjects([coin], p.recipient);
  return tx;
}

export type Balances = { suiMist: bigint; fakeUsd: bigint };

// Both balances count coins plus the address balance, which is what tx.balance() can spend.
export async function getBalances(client: ClientWithCoreApi, owner: string): Promise<Balances> {
  const [sui, fakeUsd] = await Promise.all([
    client.core.getBalance({ owner, coinType: SUI_TYPE }),
    client.core.getBalance({ owner, coinType: FAKEUSD_TYPE }),
  ]);
  return { suiMist: BigInt(sui.balance.balance), fakeUsd: BigInt(fakeUsd.balance.balance) };
}

export type SimulationReport = {
  success: boolean;
  error: string | null; // raw error text (for console/dev)
  abort: { module: string; code: number } | null; // parsed Move abort, if any
  gasEstimateMist: bigint;
  created: { objectId: string; type?: string }[];
};

// The same "simulate with a huge budget" request the SDK makes when it picks a gas budget.
const SIMULATION_BUDGET = 50_000_000_000n;
// Gas units the SDK adds on top of computation when it sets a budget.
const GAS_SAFE_OVERHEAD_UNITS = 1000n;

/**
 * Simulates with a server-mocked gas coin (works for a wallet with 0 SUI). `build` must return
 * a fresh Transaction (simulate mutates gas fields). Throws only for errors before simulation
 * (e.g. tx.balance resolution "Insufficient balance ...").
 */
export async function simulateTransaction(
  client: ClientWithCoreApi,
  build: () => Transaction,
  sender: string,
): Promise<SimulationReport> {
  const tx = build();
  tx.setSender(sender);
  // No gas coins + no gas selection = the fullnode mocks a gas coin. That way we learn the
  // gas cost even for a brand-new wallet, and can tell the visitor how much SUI they need.
  tx.setGasPayment([]);
  tx.setGasBudget(SIMULATION_BUDGET);
  // `doGasSelection` is honoured by the transport but missing from the public option type
  // (the SDK's own resolver passes it the same way). Without it, an empty payment means
  // "select gas for me", which fails for a wallet with no SUI.
  const result = await client.core.simulateTransaction(
    Object.assign(
      { transaction: tx, include: { effects: true as const, objectTypes: true as const } },
      { doGasSelection: false },
    ),
  );
  const t = result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction;
  const effects = t.effects;
  const price = BigInt(tx.getData().gasData.price ?? 1000);
  const created = effects.changedObjects
    .filter((c) => c.idOperation === "Created")
    .map((c) => ({ objectId: c.objectId, type: t.objectTypes[c.objectId] }));

  const error = t.status.success ? null : t.status.error;
  const moveAbort = error?.$kind === "MoveAbort" ? error.MoveAbort : null;
  return {
    success: t.status.success,
    error: error ? error.message : null,
    abort: moveAbort
      ? { module: moveAbort.location?.module ?? "", code: Number(moveAbort.abortCode) }
      : null,
    gasEstimateMist: gasEstimate(effects.gasUsed, price),
    created,
  };
}

// Gross gas (computation + storage, ignoring the storage rebate the wallet gets back),
// plus the SDK's overhead, plus a 20% margin. Rounds in the visitor's favour: never too low.
function gasEstimate(gasUsed: { computationCost: string; storageCost: string }, gasPrice: bigint): bigint {
  const gross =
    BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost) + GAS_SAFE_OVERHEAD_UNITS * gasPrice;
  return (gross * 6n) / 5n;
}

/**
 * After a real execution: wait for the digest, find the created Record (objectTypes) and read
 * its `number` field. Returns null if not found.
 */
export async function readPurchasedRecord(
  client: ClientWithCoreApi,
  digest: string,
): Promise<{ recordId: string; number: number } | null> {
  // The wallet returns once the transaction is final; waiting here also makes sure the
  // fullnode we read from has indexed it.
  const result = await client.core.waitForTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  });
  const t = result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction;
  if (!t.status.success) return null;
  // Compare normalized: some transports shorten the 0x2-style addresses inside type strings.
  const recordType = normalizeStructTag(RECORD_TYPE);
  const created = t.effects.changedObjects.find((c) => {
    const type = t.objectTypes[c.objectId];
    return c.idOperation === "Created" && type !== undefined && normalizeStructTag(type) === recordType;
  });
  if (!created) return null;
  // The copy number ("#2 of 50") is a field of the Record itself.
  const { object } = await client.core.getObject({ objectId: created.objectId, include: { json: true } });
  const number = Number((object.json as { number?: unknown } | null | undefined)?.number);
  return Number.isFinite(number) ? { recordId: created.objectId, number } : null;
}

// Fixed-point formatting with bigint, rounded down: a balance should never look bigger than it is.
function formatUnits(base: bigint, decimals: number, shown: number): string {
  const units = base / 10n ** BigInt(decimals - shown);
  const scale = 10n ** BigInt(shown);
  return `${units / scale}.${(units % scale).toString().padStart(shown, "0")}`;
}

/** FakeUSD base units to "12.00" (2 decimals, rounded down). */
export function formatFakeUsd(base: bigint): string {
  return formatUnits(base, FAKEUSD_DECIMALS, 2);
}

/** MIST to "0.0123" (4 decimals, rounded down). 1 SUI = 10^9 MIST. */
export function formatSui(mist: bigint): string {
  return formatUnits(mist, 9, 4);
}

export function explorerTxUrl(digest: string): string {
  return `${EXPLORER}/?search=${digest}&network=testnet`;
}
