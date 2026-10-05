import { defineConfig } from "vite";

// Static app: no server, no /api. Testnet keys (VITE_*_PRIVATE_KEY) come from .env.local
// and are compiled into the lazily loaded testnet chunk (see README "Sui testnet").
export default defineConfig({
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } } },
});
