import { defineConfig } from "vite";

// Static app: no server, no /api. Testnet keys (VITE_*_PRIVATE_KEY) come from .env.local
// and are compiled into the lazily loaded testnet chunk (see README "Sui testnet").
// `--mode e2e` (Playwright's test build only) sets __MISO_E2E__, which makes the game run
// on the MockAdapter (src/miso/select.ts); every other build is testnet-only and contains
// no MockAdapter.
export default defineConfig(({ mode }) => ({
  define: { __MISO_E2E__: JSON.stringify(mode === "e2e") },
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } } },
}));
