#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  CREATE_PROMPT,
  CREATE_RESPONSE,
  FOLLOW_UP_PROMPT,
  FOLLOW_UP_RESPONSE,
  HELLO_SOURCE,
  HELLO_TEST_SOURCE,
} from "./legacy-playground.mjs";

const MAX_PROMPT_BYTES = 65_536;
const argv = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`fake-codex: ${message}\n`);
  process.exitCode = 2;
}

async function readBoundedStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.byteLength;
    if (bytes > MAX_PROMPT_BYTES) throw new Error("prompt exceeds fixture limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function writeWorkspaceFile(workspace, filename, contents) {
  const target = path.join(workspace, filename);
  const handle = await open(
    target,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main() {
  if (argv.length === 1 && argv[0] === "--version") {
    process.stdout.write("codex-cli 0.111.0\n");
    return;
  }
  if (argv[0] !== "exec" || argv.length > 24) {
    fail("unsupported invocation");
    return;
  }
  const workspaceIndex = argv.indexOf("-C");
  const workspace = workspaceIndex >= 0 ? argv[workspaceIndex + 1] : undefined;
  if (!workspace || !path.isAbsolute(workspace) || workspace.includes("\0")) {
    fail("a safe absolute workspace is required");
    return;
  }
  await access(workspace);
  if ((await realpath(workspace)) !== workspace) {
    fail("workspace identity must be canonical");
    return;
  }

  const resumeIndex = argv.indexOf("resume");
  const ephemeral = argv.includes("--ephemeral");
  let threadId;
  let prompt;
  if (ephemeral) {
    if (argv.at(-1) !== "-" || resumeIndex >= 0) {
      fail("invalid ephemeral invocation");
      return;
    }
    prompt = await readBoundedStdin();
    threadId = `fixture-${createHash("sha256").update(workspace).digest("hex").slice(0, 16)}`;
  } else if (resumeIndex >= 0) {
    threadId = argv[resumeIndex + 1];
    prompt = argv[resumeIndex + 2];
  } else {
    prompt = argv.at(-1);
    threadId = `fixture-${createHash("sha256").update(workspace).digest("hex").slice(0, 16)}`;
  }
  if (
    !threadId ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u.test(threadId) ||
    typeof prompt !== "string" ||
    prompt.trim().length === 0 ||
    Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES
  ) {
    fail("invalid thread or prompt");
    return;
  }

  let response = "Deterministic fixture response. No model or network call was made.";
  if (prompt === CREATE_PROMPT) {
    if (resumeIndex >= 0 || ephemeral) {
      fail("the legacy create turn must start a resumable session");
      return;
    }
    await writeWorkspaceFile(workspace, "hello.js", HELLO_SOURCE);
    await writeWorkspaceFile(workspace, "hello.test.js", HELLO_TEST_SOURCE);
    response = CREATE_RESPONSE;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  } else if (prompt === FOLLOW_UP_PROMPT) {
    if (resumeIndex < 0 || ephemeral) {
      fail("the legacy follow-up must resume its existing session");
      return;
    }
    const [source, testSource] = await Promise.all([
      readFile(path.join(workspace, "hello.js"), "utf8"),
      readFile(path.join(workspace, "hello.test.js"), "utf8"),
    ]);
    if (source !== HELLO_SOURCE || testSource !== HELLO_TEST_SOURCE) {
      fail("the legacy follow-up found unexpected workspace contents");
      return;
    }
    response = FOLLOW_UP_RESPONSE;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }

  const events = [
    { type: "thread.started", thread_id: threadId },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: response,
      },
    },
    {
      type: "turn.completed",
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
    },
  ];
  process.stdout.write(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

main().catch((error) => fail(error instanceof Error ? error.message : "fixture failure"));
