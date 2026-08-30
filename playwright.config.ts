import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["harness.spec.mjs", "starter-kit.spec.mjs", "settings-model-review.spec.mjs", "ui04-audit.spec.mjs", "shepherd-hero.spec.mjs", "demo-agent-contract-flow.spec.mjs"],
  outputDir: ".tmp/playwright-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-1280x800",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "chromium-1440x900",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
