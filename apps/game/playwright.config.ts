import { defineConfig } from "@playwright/test";

/**
 * Browser end-to-end tests (tests/e2e). Unit tests live in tests/unit and run with
 * `npm run test:unit` (playwright.unit.config.ts). WebGL runs on SwiftShader so this
 * works headless without a GPU; that is slow, hence the generous timeouts.
 */
const PORT = 5287;

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["**/unit/**"],
  timeout: 900_000, // SwiftShader on a busy CI box can drop to ~1 fps
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1600, height: 900 },
    actionTimeout: 20_000,
    launchOptions: {
      args: [
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    screenshot: "only-on-failure",
  },
  // A production build served by `vite preview`: no HMR, so edits elsewhere in the
  // repo can't reload the page mid-test (and it's closer to what ships).
  webServer: {
    command: `npx vite build --logLevel warn --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
