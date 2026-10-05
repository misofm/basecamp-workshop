/**
 * Live Sui TESTNET constants for the TestnetAdapter (lazy chunk: only loaded with ?chain=testnet).
 *
 * Owns: endpoints, coin/record types, package ids (Miso records from the published
 * @misofm/platform deployment map; the permissionless FakeUSD faucet), timeouts, the ATM
 * and collector money rules, and localStorage slot names.
 * Must not: do I/O or read keys (that is ./keys.ts).
 */
import { MISO_CDN } from "../media";
import { getMisoPlatformDeployment, requireRecordSalesDeployment } from "@misofm/platform/deployments";

const recordSales = requireRecordSalesDeployment(getMisoPlatformDeployment("testnet").recordSales);

export const GRPC_URL = "https://fullnode.testnet.sui.io";
export const MISO_API = "https://api.testnet.miso.fm/v1";
export const CDN = `${MISO_CDN}/blobs`; // falls back to the Walrus aggregator, see ../media.ts

export const RECORD_PACKAGE_ID: string = recordSales.recordPackageId;
export const RECORD_SHOP_PACKAGE_ID: string = recordSales.recordShopPackageId;
export const RECORD_TYPE = `${RECORD_PACKAGE_ID}::record::Record`;

export const SUI_TYPE = "0x2::sui::SUI";
export const FUSD_TYPE = "0x77774cb7b8cb5622b4ef2658101bf5f1e965418297fe874b683df8f760b6e749::fakeusd::FakeUsd";
export const FUSD_DECIMALS = 6;
export const FUSD_SYMBOL = "FUSD";

/**
 * Permissionless FakeUSD faucet on testnet: `faucet::mint<FakeUsd>(amount, &mut treasury)`
 * returns a Balance anyone may mint. The ATM (player-signed) and the collector's payout
 * (GAME-signed) both mint from it, so FakeUSD never needs funding.
 */
export const FAUCET_PACKAGE_ID = "0xa31234471b3644f55fee16b4d5a2a12a161efc5f05e43c2feb34b4b949adcb1c";
export const FAKEUSD_TREASURY = "0xa3babc5ccf3018c0a743c3a6ee880adb4424a885ef4ca1e62645da7e460897b6";

/** Most the ATM dispenses in one withdrawal (base units). */
export const MAX_WITHDRAW = 100_000_000n; // 100 FUSD
/** The collector pays floor(purchase_price * 3 / 2), capped at MAX_PAYOUT. */
export const OFFER_NUMERATOR = 3n;
export const OFFER_DENOMINATOR = 2n;
export const MAX_PAYOUT = 150_000_000n; // 150 FUSD

/** Transferred-but-unpaid sales ({ transferDigest, payoutDigest? }), so Retry never transfers or pays twice. */
export const PENDING_SALES_KEY = "miso-game:pending-sales:testnet";

export const READ_TIMEOUT_MS = 10_000;
export const TX_TIMEOUT_MS = 30_000;
/** How long locally-known purchases/sales override a lagging chain read. */
export const LOCAL_MERGE_TTL_MS = 120_000;

export const coverUrl = (blobId: string): string => `${CDN}/${blobId}?w=512&f=webp`;
