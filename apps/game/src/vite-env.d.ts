/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default chain when the URL has no ?chain= ("mock" | "testnet"). */
  readonly VITE_MISO_CHAIN?: string;
  /** TESTNET ONLY, baked into the testnet chunk: the player wallet (suiprivkey1…). */
  readonly VITE_PLAYER_SUI_PRIVATE_KEY?: string;
  /** TESTNET ONLY, baked into the testnet chunk: the game / collector wallet (suiprivkey1…). */
  readonly VITE_GAME_SUI_PRIVATE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
