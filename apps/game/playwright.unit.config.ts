import { defineConfig } from "@playwright/test";

/** Pure unit tests (game state machine, mock adapter). No browser, no dev server. */
export default defineConfig({
  testDir: "tests/unit",
  timeout: 10000,
  fullyParallel: true,
  reporter: "list",
});
