/**
 * Explorer links (devxplorer, testnet) for receipts.
 *
 * Owns: URL shapes only. Transactions and objects share one search URL:
 * https://devxplorer.io/?search=<digest-or-object-id>&network=testnet (value URL-encoded).
 * MockAdapter returns the same shapes for its fake ids; those links will not resolve,
 * which is expected in mock mode. Players only ever see "View receipt ↗" / "View record ↗".
 */
const DEVXPLORER = "https://devxplorer.io/";

const devxplorerSearchUrl = (value: string): string =>
  `${DEVXPLORER}?search=${encodeURIComponent(value)}&network=testnet`;

export const explorerTxUrl = (digest: string): string => devxplorerSearchUrl(digest);
export const explorerObjectUrl = (objectId: string): string => devxplorerSearchUrl(objectId);
