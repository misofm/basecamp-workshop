// Turns anything a transaction can throw (building, simulating, the wallet, the chain) into a
// short message a visitor can act on. No SDK imports: errors are recognised by shape and text,
// so this works the same for SDK errors, wallet errors and plain strings.
//
// Abort codes come from the Move sources of the deployed packages:
//   record_shop::listing  0 EUnauthorized  1 EInvalidPrice  2 EDisabled  3 EWrongPressing
//                         4 EPriceChanged  5 EWrongPayment
//   record::pressing      3 EDistributorNotAuthorized  4 EMaxSupplyReached (sold out)

export type TxFailureKind =
  | "rejected"
  | "fakeUsd"
  | "gas"
  | "soldOut"
  | "disabled"
  | "priceChanged"
  | "notListed"
  | "network"
  | "other";

export type TxFailure = { kind: TxFailureKind; message: string };

const FAILURES: Record<TxFailureKind, string> = {
  rejected: "You cancelled in your wallet.",
  fakeUsd: "Not enough FakeUSD.",
  gas: "Not enough SUI to pay for gas.",
  soldOut: "Sold out. Every copy is gone.",
  disabled: "This listing is paused.",
  priceChanged: "The price changed. Reload the page and try again.",
  notListed: "This edition isn't for sale here.",
  network: "Network problem. Try again.",
  other: "Something went wrong. Try again.",
};

const failure = (kind: TxFailureKind): TxFailure => ({ kind, message: FAILURES[kind] });

const LISTING_ABORTS: Record<number, TxFailureKind> = {
  0: "notListed", // EUnauthorized: the pressing no longer authorizes this shop
  1: "notListed", // EInvalidPrice
  2: "disabled", // EDisabled
  3: "notListed", // EWrongPressing
  4: "priceChanged", // EPriceChanged: our expected pricing no longer matches
  5: "priceChanged", // EWrongPayment: we paid for a price that is no longer current
};
const PRESSING_ABORTS: Record<number, TxFailureKind> = {
  3: "notListed", // EDistributorNotAuthorized
  4: "soldOut", // EMaxSupplyReached
};

/** A Move abort (module + code, from a simulation or failed effects) as a visitor-facing failure. */
export function classifyAbort(abort: { module: string; code: number }): TxFailure {
  const table = abort.module === "listing" ? LISTING_ABORTS : abort.module === "pressing" ? PRESSING_ABORTS : {};
  return failure(table[abort.code] ?? "other");
}

function textOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string") return message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// A Move abort inside an error: the SDK's SimulationError carries executionError.MoveAbort;
// otherwise parse the message text.
function findAbort(error: unknown, text: string): { module: string; code: number } | null {
  const exec = (error as { executionError?: { MoveAbort?: { abortCode?: unknown; location?: { module?: string } } } } | null)
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

/** Anything thrown while building, simulating, signing or executing, as a visitor-facing failure. */
export function classifyTxError(error: unknown): TxFailure {
  const text = textOf(error);

  // Wallet Standard has no shared rejection code; wallets say it in words
  // ("User rejected the request", "Rejected by user", "User denied", "cancelled").
  // (The chain's own "cancelled due to shared object congestion" is not a rejection.)
  if (/reject|denied|declin|cancel/i.test(text) && !/congest/i.test(text)) return failure("rejected");

  const abort = findAbort(error, text);
  if (abort) return classifyAbort(abort);

  // Thrown while the SDK resolves tx.balance():
  // "Insufficient balance of <type> for owner 0x…. Required: N, Available: M"
  const insufficient = /Insufficient balance of (\S+) for owner/i.exec(text);
  if (insufficient) return failure(/::sui::SUI\b/i.test(insufficient[1]) ? "gas" : "fakeUsd");
  if (/InsufficientCoinBalance|insufficient.*fakeusd/i.test(text)) return failure("fakeUsd");
  if (/No valid gas coins|InsufficientGas|GasBalanceTooLow|gas.*(balance|budget)|balance.*gas/i.test(text)) {
    return failure("gas");
  }
  if (/Failed to fetch|NetworkError|Load failed|RpcError|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNREFUSED|fetch failed|timed out|TimeoutError/i.test(text)) {
    return failure("network");
  }
  return failure("other");
}
