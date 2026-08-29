#!/usr/bin/env node

const argv = process.argv.slice(2);

// Server startup performs two ownership-scoped `ps` calls while reconciling
// interrupted verifier containers. An empty result is the only operation this
// deterministic startup fixture permits.
if (
  argv[0] === "ps" &&
  argv.includes("--all") &&
  argv.includes("--quiet") &&
  argv.filter((value) => value === "--filter").length === 2 &&
  argv.some((value) => value === "label=io.codejam.shepherd=independent-verifier") &&
  argv.some((value) => value.startsWith("label=io.codejam.verifier-owner="))
) {
  process.exit(0);
}

process.stderr.write("fake-container-engine: unsupported operation\n");
process.exit(2);
