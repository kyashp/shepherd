import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryLocalTemp = fileURLToPath(
  new URL("../../.tmp/shepherd-tests/", import.meta.url),
);
mkdirSync(repositoryLocalTemp, { recursive: true });
process.env.TMPDIR = repositoryLocalTemp;
process.env.TMP = repositoryLocalTemp;
process.env.TEMP = repositoryLocalTemp;

export default defineConfig({
  test: {
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        "src/**/test-fixtures/**",
        "src/shepherd/auth-fixture.ts",
      ],
      reporter: ["text-summary", "json"],
      reportsDirectory: fileURLToPath(
        new URL("../../.tmp/coverage/server/", import.meta.url),
      ),
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
