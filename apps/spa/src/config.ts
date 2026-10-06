// Every network constant lives here. Nothing else in the app hard-codes an id or URL.

export const MISO_API = "https://api.testnet.miso.fm/v1";
export const MISO_CDN = "https://cdn.miso.fm/v1";
// Fallback for media the CDN does not host (e.g. releases you published yourself). Slower, no resizing.
export const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space/v1";
export const SUI_GRAPHQL = "https://graphql.testnet.sui.io/graphql";

// Move type of Miso Release objects (protocol package on testnet)
export const RELEASE_TYPE =
  "0x02dda3f548d9d38a9122a714663b4d304dad03499879f270f5769bc96e235c67::release::Release";

// How often the home page re-checks the chain for new releases (while the tab is visible)
export const POLL_MS = 15_000;

// Record package (from @misofm/platform@0.45.0 deployments, testnet.recordSales.recordPackageId)
export const RECORD_PACKAGE = "0xf51af0e4a29d764a6880db65d99aaa7d1802774f7be18e7220a05a2d673b4743";

// Record Shop package: per-currency Listings and listing::purchase (same deployment map, recordShopPackageId)
export const RECORD_SHOP_PACKAGE = "0x6eb622211786516988c6ee8e7c0403b4ef64a8c004d654494122e29c103060e1";

// Currency the workshop pressings are listed in
export const FAKEUSD_TYPE =
  "0x77774cb7b8cb5622b4ef2658101bf5f1e965418297fe874b683df8f760b6e749::fakeusd::FakeUsd";
export const FAKEUSD_DECIMALS = 6;

// Permissionless FakeUSD faucet: faucet::mint<FakeUsd>(amount, &mut treasury) returns a Balance anyone may mint
export const FAKEUSD_FAUCET_PACKAGE = "0xa31234471b3644f55fee16b4d5a2a12a161efc5f05e43c2feb34b4b949adcb1c";
export const FAKEUSD_TREASURY = "0xa3babc5ccf3018c0a743c3a6ee880adb4424a885ef4ca1e62645da7e460897b6";
// What the Faucet page mints per click, in base units (100 FakeUSD)
export const FAUCET_AMOUNT = 100_000_000n;

// --- Write path (wallet only). Reads above never need a wallet. ---

// Sui testnet fullnode (gRPC-web): wallet balances, transaction simulation and status
export const SUI_FULLNODE = "https://fullnode.testnet.sui.io:443";
// Official browser faucet for testnet SUI (gas). It cannot be prefilled: paste your address.
export const SUI_WEB_FAUCET = "https://faucet.sui.io/?network=testnet";
// Transaction explorer: `${EXPLORER}/?search=<digest>&network=testnet`
export const EXPLORER = "https://devxplorer.io";

// A testnet wallet that already owns two records (for the Collection page "try an example" link)
export const EXAMPLE_COLLECTOR = "0xad69173b206b5c0be6a83f6e6cde2a282d2ada46c4c81ab491b0fdc646e5795f";

// Preview behaviour, matching the official Miso app
export const PREVIEW_SECONDS = 30;
export const FADE_IN_SECONDS = 1;
export const FADE_OUT_SECONDS = 5;
