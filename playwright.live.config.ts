import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "starter-kit.live.spec.mjs",
  outputDir: ".tmp/playwright-live-results",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 420_000,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
