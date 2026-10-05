// Bank server configuration: env vars (with defaults) and live Sui TESTNET constants.
// TESTNET ONLY. Never log key material.
import { resolve } from "node:path";
import { getMisoPlatformDeployment, requireRecordSalesDeployment } from "@misofm/platform/deployments";

const here = import.meta.dir; // apps/game/server
const REPO_KEYS = resolve(here, "../../../keys"); // == ../../keys relative to apps/game

function keyPath(env: string | undefined, file: string): string {
  return env ? resolve(env) : resolve(REPO_KEYS, file);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number (got "${raw}")`);
  return n;
}

function bigEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer in base units (got "${raw}")`);
  return BigInt(raw);
}

export const MIST_PER_SUI = 1_000_000_000n;
export const FUSD_UNIT = 1_000_000n; // FakeUsd has 6 decimals

const recordSales = requireRecordSalesDeployment(getMisoPlatformDeployment("testnet").recordSales);

export const config = {
  port: intEnv("PORT", 8787),
  operatorKeyPath: keyPath(process.env.OPERATOR_KEY, "operator.key"),
  collectorKeyPath: keyPath(process.env.COLLECTOR_KEY, "npc-buyer.key"),
  dataDir: process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(here, "data"),
  fundCooldownMs: intEnv("FUND_COOLDOWN_MS", 10 * 60_000),
  fundMaxPerHour: intEnv("FUND_MAX_PER_HOUR", 30),
  maxPayout: bigEnv("MAX_PAYOUT", 150n * FUSD_UNIT),
} as const;

export const chain = {
  network: "testnet" as const,
  grpcUrl: "https://fullnode.testnet.sui.io",
  recordPackageId: recordSales.recordPackageId,
  recordType: `${recordSales.recordPackageId}::record::Record`,
  fusdType: "0x77774cb7b8cb5622b4ef2658101bf5f1e965418297fe874b683df8f760b6e749::fakeusd::FakeUsd",
  faucetPackageId: "0xa31234471b3644f55fee16b4d5a2a12a161efc5f05e43c2feb34b4b949adcb1c",
  fakeUsdTreasury: "0xa3babc5ccf3018c0a743c3a6ee880adb4424a885ef4ca1e62645da7e460897b6",
} as const;

/** Funding / payout policy. */
export const policy = {
  /** Fund SUI when the player has less than this. */
  minPlayerSui: MIST_PER_SUI / 20n, // 0.05 SUI
  /** Amount of SUI sent per funding. */
  fundSui: MIST_PER_SUI / 5n, // 0.2 SUI
  /** Fund FUSD when the player has less than this. */
  minPlayerFusd: 25n * FUSD_UNIT,
  /** Amount of FUSD minted per funding. */
  fundFusd: 100n * FUSD_UNIT,
  /** Top up the collector's gas when below this. */
  minCollectorSui: MIST_PER_SUI / 20n,
  collectorTopUpSui: MIST_PER_SUI / 5n,
  /** Rough reserve a signer needs to pay for one small PTB. */
  gasReserve: MIST_PER_SUI / 50n, // 0.02 SUI
  offerNumerator: 3n,
  offerDenominator: 2n,
} as const;
