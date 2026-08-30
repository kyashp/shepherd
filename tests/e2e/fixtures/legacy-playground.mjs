export const CREATE_PROMPT =
  "Create dependency-free hello.js and hello.test.js, then report exactly what you verified.";
export const CREATE_RESPONSE =
  "Created hello.js and hello.test.js. Verified both dependency-free hello tests passed.";
export const FOLLOW_UP_PROMPT =
  "Continue this same session and confirm the existing hello implementation still passes unchanged.";
export const FOLLOW_UP_RESPONSE =
  "Session continued with the existing workspace context. Re-verified both hello tests passed unchanged.";

export const HELLO_SOURCE = `export function hello(name = "world") {
  return \`Hello, \${name}!\`;
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  console.log(hello());
}
`;

export const HELLO_TEST_SOURCE = `import assert from "node:assert/strict";
import test from "node:test";
import { hello } from "./hello.js";

test("greets the world by default", () => {
  assert.equal(hello(), "Hello, world!");
});

test("greets a supplied name", () => {
  assert.equal(hello("Shepherd"), "Hello, Shepherd!");
});
`;
