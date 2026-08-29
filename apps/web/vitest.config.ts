import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryLocalTemp = fileURLToPath(
  new URL("../../.tmp/web-tests/", import.meta.url),
);
mkdirSync(repositoryLocalTemp, { recursive: true });
process.env.TMPDIR = repositoryLocalTemp;
process.env.TMP = repositoryLocalTemp;
process.env.TEMP = repositoryLocalTemp;

export default defineConfig({
  test: {
    clearMocks: true,
    restoreMocks: true,
  },
});
