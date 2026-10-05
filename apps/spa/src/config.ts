// Every network constant lives here. Nothing else in the app hard-codes an id or URL.

export const MISO_API = "https://api.testnet.miso.fm/v1";
export const MISO_CDN = "https://cdn.miso.fm/v1";
// Fallback for media the CDN does not host (e.g. releases you published yourself). Slower, no resizing.
export const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space/v1";
export const SUI_GRAPHQL = "https://graphql.testnet.sui.io/graphql";

// Move type of Miso Release objects (protocol package on testnet)
export const RELEASE_TYPE =
  "0x02dda3f548d9d38a9122a714663b4d304dad03499879f270f5769bc96e235c67::release::Release";

// Record package (from @misofm/platform@0.45.0 deployments, testnet.recordSales.recordPackageId)
export const RECORD_PACKAGE = "0xf51af0e4a29d764a6880db65d99aaa7d1802774f7be18e7220a05a2d673b4743";

// Currency the workshop pressings are listed in
export const FAKEUSD_TYPE =
  "0x77774cb7b8cb5622b4ef2658101bf5f1e965418297fe874b683df8f760b6e749::fakeusd::FakeUsd";

// A testnet wallet that already owns two records (for the Collection page "try an example" link)
export const EXAMPLE_COLLECTOR = "0xad69173b206b5c0be6a83f6e6cde2a282d2ada46c4c81ab491b0fdc646e5795f";

// Preview behaviour, matching the official Miso app
export const PREVIEW_SECONDS = 30;
export const FADE_IN_SECONDS = 1;
export const FADE_OUT_SECONDS = 5;
