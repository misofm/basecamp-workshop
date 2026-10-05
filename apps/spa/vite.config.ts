import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // hls.js is most of the bundle (~650 kB minified); fine for a demo, so silence the size warning.
  build: { chunkSizeWarningLimit: 1000 },
});
