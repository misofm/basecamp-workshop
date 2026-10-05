/**
 * Sui TESTNET chain access via the gRPC(-web) fullnode client.
 *
 * Owns: the SuiGrpcClient, balance reads, owned-Record reads, the PTB builders for the
 * game's four transactions and signing / executing them:
 *   purchase  (player)  @misofm/platform purchaseRecord: tx.balance(FakeUsd) → listing::purchase
 *   ATM       (player)  faucet::mint<FakeUsd> → coin::from_balance → transfer to the player
 *   transfer  (player)  the sold Record → the GAME (collector) address
 *   payout    (GAME)    faucet::mint<FakeUsd> → coin::from_balance → transfer to the player
 * Every signer runs one transaction at a time (a per-address mutex), so the ATM, a purchase
 * and a sale can't race each other for the same gas coin.
 * Must not: return SDK types to callers outside src/miso/testnet (plain data only), or
 * read keys (callers pass the signer).
 */
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { purchaseRecord } from "@misofm/platform/pressing";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  FAKEUSD_TREASURY,
  FAUCET_PACKAGE_ID,
  FUSD_TYPE,
  GRPC_URL,
  READ_TIMEOUT_MS,
  RECORD_PACKAGE_ID,
  RECORD_SHOP_PACKAGE_ID,
  RECORD_TYPE,
  SUI_TYPE,
  TX_TIMEOUT_MS,
} from "./config";
import type { SaleTerms } from "./catalog";
import { withTimeout } from "./net";

let client: SuiGrpcClient | null = null;
export function sui(): SuiGrpcClient {
  client ??= new SuiGrpcClient({ network: "testnet", baseUrl: GRPC_URL });
  return client;
}

const readSignal = () => ({ signal: AbortSignal.timeout(READ_TIMEOUT_MS) });

/** SUI (MIST) and FakeUSD (base units); `balance` counts coins + address balance. */
export async function getBalances(owner: string): Promise<{ sui: bigint; fakeUsd: bigint }> {
  const [s, f] = await Promise.all([
    sui().core.getBalance({ owner, coinType: SUI_TYPE, ...readSignal() }),
    sui().core.getBalance({ owner, coinType: FUSD_TYPE, ...readSignal() }),
  ]);
  return { sui: BigInt(s.balance.balance), fakeUsd: BigInt(f.balance.balance) };
}

/** Plain view of an on-chain record::Record. */
export interface ChainRecord {
  recordId: string;
  releaseId: string;
  pressingId: string;
  edition: number;
  number: number;
  purchasePrice: bigint;
  /** Move type name of the coin it was bought with (format as the node returns it). */
  purchaseCurrency: string;
  purchasedAtMs: number;
}

function toChainRecord(objectId: string, json: Record<string, unknown> | null | undefined): ChainRecord | null {
  if (!json) return null;
  return {
    recordId: objectId,
    releaseId: String(json.release_id ?? ""),
    pressingId: String(json.pressing_id ?? ""),
    edition: Number(json.edition ?? 0),
    number: Number(json.number ?? 0),
    purchasePrice: BigInt(String(json.purchase_price ?? "0")),
    purchaseCurrency: currencyName(json.purchase_currency),
    purchasedAtMs: Number(json.purchased_timestamp_ms ?? 0),
  };
}

/** `purchase_currency` is a TypeName: a plain string or `{ name }` depending on the encoder. */
function currencyName(value: unknown): string {
  if (typeof value === "string") return value;
  const name = (value as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

/** Every Record owned by `owner` (paginated). */
export async function listRecords(owner: string): Promise<ChainRecord[]> {
  const out: ChainRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const res: { objects: { objectId: string; json?: unknown }[]; hasNextPage: boolean; cursor: string | null } = await sui().core.listOwnedObjects({ owner, type: RECORD_TYPE, include: { json: true }, limit: 50, cursor, ...readSignal() });
    for (const o of res.objects) {
      const r = toChainRecord(o.objectId, o.json as Record<string, unknown> | null | undefined);
      if (r) out.push(r);
    }
    if (!res.hasNextPage || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

/** One Record + its current owner address (null if not address-owned / not found). */
export async function getRecord(recordId: string): Promise<{ record: ChainRecord | null; owner: string | null }> {
  const { object } = await sui().core.getObject({ objectId: recordId, include: { json: true }, ...readSignal() });
  const owner = object.owner.$kind === "AddressOwner" ? object.owner.AddressOwner : null;
  const record = object.type === RECORD_TYPE ? toChainRecord(object.objectId, object.json as Record<string, unknown> | null | undefined) : null;
  return { record, owner };
}

export interface Executed {
  digest: string;
  /** Object ids created by the tx, with their types. */
  created: { objectId: string; type: string | undefined }[];
}

/** Build + sign without executing (so the digest is known before submission). */
async function prepare(tx: Transaction, signer: Ed25519Keypair): Promise<{ bytes: Uint8Array; signature: string; digest: string }> {
  tx.setSenderIfNotSet(signer.toSuiAddress());
  const bytes = await withTimeout(tx.build({ client: sui() }), TX_TIMEOUT_MS, "building the transaction");
  const { signature } = await signer.signTransaction(bytes);
  const digest = await tx.getDigest();
  return { bytes, signature, digest };
}

/** Submit signed bytes, wait for finality, throw on effects failure. */
async function submit(prepared: { bytes: Uint8Array; signature: string }): Promise<Executed> {
  const result = await sui().core.executeTransaction({
    transaction: prepared.bytes,
    signatures: [prepared.signature],
    include: { effects: true, objectTypes: true },
    signal: AbortSignal.timeout(TX_TIMEOUT_MS),
  });
  return finish(result);
}

function finish(result: { Transaction?: unknown; FailedTransaction?: unknown }): Executed {
  const tx = (result.Transaction ?? result.FailedTransaction) as {
    digest: string;
    status: { success: boolean; error: unknown };
    effects?: { changedObjects: { objectId: string; idOperation: string }[] };
    objectTypes?: Record<string, string>;
  };
  if (!tx.status.success) {
    // Shape matches SimulationError.executionError so errors.ts can read the abort.
    throw Object.assign(new Error(`Transaction failed: ${(tx.status.error as { message?: string })?.message ?? "unknown"}`), {
      executionError: tx.status.error,
    });
  }
  const created = (tx.effects?.changedObjects ?? [])
    .filter((c) => c.idOperation === "Created")
    .map((c) => ({ objectId: c.objectId, type: tx.objectTypes?.[c.objectId] }));
  return { digest: tx.digest, created };
}

/** Wait until a digest is final on the fullnode we read from. */
export async function waitFor(digest: string, timeoutMs = TX_TIMEOUT_MS): Promise<Executed> {
  const result = await sui().core.waitForTransaction({ digest, timeout: timeoutMs, include: { effects: true, objectTypes: true } });
  return finish(result);
}

/**
 * Where a digest stands after waiting up to `waitMs`: "success", "failed" (final, effects
 * failure) or "unknown" (the node hasn't seen it: never submitted, or not indexed yet).
 */
export async function txStatus(digest: string, waitMs: number): Promise<"success" | "failed" | "unknown"> {
  try {
    await waitFor(digest, waitMs);
    return "success";
  } catch (error) {
    if ((error as { executionError?: unknown })?.executionError !== undefined) return "failed";
    return "unknown";
  }
}

/** The purchase PTB: tx.balance(FakeUsd) → listing::purchase → transfer Record to the buyer. */
export function purchaseTransaction(terms: SaleTerms, buyer: string): Transaction {
  const tx = new Transaction();
  tx.setSender(buyer);
  tx.add(
    purchaseRecord({
      releaseId: terms.releaseId,
      edition: terms.edition,
      paymentAmount: terms.pricing.amount, // floor: pay exactly the floor; fixed: the price
      expectedPricing: { kind: terms.pricing.kind, amount: terms.pricing.amount },
      currencyType: FUSD_TYPE,
      recipient: buyer,
      recordPackageId: RECORD_PACKAGE_ID,
      recordShopPackageId: RECORD_SHOP_PACKAGE_ID,
    }),
  );
  return tx;
}

export function transferTransaction(recordId: string, from: string, to: string): Transaction {
  const tx = new Transaction();
  tx.setSender(from);
  tx.transferObjects([tx.object(recordId)], to);
  return tx;
}

/**
 * `faucet::mint<FakeUsd>(amount, &mut treasury) -> Balance` → `0x2::coin::from_balance` →
 * transfer the coin to `recipient`. The faucet is permissionless: the sender only pays gas.
 * Used by the ATM (player → player) and the collector's payout (GAME → player).
 */
export function mintFakeUsdTransaction(amount: bigint, sender: string, recipient: string): Transaction {
  if (amount <= 0n) throw new Error("mintFakeUsdTransaction: amount must be > 0");
  const tx = new Transaction();
  tx.setSender(sender);
  const balance = tx.moveCall({
    target: `${FAUCET_PACKAGE_ID}::faucet::mint`,
    typeArguments: [FUSD_TYPE],
    arguments: [tx.pure.u64(amount), tx.object(FAKEUSD_TREASURY)],
  });
  const coin = tx.moveCall({ target: "0x2::coin::from_balance", typeArguments: [FUSD_TYPE], arguments: [balance] });
  tx.transferObjects([coin], tx.pure.address(recipient));
  return tx;
}

/** One transaction at a time per signer address (build → submit → finality). */
const locks = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  locks.set(key, run.catch(() => undefined));
  return run;
}

/**
 * Sign + execute, serialized per signer. `onDigest` fires before submission (the digest is
 * known once the tx is built), so callers can remember it for retries.
 */
export function signAndRun(tx: Transaction, signer: Ed25519Keypair, onDigest?: (digest: string) => void): Promise<Executed> {
  return serialized(signer.toSuiAddress(), async () => {
    const prepared = await prepare(tx, signer);
    onDigest?.(prepared.digest);
    const executed = await submit(prepared);
    // executeTransaction returns once effects are certified; also wait until the node
    // indexes it so the follow-up reads (balance, owned objects) see the new state.
    await waitFor(executed.digest).catch(() => {});
    return executed;
  });
}

export const isRecordType = (type: string | undefined) => type === RECORD_TYPE;

/**
 * Debug only: build the purchase PTB for any `sender` and simulate it (nothing is
 * signed or executed). Proves the PTB resolves against the live listing.
 */
export async function simulatePurchase(terms: SaleTerms, sender: string): Promise<{ success: boolean; createsRecord: boolean; error: string | null }> {
  const tx = purchaseTransaction(terms, sender);
  const bytes = await withTimeout(tx.build({ client: sui() }), TX_TIMEOUT_MS, "building the transaction");
  const sim = await sui().core.simulateTransaction({ transaction: bytes, include: { effects: true, objectTypes: true } });
  const t = (sim.Transaction ?? sim.FailedTransaction)!;
  return {
    success: t.status.success,
    createsRecord: Object.values(t.objectTypes ?? {}).some(isRecordType),
    error: t.status.success ? null : (t.status.error?.message ?? "unknown"),
  };
}
