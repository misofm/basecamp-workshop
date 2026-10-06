import type { DAppKit } from "@mysten/dapp-kit-react";
import type { Transaction } from "@mysten/sui/transactions";
import { FAUCET_AMOUNT } from "../config";
import { getListing, getPressing } from "../lib/miso";
import { derivePressingId } from "../lib/sui";
import {
  buildMintFakeUsdTransaction,
  buildPurchaseTransaction,
  explorerTxUrl,
  FALLBACK_GAS_MIST,
  getBalances,
  readPurchasedRecord,
  simulateTransaction,
  type Balances,
} from "../lib/transactions";
import { classifyAbort, classifyTxError } from "../lib/txErrors";
import {
  bumpRecordsVersion,
  getWalletState,
  setWalletState,
  type BuyOutcome,
  type BuyRequest,
  type MintOutcome,
  type MintRequest,
  type TxOutcome,
  type TxStep,
  type WalletApi,
} from "./store";

// The write path. Every transaction goes: fresh checks -> simulate (gas + Move aborts, before the
// wallet ever opens) -> the wallet signs and executes a fresh Transaction -> read the result.
// The app never sees a key: signing happens inside the wallet.

type Kit = DAppKit<"testnet"[]>;
type Failed = Exclude<TxOutcome<object>, { status: "success" }>;

function connectedAddress(kit: Kit): string | null {
  const connection = kit.stores.$connection.get();
  return connection.isConnected ? connection.account.address : null;
}

async function loadBalances(kit: Kit, owner: string): Promise<Balances> {
  const balances = await getBalances(kit.getClient(), owner);
  // Only store them if the same account is still connected.
  if (connectedAddress(kit) === owner) setWalletState({ balances });
  return balances;
}

/** Simulate, then check the gas. Returns null when it is fine to ask the wallet to sign. */
async function preflight(kit: Kit, build: () => Transaction, sender: string, balances: Balances): Promise<Failed | null> {
  let gasNeeded: bigint;
  try {
    const report = await simulateTransaction(kit.getClient(), build, sender);
    if (!report.success) {
      return { status: "failed", failure: report.abort ? classifyAbort(report.abort) : classifyTxError(report.error) };
    }
    gasNeeded = report.gasEstimateMist;
  } catch (error) {
    const failure = classifyTxError(error);
    if (failure.kind !== "network") return { status: "failed", failure };
    // Simulation impossible (e.g. a flaky fullnode): fall back to a safe gas floor; the wallet re-checks anyway.
    gasNeeded = FALLBACK_GAS_MIST;
  }
  if (balances.suiMist < gasNeeded) return { status: "needGas", haveMist: balances.suiMist, needMist: gasNeeded };
  return null;
}

/** Hands a fresh Transaction to the wallet. Returns the digest, or a failure (incl. "rejected"). */
async function signAndExecute(kit: Kit, build: () => Transaction): Promise<{ digest: string } | Failed> {
  try {
    const result = await kit.signAndExecuteTransaction({ transaction: build() });
    if (result.$kind === "FailedTransaction") {
      const error = result.FailedTransaction.status.error;
      const abort = error?.$kind === "MoveAbort" ? error.MoveAbort : null;
      return {
        status: "failed",
        failure: abort
          ? classifyAbort({ module: abort.location?.module ?? "", code: Number(abort.abortCode) })
          : classifyTxError(error?.message ?? "Transaction failed"),
      };
    }
    return { digest: result.Transaction.digest };
  } catch (error) {
    return { status: "failed", failure: classifyTxError(error) };
  }
}

async function buyRecord(kit: Kit, { releaseId, edition, onStep }: BuyRequest): Promise<BuyOutcome> {
  const step = (s: TxStep) => onStep?.(s);
  const buyer = connectedAddress(kit);
  if (!buyer) return { status: "failed", failure: { kind: "other", message: "Connect a wallet first." } };

  try {
    step("checking");
    // Fresh reads: someone may have bought the last copy, or the listing may have been paused.
    const pressingId = derivePressingId(releaseId, edition);
    const [pressing, listing, balances] = await Promise.all([
      getPressing(pressingId, true),
      getListing(pressingId, true),
      loadBalances(kit, buyer),
    ]);
    if (!pressing || !listing) return { status: "unavailable", reason: "notListed" };
    if (pressing.supply >= pressing.maxSupply) return { status: "unavailable", reason: "soldOut" };
    if (listing.state !== "enabled") return { status: "unavailable", reason: "paused" };

    const pricing = { kind: listing.pricing.kind, amount: BigInt(listing.pricing.amount) };
    if (balances.fakeUsd < pricing.amount) {
      return { status: "needFakeUsd", have: balances.fakeUsd, need: pricing.amount };
    }

    const build = () => buildPurchaseTransaction({ releaseId, edition, pricing, buyer });
    const problem = await preflight(kit, build, buyer, balances);
    if (problem) {
      if (problem.status === "failed" && problem.failure.kind === "fakeUsd") {
        return { status: "needFakeUsd", have: balances.fakeUsd, need: pricing.amount };
      }
      return problem;
    }

    step("confirm");
    const signed = await signAndExecute(kit, build);
    if (!("digest" in signed)) return signed;

    step("finishing");
    const record = await readPurchasedRecord(kit.getClient(), signed.digest).catch(() => null);
    bumpRecordsVersion();
    void loadBalances(kit, buyer).catch(() => {});
    return {
      status: "success",
      digest: signed.digest,
      explorerUrl: explorerTxUrl(signed.digest),
      edition,
      recordId: record?.recordId ?? null,
      recordNumber: record?.number ?? null,
    };
  } catch (error) {
    // Fresh reads or balances failed (network): nothing was signed.
    return { status: "failed", failure: classifyTxError(error) };
  }
}

async function mintFakeUsd(kit: Kit, { onStep }: MintRequest = {}): Promise<MintOutcome> {
  const step = (s: TxStep) => onStep?.(s);
  const recipient = connectedAddress(kit);
  if (!recipient) return { status: "failed", failure: { kind: "other", message: "Connect a wallet first." } };

  try {
    step("checking");
    const balances = await loadBalances(kit, recipient);
    const build = () => buildMintFakeUsdTransaction({ amount: FAUCET_AMOUNT, recipient });
    const problem = await preflight(kit, build, recipient, balances);
    if (problem) return problem;

    step("confirm");
    const signed = await signAndExecute(kit, build);
    if (!("digest" in signed)) return signed;

    step("finishing");
    // Wait until the fullnode has the transaction, so the new balance includes the mint.
    await kit.getClient().core.waitForTransaction({ digest: signed.digest }).catch(() => {});
    const after = await loadBalances(kit, recipient).catch(() => null);
    return {
      status: "success",
      digest: signed.digest,
      explorerUrl: explorerTxUrl(signed.digest),
      amount: FAUCET_AMOUNT,
      fakeUsd: after?.fakeUsd ?? null,
    };
  } catch (error) {
    return { status: "failed", failure: classifyTxError(error) };
  }
}

export function createWalletApi(kit: Kit, openConnect: () => void): WalletApi {
  return {
    openConnect,
    disconnect: () => kit.disconnectWallet(),
    async refreshBalances() {
      const address = getWalletState().address;
      if (address) await loadBalances(kit, address).catch(() => {});
    },
    buyRecord: (request) => buyRecord(kit, request),
    mintFakeUsd: (request) => mintFakeUsd(kit, request),
  };
}
