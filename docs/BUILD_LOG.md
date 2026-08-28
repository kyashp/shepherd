# Shepherd Build Log

This log records commands actually executed and evidence actually observed. Secrets, raw prompts, and unbounded process output are intentionally excluded.

## Phase 0 — Baseline Lock

**Date:** 2026-08-29 (Asia/Singapore)  
**Branch:** `feature/shepherd-phase-0-baseline`  
**Starting commit:** `12479cf`  
**Environment:** Node 24.17.0, npm 11.17.0, Git 2.43.0, Docker client/server 29.7.2, Linux host. The application Runtime image is based on Node 22.

### Configuration and credential hygiene

- Confirmed ignored `.env` contains configured `ARK_API_KEY`, `ARK_MODEL`, `SHEPHERD_MODEL`, and `ARK_BASE_URL` without printing their values.
- Removed real values from tracked `.env.example`; it now contains placeholders only.
- Direct Responses API probes returned HTTP 200 and exact output `OK` for the configured Agent model (`gpt-5.6-terra`) and Shepherd model (`gpt-5.6-sol`).
- Added ignored `.tmp/` so test/browser temporary state can remain inside the repository boundary.

### Locked dependency baseline

Commands:

```sh
npm ci
npm audit fix
npm audit
```

Observed:

- Locked install completed.
- The initial audit reported five high and one moderate advisory.
- Non-force audit remediation updated seven transitive packages.
- Final audit: `found 0 vulnerabilities`.
- Added exact development dependency `@playwright/test@1.62.1`; Chromium 151 test binaries are held under ignored repository-local `.tmp/`.

### Real starter Runtime acceptance

Started the actual local PoC on loopback with repository-local persistent state and the disposable Docker Runtime. The first build produced `volc-agent-runtime:local`. Runtime preflight observed that Landlock was unavailable and correctly used the documented `danger-full-access` inner fallback inside the disposable outer container.

Observed API/system state:

```json
{
  "arkConfigured": true,
  "arkModel": "gpt-5.6-terra",
  "codexAvailable": true,
  "runtimeProvider": "container",
  "containerEngine": "docker"
}
```

Acceptance journey:

1. Created one real Agent through `POST /api/agents`; it entered `ready`.
2. Sent a dependency-free hello-world CLI task through `POST /api/agents/:id/messages`.
3. Observed Run transition `queued → running → completed`.
4. Agent created `hello.js` and `hello.test.js`; the exact Runtime-container command `node --test hello.test.js` passed 1/1.
5. Sent a minimal follow-up in the same persisted Codex thread; observed exact response `Hello, world!`.
6. Stopped and restarted the server against the same data root.
7. After restart, observed the Agent still `ready`, its Codex thread present, four ordered messages (`user, assistant, user, assistant`), two completed Runs, and the original workspace files.

The first live turn reported 79,196 input tokens (58,062 cached) and the follow-up reported 91,339 input tokens (67,739 cached). This is why later live-model verification is intentionally limited to required gates.

### Diagnosed baseline discrepancy

Reproduction on the host:

```sh
node --test .local/baseline-poc/workspaces/<agent-id>/hello.test.js
```

Observed: failure because the host resolves the nested workspace under the repository's root `"type": "module"`, while the Agent generated CommonJS `.js` files.

Root cause: the same mounted workspace is `/workspace` inside the disposable Runtime and has no ancestor `package.json`; Node therefore evaluates the generated files as CommonJS there. Re-running the exact test in `volc-agent-runtime:local` passed 1/1. No starter code was changed because the supported execution boundary behaved correctly; the host-only command is not the Runtime acceptance path.

### Rendered baseline evidence

Used headless Chromium against the real production server and real persisted backend data.

- `docs/ui-review/baseline/1440x900.png`: Agent, session, first response, and follow-up rendered; no horizontal overflow.
- `docs/ui-review/baseline/1280x800.png`: same persisted state rendered; no horizontal overflow.

Both screenshots were visually inspected. They establish the starter's cream surface, charcoal sidebar, violet accent, typography, spacing, chat treatment, and compact control conventions to preserve.

### Phase 0 gate

Commands and observed results:

```sh
TMPDIR="$PWD/.tmp/test-temp" npm run check
# type checks passed; 5 test files / 12 tests passed; web and server builds passed

terraform fmt -check -recursive deploy/volcengine
# passed

docker compose config --quiet
# passed

npm audit
# found 0 vulnerabilities

git diff --check
# passed
```

**Verdict:** starter deterministic checks, real model/container execution, session continuation, restart persistence, and rendered baseline are verified for this local environment. This does not yet establish any Shepherd behavior.

## Phase 1 — Deterministic Walking Skeleton

**Date:** 2026-08-29 (Asia/Singapore)

**Branch:** `feature/shepherd-phase-1-kernel`

### Built kernel chain

Implemented the deterministic chain before connecting any live model:

```text
Contracts → real Git worktrees → deterministic executors → manifest ingestion
→ actual-diff authority → independent Docker verification → trusted integration
→ normalized semantic collision → concurrent resolution Planes
→ independent candidate evidence → deterministic selection
→ final re-verification + expected-HEAD CAS promotion
```

The V2 store migration preserves the captured V1 Agent/message/Run fixture. Mission and Contract transitions, 22 failure codes, authority envelopes, Plane/candidate evidence, collision state, group messages, settings, and monotonically sequenced events are durable. Store mutations are serialized and written through an atomic temporary-file rename.

The managed authentication fixture uses different frontend/backend files, so both contract commits merge without a textual conflict. Their normalized exclusive `auth.transport` claims conflict semantically. Under the default invariant the cookie candidate passes and is promoted; flipping the invariant selects bearer instead. Both resolution Planes begin at the exact same integration SHA.

### Trust-boundary verification

- Git is invoked with argv arrays, sanitized refs, disabled prompts/hooks/signing, bounded output, and explicit timeouts.
- Public protected-worktree/ref mutation methods reject direct use; the configured protected branch changes only through the final promotion gate.
- Contract and candidate executors receive authority-filtered, Git-free exports with opaque handles; they never receive a linked Git worktree or trusted repository metadata.
- Trusted import compares the complete exported tree with the source Plane, validates the derived actual diff, and rejects escapes, symlinks, FIFOs/special files, `.git`, protected `.shepherd` contents, and out-of-scope writes. A partial import is restored before the error is surfaced.
- Contract and candidate commits are inspected against actual changed paths at the import/Plane boundary and again before promotion.
- Result manifests are strict-schema parsed. The exact `.shepherd/result.json` ingestion exception is removed before trusted commit creation and is absent from every Plane commit.
- The independent verifier creates a fresh snapshot of the exact trusted commit, creates a named container, mounts only that snapshot read-only, uses `--network none`, no capabilities, no new privileges, cleared environment, bounded resources/output/time, then forcibly removes both the container and snapshot on every exit path.
- Independently observed fixture facts must corroborate manifest claim values before claims are persisted as collision inputs. A forged value produces `claim_rejected` and `invalid_semantic_evidence` instead of participating in selection.
- Protected compare-and-swap promotion rolls the ref back to the expected commit if worktree synchronization fails and proves both ref and worktree restoration. Synchronization failure and unprovable rollback are distinct fail-closed errors.
- Agent workspaces use isolated execution UUIDs outside all protected repositories and Planes. Public DTOs expose allowlisted logical fields only.
- Server binding defaults to loopback. Every non-loopback bind requires a URL-safe, non-placeholder token of at least 24 characters; internal errors are bounded/redacted and public 500 responses are generic.
- The JSON store sanitizes configured canaries and common credential forms before state can become observable in memory or on disk. Public Shepherd DTOs strip repository, worktree, and Agent workspace host paths.

An independent read-only security review first identified mutable verification input, linked worktree metadata at the executor boundary, public-bind authentication defaults, uncorroborated claims, incomplete production authority intersection, raw error/path exposure, and a protected-ref synchronization edge. Each finding received a regression test and the smallest fail-closed remediation above. A second independent review re-ran its focused 38-test security slice and reported no remaining critical, high, or medium findings.

### Automated and real-boundary evidence

Focused real-container Mission test:

```sh
npm run test -w @launchpad/server -- --run src/shepherd/service.container.test.ts
# 1 file / 1 test passed; real Docker Mission completed in 5.53 s
```

The test observed persisted contract/candidate/final-promotion evidence, the cookie winner, common resolution base SHA, selected Plane HEAD equal to protected HEAD, trusted profile output, no committed `.shepherd` path, and no remaining containers owned by that Mission.

Full parallel server suite after integration:

```sh
npm run test -w @launchpad/server
# 19 files / 225 tests passed
```

Real built-server HTTP smoke used isolated repository-local data and the real `volc-agent-runtime:local` verification image. Observed:

```json
{
  "unauthenticatedStatus": 401,
  "rejectedInputStatus": 400,
  "missionState": "completed",
  "selectedTransport": "http-only-session-cookie",
  "corroboratedClaimEvents": 2,
  "eventCount": 33,
  "elapsedMs": 6798,
  "pathAndTokenLeakCheck": "passed"
}
```

After graceful stop/restart against the same store, the Mission remained `completed`, persisted protected HEAD matched real Git `HEAD`, no control metadata was tracked, and neither the configured Ark key nor application token appeared in the persisted JSON. The execution-export, trusted-materialization, and trusted-verification directories were empty; Git listed no materialization worktrees; a global Docker label query returned zero remaining verifier containers.

### Five invariant mutation checks

Each guard was temporarily disabled only in the working tree, its hostile test was run red, the guard was restored, and the same test was run green. No mutation was retained.

| Invariant | Temporary mutation | Red observation | Restored observation |
| --- | --- | --- | --- |
| Agent cannot self-certify | Allowed `agent_runtime` to perform `verifying → verified` | Independent-actor assertion failed (1 failed / 7 passed) | State-machine suite 8/8 passed |
| Out-of-scope changes cannot integrate/promote | Forced writable-scope result to `true` | Authority suite failed twice and direct Plane-boundary bypass test failed | Authority + Git suites 56/56 passed |
| Protected branch only changes through promotion | Disabled protected-root mutation guard | Structural bypass test resolved instead of rejecting | Git/Plane suite 10/10 passed |
| Winner is evidence-derived | Forced first assessment to pass | Invariant-flip expected cookie but selected bearer (1 failed / 27 passed) | Resolution suite 28/28 passed |
| Secrets never persist | Replaced recursive redaction with identity | New-write and existing-V2 canaries both leaked (2 failed / 5 passed) | Store suite 7/7 passed |

### Problem-resolution record: parallel Docker cleanup assertion

Reproduction:

```sh
npm run check
# verifier.container.test.ts reported containers owned by service.container.test.ts
```

Root cause: Vitest runs test files in parallel, while both real-container tests queried the shared `io.codejam.shepherd=independent-verifier` label and incorrectly treated another test's live container as their own leak.

Fix: cleanup assertions now combine the shared label with each test's owned `io.codejam.verification-target` labels. This preserves parallelism and still proves each executor destroys its own containers. The original full-suite reproduction then passed 19/19 files and 225/225 tests; an additional phase-boundary global query proves no actual leftovers after all work stops.

### Problem-resolution record: authority denial misclassification

Reproduction: an executor changed an out-of-scope file after Git-free export, and the service initially persisted generic `execution_failed` because trusted import occurred inside the broad executor error boundary.

Root cause: authority validation had moved to the trusted import boundary, but the orchestration layer still classified every pre-import exception as an execution failure.

Fix: execution completion and trusted import now have distinct transitions/error handling. An import-scope rejection durably records `authority_denied` (and candidate `unauthorized_file_change`) while preserving the fail-closed Plane. The focused service/container/Git slice passed 23/23 after the original reproduction was rerun.

### Problem-resolution record: real-Git integration timeout under suite load

Reproduction: the full parallel suite crossed Vitest's generic 5-second default in one real-Git background Mission journey (observed 5.13 seconds) even though the Mission was progressing normally.

Root cause: the integration test intentionally performs multiple real worktree, commit, merge, snapshot, and container-adjacent operations and can exceed a unit-test timeout under parallel contention.

Fix: only that real-boundary integration test declares a 30-second ceiling; unit-test defaults remain unchanged. No sleep or polling delay was added. The full 225-test server suite passed afterward.

### Problem-resolution record: empty control directory in snapshots

Reproduction: after trusted import removed `.shepherd/result.json`, the optimized snapshot copier rejected the now-empty root `.shepherd/` directory even though no control content could enter the snapshot.

Root cause: the hardened tree copier correctly rejected protected control content but did not distinguish a harmless empty root directory left by manifest ingestion from actual metadata.

Fix: snapshot creation skips only an empty root `.shepherd/`; any file or nested content still rejects the source. A regression also proves `.git`, live-only files, and control content never enter a verification snapshot and every snapshot is removed.

### Hardened Phase 1 focused gate

```sh
npm run test -w @launchpad/server -- --run \
  src/config.test.ts src/app.test.ts src/shepherd/auth-fixture.test.ts \
  src/shepherd/service.test.ts src/shepherd/git-plane-promotion.integration.test.ts
# 5 files / 38 tests passed

npm run test -w @launchpad/server
# 19 files / 225 tests passed (includes the real Docker Mission)

npm run typecheck -w @launchpad/server
# passed
```

**Security review verdict:** no critical, high, or medium findings remain at the Phase 1 boundary.

### Phase 1 branch gate

```sh
TMPDIR="$PWD/.tmp/test-temp" npm run check
# exit 0: both workspace type checks passed; 19 files / 225 server tests
# passed; web and server production builds passed

npm audit
# found 0 vulnerabilities

terraform fmt -check -recursive deploy/volcengine
# passed

docker compose config --quiet
# passed

git diff --check
# passed
```

A repository-wide text scan compared the configured non-placeholder Ark credential against 145 files (excluding the ignored source `.env`, dependency/build/browser scratch, and Git metadata) and found zero occurrences. The global verifier-container label query returned zero containers.

The sample environment now defaults `HOST` to `127.0.0.1`; Compose and Terraform retain explicit service binds with their required application token. The user's current ignored `.env` has both requested models and the Ark credential configured, but also has a non-loopback host without a strong application token. Test/rehearsal processes therefore use an explicit loopback override until the private file is intentionally changed; the server correctly refuses that unsafe combination.

**Phase verdict:** the deterministic kernel, its hardened executor/import/verifier boundaries, real Git/container/HTTP path, restart persistence at a completed boundary, and all Phase 1 security regressions are verified. General in-flight recovery and the remaining PRD capabilities are intentionally deferred to subsequent phase gates.
