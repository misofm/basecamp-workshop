import { defineConfig } from "@playwright/test";

// A dedicated port so the tests never talk to some other dev server by accident.
const PORT = 4319;

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
