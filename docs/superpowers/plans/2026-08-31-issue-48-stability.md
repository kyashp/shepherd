# Issue 48 Stability Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for each behavior change and `superpowers:verification-before-completion` before commits, pushes, pull-request updates, or completion claims. Execute the tasks in order and keep every observed command result in the issue evidence packet.

**Goal:** Remove the reproduced sources of suite instability, recheck the previously recorded service rows without weakening them, and produce a trustworthy five-run `npm run check` campaign for GitHub issue #48.

**Architecture:** Keep the fixes at their causal boundaries. Fixture Git commands receive a deliberately curated child-process environment so an enclosing hook cannot redirect them. Verification-snapshot tests synchronize through the service's existing fault-checkpoint seam after the owned snapshot has been removed, rather than consuming OS file watchers. Scheduler overlap is proven directly at the shared bounded-batch primitive instead of through a full Git-backed Mission. The candidate-cleanup fixture establishes the executor's shared private root through its public preflight before concurrent runs, isolating the cleanup phase that the test claims to exercise. No product behavior, public API, UI, dependency, retry count, assertion strength, or timeout changes.

**Tech stack:** TypeScript, Node.js, npm workspaces, Vitest 4, Git, GitHub Actions.

**Spec:** GitHub issue #48; `docs/PRD.md` section 16, Phase 9B; `docs/TASKS.md` row `STABILITY`.

## Progress

- [x] Task 1: Isolate fixture Git commands from enclosing hook state.
- [x] Task 2: Replace snapshot-removal file watchers with a lifecycle checkpoint.
- [x] Task 3: Recheck and causally isolate the historically sensitive service rows.
- [x] Task 4: Run adjacent and full server verification on the revised candidate.
- [x] Task 5: Commit the causal fixes and open the linked draft pull request.
- [ ] Task 6: Run the formal five-consecutive-check campaign.
- [ ] Task 7: Independent readiness review.

## Global constraints

- Work only in `/Users/sanje/code/shepherd/.tmp/worktrees/issue-48-stability` on `test/48-stability-campaign`, based on `origin/main@9f8579370247410a5e85df57bb4b6fe219e675b7`.
- The issue is assigned to `sanjey99`; ownership is recorded in issue comment `#issuecomment-5472521900`; the branch is already published to `origin`.
- Recheck issue #48, open pull requests, remote branches, and worktrees before each new file-ownership expansion. Stop if another active owner claims an overlapping file.
- Keep the accepted UI frozen. This plan does not modify web code or visual evidence.
- Do not alter production timeouts, Vitest timeouts, retry counts, suite concurrency, assertions, or skip lists. A green result obtained through those mechanisms is invalid for #48.
- Keep default tests network- and model-free. Never print credentials, prompts, session identifiers, private environment values, or unbounded logs.
- Preserve the current `test.each` coverage for both policy values and both F-03 failure variants.
- Treat the five-run sequence as formal evidence only when every run uses the same commit and current `origin/main`. If either SHA changes, restart the sequence from run 1.
- Do not merge the branch. Integration and the post-merge gate belong to the integrator.

---

## Task 1: Isolate fixture Git commands from enclosing hook state

**Files:**

- Modify: `apps/server/src/shepherd/general-project.test.ts`
- Reference only: `apps/server/src/shepherd/recovery.test.ts`

### Step 1: Preserve the deterministic RED evidence

The pre-implementation reproduction has already been observed on the unchanged branch:

- `general-project.test.ts` alone: 8/8 passed.
- Full server suite in a normal shell: 843 passed, 3 skipped.
- The same policy-interruption row under inherited outer `GIT_DIR` and `GIT_WORK_TREE`: 1/1 failed and staged `policy.json` in the enclosing Shepherd repository.

Record this exact contrast in `docs/BUILD_LOG.md`; do not manufacture a second enclosing repository mutation merely to repeat RED.

### Step 2: Add a hostile-environment regression test first

Import `vi` from Vitest and add `vi.unstubAllEnvs()` to the existing teardown path. Add one focused test modeled on the poisoned-Git-selector regression in `recovery.test.ts`:

1. Create a managed project fixture and a separate decoy Git repository inside the test-owned temporary directory.
2. Point inherited `GIT_DIR` and `GIT_WORK_TREE` at the decoy with `vi.stubEnv`.
3. Ask the fixture helper for the managed repository's top level and stage a fixture-owned file.
4. Assert that the returned top level is the real path of the selected managed repository.
5. Assert that the selected repository contains the expected staged path and the decoy repository remains clean.

Run:

```bash
npx vitest run apps/server/src/shepherd/general-project.test.ts
```

Expected RED: the current raw `execFile("git", ...)` helper follows the inherited selector variables, so repository identity or staging ownership is wrong.

### Step 3: Add one curated fixture Git helper

Replace direct uses of the promisified raw Git executor with a local helper whose public shape is:

```ts
async function runFixtureGit(
  repositoryPath: string,
  args: readonly string[],
): Promise<string>
```

Invoke Git as `git -C <repositoryPath> ...args` with a bounded buffer and timeout. Pass a new environment object containing only the process values the child needs:

- `PATH`
- `HOME=/nonexistent`
- `LANG=C`
- `LC_ALL=C`
- `GIT_CONFIG_NOSYSTEM=1`
- `GIT_CONFIG_GLOBAL=/dev/null`
- `GIT_TERMINAL_PROMPT=0`

Do not spread `process.env`; omitting `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, and related selector state is the security and isolation boundary. Return trimmed stdout and allow command failures to retain their normal diagnostics.

### Step 4: Assert nested repository identity before destructive fixture operations

Add a small assertion helper that compares:

```ts
await realpath(repositoryPath)
```

with the resolved result of:

```bash
git -C <repositoryPath> rev-parse --show-toplevel
```

Call it before the policy interruption tests stage or commit fixture paths. A mismatch must fail before Git mutates any index. Keep the existing assertions that prove the interrupted write is cleaned before its commit.

### Step 5: Turn the focused test GREEN

Run:

```bash
npx vitest run apps/server/src/shepherd/general-project.test.ts
npm run typecheck -w @launchpad/server
git diff --check
```

Expected GREEN: all general-project rows pass, including the hostile-selector regression, and the enclosing Shepherd repository remains clean.

---

## Task 2: Replace snapshot-removal file watchers with a lifecycle checkpoint

**Files:**

- Modify: `apps/server/src/shepherd/service.ts`
- Modify: `apps/server/src/shepherd/service.test.ts`

### Step 1: Write checkpoint-driven F-03 tests before production code

Remove `watch` from the `node:fs/promises` imports and remove `waitForOwnedPathRemoval`. Extend the two test verifiers' sibling-capture promise values from a bare path to:

```ts
{
  contractId: string;
  snapshotPath: string;
}
```

For each F-03 test, create one promise before constructing the service. Its `faultCheckpoint` observer resolves only when all three conditions hold:

- the checkpoint is `contract_verification_snapshot_removed`;
- the checkpoint context belongs to the current Mission;
- the checkpoint context contract ID equals the captured sibling contract ID.

Keep the existing sequence: observe the primary failure, capture the blocked sibling, release the sibling verifier, await its return, await the exact cleanup checkpoint, then assert the sibling snapshot path returns `ENOENT`. The promise replaces only watcher-based observation; it does not replace the filesystem assertion.

Run:

```bash
npx vitest run apps/server/src/shepherd/service.test.ts -t "removes the sibling verification snapshot after F-03"
npm run typecheck -w @launchpad/server
```

Expected RED: the new checkpoint literal is not yet part of the service contract and no production path emits it.

### Step 2: Extend the existing checkpoint type

In `service.ts`, add:

```ts
"contract_verification_snapshot_removed"
```

to `ShepherdFaultCheckpoint`. Do not add a new event bus, public response field, or runtime dependency; the existing optional `faultCheckpoint` test seam is sufficient.

### Step 3: Emit the checkpoint only after owned cleanup settles

Wrap the existing `planeManager.withVerificationSnapshot(...)` call in a local async function with `try/finally`. In the `finally` block, await:

```ts
this.checkpoint("contract_verification_snapshot_removed", {
  missionId: mission.id,
  contractId: contract.id,
});
```

The checkpoint belongs after `withVerificationSnapshot` settles because `PlaneManager` removes the snapshot in its own `finally`. Preserve the verifier result and exception unchanged. Use the same scoped IDs already passed to `contract_verification_snapshot_ready`.

If the optional checkpoint observer itself throws while a verifier exception is already active, preserve the verifier exception as the primary failure and attach the observer failure only through the repository's existing diagnostic mechanism; a test seam must not mask product behavior.

### Step 4: Turn the F-03 tests GREEN without watchers

Run the focused command five separate times, followed by adjacent verification tests:

```bash
npx vitest run apps/server/src/shepherd/service.test.ts -t "removes the sibling verification snapshot after F-03"
npx vitest run apps/server/src/shepherd/service.test.ts -t "contract verification snapshot"
npm run typecheck -w @launchpad/server
git diff --check
```

Expected GREEN: both F-03 variants pass without `fs.watch`, the snapshot-removal assertions remain intact, and no `EMFILE` or unhandled-rejection warning appears.

---

## Task 3: Recheck the two historically sensitive service rows

**Files:**

- Inspect first: `apps/server/src/shepherd/service.test.ts`
- Modify only after a deterministic RED demonstrates a causal defect: `apps/server/src/shepherd/service.test.ts`, `apps/server/src/shepherd/service.ts`

### Step 1: Run each row repeatedly on the fixed branch

Run the PERF-01 overlap row and attention-required fixture-cleanup row five separate times each:

```bash
npx vitest run apps/server/src/shepherd/service.test.ts -t "PERF-01 proves real scheduled candidate executor intervals overlap before release"
npx vitest run apps/server/src/shepherd/service.test.ts -t "cancels tracked attention-required Missions before fixture cleanup"
```

Record every result. Passing repeated focused runs establishes that the previously logged failures do not currently justify unrelated edits.

### Step 2: Apply only a demonstrated causal synchronization fix

PERF-01 did fail during formal campaign run 4 after five focused passes and three complete green campaign runs. The service row timed out at 5.176 seconds while 843 peer server tests passed. A deferred start barrier alone retained the original full-Mission completion assertions but still timed out under a fresh full-suite run at 6.229 seconds. Disabling auto-resolution and awaiting exact candidate completion/attention also remained over budget at 6.038 seconds. These RED results prove that a Git-backed Mission lifecycle cannot be the timing harness for a five-second scheduler-overlap assertion under representative suite pressure.

Move the existing production `allSettledBounded` primitive from `service.ts` to the canonical `scheduler.ts` module without changing its implementation or callers. Replace the expensive service-level PERF row with a scheduler-boundary test in `scheduler.test.ts` that:

1. passes two distinct candidate IDs to the same exported bounded batch primitive used by `ShepherdService`;
2. dispatches each item through a test executor with promise barriers for both-started, release, and both-completed;
3. asserts two start timestamps exist while completion remains empty before release;
4. releases both operations, awaits the real batch result, and asserts two fulfilled results plus two completion timestamps;
5. proves the latest start timestamp is no later than the earliest completion timestamp;
6. retains a separate limit-one assertion so the moved primitive still enforces its concurrency cap and input-order result contract.

Remove the service-test-only `CandidateExecutionIntervalExecutor` and its full-Mission PERF row after the scheduler-boundary RED/GREEN test exists. This isolates the performance contract rather than reducing it: the exact start-before-release/completion-after-release assertions move intact to the production scheduling primitive, while the adjacent 30-second real-Planes tests continue to prove completed Mission, selected/promoted candidate, and `promotion_completed` behavior. Do not extend any timeout or change suite concurrency.

If attention-required cleanup fails, add a test-owned lifecycle barrier at the exact point the tracked Mission finishes cancellation and await that barrier before fixture removal. Preserve the terminal-state and cleanup assertions; do not add retries or sleeps.

After either demonstrated fix, rerun the failing row five separate times and run all adjacent lifecycle tests. If neither row fails, leave their code unchanged.

---

## Task 4: Run adjacent and full server verification

**Files:** none unless a new deterministic defect is exposed.

### Step 1: Verify the complete server suite

Run:

```bash
npm test -w @launchpad/server
npm run typecheck -w @launchpad/server
git diff --check
git status --short
```

Expected GREEN: 843 or more passing server tests, only the three documented skips, zero unhandled-rejection warnings, and no unowned files or staged fixture artifacts.

### Step 2: Review the causal diff

Inspect the complete diff and confirm:

- no timeout, retry, concurrency, skip, or assertion weakening;
- no UI or dependency changes;
- fixture Git selectors cannot escape the fixture repository;
- the removal checkpoint is emitted after cleanup and cannot alter normal production behavior;
- all temporary repositories and snapshots remain test-owned.

Run `npm audit` and record the observed result before committing.

### Step 3: Isolate candidate cleanup from first-use root adoption

The normal pre-push server gate exposed one more representative-load failure in
`keeps candidate cleanup failures bounded and prevents promotion`: all candidates
were failed and promotion remained blocked, but none retained the expected
sanitized Runtime cleanup message. The row passed alone, indicating a scheduling
race rather than a deterministic assertion mismatch.

The live executor prepares and validates one shared private-home root inside every
candidate `run()`. This routed fixture bypassed the production executor recovery /
startup path, so concurrent first-use candidates could race sentinel adoption and
fail before `runner.run` registered their private homes as cleanup-fault targets.
Initialize that shared boundary through the executor's public `preflight()` before
candidate scheduling and assert exactly one preflight occurred. Do not change
sentinel production code, cleanup injection, failure assertions, or the test
timeout.

Preserve the observed RED/GREEN evidence:

- RED: the new preflight-count invariant observed `0` before fixture initialization.
- GREEN: the exact row 10/10, the executor file 72/72, production and test
  typechecks, and the full server suite with 845 passed / 3 skipped.

---

## Task 5: Commit the causal fixes and open the linked draft pull request

**Files:** the Task 1 and Task 2 files plus this plan.

### Step 1: Commit the implementation packet

Use the repository commit format with subject:

```text
test: harden stability campaign fixtures
```

The body must summarize both root causes and list the focused checks actually observed. Push without bypassing hooks. The normal pre-push hook must pass with the new Git-environment isolation; do not use `--no-verify` for this implementation push.

### Step 2: Open a draft PR against `main`

The draft PR must include:

- `Relates #48` and TASKS ID `STABILITY`;
- PRD section 16 / Phase 9B;
- owned files and explicit exclusion of UI/product feature work;
- base `main` and exact branch SHA;
- the two root causes and why the fixes are causal;
- acceptance criteria and the five-run test plan;
- current focused/full checks, with the formal five-run campaign still pending.

Post the PR URL and current SHA to issue #48. Do not mark the issue complete at this stage.

---

## Task 6: Run the formal five-consecutive-check campaign

**Files:**

- Modify after the campaign: `docs/BUILD_LOG.md`
- Modify after the campaign: `docs/FIXES.md`
- Modify after the campaign: `docs/TASKS.md`

### Step 1: Freeze and record the candidate identity

Fetch and prune. Record:

```bash
git rev-parse HEAD
git rev-parse origin/main
git status --short
```

Confirm the worktree is clean and no overlapping PR has appeared. The branch SHA and `origin/main` SHA become the campaign identity.

### Step 2: Run the exact full gate five times

Run this command five separate times, without edits, commits, dependency changes, Docker state changes, or branch changes between runs:

```bash
npm run check
```

For each run, record start/end time, duration, server pass/skip counts, web pass count, build result, warnings, branch SHA, and `origin/main` SHA. Any failure or SHA change resets the count to zero after the causal issue is resolved.

### Step 3: Record bounded evidence

Add `FIXES` entries for:

- fixture Git environment isolation under enclosing hooks;
- deterministic verification-snapshot cleanup observation without OS watchers.

Add a bounded `BUILD_LOG` campaign table for runs 1–5. Update the `STABILITY` row in `TASKS` with branch evidence and distinguish candidate coverage from post-integration status. Do not claim the issue integrated or closeable until the branch is merged and the required updated-`main` gate is observed.

### Step 4: Commit and push the evidence packet

Use subject:

```text
docs: record issue 48 stability evidence
```

Run `git diff --check`, the relevant documentation checks, and the normal pre-push hook. Update the draft PR with the exact run table and candidate SHA.

---

## Task 7: Independent readiness review

**Files:** review-only unless a finding requires a causal correction.

Ask the selected quality specialist for a critical review of the final branch against issue #48 and Phase 9B. The review must check:

- correctness and failure preservation in both fixes;
- absence of masking tactics;
- adequacy of regression coverage;
- exact-SHA integrity of the five-run campaign;
- accuracy of `TASKS`, `FIXES`, `BUILD_LOG`, the draft PR, and issue evidence;
- remaining integration and post-merge gates.

Address every critical/high finding with TDD, rerun the affected gates, and restart the five-run sequence if the candidate SHA changes. Leave the draft PR ready for integrator review; do not merge it or close #48 yourself.
