import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["deterministic-recording.spec.mjs"],
  outputDir: ".tmp/demo-recordings/deterministic/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 10_000 },
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    browserName: "chromium",
    headless: true,
    viewport: { width: 1920, height: 1080 },
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "deterministic-1920x1080" }],
});
