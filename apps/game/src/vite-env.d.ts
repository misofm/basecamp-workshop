/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** TESTNET ONLY, baked into the testnet chunk: the player wallet (suiprivkey1…). */
  readonly VITE_PLAYER_SUI_PRIVATE_KEY?: string;
  /** TESTNET ONLY, baked into the testnet chunk: the game / collector wallet (suiprivkey1…). */
  readonly VITE_GAME_SUI_PRIVATE_KEY?: string;
}

/** True only in the Playwright e2e test build (`vite build --mode e2e`); see vite.config.ts. */
declare const __MISO_E2E__: boolean;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
