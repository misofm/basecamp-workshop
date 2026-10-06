import { defineConfig } from "@playwright/test";

/**
 * Browser end-to-end tests (tests/e2e). Unit tests live in tests/unit and run with
 * `npm run test:unit` (playwright.unit.config.ts). WebGL runs on SwiftShader so this
 * works headless without a GPU; that is slow, hence the generous timeouts.
 *
 * MISO_E2E_BASE_URL=http://127.0.0.1:4173 runs against an already-running server (e.g.
 * `npm run stage`'s vite preview) instead of building one.
 */
const PORT = 5287;
const EXTERNAL = process.env.MISO_E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["**/unit/**"],
  timeout: 900_000, // SwiftShader on a busy CI box can drop to ~1 fps
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: EXTERNAL ?? `http://127.0.0.1:${PORT}`,
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
  // repo can't reload the page mid-test (and it's closer to what ships). `--mode e2e`
  // makes the game run on the MockAdapter (deterministic, failure injection; see
  // src/miso/select.ts); only e2e builds contain it. `vite build` reads .env.local, so
  // with testnet keys there this build is keyed too (testnet.spec.ts, ?chain=testnet).
  webServer: EXTERNAL
    ? undefined
    : {
        command: `npx vite build --mode e2e --logLevel warn --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort --host 127.0.0.1`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
