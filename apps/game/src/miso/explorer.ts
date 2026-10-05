/**
 * Block explorer links (Suiscan, testnet) for receipts.
 *
 * Owns: URL shapes only. MockAdapter returns the same shapes for its fake ids;
 * those links will not resolve, which is expected in mock mode.
 */
const SUISCAN_TESTNET = "https://suiscan.xyz/testnet";

export const suiscanTxUrl = (digest: string): string => `${SUISCAN_TESTNET}/tx/${digest}`;
export const suiscanObjectUrl = (objectId: string): string =>
  `${SUISCAN_TESTNET}/object/${objectId}`;
