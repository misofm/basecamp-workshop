/**
 * localStorage slot names for the testnet adapter. Dependency-free on purpose, so the
 * app layer (src/app/pending-sales.ts) can use them without pulling ./config.ts (which
 * imports @misofm/platform) into the main chunk. ./config.ts re-exports them.
 */

/** Transferred-but-unpaid sales ({ transferDigest, payoutDigest? }), so Retry never transfers or pays twice. */
export const PENDING_SALES_KEY = "miso-game:pending-sales:testnet";
