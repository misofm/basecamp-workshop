/**
 * Error mapping: turns SDK / RPC / Move-abort failures into short messages that
 * are safe to show the player. Raw errors go to console.warn for developers only.
 *
 * Owns: PlayerError, the Move abort code tables and `toPlayerError`.
 * Must not: import the Sui SDK (errors are recognised by shape and message).
 *
 * Abort codes come from the Move sources of the deployed packages (verified against a
 * live simulate: a wrong expected price aborts listing::purchase with code 4):
 *   record_shop::listing  0 EUnauthorized  1 EInvalidPrice  2 EDisabled  3 EWrongPressing
 *                         4 EPriceChanged  5 EWrongPayment
 *   record::pressing      4 EMaxSupplyReached (sold out), 3 EDistributorNotAuthorized
 */
import { formatAmount } from "../format";
import { FUSD_DECIMALS, FUSD_SYMBOL } from "./config";
import { TimeoutError } from "./net";

/** An error whose message is already player-safe. */
export class PlayerError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind = "other",
  ) {
    super(message);
    this.name = "PlayerError";
  }
}

export type ErrorKind =
  | "fusd"
  | "gas"
  | "soldOut"
  | "disabled"
  | "priceChanged"
  | "notOwned"
  | "timeout"
  | "network"
  | "keys"
  | "other";

/** What was being attempted: picks the fallback text and whose gas ran out. */
export type Phase = "read" | "purchase" | "withdraw" | "sell" | "payout";

const ATM_HINT = "The ATM outside dispenses testnet dollars.";

export const MESSAGES = {
  gas: "The player wallet is out of testnet SUI for gas. Fund VITE_PLAYER_SUI_PRIVATE_KEY's address at faucet.sui.io.",
  gameGas: "The collector (game wallet) is out of testnet SUI for gas. Fund VITE_GAME_SUI_PRIVATE_KEY's address at faucet.sui.io.",
  soldOut: "Sold out — every copy of this pressing has been sold.",
  disabled: "This record isn't on sale right now (the shop paused the listing).",
  priceChanged: "The price just changed. Reload the page to see the new price.",
  wrongPayment: "The payment didn't match the price. Reload the page and try again.",
  notListed: "This record isn't for sale here any more.",
  notOwned: "You don't own that record any more.",
  timeout: "Sui testnet didn't answer in time. Check your connection and try again.",
  network: "Couldn't reach Sui testnet. Check your connection and try again.",
  withdraw: "The ATM couldn't reach the faucet. Try again.",
  alreadyCollected: "The collector already has this record.",
} as const;

const LISTING_ABORTS: Record<number, [string, ErrorKind]> = {
  0: [MESSAGES.notListed, "other"],
  1: [MESSAGES.notListed, "other"],
  2: [MESSAGES.disabled, "disabled"],
  3: [MESSAGES.notListed, "other"],
  4: [MESSAGES.priceChanged, "priceChanged"],
  5: [MESSAGES.wrongPayment, "other"],
};
const PRESSING_ABORTS: Record<number, [string, ErrorKind]> = {
  3: [MESSAGES.notListed, "other"],
  4: [MESSAGES.soldOut, "soldOut"],
};

interface AbortInfo {
  module: string;
  code: number;
}

/** Find a Move abort in an SDK error (SimulationError.executionError), an effects status, or a message. */
function findAbort(error: unknown, text: string): AbortInfo | null {
  const exec = (error as { executionError?: { MoveAbort?: { abortCode?: string; location?: { module?: string } } } })
    ?.executionError?.MoveAbort;
  if (exec?.abortCode !== undefined) return { module: exec.location?.module ?? "", code: Number(exec.abortCode) };
  // "MoveAbort in 3rd command, abort code: 4, in '0x…::listing::purchase' (instruction 52)"
  let m = /abort code:\s*(\d+),\s*in '0x[0-9a-f]+::(\w+)::/i.exec(text);
  if (m) return { module: m[2], code: Number(m[1]) };
  // Older shape: MoveAbort(MoveLocation { module: ModuleId { …, name: Identifier("listing") } … }, 4)
  m = /Identifier\("(\w+)"\)[\s\S]*?\},\s*(\d+)\)/.exec(text);
  if (m) return { module: m[1], code: Number(m[2]) };
  return null;
}

const fusd = (n: bigint) => formatAmount(n, FUSD_DECIMALS, FUSD_SYMBOL);

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Map anything thrown by the testnet stack to a PlayerError. Never surfaces raw aborts. */
export function toPlayerError(error: unknown, phase: Phase): PlayerError {
  if (error instanceof PlayerError) return error;
  const text = messageOf(error);
  console.warn(`[miso testnet] ${phase} failed:`, error);

  const abort = findAbort(error, text);
  if (abort) {
    const table = abort.module === "listing" ? LISTING_ABORTS : abort.module === "pressing" ? PRESSING_ABORTS : {};
    const hit = table[abort.code];
    if (hit && phase === "purchase") return new PlayerError(hit[0], hit[1]);
    if (phase === "sell") return new PlayerError("The transfer was rejected by Sui. You still own the record.");
    if (phase === "withdraw" || phase === "payout") return new PlayerError(MESSAGES.withdraw);
    return new PlayerError("The shop's contract rejected this purchase. Nothing was charged.");
  }

  const gas = () => new PlayerError(phase === "payout" ? MESSAGES.gameGas : MESSAGES.gas, "gas");

  // tx.balance() resolution: "Insufficient balance of <type> for owner 0x…. Required: N, Available: M"
  const insufficient = /Insufficient balance of (\S+) for owner \S+ Required: (\d+), Available: (\d+)/i.exec(text);
  if (insufficient) {
    if (/::sui::SUI$/i.test(insufficient[1])) return gas();
    return new PlayerError(
      `Not enough FakeUSD — you have ${fusd(BigInt(insufficient[3]))}, this costs ${fusd(BigInt(insufficient[2]))}. ${ATM_HINT}`,
      "fusd",
    );
  }
  if (/InsufficientCoinBalance|insufficient.*fakeusd/i.test(text)) return new PlayerError(`Not enough FakeUSD for this record. ${ATM_HINT}`, "fusd");
  if (/No valid gas coins|InsufficientGas|GasBalanceTooLow|gas.*(balance|budget)|balance.*gas/i.test(text)) return gas();
  if (/not owned by|is not owned|is owned by account address|not signed by the correct sender|ObjectNotFound|InputObjectDeleted|object .*(deleted|not found|does not exist)|IncorrectUserSignature|ObjectVersionUnavailable/i.test(text)) {
    if (phase === "sell") return new PlayerError(MESSAGES.notOwned, "notOwned");
    return new PlayerError("Sui testnet couldn't find part of this sale. Reload the page and try again.");
  }
  if (error instanceof TimeoutError || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) || /DEADLINE_EXCEEDED|timed out/i.test(text)) {
    return new PlayerError(MESSAGES.timeout, "timeout");
  }
  if (/Failed to fetch|NetworkError|Load failed|RpcError|UNAVAILABLE|ECONNREFUSED|fetch failed/i.test(text)) {
    return new PlayerError(MESSAGES.network, "network");
  }
  if (phase === "read") return new PlayerError("Couldn't read from Sui testnet. Try again.");
  if (phase === "withdraw") return new PlayerError(MESSAGES.withdraw);
  return new PlayerError("Something went wrong on Sui testnet. Try again.");
}
