/**
 * Live Sui TESTNET constants for the TestnetAdapter (lazy chunk: only loaded with ?chain=testnet).
 *
 * Owns: endpoints, coin/record types, package ids, timeouts and money thresholds.
 * Must not: do I/O. Package ids come from the published @misofm/platform deployment map.
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

/** Ask the bank server for a top-up when below these (mirrors the server's own thresholds). */
export const MIN_SUI = 50_000_000n; // 0.05 SUI
export const MIN_FUSD = 25_000_000n; // 25 FUSD

/** TESTNET-ONLY burner key slot in localStorage. */
export const BURNER_STORAGE_KEY = "miso-game:burner:testnet";
/** Transferred-but-unpaid sales, so Retry only re-asks the server for payment. */
export const PENDING_SALES_KEY = "miso-game:pending-sales:testnet";

export const READ_TIMEOUT_MS = 10_000;
export const TX_TIMEOUT_MS = 30_000;
/** How long locally-known purchases/sales override a lagging chain read. */
export const LOCAL_MERGE_TTL_MS = 120_000;

export const coverUrl = (blobId: string): string => `${CDN}/${blobId}?w=512&f=webp`;
