# Shepherd Build Log

This log records commands actually executed and evidence actually observed. Secrets, raw prompts, and unbounded process output are intentionally excluded.

This is a chronological evidence record, not the current task/status authority.
Branch and phase statements remain true only for the commit named in their entry.
Use [`HANDOVER.md`](HANDOVER.md) for the current repository snapshot, defects,
pending checks, and workflow.

## OPS-05 canonical launcher-entry candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch:** `fix/31-ops-05-canonical-launcher-entry`
**Issue:** [#31](https://github.com/kyashp/shepherd/issues/31)

On macOS, `os.tmpdir()` returned a lexical `/var/...` path while `realpath()`
returned its `/private/var/...` filesystem identity. The launcher compared the
lexical `process.argv[1]` with ESM's canonical module path, misclassified direct
execution as an import, and exited before starting its child. The preserved initial
launcher suite RED was 1/2: the direct-shell fixture failed with missing
`startup-environment`. A new deterministic symlink-entry RED then failed 0/1
because its child-side-effect marker was absent even though the launcher exited 0.

The launcher now canonicalizes both entry paths with `realpath()` before comparing
them. An identity-resolution failure is an explicit generic launcher error (exit 1),
never a safe import classification. The regression invokes a symlink alias and
asserts that its child writes the marker. The existing direct-shell fixture now uses
a temporary `HOME` and asserts Darwin's documented user-local state root while
retaining Linux's repository-local root; exact Docker-default localization, explicit
custom paths, Node-only dotenv parsing, inherited child environment, and secret
non-disclosure assertions remain intact.

Observed GREEN verification:

```sh
node --test scripts/start-local-poc-launcher.test.mjs
# 3/3 passed, repeated five consecutive times

npm run check
# exit 0: workspace typechecks passed; launcher 3/3; server 25 files passed,
# 550 tests passed, 2 opt-in tests skipped; web and server production builds passed

npm audit
# found 0 vulnerabilities
```

No Ark or Shepherd model request was made. A real zero-parameter Docker smoke was
unavailable in this session: the Docker CLI was installed but `docker info` exited
1, so no live Runtime claim is recorded.

## OPS-04 local loopback candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/commit:** `fix/29-ops-04-local-loopback` / `a0a2d60`
**Issue:** [#29](https://github.com/kyashp/shepherd/issues/29)

The first exact post-#28 command, `./scripts/start-local-poc.sh`, used the real
ignored `.env` without printing values. Runtime preflight and both builds passed,
but server configuration then failed closed because the inherited host was an
any-address value and the configured application token was a placeholder. A
classification-only check confirmed those facts without exposing either value.

The candidate changes only the local launcher: an empty host or the exact container
any-address values `0.0.0.0` and `::` become `127.0.0.1`. Other custom hosts remain
unchanged, and the server's non-loopback token validation is untouched. The causal
RED fixture captured `0.0.0.0`; GREEN captured `127.0.0.1` through the real launcher
boundary.

The exact direct command was then run from the candidate worktree against the real
ignored `.env` through a temporary ignored symlink; no credential was copied,
printed, or committed. Observed results:

- listener: `127.0.0.1:3000` only;
- `GET /api/health`: 200;
- `GET /`: 200;
- unauthenticated `GET /api/system`: 401;
- authenticated `GET /api/system`: 200 with Ark configured, Codex available, and
  the container/Docker Runtime selected;
- SIGINT closed port 3000 and left zero Runtime containers owned by the configured
  instance; the temporary `.env` symlink was removed;
- no Agent or Shepherd model request was made.

Final local verification before PR creation:

```sh
node --test scripts/start-local-poc-launcher.test.mjs
# 2/2 passed

npm run check
# exit 0: both workspace typechecks passed
# launcher tests 2/2 passed
# 26 server test files passed, 1 opt-in live file skipped
# 551 tests passed, 1 opt-in live test skipped
# web and server production builds passed
```

The configured custom security-reviewer role was unavailable. An independent
read-only fallback review reported no high or medium finding and confirmed that
non-loopback hosts still reach the unchanged server token-enforcement boundary.
It reported one Low test gap for empty, IPv6-any, and explicit custom hosts. The
launcher regression now covers empty and `::` normalization plus preservation of
the concrete documentation-range host `192.0.2.10`; the focused test remains 2/2.

## OPS-02 direct local startup candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/commit:** `fix/27-ops-02-direct-env-launch` / `e4cb2e5`
**Draft PR:** [#28](https://github.com/kyashp/shepherd/pull/28)

Direct `./scripts/start-local-poc.sh` previously exited 2 before Runtime detection
because it did not read the repository `.env`. The preserved RED launcher fixture
observed the generic missing-Ark-variable error. The candidate performs one guarded
handoff through Node's dotenv parser and marks the returned shell environment to
prevent recursion; `.env` is never sourced or printed.

The same fixture established the adjacent host-path defect: `.env.example` Docker
defaults would otherwise remain `/app/...`. The candidate maps only those exact
defaults into the existing platform local-state root and leaves explicit custom host
paths unchanged. The fake engine/npm boundary captures values only in a private
temporary test file and asserts that planted Ark/model sentinels never reach stdout
or stderr.

Observed verification:

```sh
node --test scripts/start-local-poc-launcher.test.mjs
# 2/2 passed: npm launcher compatibility; direct dotenv/path behavior

bash -n scripts/start-local-poc.sh
node --check scripts/start-local-poc-launcher.mjs
git diff --check
# all passed

npm run check
# exit 0: both workspace typechecks passed
# launcher tests 2/2 passed
# 26 server test files passed, 1 opt-in live file skipped
# 551 tests passed, 1 opt-in live test skipped
# web and server production builds passed
```

No live Ark or Shepherd-model request was made. The configured custom security
reviewer role was unavailable, so an independent read-only fallback reviewer
inspected the exact `origin/main...8266c46` delta. It reported no critical, high,
medium, or low finding: Node parses rather than executes `.env`; the recursion
marker adds no privilege boundary; paths remain quoted; only exact Docker defaults
are localized; and container isolation is unchanged. It reran the launcher suite
2/2. A post-merge real zero-parameter startup smoke remains before `OPS-02` may be
marked complete on `main`.

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

## Phase 2 — Domain, Persistence, and Crash Recovery Hardening

**Date:** 2026-08-29 (Asia/Singapore)
**Branch:** `feature/shepherd-phase-2-recovery`

### Strict durable state

The version-2 store now validates every persisted and outgoing field with strict,
bounded schemas rather than accepting shape-compatible JSON. Validation covers
canonical host and project-relative paths, supported authority patterns, safe Git
branches, full object IDs, bounded collections/text/numbers/timestamps, unique IDs,
references, event cursors, one active non-terminal Mission, and lifecycle/evidence
relationships. The captured version-1 fixture is independently validated before its
lossless migration.

False-green completion is rejected unless verified Contracts have non-vacuous
mandatory acceptance evidence tied to their exact Plane diff and manifest claims.
Collision sources must be verified Contracts with canonical embedded claims. For the
managed authentication fixture, candidate evidence must contain exactly the trusted
frontend, backend, and project-security mandatory suite; final promotion evidence
must repeat that exact suite. Completed collision Missions require one resolved,
selected, promoted candidate whose verified Plane HEAD matches the protected project
HEAD. A no-collision completion requires a verified integration Plane at the promoted
protected HEAD.

The JSON reader uses bounded, no-follow, non-blocking regular-file reads. Outgoing
state is validated and recursively scrubbed before a unique exclusive `0600`
temporary file is synced and atomically renamed. Oversized reads/writes, symlinks,
fixed-name temporary symlinks, FIFOs, invalid outgoing state, and persistence failure
before in-memory publication all have negative tests. The supported concurrency model
is one server process per data root; mutation serialization is in-process and the JSON
store is not a distributed database.

### Restart reconciliation and trust adoption

Startup now validates the sentinel-bound managed root, project metadata, repository,
Plane roots, Plane sentinels, Git worktree registration, protected branch, index, and
worktree before serving. Trusted identity files are bounded `O_NOFOLLOW | O_NONBLOCK`
reads with pre/opened inode and size checks. Persisted host paths are comparison values
only; server-derived sentinel identities select filesystem locations. Missing,
substituted, symlinked, special-file, out-of-root, dirty, detached, unregistered, or
unexpected artifacts fail closed.

In-flight Contracts, candidates, and Planes become `interrupted`; their Mission and
Collision become `attention_required`; Agent leases are released; private execution,
materialization, and verification artifacts are removed. Evidence and the event cursor
are preserved, and a second restart is idempotent.

Promotion has a durable intent boundary. After final authority, immutable-head,
selection, protected-head, and independent-verification checks—and immediately before
compare-and-swap—Shepherd atomically records `promotionState=promoting`, the complete
passing promotion evidence, and its Plane evidence link. Recovery never trusts the
earlier `reverifying` state. It recognizes a post-CAS window only when the exact
selected resolution Plane, expected-head ancestry, derived branch/worktree identity,
live Git registration, clean/index-synchronized protected checkout, candidate HEAD,
and complete verifier suite all corroborate. Ordinary post-marker promotion failures
retain evidence and fence the project in `attention_required`; a same-process second
Mission cannot silently adopt an external branch move.

An empty/replaced database cannot establish a new trust root over old managed project
artifacts. Only a missing/empty root or an existing sentinel-only root with empty known
containers is a valid zero-project state. A non-empty unsentinelled root is still never
adopted.

### Stable verifier and Agent identities

Verifier cleanup ownership is installation-scoped and restart-stable:
`verifier.<runtime-instance>.<128-bit persisted nonce>`. A separately persisted marker
distinguishes first boot/one-time upgrade from nonce loss; corruption, symlink/special
files, or deletion after establishment fail closed. Concurrent first starts converge
on one nonce, while different data roots remain distinct. Cleanup targets only the
exact owner label.

Persisted Agent workspaces are revalidated at startup and before execution against the
canonical configured workspace root and exact Agent-ID-derived path. Escapes,
cross-Agent substitutions, root/leaf symlinks, and durable Shepherd references during
Agent deletion are rejected.

### Problem-resolution records

**Persisted state initially proved shape, not truth.** Hostile V2 fixtures could label
evidence-free or weakly related records as verified/completed. The root cause was that
the first V2 loader validated DTO shapes and references but not completion proofs.
Strict semantic/lifecycle validation plus false-green fixtures now rejects invented,
substituted, incomplete, or cross-target evidence.

**A restart-unstable verifier owner could collide or leak cleanup scope.** A random
per-process fallback changed on every boot and a configured default could be shared by
unrelated installations. Persisted installation identity and exact-owner cleanup
remove both ambiguities.

**A persisted `reverifying` candidate was not proof that CAS had been attempted.** An
external move to the candidate SHA during re-verification could resemble a post-CAS
crash. The durable pre-CAS evidence marker makes the distinction explicit; recovery
accepts only `promoting` with the exact full suite. A kill immediately before CAS keeps
the trusted/protected head unchanged, while a kill immediately after a successful CAS
can be corroborated and adopted.

**Promotion failure could release the project fence.** The initial compensation marked
only the Candidate/Collision before generic failure handling terminalized the Mission
and cleared `activeMissionId`. The fixed atomic compensation preserves final evidence,
sets Candidate promotion failure plus Mission/Collision `attention_required`, and keeps
the project fenced. A synchronous regression proves a second Mission is rejected and
neither the stored trusted head nor externally moved Git head changes.

**Deleting only the database could orphan and then re-adopt an old repository.** The
empty state previously looked like first boot. Startup now rejects any established
managed project artifacts when no durable Project record exists; a hostile external
branch move remains untrusted.

**A live server could adopt an external head between Missions.** Startup reconciliation
runs once, while the fixture re-opener returns the repository's current branch head.
After a completed Mission, an external commit could therefore become the next Mission's
base without a restart. Mission preparation now re-derives the sentinel-backed project
identity and requires the protected ref, checked-out branch, HEAD, index, and worktree
to equal the durable trusted record before any new Mission, Plane, Agent, workspace, or
store mutation. A regression completes one Mission, commits externally, and proves a
second synchronous run is rejected with all durable counts and both heads unchanged.

**No-follow reads could still block on a FIFO.** Opening a FIFO read-only can block
before `fstat`. Adding `O_NONBLOCK` while retaining post-open regular-file and identity
checks makes database, verifier identity, sentinel, metadata, and policy reads reject
special files immediately.

**A real-Git winner-flip test retained a unit-test timeout.** An independent full-suite
run exceeded Vitest's five-second default while parallel real-Git tests were active;
the still-running test then raced teardown of a read-only snapshot. The production path
was not failing. That integration-style test now has the same 30-second ceiling as its
adjacent real-Git journeys. Two consecutive complete server-suite reruns passed after
the fix (31.31 s and 31.47 s) with no teardown failure.

### Phase 2 verification evidence

Real process tests send `SIGKILL` at five boundaries:

1. contract execution workspace ready;
2. contract verification snapshot ready;
3. complete promotion proof persisted immediately before CAS;
4. successful CAS complete before final database persistence; and
5. protected ref updated before protected index/worktree synchronization.

Each ordinary boundary is restarted twice and proves non-green durable state,
artifact cleanup, and cursor idempotence. The internal ref/index gap is rejected on
both restarts with the original trusted head preserved.

Commands and observed results:

```sh
TMPDIR="$PWD/.tmp/test-temp" npm run test -w @launchpad/server -- \
  src/database.test.ts src/shepherd/git-plane-promotion.integration.test.ts \
  src/shepherd/recovery.test.ts src/shepherd/recovery.process.test.ts \
  src/shepherd/service.test.ts
# 5 files / 111 tests passed

TMPDIR="$PWD/.tmp/test-temp" npm run check
# exit 0: both workspace type checks passed; server suite passed;
# web and server production builds passed

TMPDIR="$PWD/.tmp/test-temp" npm run test -w @launchpad/server -- \
  --reporter=json --outputFile="$PWD/.tmp/phase2-vitest.json"
# 21 files / 326 tests passed; 0 failed or pending

# repeated twice after stabilizing the real-Git test ceiling
# run 1: 21 files / 326 tests passed in 31.31 s
# run 2: 21 files / 326 tests passed in 31.47 s

npm audit
# found 0 vulnerabilities

terraform fmt -check -recursive deploy/volcengine
docker compose config --quiet
git diff --check
# all passed
```

A repository-local exact-value scan checked 150 tracked/ignored project files outside
`.env`, Git metadata, dependencies, builds, and test/browser scratch against the one
configured non-placeholder secret and found zero matching files. The global verifier
container label query returned zero containers after the suite.

The dedicated `security-reviewer` role was requested after stabilization but was not
available in this environment. A separate read-only fallback reviewer inspected the
complete Phase 2 trust boundary and ran a 5-file/111-test security slice, server
typecheck/build, production fault-seam scan, and whole-tree diff check. Its final
verdict was **no remaining critical, high, or medium findings**. Residual lows are:
directory entries are not explicitly fsynced after atomic rename (process-crash, not
sudden-power-loss, durability is tested); one server per data root is operationally
required; `RUNTIME_INSTANCE_ID` must remain stable for prior-owner container cleanup;
and test-only fault seams remain constructor-injectable but are absent from config,
API, and production composition.

**Phase verdict:** strict persistence, exact evidence proof, stable ownership,
sentinel-bound identity, five process-kill boundaries, idempotent reconciliation,
pre/post-CAS distinction, live-process protected-head fencing, secret scanning, and
the complete deterministic gate are verified for Phase 2.

## Phase 3 — Live Plane Runtime and Bounded Advisory Modules

**Date:** 2026-08-29 (Asia/Singapore)

**Branch:** `feature/shepherd-phase-3-live-runtime`

### Versioned execution envelopes and semantic authority

Contract and resolution work now receive bounded, JSON-escaped
`SHEPHERD_EXECUTION_ENVELOPE_V1` prompts assembled by trusted code. Prompts contain
logical IDs, the intersected authority, expected artifacts, dependency outputs, and
the exact strategy or objective; configured secret values are rejected before a
prompt can be returned. Contract Agents must write the one schema-validated
`.shepherd/result.json` ingestion artifact. Resolution Agents are explicitly forbidden
from writing any `.shepherd/**` path and are evaluated from the imported Git diff and
independent evidence instead.

Contract envelopes now include both the declared canonical claim keys and the
Contract's declared canonical semantic scopes. Manifest ingestion rejects an
undeclared scope, just as it already rejected an undeclared or omitted key. This
prevents independently correct Contracts from avoiding collision only because their
model-selected scope labels differ.

Resolution envelopes state the candidate's exact canonical key/value strategy and
forbid substituting a different value based on project policy. Prompt compliance is
not trusted: after the fixed candidate acceptance suite runs, server code derives the
verified `auth.transport` fact from its outputs and requires it to equal the
candidate's persisted target. A candidate whose checks pass for a substituted target
fails with `invalid_semantic_evidence` at
`candidate_target_corroboration`; it cannot tie, win, or promote.

### Isolated live Codex execution

`SHEPHERD_EXECUTION_MODE` now accepts `auto`, `live`, or `deterministic`. `auto`
selects live execution only when a usable Ark Agent-model configuration and the
container Runtime are both present. Explicit `live` fails closed if either condition
is absent, and live execution additionally requires `CODEX_SANDBOX_MODE=workspace-write`.
The resolved mode is exposed by system/demo metadata so a deterministic run cannot be
presented as live-model evidence.

Each Contract or candidate execution uses a fresh Git-free export, a unique opaque
execution identity, a new private `0700` `CODEX_HOME`, and one disposable container.
The exact in-container Codex shape is:

```text
codex exec --ephemeral --json --sandbox workspace-write \
  --skip-git-repo-check -C /workspace -
```

The complete prompt is sent only on standard input. No thread is resumed. The Runtime
container is created first and then started/attached by the validated immutable
container ID, avoiding name-retargeting between creation and attachment. The
container runs non-root with a read-only root filesystem, a dedicated `/tmp` tmpfs,
all capabilities dropped, `no-new-privileges`, and configured CPU, memory, and PID
limits. Only the Git-free workspace and that execution's private home are mounted.

The outer container uses bridge networking because the Codex control process must
reach Ark. The generated Codex config gives model-authored shell processes a fixed,
key-free environment. Startup preflight, without an Ark credential, requires the
exact pinned `codex-cli 0.111.0`, proves a sandboxed write succeeds in `/workspace`,
proves a write to `/codex-home` is denied, and proves sandboxed TCP listen and connect
attempts are denied. This is distinct from the independent acceptance verifier, which
continues to run with no network and no model credential at all.

Private-home roots use an exact sentinel and refuse non-empty unsentinelled adoption.
Runtime containers carry the restart-stable installation owner labels introduced in
Phase 2. Startup reconciliation removes only exact-owner interrupted containers,
private homes, and preflight workspaces; normal completion and timeout/cancellation
paths also verify cleanup.

Codex thread IDs exist only long enough to validate that exactly one fresh session was
created. Shepherd persists only a SHA-256 fingerprint and rejects fingerprint reuse
across Plane executions. Public state and Mission DTOs omit that fingerprint and
expose only `runtimeSessionEstablished: boolean`. Raw session IDs, raw prompts, and
prompt-envelope text are not persisted or returned.

### Implemented modules not yet connected to Mission orchestration

Three Phase 3 modules are implemented with focused deterministic tests, but are not
yet invoked by `ShepherdService` or exposed by the current HTTP/UI surfaces:

- The DAG scheduler validates the duplicate/unknown/self/cyclic dependency cases and
  selects a stable maximal batch subject to verified dependencies, failed-dependency
  blocking, one active assignment per Agent, the mutation lock, and configured Plane
  capacity.
- Project Group routing normalizes and bounds input, routes unmentioned text to
  Shepherd, resolves one leading Agent name/ID mention, supports JSON-quoted names,
  and rejects malformed, ambiguous, unknown, or multiple mentions. It interprets no
  paths or commands.
- `ArkModelReviewer` is an advisory-only Responses client. It canonicalizes and caps
  input at 48 KiB, performs at most one HTTPS request with redirects rejected,
  `store:false`, no tools, no prior-response chain, and a strict structured-output
  schema. It caps streamed response bytes at 128 KiB, output tokens at 1,536,
  findings at eight, evidence references at six per finding, and its deadline at
  120 seconds (30-second default). All provider/configuration/timeout/schema/storage
  failures return an explicit typed degraded result; no result grants authority or
  changes deterministic collision/selection. The current service does not yet call
  this adapter or emit its `model_review_degraded` event.

### Live-gate corrective episodes

The opt-in gate uses the configured Agent model only for this explicit evidence path:

```sh
npm run test:shepherd:live
```

It is single-worker, has no test retries, and creates fresh Mission state inside the
sentinel-guarded repository-local live-gate root. Four failed gate episodes were
preserved as causal evidence before the final pass:

1. **Two sessions, no semantic collision.** Both contract executions and their
   independent checks passed, but one model used a file-oriented scope while the
   other used a conceptual scope, so the exact-scope collision predicate found zero
   collisions. Root cause: semantic scopes existed on the Contract but were absent
   from the prompt and were not checked during manifest ingestion. Supplying the
   canonical declared scope and rejecting undeclared scopes fixed the contract.
2. **Four sessions, objective tie.** The collision then appeared and both candidates
   ran, but the bearer-target candidate substituted the policy-preferred cookie
   implementation. Its independent checks passed the cookie implementation, as did
   the actual cookie candidate, so the deterministic selector correctly stopped in
   `attention_required` with `objective_tie`. Root cause: the prompt did not make
   speculative target fidelity sufficiently explicit and trusted selection checked
   acceptance success without corroborating the implemented value against the
   candidate target. The exact-target rules and trusted target corroboration above
   close both gaps.
3. **Completed Mission, outdated all-pass assertion.** After those product fixes, the
   Mission completed with the secure cookie candidate selected and the bearer
   alternative objectively rejected by the project-security check. The gate itself
   still expected every candidate's verification to pass. The assertion was corrected
   to require the evidence-derived bearer failure and cookie promotion; no production
   behavior changed for this harness-only failure.
4. **Completed Mission, missing test import.** The next product Mission again
   completed, after which the test referenced a fixture transport constant it had not
   imported. The missing test-only import was added; no production behavior changed.

The final gate then passed in **121.49 seconds**. It completed two fresh Missions with
eight total live Codex sessions: two Contract and two resolution sessions per Mission.
Both Missions persisted two verified Contracts, one resolved semantic collision, the
bearer candidate rejected by independent acceptance, the cookie candidate selected
and promoted, and 33 bounded events. All eight persisted session fingerprints were
present, valid, and unique; no raw session ID was stored or exposed. Both resolution
Planes shared their Mission's exact immutable integration base.

The gate also proved the protected repository HEAD equals the promoted result,
`.shepherd/**` is absent from the promoted tree, and no prompt-envelope marker or
configured secret appears in persisted state, reachable Git blobs, or managed
worktree files. Exact-owner queries found no remaining live-Runtime or verifier
containers, and every per-execution private home and Git-free execution export was
gone after cleanup.

### Security review and verification evidence

The independent Phase 3 live-Runtime review identified four Medium findings during
implementation: unsafe private-root adoption, an incomplete sandbox preflight, raw
Runtime error/secret propagation, and a cleanup rejection race. Sentinel-only
adoption, the positive/negative filesystem plus socket probes, bounded redacted
Runtime errors, and immediately handled/awaited cleanup failures closed them. The
reviewer's final 58-test focused slice reported no remaining critical, high, or
medium finding at the live-Runtime boundary.

The independent model-reviewer review later found two Medium stream-handling issues:

- **M1:** a hostile asynchronous `reader.cancel()` rejection could surface as an
  unhandled rejection. Every fire-and-forget cancellation now attaches a rejection
  handler, with an exact regression.
- **M2:** an endless stream of zero-byte chunks could make no byte progress and starve
  the intended deadline path. Zero-byte chunks are now rejected immediately as an
  invalid response, with an exact regression.

The same reviewer re-inspected both fixes and reported both Mediums closed, no new
critical/high/medium findings, and a **PASS** merge gate. Its fake-only focused suite
passed **121/121**; the review made no network call and did not read `.env`.

A final independent security delta review then covered the canonical-scope and
candidate-target changes together with the live-gate scanner and Ark adapter. Its
focused suite passed **174 tests with the opt-in live test skipped**, its diff check
passed, and it reported **no critical, high, or medium finding**. It made no network
call and did not read `.env` or credentials. Residual lows are recorded explicitly:
the generic manifest-ingestion API treats an omitted declared-scope list as
unrestricted, although every production service call supplies a non-empty list; the
live gate scans current/reachable Git blobs and managed worktrees rather than dangling
Git objects; and the Ark reviewer requires a trusted HTTPS endpoint configuration but
does not pin a hostname.

The first final repository check exposed one test-harness concurrency flake: an
executor test used a 15 ms sleep as a proxy for proving two Contract executions had
overlapped. Under full-suite scheduling, the first execution could finish before the
second arrived even though production still dispatched them concurrently. The test
now uses a deterministic two-arrival barrier and still records the maximum active
executions. Its focused service suite passed **12/12** after the correction.

Final commands and observed results:

```sh
npm_config_cache="$PWD/.tmp/npm-cache" \
  TMPDIR="$PWD/.tmp/test-temp" npm run check
# exit 0: both workspace type checks passed
# 26 test files passed, 1 opt-in live file skipped
# 520 tests passed, 1 opt-in live test skipped
# web and server production builds passed

npm run build -w @launchpad/server
# passed on a separate rerun
```

The final exact-owner container query returned no container. The two-Mission live
gate above is separate opt-in evidence; its PASS is not presented as proof of
unrelated UI or Phase 4 behavior.

**Phase 3 scope verdict:** isolated live Contract/candidate execution and the fixed
demo Mission are proven across two fresh end-to-end Missions. Scheduler, Project
Group parser, and Ark advisory-reviewer modules exist and are focused-test-backed, but
their service/API integration remains Phase 4 work and is not claimed here.

## RST-01 — Idempotent and Serialized Demo Reset

**Date:** 2026-08-29 (Asia/Singapore)

**Branch:** `fix/7-rst-01-idempotent-reset`

**Draft PR:** [#10](https://github.com/kyashp/shepherd/pull/10)

**Reviewed implementation commit:** `19a2e45f7a67c575d9acced3dfcfbc6a32f5718e`

### Root cause and correction

`resetDeterministicDemo()` classified a missing durable `auth-demo` project as
`not_found`, although a missing project is the expected state before the first demo
Mission. The initial empty-result correction then exposed a check-without-reserve
race: reset checked `activeProjects` but did not claim `auth-demo` across its later
asynchronous validation and cleanup work.

The scoped correction:

- returns a deliberate path-free empty success with `restoredHead: null` and zero
  removal counts when the durable project is absent;
- creates no Mission, Agent, repository, worktree, or fixture merely to reset;
- still calls `assertNoManagedProjectState()` so the empty path fails closed on
  orphaned, symlinked, or unknown managed-root artifacts;
- synchronously reserves `auth-demo` before the first reset await and releases it in
  `finally`, serializing both clean and initialized resets against Mission startup;
- leaves initialized trusted-identity checks, guarded Git/Plane cleanup, unrelated
  data preservation, cursor high-water preservation, and partial-reset recovery
  intact.

### TDD and verification evidence

Original clean-start RED:

```sh
npm test -w @launchpad/server -- src/shepherd/service.test.ts src/app.test.ts \
  -t "returns the same empty result|returns an authenticated empty demo reset"
# 2 failed as intended: service rejected "Auth demo was not found";
# authenticated API returned 404 instead of 200
```

Concurrency RED and GREEN:

```sh
npm test -w @launchpad/server -- src/shepherd/service.test.ts \
  -t "reserves .* demo reset against a concurrent Mission start"
# RED: 2 failed; clean start reached the executor and initialized reset lost the race
# GREEN after reservation: 2 passed, 21 skipped
```

Additional observed results:

- reset-focused service/API selection: **8 passed, 34 skipped**;
- adjacent persistence/recovery suites: **100 passed**;
- complete Shepherd service suite: **23 passed**;
- complete server suite with one worker: **25 files passed, 2 skipped; 547 tests
  passed, 2 skipped**;
- `npm run check` under Node 24.17.0/npm 11.17.0 with Vitest externally constrained
  to one worker: both workspace typechecks, the same complete server suite, and both
  production builds passed;
- `npm audit --json`: **0 vulnerabilities across 251 dependencies**;
- `git diff --check`: passed.

Three unconstrained `npm run check` attempts after the concurrency correction hit
different existing fixed 1-second/5-second timeouts in Git-heavy service, recovery,
and Plane integration tests. Every affected test passed isolated, and the complete
suite passed serialized without weakening assertions. This is recorded as `TST-01`
in `HANDOVER.md`; no unrelated timeout or test behavior changed in PR #10.

### Current-main integration verification

After OPS-05 merged through PR #32 at
`8110aa3ed49bd0586cbb275d7c4067552cd9a144`, only `origin/main` was merged into
the RST-01 branch. Merge commit
`4673edfff0d6a205b48ca4d90821ce852a9952e4` had conflicts only in this file and
`docs/HANDOVER.md`; resolution preserved current-main evidence and reapplied only
RST-01-specific entries. The effective diff against `origin/main` remained limited
to the three reset implementation/test files and these two evidence files.

Fresh results observed on that integrated commit:

- reset-focused service/API selection: **2 files passed; 8 tests passed, 39
  skipped**;
- complete `service.test.ts`: **28/28 passed**;
- complete `app.test.ts`: **19/19 passed**;
- `npm run typecheck`: both workspace typechecks passed;
- `npm run build`: web and server production builds passed;
- literal `npm run check` with no worker or timeout override: launcher tests
  **3/3 passed**; server **25 files passed, 2 skipped; 554 tests passed, 2
  skipped**; both production builds passed;
- `npm audit --json`: **0 vulnerabilities across 251 dependencies**;
- `git diff --check origin/main...HEAD`: passed; worktree status was clean.

Browser evidence is not applicable to this service/API-only correction. No UI
source, layout, interaction, or response consumer changed; the authenticated
reset route is exercised through the real Fastify injection boundary in
`app.test.ts`.

### Independent review and remaining gates

An independent read-only security/correctness review found the reset/start race.
After causal regressions and the reservation fix, its follow-up reported no Critical,
Important, or Minor finding and marked the implementation ready to merge.

GitHub reported the draft PR open and mergeable at this checkpoint, but with no
automated status checks. `CI-01` tracks required pull-request automation separately.
The remaining RST-01 work is lifecycle evidence: an independent review of the
latest integrated diff, the final literal check/push gate, required/merge-group
checks when available, clean and initialized reset verification on updated `main`,
issue closure, and a merged-SHA ledger update. None requires another scoped
product-code change on this branch.

## Test-lifecycle stabilization candidate (`#11`)

**Date:** 2026-08-29 (Asia/Singapore)
**Candidate branch/commits:** `fix/11-shepherd-test-flake-clean` /
`de986b9a3ecdd1e1360050209742497f8c6b2813`, `f2db22c`
**Draft PR:** [#19](https://github.com/kyashp/shepherd/pull/19)

The generic five-second Vitest budget was exceeded by three real service journeys
and measured Git/recovery integration journeys under full-suite contention. A timed
out background-Mission test could also race fixture cleanup; raw recursive cleanup
could not remove a deliberately read-only trusted-verification snapshot.

The candidate adds only test lifecycle changes. Service fixtures now require an
exact sentinel, restore write permission only after validating the allocated path,
and skip symlinks. Causal RED checks observed `EACCES` on a `0400` file beneath a
`0500` snapshot and, under a temporary unsafe symlink mutation, an external marker
became unreadable. Restored GREEN checks prove the fixture is removed while the
external marker and permissions survive. Background test Missions cancel and join via
the existing `cancelMission()` behavior before cleanup. Six measured
integration cases declare 15-second budgets; global defaults stay unchanged.

The contamination route was also causal: `runFixtureGit()` spread `process.env`, so
an inherited `GIT_DIR` could override `git -C` and route a fixture commit elsewhere.
The helper now gives Git a fixed environment (path/locale plus non-interactive,
system/global-config-disabled settings). Its regression creates only disposable
fixture and decoy repositories, poisons `GIT_DIR` with the decoy, and proves the
fixture advances while the decoy's HEAD and tracked file remain unchanged. The RED
against the old inherited environment left the fixture HEAD unchanged; the restored
implementation is GREEN.

Observed verification:

```sh
# target-substitution regression: 5 consecutive passes (2.51–3.59 s)
npm run check
# pass twice: 25 files passed, 2 opt-in skipped; 547 tests passed, 2 skipped;
# web and server production builds passed
git diff --check
# passed
```

The initial PR #18 was closed as contaminated: the documented defective pre-push hook
created commit `9d252957` and tracked `external-move.txt` before the intended fix.
The clean candidate contains only the causal test files. The demonstrated recovery
fixture route is fixed; the pre-push hook itself remains separate infrastructure work,
so manual verification is required before using `ECC_SKIP_PREPUSH=1` for a scoped
push.

### Resolved-base verification

The clean candidate was resolved against current `main` at
`2f7a9fd8122cb62f2f2ed4e2b08cc87f311e8887`. On that exact resolved head,
`npm run check` passed: 25 files passed, 548 tests passed, 2 opt-in tests skipped,
and both production builds completed. A subsequent teardown-only audit identified a
test-lifecycle follow-up; its final commit and verification are recorded separately
once that bounded correction is complete.

### Teardown follow-up evidence

Commit `d8c4dff7e6a6c3b1597e56c8b493e436a4f227c2` is test-only. It retains tracked
Missions until cancellation and background-run joining succeed, treats
`attention_required` as cancellable, and releases both blocked promotion checkpoints
in `finally` paths. The promotion verifier release is idempotent. Its causal RED
timed out safely against the prior blocked verifier (the test's `finally` released
the fixture); GREEN focused coverage passed the four promotion/attention teardown
paths, and the full `service.test.ts` file passed 25/25.

The first repository `npm run check` on `d8c4dff` was **not green**: the unmodified
Git-plane integration test `reports a real textual merge conflict and leaves the
integration Plane clean` timed out at Vitest's five-second default. The observed
test phase had 24 files passed, 1 failed, 2 skipped; 549 tests passed, 1 failed, 2
skipped. This follow-up did not broaden into that separately owned timeout; its
production builds therefore did not run after the failing test phase.

That Git-plane test is also an owned #11 real-Git integration case. Commit
`0e0e743` gives only that test a 15-second Vitest budget. It passed five consecutive
focused runs (1.23–1.90 s) and the complete Git-plane integration file passed 19/19.
A subsequent full gate exposed a distinct RED: the background real-Planes service
journey has a 30-second test budget but its shared completion helper stopped at 15
seconds. Commit `a14c3f7` makes that helper accept an optional timeout and passes
25 seconds only to this measured journey; it does not add another Vitest budget.
The journey passed five consecutive focused runs (4.27–6.33 s) and the complete
service test file passed 25/25.

On final head `a14c3f71446ff5c46a84db6482fc445e9d1944d9`, `npm run check` passed:
25 files passed, 550 tests passed, 2 opt-in tests skipped, and both production
builds completed. Six measured integration cases now have explicit 15-second
Vitest budgets; the one 25-second internal completion wait remains confined to the
already-30-second background real-Planes test.
