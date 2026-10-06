import { useSyncExternalStore } from "react";
import { FAKEUSD_DECIMALS } from "../config";
import type { TxFailure } from "../lib/txErrors";

// The wallet as the rest of the app sees it: a tiny external store (like src/lib/requestLog.ts).
// This file is in the main bundle and imports nothing from dApp Kit or the Sui transaction builder.
// The kit itself lives in a lazily loaded chunk (WalletRuntime.tsx + actions.ts), which mirrors the
// connection into this store and sets `api` once it has loaded. Reading the catalog never needs it.

export type WalletStatus = "loading" | "disconnected" | "connecting" | "connected";

export type WalletBalances = { suiMist: bigint; fakeUsd: bigint };

/** Progress of a transaction: checking (fresh reads + simulation), confirm (waiting for the wallet), finishing. */
export type TxStep = "checking" | "confirm" | "finishing";

/** Why a transaction could not even be sent to the wallet, or what it returned. */
export type TxOutcome<Success> =
  | ({ status: "success"; digest: string; explorerUrl: string } & Success)
  | { status: "failed"; failure: TxFailure } // failure.kind "rejected" = cancelled in the wallet
  | { status: "needFakeUsd"; have: bigint; need: bigint } // FakeUSD base units
  | { status: "needGas"; haveMist: bigint; needMist: bigint } // SUI for gas, in MIST
  | { status: "unavailable"; reason: "soldOut" | "paused" | "notListed" }; // fresh read before buying

export type BuyRequest = {
  releaseId: string;
  edition: number;
  onStep?: (step: TxStep) => void;
};
export type BuyOutcome = TxOutcome<{ edition: number; recordId: string | null; recordNumber: number | null }>;

export type MintRequest = { onStep?: (step: TxStep) => void };
export type MintOutcome = TxOutcome<{ amount: bigint; fakeUsd: bigint | null /* balance afterwards */ }>;

export type WalletApi = {
  /** Opens the wallet picker (dApp Kit connect modal). */
  openConnect(): void;
  disconnect(): Promise<void>;
  refreshBalances(): Promise<void>;
  /** Buys the next copy of the given edition from the connected wallet. Never throws. */
  buyRecord(request: BuyRequest): Promise<BuyOutcome>;
  /** Mints FAUCET_AMOUNT FakeUSD to the connected wallet. Never throws. */
  mintFakeUsd(request?: MintRequest): Promise<MintOutcome>;
};

export type WalletState = {
  status: WalletStatus;
  address: string | null;
  walletName: string | null;
  balances: WalletBalances | null;
  recordsVersion: number; // bumps after a purchase, so record lists refetch
  api: WalletApi | null; // null until the wallet runtime chunk has loaded
};

let state: WalletState = {
  status: "loading",
  address: null,
  walletName: null,
  balances: null,
  recordsVersion: 0,
  api: null,
};
const listeners = new Set<() => void>();

export function getWalletState() {
  return state;
}

export function setWalletState(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function bumpRecordsVersion() {
  setWalletState({ recordsVersion: state.recordsVersion + 1 });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWallet() {
  return useSyncExternalStore(subscribe, getWalletState);
}

// Small formatters for the main bundle (the same rounding as src/lib/transactions.ts, which is lazy).
function formatUnits(base: bigint, decimals: number, shown: number): string {
  const units = base / 10n ** BigInt(decimals - shown);
  const scale = 10n ** BigInt(shown);
  return `${units / scale}.${(units % scale).toString().padStart(shown, "0")}`;
}

/** FakeUSD base units to "12.00", rounded down. */
export const formatFakeUsd = (base: bigint) => formatUnits(base, FAKEUSD_DECIMALS, 2);
/** MIST to "0.0123" SUI, rounded down. */
export const formatSui = (mist: bigint) => formatUnits(mist, 9, 4);

/** 0x1234…abcd */
export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
