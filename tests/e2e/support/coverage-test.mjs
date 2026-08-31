import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./test-app.mjs";

const coverageEnabled = process.env.E2E_COVERAGE === "true";
const coverageDirectory = path.join(repositoryRoot, ".tmp", "coverage", "web-e2e");
const storageKey = "shepherd-e2e-coverage-v1";

export const test = base.extend({
  coverageCollector: [async ({ page }, use, testInfo) => {
    if (coverageEnabled) {
      await page.addInitScript((key) => {
        try {
          const saved = localStorage.getItem(key);
          if (saved) globalThis.__coverage__ = JSON.parse(saved);
          addEventListener("pagehide", () => {
            if (globalThis.__coverage__) {
              localStorage.setItem(key, JSON.stringify(globalThis.__coverage__));
            }
          });
        } catch {
          // Non-HTTP bootstrap documents do not expose origin storage.
        }
      }, storageKey);
    }
    await use();
    if (!coverageEnabled || page.isClosed()) return;
    const coverage = await page.evaluate((key) => {
      try {
        if (globalThis.__coverage__) {
          localStorage.setItem(key, JSON.stringify(globalThis.__coverage__));
        }
      } catch {
        // The current page may be an originless error document.
      }
      return globalThis.__coverage__ ?? null;
    }, storageKey);
    if (!coverage) return;
    await mkdir(coverageDirectory, { recursive: true });
    const identity = createHash("sha256")
      .update([testInfo.project.name, testInfo.file, testInfo.title, testInfo.retry].join("\0"))
      .digest("hex")
      .slice(0, 24);
    await writeFile(
      path.join(coverageDirectory, `${identity}.json`),
      `${JSON.stringify(coverage)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }, { auto: true }],
});

export { expect };
