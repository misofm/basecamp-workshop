import { defineConfig } from "vite";

// /api is served by the bank server (bun server/index.ts) in dev and preview. It listens on
// PORT (default 8787); `npm run stage` passes the same env to both processes so they agree.
const bankPort = process.env.PORT || "8787";
const apiProxy = { "/api": { target: `http://127.0.0.1:${bankPort}`, changeOrigin: true } };

export default defineConfig({
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } } },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
