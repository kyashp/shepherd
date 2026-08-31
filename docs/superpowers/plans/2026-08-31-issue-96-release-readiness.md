# Issue 96 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every concrete product, security, test-harness, infrastructure-validation, and documentation defect reproduced by the exact-main audit.

**Architecture:** Preserve the frozen UI and existing public contracts. Add fail-closed capacity and request-boundary helpers, constrain live gates structurally, move cloud secrets to a post-provision SSH bootstrap outside Terraform, and make every correction observable through causal tests before implementation.

**Tech Stack:** Node.js 22+, TypeScript, Fastify, React, Vitest, Playwright, Docker, Terraform 1.6+.

**Spec:** `docs/PRD.md` sections 0.3–0.4 and 11–17; umbrella issue #96 with linked issues #45, #65, and #89.

## Global Constraints

- Preserve the accepted UI theme and layout; only minimal functional/accessibility corrections are allowed.
- Default tests must remain network- and model-free.
- Live gates stay opt-in, single-worker, retry-free, bounded, redacted, and current-tree-only.
- No credential may enter Terraform state, cloud-init user data, process arguments, persisted state, DOM, or logs.
- Every production behavior change starts with a failing regression test.
- `npm run check`, the two-viewport Playwright matrix, coverage, audit, and Terraform validation must pass before push.

---

### Task 1: Durable collection admission

**Files:**
- Create: `apps/server/src/collection-capacity.ts`
- Modify: `apps/server/src/database-schema.ts`
- Modify: `apps/server/src/agent-service.ts`
- Modify: `apps/server/src/shepherd/service.ts`
- Test: `apps/server/src/collection-capacity.test.ts`
- Test: `apps/server/src/agent-service.test.ts`

**Interfaces:**
- Produces `appendWithinCapacity<T>(collection, values, label)` and `DurableCapacityError` with HTTP status `507`.
- Consumers use the helper before every top-level durable append; no existing evidence is evicted.

- [ ] Write boundary tests proving an append at 9,999 succeeds, an append past 10,000 fails without mutation, and an Agent capacity failure creates no workspace.
- [ ] Run the focused tests and observe the expected RED at the real append paths.
- [ ] Implement bounded admission and replace top-level durable `push` calls.
- [ ] Run focused Store, Agent, Shepherd service, API, and schema tests GREEN.

### Task 2: Tokenless request and public-bind boundary

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/config.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`
- Modify: `docker-compose.yml`
- Modify: `scripts/deploy-existing-ecs.test.mjs`

**Interfaces:**
- Tokenless mode is valid only for a loopback external bind.
- Tokenless API requests require a loopback `Host`; requests carrying `Origin` require an exact same-origin loopback origin.

- [ ] Add failing config tests for a direct non-loopback bind and Compose public bind without a token.
- [ ] Add failing real-app tests for hostile `Host`, hostile `Origin`, `Origin: null`, and allowed same-origin/no-Origin loopback requests.
- [ ] Implement external-bind validation and the tokenless request hook before route handling.
- [ ] Run focused config, app, and Compose behavior tests GREEN.

### Task 3: UI interaction and accessibility regressions

**Files:**
- Modify: `apps/web/src/pages/ProjectGroupPage.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `tests/e2e/ui-gate.spec.mjs`
- Modify: `tests/e2e/starter-kit.spec.mjs`
- Modify: `tests/e2e/starter-kit.live.spec.mjs`

**Interfaces:**
- Mention insertion commits text and caret synchronously before subsequent keyboard input.
- Settings numeric inputs expose exact accessible names.
- The direct Playground tests explicitly select direct mode without changing the product default.

- [ ] Add/retain failing Playwright assertions for exact mention content, numeric-control roles/names, direct-mode routing, and Create Agent viewport containment.
- [ ] Run focused tests at both viewports and observe the four audit failures.
- [ ] Use synchronous React state flush for mention insertion, add explicit numeric labels, select direct mode in legacy tests, and add the minimum scroll clearance needed for the Create action.
- [ ] Run focused browser tests GREEN at `1280x800` and `1440x900`.

### Task 4: Current-tree-only live gates

**Files:**
- Modify: `package.json`
- Modify: `apps/server/vitest.config.ts`
- Modify: `tests/e2e/starter-kit.live.spec.mjs`
- Modify: `tests/e2e/support/test-app.mjs`
- Test: `tests/e2e/harness.test.mjs`

**Interfaces:**
- Vitest live commands run with `--root apps/server` and paths relative to that root.
- The legacy harness resolves a bare Codex executable through the allowlisted `PATH`, while an explicit path remains exact.

- [ ] Run the existing model-review list command and capture duplicate worktree discovery as RED.
- [ ] Add a failing executable-resolution harness test and a list assertion that exactly one live file is selected.
- [ ] Constrain both package scripts/config and implement bounded executable resolution.
- [ ] Verify one listed model-review test and one listed runtime test without making a live request.

### Task 5: Volume-aware live Runtime gate

**Files:**
- Create: `Dockerfile.live-test`
- Create: `scripts/run-live-runtime-gate.mjs`
- Create: `scripts/run-live-runtime-gate.test.mjs`
- Modify: `apps/server/src/shepherd/live-runtime.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- The host wrapper runs the test control plane in a disposable test image with a named state volume and the container-engine socket.
- `liveConfig()` accepts only the wrapper-provided canonical state root/volume and places all mounted roots beneath it.

- [ ] Add wrapper argument/environment tests that fail until the named-volume, cleanup, env-name-only, one-attempt contract exists.
- [ ] Add a config-focused RED proving the live test no longer clears valid volume settings.
- [ ] Implement the disposable runner image/wrapper and volume-root layout.
- [ ] Run the zero-spend preflight, then the single authorized live Runtime gate once with no retry.

### Task 6: Enforced 80 percent coverage

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/server/vitest.config.ts`
- Modify: `apps/web/vitest.config.ts`

**Interfaces:**
- `npm run test:coverage` produces bounded text/JSON reports and enforces at least 80 percent statements, branches, functions, and lines for covered production modules.

- [ ] Run `npm run test:coverage` and observe the missing-script RED.
- [ ] Add pinned `@vitest/coverage-v8` and workspace coverage commands with explicit source inclusion and live-test exclusions.
- [ ] Run coverage, add causal unit tests for uncovered behavior rather than exclusions, and repeat until all thresholds pass.

### Task 7: Secret-free Terraform provisioning

**Files:**
- Modify: `deploy/volcengine/main.tf`
- Modify: `deploy/volcengine/variables.tf`
- Modify: `deploy/volcengine/cloud-init.yaml.tftpl`
- Modify: `scripts/deploy-volcengine.sh`
- Create: `scripts/deploy-volcengine.test.mjs`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Terraform provisions only infrastructure and public repository metadata.
- The deploy script transfers `.env.production` over SSH after cloud-init and installs it mode `0600`; secret values never become Terraform inputs or command arguments.

- [ ] Add a behavior test with fake Terraform/SSH/SCP commands proving secrets are absent from Terraform environment, generated plan inputs, and command arguments.
- [ ] Run the test RED against the current `TF_VAR_ark_api_key` and cloud-init path.
- [ ] Remove secret Terraform variables/user data and implement post-provision SSH bootstrap with strict key-file validation.
- [ ] Run script tests, shell syntax checks, and credential canary scans GREEN.

### Task 8: Pinned Terraform validation

**Files:**
- Modify: `package.json`
- Create: `scripts/validate-terraform.mjs`
- Test: `scripts/validate-terraform.test.mjs`

**Interfaces:**
- `npm run test:terraform` uses local Terraform when compatible, otherwise pinned `hashicorp/terraform:1.9.8` through Docker with no credentials.

- [ ] Run the missing validation command RED.
- [ ] Implement version selection, read-only repository mount, isolated plugin cache, `fmt -check`, `init -backend=false`, and `validate`.
- [ ] Run the pinned validation command GREEN.

### Task 9: Complete browser, security, and repository verification

**Files:** all changed files.

- [ ] Run focused RED/GREEN tests for every task.
- [ ] Run `npm audit --json` and inspect zero High/Critical results.
- [ ] Run `npm run test:coverage`, `npm run test:terraform`, full `npm run test:e2e:harness`, and `npm run check`.
- [ ] Inspect both viewport screenshots, console errors, accessibility names, and document/body overflow.
- [ ] Run `git diff --check` and a tracked secret scan.

### Task 10: Truthful evidence and delivery

**Files:**
- Modify: `docs/TASKS.md`
- Modify: `docs/SHEPHERD.md`
- Modify: `docs/LOCAL_POC.md`
- Modify: `docs/FIXES.md`
- Modify: `docs/BUILD_LOG.md`
- Create or modify: `docs/SHEPHERD_TEST_REPORT.md`

- [ ] Update only statuses supported by the fresh commands from Task 9; keep independent `U`/`S` and second-machine evidence open when not independently observed.
- [ ] Commit using the repository conventional format with Summary, Root cause, Fix, and Testing evidence.
- [ ] Push the branch, open a draft linked PR for #96/#45/#65/#89, inspect CI, and update the PR/issue evidence.
