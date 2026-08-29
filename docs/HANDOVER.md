# Shepherd Engineering Handover

**Date:** 2026-08-29 (Asia/Singapore)

**Track:** TikTok TechJam 2026, Track 1 — Agent Launchpad middleware

**Assessed branch:** `main`

**Assessed implementation checkpoint:** `6c1a948c52b8c6b8107ffcc87e63a1352e62481a`
(`chore(docs): add techjam brief docs`)

**Active stacked UI delta:** [draft PR #17](https://github.com/kyashp/shepherd/pull/17)
contains the minimal viewport/layout corrections described below at commit
`1406b7e38cea03390878f5b6b775c41fd27776d1`. This documentation branch is a
child of PR #17 and must merge after its parent. Neither the UI changes nor this
evidence update is part of `main` yet.

**Active reviewed reset delta:** `RST-01` is implemented at
`19a2e45f7a67c575d9acced3dfcfbc6a32f5718e` on
[`fix/7-rst-01-idempotent-reset` draft PR #10](https://github.com/kyashp/shepherd/pull/10).
The issue and PR remain open; this fix is not yet part of `main`.

**Repository observation:** the working tree was clean before this documentation
update, and local `main` matched `origin/main` at the assessed checkpoint. The
historical `feature/shepherd-phase-*` branches do not by themselves claim current
work.

**Product verdict:** incomplete. The deterministic backend hero chain works at the
assessed checkpoint, but known defects, unimplemented PRD behavior, browser gates,
security/UI review, repeated stability, and final deliverables remain.

## 1. Read this first

This file is the required entry point for every human or coding agent. It is a
truthful checkpoint, not a Definition-of-Done claim for `docs/PRD.md`.

### Document authority and navigation

Use documents in this order:

1. **[`docs/PRD.md`](PRD.md)** — authoritative required product behavior and
   Definition of Done. No handover task may silently narrow it.
2. **This file** — authoritative current implementation status, defects, test gaps,
   task IDs, confidence, runbook, and multi-agent GitHub workflow at the assessed
   checkpoint.
3. **[`docs/DEVIATIONS.md`](DEVIATIONS.md)** — accepted interpretations only. A
   deviation is not proof that its code exists or works.
4. **[`docs/SHEPHERD.md`](SHEPHERD.md)** — as-built design, model/deterministic
   responsibilities, and trust boundaries. It no longer owns current status.
5. **[`docs/BUILD_LOG.md`](BUILD_LOG.md)** — historical executed evidence tied to
   the phase, branch, and commit named in each entry. Older green evidence is not
   automatically current evidence.
6. **[`docs/UI.jpeg`](UI.jpeg)** and `docs/ui-review/` — visual reference and
   screenshot evidence. Source code or a production build is not rendered proof.
7. **[`README.md`](../README.md), [`docs/LOCAL_POC.md`](LOCAL_POC.md), and
   [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)** — Starter Kit setup/baseline
   documentation. Where they conflict with current Shepherd status or run caveats,
   this handover wins.
8. **[`docs/TikTok_TechJam_2026_Complete_Brief.md`](TikTok_TechJam_2026_Complete_Brief.md)**
   — competition context; `docs/PRD.md` is the implementation acceptance contract.

Suggested reading paths:

- **Taking a task:** read this section, the status definitions, the task row, its
  linked PRD sections, the workflow, and only then the affected implementation/tests.
- **Understanding the kernel:** read Sections 4–6 below, then `docs/SHEPHERD.md`.
- **Running the product:** go directly to
  [Run and test the current solution](#run-and-test-the-current-solution).
- **Reviewing release readiness:** read the pending-test ledger, PRD traceability,
  failure matrix, security notes, and current confidence.

### Current summary

The repository now has a strong deterministic Shepherd kernel, a proven live
Codex-in-container boundary, a strict authenticated API, durable
cancellation/retry/tie/reset controls, Agent roles and scoped authority, and all
six requested React surfaces implemented in source. The rendered UI gate is still
pending. The latest production type checks and builds are green. The full server
suite is green when run with one worker; unconstrained parallel execution has the
fixed-timeout stability gap tracked as `TST-01`.

The remaining work is material:

- `SHEPHERD_MODEL` Mission composition is implemented and test-backed on active
  [PR #16](https://github.com/kyashp/shepherd/pull/16), but is not on `main` until
  that PR passes final review and merges. Its live completed-finding path remains
  blocked by `MR-03`/issue #21; degradation is explicit and deterministic behavior
  remains authoritative.
- Several PRD Section 12 failures still collapse to a generic Mission failure or lack service-level fault tests.
- No Playwright configuration, eight-journey suite, screenshots, or independent rendered UI review exists yet.
- Final architecture/test-report/README completion, repeated stability runs, and
  three timed rehearsals are not complete.
- Merged PRs #8 and #28 provide safe Node-parsed `.env` propagation, direct
  `./scripts/start-local-poc.sh` invocation, and host-local data paths. The first
  real post-merge run exposed `OPS-04`: a container-wide `HOST` value in the
  ignored `.env` is still preserved and the server correctly refuses its
  placeholder token. Branch `fix/29-ops-04-local-loopback` contains the minimal
  local-only loopback correction and passed its real startup smoke.
- `RST-01` clean-start reset is fixed and independently reviewed on
  [draft PR #10](https://github.com/kyashp/shepherd/pull/10); merge-group,
  merged-`main`, and ledger verification remain.

Do not treat `main` as complete merely because the current deterministic suite is
green. Every future change still goes through a protected PR, and every completion
claim must be updated from evidence at the merged SHA.

## Agent, GitHub, and stacked-PR workflow

`docs/HANDOVER.md` is a checkpoint inventory. **GitHub Issues and the GitHub
Project are the live ownership/status authority.** Do not use edits to this file as
a locking mechanism.

### Claiming work without collisions

1. Fetch current remote metadata and check the GitHub issue, open PRs, and remote
   branches for the task ID.
2. If the task has a recently active owner, linked branch, or draft PR, do not edit
   it; choose another ready task. A branch name alone is not a permanent claim, but
   takeover of apparently stale work requires a comment and integrator decision.
3. Assign the issue to yourself and move it to `In Progress`.
4. Create a branch named `feat/<issue>-<slug>`, `fix/<issue>-<slug>`,
   `test/<issue>-<slug>`, `audit/<issue>-<slug>`, `refactor/<issue>-<slug>`, or
   `docs/<issue>-<slug>`.
5. **Push the new branch to `origin` immediately, before implementation edits,** so
   its name is an early ownership signal visible to every other agent. A remote
   branch remains a provisional claim subject to the stale-work rule above.
6. Open a linked **draft PR immediately once the branch has a comparable commit**,
   using the repository PR template. Record the HANDOVER ID, PRD references, owned
   files, base/parent branch, dependencies, acceptance criteria, and test plan.
7. Keep the issue, branch, and draft PR updated. If no useful update is posted for
   24 hours, the integrator may ask whether the claim should be released.

Recommended GitHub Project states:

```text
Backlog → Ready → Claimed → In Progress → In Review → Merge Queue
        → Merged → Post-merge Verified
                     ↘ Blocked
```

Recommended labels combine `type/{feature,defect,test,audit,refactor}`,
`area/{shepherd,group-chat,api,ui,persistence,integration}`, `priority/{P0,P1,P2}`,
and risk labels such as `risk/security`, `risk/ui`, `risk/model`, and `risk/data`.

### Independent PR or stacked PR

- Branch independent work from current `main` and target `main` directly.
- Use a stack only when an upper change genuinely depends on a lower change.
- The bottom PR targets `main`; each higher PR targets the branch directly below
  it. Higher PRs are destined for `main` but must not initially target `main`, or
  their diffs will duplicate lower layers.
- Keep a stack to approximately 2–4 PRs. Assign one stack steward to own cascading
  rebases, merge order, and coordination. Each layer still has one implementation
  owner and its own tests.
- If feedback belongs to a lower layer, change the lower branch and cascade/rebase
  the upper layers. Do not patch around it in the top layer.
- Merge bottom-up through the protected workflow or merge queue. If GitHub's native
  stacked-PR public preview is unavailable or unstable, use the same parent-branch
  chain manually and retarget/rebase bottom-up.
- Manually link mid-stack PRs to issues; do not rely on `Closes #...` until the PR
  targets `main`.
- Avoid a long-lived unprotected integration branch. Multiple short independent
  stacks may run concurrently.

Example:

```text
main
  └─ fix/201-typed-stage-errors       PR base: main
       └─ fix/202-durable-failure-map PR base: fix/201-typed-stage-errors
            └─ test/203-failure-ui    PR base: fix/202-durable-failure-map
```

The behavior and regression tests for a layer belong in the same PR. A separate
test-only upper layer is appropriate only for a reusable cross-feature harness or
an independent assurance audit.

### Required branch and PR policy

- Never push directly to protected `main` and never bypass required checks.
- Require independent approval, required status checks, resolved review
  conversations, and approval of the latest reviewable push.
- If a merge queue is enabled, CI must run for both `pull_request` and
  `merge_group`; otherwise required checks may never report for the queue.
- Prefer squash merging for one reviewable commit per PR when the chosen stack
  tooling preserves/restacks the chain correctly.
- Delete merged head branches so historical branches are not mistaken for claims.
- No PR may mix unrelated refactors, formatting, renames, dependency churn, and
  behavior changes.

### Definition of Ready

A task is ready only when its issue contains:

- stable HANDOVER ID and exact PRD reference(s);
- observed behavior and evidence at a named commit;
- expected behavior and explicit acceptance criteria;
- important negative, failure, security, responsive, and accessibility cases;
- owned files/scope and excluded adjacent work;
- dependencies and proposed stack position;
- exact targeted, adjacent, full, browser, live, reviewer, and post-merge gates.

### Definition of Done

A task is done only after:

1. the smallest coherent implementation and causal regression tests are in one PR;
2. targeted and adjacent tests pass with recorded commands/results;
3. `npm run check` or the justified repository-defined equivalent passes;
4. required browser/live/security/UI/failure evidence passes for the task's scope;
5. documentation and `docs/BUILD_LOG.md` reflect changed behavior/evidence;
6. an independent reviewer approves the latest reviewable push;
7. protected merge/merge-queue checks pass;
8. the scoped smoke passes on updated `main`; and
9. the issue and this ledger are updated from the merged SHA.

Confidence `100` means only that every defined criterion, required check,
independent review, and post-merge gate passed for the named scope. It is not a claim
that unknown defects are impossible. **Anything below 100 remains explicitly
review-required; every PR receives normal review even at scoped 100.**

## Canonical implementation and verification ledger

This section is the authoritative status inventory for the checkpoint. If a later descriptive section sounds more optimistic, this ledger wins. Confidence is scoped to the behavior named in the row; it is not a claim that adjacent behavior works.

### Status definitions

| Label | Meaning |
|---|---|
| **Implemented + tested** | The production path exists and named automated evidence passed at the assessed SHA. This is scoped evidence, not global completion; user-facing behavior still requires browser evidence. |
| **Implemented, not fully tested** | Production code exists, but one or more required integration, failure, live, browser, accessibility, responsive, or repeated-run checks are absent. |
| **Defective / partial** | The path exists but a reproduced defect, misleading control, unsafe generic failure, stranded state, or material requirement mismatch is known. |
| **Unimplemented** | No production composition exists for the required behavior; standalone helpers or UI shells do not count. |
| **Assurance pending** | No product behavior is necessarily missing, but the required security, UI, edge-case, performance, stability, secret-scan, refactor, or release evidence has not run. |
| **Post-merge verified** | All scoped checks and independent review passed at the merged `main` SHA. No current row has this status for the complete PRD. |

Confidence is evidence-based and scoped. Every current confidence below 100 is a
mandatory review flag. The next agent must not round a value to 100 merely because
the existing suite is green.

### Mandatory change policy for every next agent

All fixes must make the **smallest coherent change** that completely restores the named requirement:

- Do not perform unrelated refactoring, renaming, formatting, dependency changes, architecture replacement, or speculative cleanup.
- Preserve existing public contracts, trust boundaries, persistence invariants, security checks, tests, and working starter behavior unless the supported root cause requires a narrowly documented contract change.
- Add or strengthen the smallest regression test that reproduces the defect. Never weaken an assertion or remove a quality gate merely to make a check pass.
- Work feature-by-feature on a branch. Commit only coherent, tested checkpoints. Merge to `main` only after the feature-specific gate and the combined gate pass.
- Continue to protect the tracked user-provided TechJam brief and all secrets.

For **every UI fix**, the following additional rules are mandatory:

- Preserve the existing Launchpad visual language and layout: dark charcoal sidebar, cream/off-white work surfaces, restrained purple primary accent, green success, red failure/collision, compact starter typography, restrained borders/shadows, and the existing spacing rhythm.
- Reuse the current React components, CSS variables, classes, layout primitives, and interaction patterns before adding new primitives.
- Fix the affected component or state only. Do not redesign unrelated pages, replace the navigation, introduce a new visual system, or apply generic AI-dashboard styling.
- Keep the result human-faithful to `docs/UI.jpeg`; pixel-perfect matching is not required, but it must remain immediately recognizable as the same product.
- Do not add decorative gradients, neon effects, particles, 3D effects, excessive motion, or unrelated animation. The timeline grid gradient is a functional line-rendering exception.
- Preserve complete loading, empty, error, disabled, reconnecting, success, failure, focus, and keyboard states.
- Verify every material UI fix in a real browser at both `1280x800` and `1440x900`, including overflow, overlap, truncation/title behavior, keyboard focus, and screenshots. Source inspection or a successful TypeScript build is not visual verification.

### Implemented and fully tested within the current automated scope (all below 100; review required)

| Feature | Evidence observed | Confidence it is correct within the stated scope |
|---|---|---:|
| Versioned JSON persistence, V1 migration, serialized atomic mutation, validation, secret redaction, and monotonic event high-water cursor | Database/store suites; full server suite; persistence rollback and cursor-gap regressions | **96%** |
| Agent CRUD, lifecycle state, workspace binding, conversation/run persistence, and one-active-run guard | AgentService and API suites; full server suite | **95%** |
| Agent roles, safe authority presets, advanced-authority normalization, role-only preset reset, and hostile path/glob rejection | AgentService/API tests; full server suite | **96%** |
| Prompt envelope construction, prompt size/control rules, and sensitive-value exclusion | Prompt/runtime tests and Phase 3 live gate | **95%** |
| Plane path confinement, Git argv operations, branch/ID sanitization, diff inspection, and protected-path authority enforcement | Authority, Plane/Git, promotion, and service tests | **95%** |
| Strict result-manifest parser and independently corroborated structured semantic claims for the valid hero path | Manifest, service, and live-runtime tests | **94%** |
| Independent verifier boundary, trusted check registry, bounded container resources/output, secret-free environment, and no-network fixture verification | Verifier container tests and full server suite | **94%** |
| Deterministic exclusive-claim collision rule, including near misses and dependency supersession | Collision unit tests and complete deterministic Mission test | **97%** |
| Two resolution Planes from one immutable integration SHA, independent execution identities, evidence-based mandatory checks, and no hard-coded strategy winner | Service/resolution/live tests and winner-flip test | **96%** |
| Final promotion gate: authority recheck, independent re-verification, selected-candidate validation, protected-head consistency, and trusted Git promotion | Promotion-gate negative tests, Git integration tests, service compensation tests | **96%** |
| Restart recovery at four process-kill checkpoints, with no falsely completed Mission | Recovery unit/process tests and full server suite | **95%** |
| Cancellation linearization in both promotion race directions and exact executor/verifier cancellation targets | Dedicated service race tests; full server suite | **95%** |
| Guarded `auth-demo` reset, clean-start idempotence, reset/start serialization, unrelated-data and cursor preservation, hostile-path protection, and partial-reset recovery | Causal service/API reset tests; concurrent clean/initialized reset tests; persistence/recovery suites; independent review on [PR #10](https://github.com/kyashp/shepherd/pull/10) | **98%** |
| Authenticated Shepherd HTTP schemas, stable error statuses, path-free controls, demo-mode guards, and public DTO redaction | API tests; focused 116-test gate; full server suite | **95%** |
| Project Group **parser only**: bounded normalization, exact/quoted mentions, ambiguity rejection, and inert untrusted content | `group-routing.test.ts`: 10/10 passed | **97%** |
| Standalone `ArkModelReviewer` adapter only: schema validation, bounded I/O, timeout/cancellation, sensitive-value rejection, and explicit degradation results | `model-reviewer.test.ts` and Phase 3 full suite | **94%** |
| Project Group clean-start **layout only** on draft PR #17 | Playwright with mocked authenticated API state at `1280x800` and `1440x900`: composer remained inside the panel/viewport, message history owned the flexible region, and document X/Y overflow was absent; screenshots were visually inspected | **93%** for this empty-state layout only; interaction, populated history, accessibility, and independent UI review remain |
| Project Group `GC-01` mention formatting and native activation on draft PR #9 | Default server-workspace regression passes 8/8 formatter/parser-round-trip/preservation/submission-lock/boundary cases; terminal Playwright mouse, Enter, Space, focus, caret, deferred-POST lock, exact limit, and visual checks pass at exact `1280x800` and `1440x900` after integrating current `main` at `d27dea6`; final independent review reports no finding and Ready to merge | **97%** within this mocked-API interaction scope; the unrelated full-suite process/shared-state instability, required checks, and post-merge verification remain |
| Phase 3 live Codex runtime isolation at the Phase 3 checkpoint | Two fresh live Missions, eight isolated sessions, real collision/promotion evidence recorded in `docs/BUILD_LOG.md` | **88%**; not rerun after Phase 4 changes |

The following are **not** included in the fully-tested claim above: rendered UI
behavior beyond the narrowly scoped Project Group layout and mention-interaction
rows, complete Group Chat behavior, general DAG scheduling, model-review Mission
composition on `main`, and every missing/partial row in the failure matrix.

### Fixed on an active PR, pending merge

| ID | Fix and evidence | Active PR | Remaining gate |
|---|---|---|---|
| `RST-01` | A clean root now returns a deliberate path-free empty success without creating a Mission or fixture. Clean and initialized resets reserve `auth-demo` across all asynchronous work, so Mission startup cannot race destructive cleanup. Causal service/API and concurrency regressions, adjacent persistence/recovery suites, a full constrained check, and an independent follow-up review are green. | [Draft PR #10](https://github.com/kyashp/shepherd/pull/10), reviewed implementation commit `19a2e45f7a67c575d9acced3dfcfbc6a32f5718e` | Merge/required checks, rerun clean and initialized reset on updated `main`, then update issue and merged-SHA ledgers. |
| `ST-02` | Stored notification values remain visible, but native disabled controls label the unimplemented capability **Reserved** and **Unavailable**. After TST-02/PR #34, the `8149a7c` current-main base was merged conflict-free at `f1ad0b9`; the exact four-file diff retained a focused 1/1 regression, literal full check (554 passed, 2 skipped), zero-vulnerability audit, and terminal Chromium proof at both required viewports without mutation, focus, PATCH, overflow, clipping, or runtime errors. The earlier independent audit reported no finding and **Ready to merge: Yes**; its final integrated-diff confirmation remains the pre-push review gate. | [Draft PR #13](https://github.com/kyashp/shepherd/pull/13), integrated merge commit `f1ad0b9811e9b77dddc933c11df6a6e3fd17cf61` | Final independent follow-up, exact-head literal check, push/required checks, merge, and post-merge verification. |
| `MR-01` / behavioural `MR-02` | `ShepherdService` accepts an optional bounded reviewer; `index.ts` composes `ArkModelReviewer` only from adapter-aligned trusted configuration; the persisted setting causally gates one advisory call. Completed/degraded events are redacted, injected results are runtime-validated, and cancellation/deadlines stay bounded even when a reviewer ignores aborts. Hostile or malformed findings cannot influence deterministic collision, winner selection, or promotion. Integrated Node 24 evidence before the final base refresh: focused 33/33 and literal full check with launcher 3/3, server 568 passed/6 skipped, both typechecks, and both builds. Final-review follow-up reproduced all three boundary defects RED, then passed the 26/26 config suite, isolated malformed-result/cancellation regressions, and server typecheck. The opt-in live gate made one request and durably reported `invalid_response`, exposing separately scoped `MR-03`/#21 without affecting promotion. Presentation-only event regex deltas were removed during final integration, so the final diff adds no rendered UI behavior. | [PR #16](https://github.com/kyashp/shepherd/pull/16), current-main merge `5972aa8`, reviewed-base checkpoint `aa76ebf` plus final-review follow-up | Commit and independently re-review the boundary corrections, run the exact-head Node 24 gate, push/required checks, merge, and post-merge verification. The unconfigured-server control truthfulness remainder is still separate from behavioural `MR-02`. |

### Confirmed defects and partial behavior

| ID | Area | Confirmed defect / mismatch | User-visible or safety impact | Required minimal correction |
|---|---|---|---|---|
| `OPS-01` (resolved) | Local startup / `.env` | Merged PR #8 uses Node's dotenv parser and an explicit launcher that inherits the parsed environment without shell-sourcing or logging it. | `npm run poc` is restored on `main`. | Retain the secret-sentinel launcher regression. |
| `OPS-02` (resolved) | Direct local startup / paths | Merged PR #28 makes `./scripts/start-local-poc.sh` perform one guarded Node dotenv handoff and maps only the exact Docker-default data paths into the host local state root. Its regression, full gate, and independent fallback security review passed. | Direct zero-parameter shell startup now safely loads `.env`; explicit custom host paths remain unchanged. | Retain the dotenv, secret non-disclosure, default localization, and custom-path regressions. |
| `OPS-04` | Local startup host binding | The ignored operator `.env` contains container-wide `HOST=0.0.0.0` and a placeholder application token. The real post-merge direct command reaches `node dist/index.js`, then the server correctly exits 1 rather than expose an unsafe public bind. | The promised zero-parameter local command still fails with the configured `.env`. | In the local launcher only, normalize empty and exact any-address hosts (`0.0.0.0`, `::`) to `127.0.0.1`; preserve custom hosts and the server's non-loopback token enforcement. Branch `fix/29-ops-04-local-loopback` has a causal regression across all host branches, real startup/API/shutdown smoke, full green gate, and independent fallback security review with its sole Low coverage finding closed. |
| `OPS-05` | Local launcher self-entry | On macOS, `/var/...` from `os.tmpdir()` and ESM's `/private/var/...` module identity compared unequal lexically, so a directly invoked copied launcher exited before spawning its child. Issue [#31](https://github.com/kyashp/shepherd/issues/31) owns the correction. | Direct local launch can exit 0 without starting the control-plane child. | Canonicalize both entry paths before comparison; the regression invokes a symlink alias and asserts a child side effect. The fixture supplies an isolated `HOME` and follows the documented Darwin/Linux local-state root. Focused suite passed 3/3 five times; full check and audit passed. |
| `GC-01` | Group Chat mention buttons | **Resolved on [draft PR #9](https://github.com/kyashp/shepherd/pull/9), pending merge.** For canonically valid, identifier-unambiguous Agent directories, the branch emits parser-safe normalized/trimmed JSON-quoted name mentions, falls back to the Agent ID when message normalization would alter the target, preserves multiline composer content, locks mention mutation during submission, and rejects over-limit insertion without losing the draft. | The prior `unknown_agent` paths from UI-generated whitespace names, including normalization-changing and post-NFKC-trim edge cases, are fixed on the branch; the reviewer-found submission race and length-boundary rejection are covered. | The 8/8 default-workspace regression plus mouse, Enter, Space, focus/caret, deferred-POST lock, exact 2,000-character boundary, and exact `1280x800`/`1440x900` checks pass after integrating `main` at `d27dea6`; final independent review reports no finding and Ready to merge. Full `npm run check` still exposes unchanged process/shared-state failures, so keep the PR draft pending integrator disposition and required checks. Canonical-length and cross-ID/name namespace validation remain `GC-07`; keep `GC-02..07` separate. |
| `GC-02` | Unmentioned Group Chat messages | The backend persists a human message with no target, but does not invoke Shepherd, create work, or post a Shepherd response. | UI says “Unmentioned → Shepherd,” but no Shepherd action occurs. | Route through an existing bounded Shepherd action/response contract; do not add free-form shell/model authority. |
| `GC-03` | `@Agent` assignment | It only links to an already-created Contract in an active Mission; it cannot create a new bounded Contract. | The required targeted Contract journey is incomplete. | Add a constrained, schema-validated Contract-creation path or change the copy/acceptance contract if product direction is explicitly revised. |
| `GC-04` | Mission timing | `@Agent` returns `409` after the active Mission finishes, and the deterministic Mission may finish before a human can use Group Chat. | The demo interaction is unreliable. | Make the bounded targeted journey independent of a narrow timing race while retaining one-project/one-mutation safety. |
| `GC-05` | Pre-Mission chat | Composer is disabled until a Shepherd project exists. | Group Chat appears broken on a clean start. | Either initialize the safe demo project read model without starting execution or provide a clear in-panel Mission-start action. |
| `GC-06` | Agent summaries | Lifecycle summaries are sent as Shepherd; Agents do not post concise manifest-derived completion summaries as `senderType: agent`. | Required human/Shepherd/Agent conversation is incomplete. | Map verified manifest summaries to bounded server-authored Agent messages after verification. |
| `GC-07` | Agent-directory canonical/namespace validation | Create/update accepts both a short source name whose NFKC+trim form exceeds the Group parser's 128-character key limit (for example, eight U+FDFA characters) and a name canonically equal to another Agent's ID. The parser validates the whole directory before ID lookup and stores IDs/names in one lookup namespace. | One over-expanding stored name can make every Project Group route fail with `invalid_agent_directory`; an ID/name collision makes that target ambiguous, including a GC-01 fallback mention. No web formatter can bypass either directory invariant. | In a separate server/schema task, align create/update validation with the parser's canonical NFKC+trim length/control contract, enforce a disjoint canonical ID/name namespace, add API/parser regressions, and define a non-destructive repair path for existing invalid/colliding stored names. |
| `MR-01` (fixed on PR #16) | Shepherd advisory model | Active PR #16 composes `ArkModelReviewer` after trusted Contract evidence, validates any injected result before use, and records bounded completed/degraded events; `main` remains uncomposed until merge. | No Mission model review on current `main`; the active PR degrades explicitly and preserves deterministic authority even for malformed or abort-ignoring injected reviewers. | Complete review/merge/post-merge gates; retain `MR-03`/#21 as a separate adapter-validation correction. |
| `MR-02` (behaviour fixed on PR #16) | Model-review setting | Active PR #16 makes `modelReviewEnabled` causally gate the review call. An unconfigured server can still render the control as active. | Behaviour is truthful when configured; configured-ness is not yet visible to the control. | Merge PR #16, then expose trusted configured-ness or label the control unavailable when no reviewer is composed. |
| `ST-01` | Startup settings | `SHEPHERD_AUTO_RESOLUTION` and `SHEPHERD_MAX_PARALLEL_PLANES` are parsed by config but not passed to `ShepherdService` as initial settings. | Environment configuration can be silently ignored. | Add explicit initial-setting composition and tests without overriding later persisted operator settings unexpectedly. |
| `F-01` | Contract timeout | Contract timeouts can flow through `makeFailure()` as `unknown` instead of `agent_timeout`. | Failure evidence is generic. | Preserve a typed timeout error through Contract, Plane, Agent, Mission, event, API, and UI state. |
| `F-02` | Contract runtime error | Candidate runtime errors are typed, but Contract runtime errors can become `unknown`. | Failure matrix is incomplete. | Introduce typed stage errors and one causal regression test. |
| `F-03` | Contract verifier exception | A thrown verifier infrastructure error can leave Contract=`verifying`, Plane=`inspecting`, Agent=`busy` while the Mission fails generically. | Stranded active-looking UI and incorrect durable state. | Atomically land all affected entities in an evidenced non-green terminal/attention state. |
| `F-04` | Worktree/Plane creation failure | Initial Plane creation can fail before a durable Plane/failure event exists; a later `PlaneCreationError` mapper is unreachable for that point. | No durable visible evidence. | Persist an attempted-stage failure on the owning Contract/Mission before returning. |
| `F-05` | Git textual integration conflict | Git detects the conflict, but `integrateContracts()` converts it to a generic throw. | Required `git_conflict` state/evidence is missing. | Persist conflict files, integration Plane state, Mission failure/attention, and a typed event. |
| `F-06` | Persistence failure | Store rollback is atomic, but there is no recovery-visible `persistence_failed` Mission event/path. | Failure may only appear as an HTTP/process error. | Add a safe recovery/journal/reconciliation mechanism; do not claim durability through the same unavailable write. |
| `F-07` | Candidate timeout | Some timeout paths use `failed` rather than `timed_out`; runtime timeout classification partly relies on message regex. | Inconsistent UI/state and brittle retry decision. | Use typed timeout errors and one canonical state mapping. |
| `F-08` | Retry eligibility | Retry is capped at one, but most non-authority candidate execution exceptions are treated as retryable. | Non-transient failures may waste a retry and obscure cause. | Retry only typed transient/runtime/infrastructure failures; add a second-failure/no-second-retry test. |
| `SCH-01` | General DAG execution | Service calls the scheduler for one fixed initial two-Contract batch with no real busy-Agent, lock, or active-Plane inputs. | PRD general dependency-wave behavior is absent. | Extend the existing scheduler/service boundary rather than replacing it. |
| `SCH-02` | Cycle timing | Cycles are rejected during scheduler evaluation, not before graph persistence/creation. | Invalid graphs may persist until execution. | Validate before persistence using the existing DAG validator. |
| `UI-01` | Failed Mission evidence | Detailed failure UI is focused on `attention_required`; ordinary `failed` Missions can hide the specific failure. | A failed run may look unexplained. | Reuse the current attention/failure components for all non-green terminal Mission failures. |
| `UI-02` | Timeline estimates | The UI renders an `est.` bar only if `estimatedDurationMs` exists, but no server/domain path produces or persists that field. | PRD Goal 16 / 11.3 estimated durations are absent in real Missions. | Persist a clearly labelled trusted estimate or remove the dead optional UI branch only if the PRD is explicitly revised; add API and browser assertions that distinguish estimates from actual timing. |
| `TST-01` | Parallel test stability | On the RST-01 branch, three unconstrained `npm run check` attempts hit different existing 1-second/5-second timeouts in Git-heavy service, recovery, and Plane integration tests. Each affected test passed isolated; the complete suite passed with one worker and unchanged assertions. | Required checks can fail nondeterministically under local/CI resource contention even when product behavior is correct. | In a separate test-harness PR, replace timing proxies with condition barriers where applicable, give real-Git integration journeys evidence-based ceilings, or cap Vitest workers. Preserve assertions and first reproduce RED under contention. |
| `CI-01` | Pull-request checks | GitHub reports no status checks for [draft PR #10](https://github.com/kyashp/shepherd/pull/10). | A locally verified branch can reach review without an independent automated typecheck/test/build result. | Add or repair required pull-request automation for the documented Node runtime; protect `main` with the resulting checks. Keep workflow/configuration changes separate from RST-01. |

### Implemented but not fully tested

| Feature/path | What exists | Missing evidence before it may be called complete |
|---|---|---|
| Six UI surfaces and shared navigation/design system | All requested routes compile and production-build; draft PR #17 preserves the existing palette/components while moving page overflow into bounded internal regions and replacing the Shepherd glyph with Iconoir solid `cube-scan` geometry | Browser all six routes and all interaction states at both required viewports; accessibility and independent UI review |
| Shepherd stream, filters, timeline, Plane Tree, detail drawer, cancel/selection controls | React components and API bindings exist; draft PR #17 keeps the composer in the flex-owned viewport, reduces excess stream/tree bottom spacing, shows seconds in short timelines, and labels Resolution rows by target value | Populated deterministic browser journey at both viewports, real Git/tree comparison, event visibility timing, failure slices, and screenshot review; the PR #17 Shepherd changes have source/build evidence only |
| Project Group message display/polling | Read API, sorting, connection/error/empty states exist; draft PR #17 anchors the composer below a flexible scrollable history, and [draft PR #9](https://github.com/kyashp/shepherd/pull/9) adds parser-safe name/ID mention insertion with multiline draft preservation | Browser polling/reconnect and populated-history tests plus fixes for `GC-02..07`; `GC-05` still disables typing before a project exists; accessibility and independent UI review remain |
| Legacy Playground in the new shell | Existing workflow retained in source | Create → task → follow-up → stop/restart Playwright regression |
| Create/Edit Agent UI | Role/preset/advanced forms compile | Browser validation, keyboard/accessibility, and persistence round-trip |
| Settings UI | Timeout/concurrency/auto-resolution values call the real API; `ST-02` notification values are visibly reserved and read-only on [PR #13](https://github.com/kyashp/shepherd/pull/13) | Browser round-trip for writable settings; fix the misleading model-review control and startup-env composition; complete the broader Settings accessibility/browser journey |
| One automatic candidate retry | Fresh Plane and prior-attempt archive are tested | Typed eligibility and failed-second-attempt/no-second-retry test |
| Manual confirmation and candidate selection | Service/API path promotes an independently passing candidate | A service-generated objective tie, browser choice, and chosen-candidate promotion journey |
| Missing manifest durable transition | Code persists `manifest_missing` | Service fault injection asserting Contract/Plane/Mission/event/API/UI |
| Malformed manifest durable transition | Code persists `manifest_malformed`; parser is tested | Service-level state/event/API/UI test |
| Omitted declared claim key | Parser rejects it | Service-level state/event/API/UI test |
| Contract independent-acceptance failure | Code path exists | Contract-specific verifier-failure orchestration test |
| Final re-verification failure | PromotionGate unit behavior exists | Durable Shepherd Candidate/Mission/event/API/UI test |
| Candidate timeout | Partial code path exists | Correct typed state mapping, retry behavior, API/UI evidence test |
| Repeated cancellation | Single cancellation and both promotion races are tested | Explicit idempotent repeated-cancel API/service test |
| UI reconnect handling | Poller retains state and retries | Browser interruption, visible reconnect, cursor reconciliation, no-duplicate event test |
| Live Mission on current `main` | Phase 3 runtime previously passed at its named checkpoint | One sparse post-integration live Mission after P0 fixes; no repeated unnecessary model calls |
| Host local-PoC startup | Merged #8/#28 provide direct dotenv and path behavior. The `OPS-04` candidate additionally normalizes exact any-address hosts to loopback while preserving a concrete custom host in regression coverage. With the actual ignored `.env`, direct startup bound `127.0.0.1:3000`; health/web returned 200, unauthenticated system returned 401, authenticated system returned 200, and SIGINT left no owned Runtime container. Independent fallback security review found no high/medium issue; its sole Low coverage gap was closed. | Merge `OPS-04`, then repeat the same zero-parameter smoke on updated `main` |

### Unimplemented required behavior

| Required behavior | Status |
|---|---|
| Mission-composed bounded `SHEPHERD_MODEL` semantic review and durable `model_review_degraded` event | **Implemented + tested on active PR #16, pending final review/merge**; current `main` remains uncomposed |
| General multi-wave DAG scheduling with actual Agent occupancy, mutation lock, active Plane capacity, and downstream re-evaluation | **Unimplemented in service orchestration**; scheduler module exists |
| Complete unmentioned-message → Shepherd action/reply behavior | **Unimplemented**; persistence only |
| Bounded Project Group `@Agent` Contract creation independent of an already-existing active Contract | **Unimplemented** |
| Manifest-derived Agent completion messages in Project Group | **Unimplemented** |
| Durable recovery-visible persistence-failure evidence | **Unimplemented** |
| Complete typed implementation for every PRD Section 12 failure row | **Unimplemented/partial**, itemized above and in the failure matrix |
| Playwright configuration, deterministic browser harness, fake Codex CLI, and all eight journeys | **Unimplemented** |
| Required screenshot corpus and visual checklist report | **Unimplemented** |
| Product notification delivery or in-app notification consumption | **Future capability, unimplemented**; PR #13 deliberately reserves the preserved settings UI. Define behavior and privacy/threat boundaries in a separate approved issue and PR; external integrations are not implied. |
| Persisted/served trusted Contract duration estimates for the timeline | **Unimplemented**; UI has an optional dead-data rendering branch only (`UI-02`) |
| Final generated architecture document, final test report, and final README refresh | **Unimplemented**; this `HANDOVER.md` is the single continuation entry point and must be kept current rather than duplicated as `HANDOFF.md` |

### Pending test and review ledger

The next agent must explicitly mark each item pass/fail with the exact command and observed evidence:

1. Fix and test `OPS-01` and `OPS-02`: `.env` propagation and repository-local host paths. Keep startup secret/path work separate from the reviewed `RST-01` reset PR.
2. Add service fault-injection tests for `F-01..08`, missing/malformed/omitted manifests, Contract acceptance failure, objective tie, final re-verification, repeated cancellation, and persistence recovery.
3. Complete Group Chat API/browser regressions for `GC-02..07`. For canonically valid, identifier-unambiguous directories, PR #9 covers `GC-01` quoted/escaped whitespace names, normalization-changing name fallback to Agent IDs, post-NFKC trim, formatter-to-production-parser round trips, multiline draft preservation, native mouse/keyboard activation, focus/caret, and both required viewports; after it merges, run the scoped post-merge check. Still prove a clean-start state, a message that produces a bounded Shepherd result, a targeted Contract, post-Mission behavior, manifest-derived Agent summaries, and canonical length/ID-name namespace validation at create/update boundaries.
4. **PASS on PR #16, final aggregate gate pending:** 14 service-level cases cover no reviewer, completed/zero/hostile/malformed findings, the persisted toggle, degraded/throw/disabled/cancelled/deadline behavior, real-adapter redaction/config composition, insufficient verified Contracts, and cancellation against an abort-ignoring reviewer. The earlier integrated focused command passed 33/33 under Node 24; final-review RED/GREEN follow-up passed 26/26 config assertions plus the isolated malformed-result and cancellation cases. One aggregate rerun reached 39/40 before an unrelated Git-fixture exit in `MR-T12`, which passed immediately in isolation; do not present that interrupted aggregate as green.
5. **PASS with a tracked product finding:** the double-gated live `SHEPHERD_MODEL` smoke made exactly one request and preserved the deterministic outcome while durably reporting `invalid_response`. The provider returned a valid finding that adapter evidence-reference validation rejected; `MR-03`/#21 owns that separate correction. No credential was printed.
6. Add real service DAG-wave tests for dependencies, failed-required blocking, busy Agent, mutation lock, capacity, cycle rejection before persistence, and overlapping timestamps.
7. Implement and test real `estimatedDurationMs` production data for `UI-02`, clearly separated from actual timestamps.
8. Implement and run all eight PRD Playwright journeys: baseline Playground, Mission, `@Agent`, authority failure, all-fail attention, objective tie/human choice, cancellation, and restart.
9. Capture and review every required browser stage at `1280x800` and `1440x900`; verify no overlap/truncation, loading/empty/error/disabled/reconnect states, keyboard navigation, focus visibility, labels, contrast, and long-ID titles.
10. Measure event persistence → browser visibility `<=1.5s`, candidate timestamp overlap, Plane creation time, collision-to-promotion time, and full demo time.
11. Verify Plane Tree nodes/branches/SHAs against real persisted Plane data and `git worktree list`/branch reality.
12. Run the read-only `ui-reviewer` after screenshots and fix every high/medium finding with the mandatory minimal UI policy above.
13. Run the read-only `security-reviewer` after Group Chat/model/failure/startup changes and fix material findings.
14. Add TypeScript checking for test files; current server production typecheck excludes `*.test.ts`.
15. Resolve `TST-01`, then run the literal unconstrained `npm run check` on the final feature commit. Until then, record both the exact attempt and the constrained-worker result without presenting one as the other.
16. Run the complete suite at least five consecutive times and fix flakiness by root cause; `TST-01` is the current evidenced starting point.
17. Run secret scans over source, generated prompts, persisted store, API payloads, and browser DOM after a complete demo.
18. Perform three clean reset-to-completion rehearsals and record exact timings; use a second machine/state only if genuinely available.
19. Run one final clean deterministic demo and the separately gated sparse live smoke on the final commit.
20. After merge, rerun typecheck, full tests, production build, browser smoke, secret scan, and one clean demo on `main`. For PR #10, explicitly rerun both clean and initialized reset, then close issue #7 and update the merged-SHA ledger.

## PRD traceability matrix

This matrix is the coverage index for `docs/PRD.md`. The detailed defect and
failure tables remain authoritative for root cause and acceptance work. No phase
number or compiled UI component implies completion of its requirement.

Abbreviations: **I+T** = implemented with named automated evidence at the assessed
SHA; **I-U** = implemented but required evidence is incomplete; **Partial** = a
known requirement mismatch exists; **Unimplemented** = no composed product path;
**Assurance** = evidence/review only, but mandatory before final completion.

### PRD 4.1 product goals

| ID | Requirement | Status and confidence | Blocking work/evidence |
|---|---|---|---|
| `G-01` | One human coordinates multiple Agent instances from Shepherd | **I-U, 78%** | Fixed two-Agent Mission and UI/API exist; browser Mission journey and general planning remain. `E2E-02`, `K-01`. |
| `G-02` | Durable typed Execution Contracts | **I+T, 96% — review required** | Backend/domain/persistence tests pass; complete browser evidence still required. |
| `G-03` | Isolated Planes; Agents do not mutate protected project | **I+T, 95% — review required** | Git/Plane/authority tests pass; final security review remains `SEC-REVIEW`. |
| `G-04` | Trusted actual-diff scoped authority | **I+T, 95% — review required** | Negative authority/promotion tests pass; final review remains. |
| `G-05` | Independent verification; no self-certification | **I+T, 94% — review required** | Container verifier and invariant tests pass; several infrastructure failure compositions remain `F-03`. |
| `G-06` | Live Contract DAG and scheduler | **Partial, 65%** | Standalone scheduler is tested, but service runs one fixed initial batch. `SCH-01`, `SCH-02`. |
| `G-07` | Real semantic conflict without textual conflict | **I+T, 97% — review required** | Deterministic fixture/service tests and current API demo pass. |
| `G-08` | Two distinct strategies from one immutable integration state | **I+T, 96% — review required** | Candidate base/identity tests and current deterministic run pass. |
| `G-09` | Concurrent candidate execution and independent evaluation | **I+T backend, 93% — review required** | Overlap is test-backed; final measured/timed report and browser evidence remain. |
| `G-10` | Verified-only deterministic promotion; fail closed | **I+T, 96% — review required** | Winner flip, re-verification, selected identity, and expected-HEAD tests pass. |
| `G-11` | Preserve failure evidence and use `attention_required` safely | **Partial, 68%** | Several failures remain generic or strand entities. `F-01..08`, `UI-01`. |
| `G-12` | Explicit `@Agent` Project Group routing | **Defective/partial, 48%** | Parser and PR #9 mention generation are strong; composed Contract behavior and canonical Agent-directory validation still fail requirements. `GC-03`, `GC-04`, `GC-05`, `GC-07`. |
| `G-13` | Advisory model reviewer, never demo-critical | **I+T on active PR #16, 90% — review required** | Mission composition, explicit degradation, toggle causality, and hostile-finding independence pass; merge/post-merge evidence and the separate `MR-03` live completed path remain. |
| `G-14` | Human selection on objective tie | **I-U, 72%** | Service/API/UI control exists; no real service-generated tie browser journey. `E2E-06`. |
| `G-15` | Mission cancellation and bounded retry | **I-U/partial, 84%** | Race and one-retry tests pass; retry classification, repeated cancel, and browser journeys remain. `F-07`, `F-08`, `E2E-07`. |
| `G-16` | Clearly labelled duration estimates in timeline | **Unimplemented production data, 20%** | Optional UI renderer exists but no server produces estimates. `UI-02`. |
| `G-17` | Complete specified UI | **I-U, 60%** | Six surfaces build; no rendered, responsive, accessibility, or full journey evidence. `UI-GATE`. |
| `G-18` | Preserve every Starter Kit behavior | **I-U, 82%** | Unit/API/build regression passes; current full live browser restart journey was not rerun. `E2E-01`, `LIVE-01`. |

### PRD 6–10 architecture, domain, kernel, persistence, API, and fixture

| ID | PRD scope | Status and confidence | Blocking work/evidence |
|---|---|---|---|
| `A-01` | 6.1 layered Experience/Agent/Shepherd/runtime/verifier/Git architecture | **I-U, 88%** | Code boundaries exist; final generated architecture and UI gate remain. `DEL-01`, `UI-GATE`. |
| `A-02` | 6.2 trusted/untrusted boundary enforcement | **I+T, 94% — review required** | Strong negative tests; final security review and missing failure compositions remain. |
| `D-01` | 7.1 ShepherdProject and one mutating Mission | **I+T, 95% — review required** | Service/store/API tests pass. General DAG use still `SCH-01`. |
| `D-02` | 7.2 Mission states/transitions/events | **Partial, 82%** | Normal/restart paths are strong; typed terminal failures remain `F-01..06`. |
| `D-03` | 7.3–7.4 AgentRole and ScopedAuthority | **I+T, 96% — review required** | CRUD/API/path negative tests pass; browser form round-trip remains. |
| `D-04` | 7.5–7.6 Contract lifecycle and result manifest | **I+T core / I-U failures, 90%** | Valid path and parser pass; missing/malformed/omitted durable service/UI tests remain. |
| `D-05` | 7.7 claims, normalization, declared keys, evidence | **I+T core, 94% — review required** | Near-miss/forgery tests pass; omitted-key service/UI evidence remains. |
| `D-06` | 7.8 Plane lifecycle and cleanup | **I+T core / Partial failure, 91%** | Real Git/container tests pass; initial creation failure lacks durable evidence (`F-04`). |
| `D-07` | 7.9 collision model and evidence | **I+T, 97% — review required** | Deterministic and durable service coverage passes. |
| `D-08` | 7.10 candidate model, retry, selection evidence | **I-U, 86%** | Core path passes; timeout/retry/tie/browser gaps remain. |
| `D-09` | 7.11 bounded redacted event stream | **I+T, 95% — review required** | Cursor/redaction/API tests pass; browser interruption/latency remain. |
| `K-01` | 8.1 Contract origins: Shepherd, Project Group, demo | **Partial, 52%** | Shepherd maps only to fixed preset; Project Group creation is incomplete. `GC-02..05`; general planner remains unimplemented. |
| `K-02` | 8.2 trusted prompt envelope and secret exclusion | **I+T, 95% — review required** | Prompt tests and Phase 3 live evidence pass. |
| `K-03` | 8.3 general scheduler rules and concurrency | **Partial, 65%** | `SCH-01`, `SCH-02`; final timing measurement pending. |
| `K-04` | 8.4 integration Plane and explicit Git-conflict state | **Partial, 84%** | Normal integration passes; textual conflict becomes generic failure (`F-05`). |
| `K-05` | 8.5 deterministic collision predicate | **I+T, 97% — review required** | Exhaustive near-miss tests pass. |
| `K-06` | 8.6 bounded model-assisted reviewer and degradation event | **I+T on active PR #16, 90% — review required** | Focused/full deterministic gates and one opt-in degraded live request pass; final review/merge and `MR-03` remain. |
| `K-07` | 8.7 live speculative resolution | **I+T backend, 93% — review required** | Deterministic/current run and Phase 3 live evidence pass; sparse current live smoke pending. |
| `K-08` | 8.8 winner policy and winner flip | **I+T, 97% — review required** | Unit/service/integration flip evidence passes; service tie journey pending. |
| `K-09` | 8.9 final promotion gate | **I+T core, 96% — review required** | Negative gate/compensation tests pass; durable final reverify failure journey remains. |
| `K-10` | 8.10 credential-free bounded verifier | **I+T, 94% — review required** | Container boundary tests pass; final security audit remains. |
| `K-11` | 8.11 cancel and retry E2E | **I-U/partial, 84%** | `F-07`, `F-08`, repeated-cancel test, `E2E-07`. |
| `P-01` | 9.1 versioned atomic persistence, migration, restart, secret-free state | **I+T core / Partial failure, 92%** | Migration/restart/redaction tests pass; recovery-visible persistence failure remains `F-06`. |
| `P-02` | 9.2 authenticated schema-validated API and polling | **I+T core / Partial group path, 93%** | API and authenticated clean/initialized reset tests pass on [PR #10](https://github.com/kyashp/shepherd/pull/10); Group behavior and polling browser evidence remain. |
| `FIX-01` | 10 deterministic network-free auth fixture and safe reset | **I+T backend, 98% — pending merge** | Clean and initialized reset, hostile-path, unrelated-data, cursor, recovery, and reset/start serialization tests pass on [PR #10](https://github.com/kyashp/shepherd/pull/10). Browser rehearsal and merged-`main` evidence remain. |

### PRD 11 UI surfaces and user journeys

| ID | Requirement | Status | Blocking work/evidence |
|---|---|---|---|
| `UI-S01` | 11.1 sidebar/navigation | **I-U; scoped visual evidence on draft PR #17** | Sidebar and official Shepherd icon were visually inspected with the Project Group empty state at both viewports; complete route, responsive, focus, and keyboard review remains. |
| `UI-S02` | 11.2 real event stream, filters, evidence, composer | **I-U; layout correction on draft PR #17** | Composer/flexible-panel source and build checks pass; populated Shepherd browser polling/latency/error evidence remains. |
| `UI-S03` | 11.3 timeline with actuals and labelled estimates | **Partial; legibility correction on draft PR #17** | Actual timestamps now include seconds for short runs and Resolution rows identify the target value; rendered populated-state evidence and real persisted estimates remain (`UI-02`). |
| `UI-S04` | 11.4 Plane Tree and Git-reality detail | **I-U** | Data/detail UI exists; browser-to-`git worktree` comparison pending. |
| `UI-S05` | 11.5 Project Group, Agent, Create/Edit | **Defective/I-U; scoped Project Group layout and mention interaction verified** | Draft PR #17 proves clean-start composer placement/no-page-overflow; draft PR #9 proves mouse/Enter/Space mention insertion, focus, caret, and both viewports on merged current `main`. `GC-02..07` and remaining Agent/form/Playground browser evidence remain. |
| `E2E-01` | 11.6.1 baseline create/task/follow-up/restart | **Not evaluated on current UI** | Build a deterministic browser harness plus one sparse live Runtime acceptance. |
| `E2E-02` | 11.6.2 full Mission hero chain | **Backend pass; browser not evaluated** | Eight-stage browser assertions/screenshots and timing. |
| `E2E-03` | 11.6.3 `@Agent` journey | **Blocked after scoped button pass** | PR #9 passes the `GC-01` button/composer interaction; `GC-03`, `GC-04`, and `GC-05` still block the end-to-end targeted Contract journey. |
| `E2E-04` | 11.6.4 unauthorized-change journey | **Backend protected; browser not evaluated** | Causal service/API/UI failure fixture and screenshots. |
| `E2E-05` | 11.6.5 all-candidates-fail attention | **Backend pass; browser not evaluated** | Browser fault composition and preserved-evidence assertions. |
| `E2E-06` | 11.6.6 objective tie and human selection | **Unit/control exists; service/browser not evaluated** | Real tie state → verified choice → promotion. |
| `E2E-07` | 11.6.7 cancellation | **Backend pass; browser not evaluated** | Mid-Mission browser cancellation plus repeated-cancel check. |
| `E2E-08` | 11.6.8 restart interruption | **Backend process pass; browser not evaluated** | Browser reconnect shows durable interrupted state and nothing green. |
| `UI-GATE` | 11.7 visual checklist and all UI states at 1280x800/1440x900 | **Assurance pending; two scoped Project Group states evidenced** | Draft PR #17 covers clean-start empty-state layout; draft PR #9 covers populated composer mention activation/focus/caret. A committed screenshot corpus, all other routes/states, accessibility run, and independent `ui-reviewer` result remain. Preserve the mandatory minimal UI policy above. |

### PRD 12 failure matrix

All 22 named failure/recovery categories are mapped individually in
[Section 8](#8-failure-matrix-audit). None may be closed by a generic “Mission
failed” assertion. Each needs entity state, bounded event/evidence, public API,
visible UI, and no-promotion assertions. Current status: **mixed/incomplete**.

### PRD 13 security

| ID | Requirement | Status and confidence | Blocking work/evidence |
|---|---|---|---|
| `SEC-01` | Secrets absent from source/state/prompts/verifier/API/DOM | **I+T backend, 93% — review required** | DOM scan after full browser demo and final repo/store scan pending. |
| `SEC-02` | Canary redaction of logs/verification/events/browser | **I+T backend, 93% — review required** | Full UI/DOM and composed model-review path pending. |
| `SEC-03` | Semantic evidence cannot reference protected/secret paths | **I+T, 95% — review required** | Negative backend tests pass; final reviewer gate pending. |
| `SEC-04` | No model-generated host shell; trusted verifier commands only | **I+T, 94% — review required** | Boundary tests pass; final integration/security review pending. |
| `SEC-05` | Sanitized refs/IDs, bounded subprocess output/time | **I+T, 95% — review required** | Backend tests pass; startup-path fix must preserve the boundary. |
| `SEC-REVIEW` | Independent full security review | **Assurance pending** | Required after startup, Group Chat, model-review, failure, file/reset, and browser work stabilizes. |

### PRD 14 performance/demo targets

| ID | Requirement | Status | Blocking work/evidence |
|---|---|---|---|
| `PERF-01` | Persisted event visible in UI within 1.5s | **Not measured** | Browser timestamp measurement. |
| `PERF-02` | Fixture Plane creation near-instant | **Not formally measured** | Record reproducible timings. |
| `PERF-03` | Fixture verification completes in seconds | **Observed informally/current run** | Formal sample/timing report required. |
| `PERF-04` | Candidates overlap/concurrent | **Automated backend evidence** | Record final timestamp evidence and browser representation. |
| `PERF-05` | No fixture network/package downloads | **Verifier boundary tested** | Final demo log/audit required. |
| `PERF-06` | Collision-to-promotion <2 min and three-minute story ×3 | **Not rehearsed** | Three clean timed runs; second environment only if available. |

### PRD 16 Phase 9 and PRD 17 completion gates

| ID | Deliverable/gate | Status | Required work |
|---|---|---|---|
| `DEL-01` | `docs/SHEPHERD_ARCHITECTURE.md` with validated Mermaid | **Unimplemented** | Generate only after behavior freeze; validate locally. |
| `DEL-02` | Final gap-generated suite, typed tests, five stable runs | **Incomplete** | Close matrix/journey gaps, include tests in typecheck, run ×5. |
| `DEL-03` | `docs/SHEPHERD_TEST_REPORT.md` | **Unimplemented** | Generate from executed final evidence only. |
| `DEL-04` | Final Shepherd README | **Partial** | Current README has corrected navigation/status but remains Starter Kit-heavy. Finish after product freeze. |
| `DEL-05` | Final no-secret/no-debug/no-duplicate/no-bypass audit | **Assurance pending** | Run after all behavior changes, not before. |
| `DOD-01` | Complete PRD 17 Definition of Done | **Fail/incomplete** | Every non-complete row above plus final post-merge evidence. |

## Suggested issue and stack decomposition

Create one GitHub issue per stable ID. The table suggests dependency shape; the
integrator may split a large row further, but must retain the parent ID and PRD
traceability.

| Workstream | Recommended PR units | Stack/dependency guidance | Reviewer gate |
|---|---|---|---|
| Local run/reset | `OPS-01`, `OPS-02`; `RST-01` is implemented on [draft PR #10](https://github.com/kyashp/shepherd/pull/10) | `OPS-02` may stack on `OPS-01`. Keep startup secret/path work separate from the reset PR; after PR #10 merges, perform its clean/initialized post-merge reset gate. | Security review for env/path handling; PR #10 independent review is complete |
| Test/PR assurance | `TST-01`, `CI-01` | Stabilize the Git-heavy test harness without weakening assertions, then add/require the resulting typecheck/test/build checks on pull requests. Keep this independent of product fixes. | Test-infrastructure and repository-administration review |
| Typed failures | `F-01/F-02` common typed-stage foundation, then `F-03`, `F-04`, `F-05`, `F-06`, `F-07/F-08` | Use short stacks only where a shared typed error contract is required. Each PR includes its entity/event/API tests. | Security review after the workstream |
| Group Chat | `GC-05` safe project initialization, `GC-02` Shepherd handling, `GC-03/GC-04` targeted Contract lifecycle, `GC-06` Agent summaries, `GC-07` canonical Agent-name validation; `GC-01` mention UI is verified on draft PR #9 | One stack steward; keep parser/security foundation below service behavior and UI. Browser tests land with each UI-visible correction. | Security + UI review |
| Advisory model | `MR-01` service composition/degradation, then `MR-02` truthful setting/UI | Deterministic collision independence is a mandatory lower-layer test. One sparse live smoke only after fake-adapter gates. | Security + UI review |
| Settings truthfulness | `ST-01` startup setting composition remains; `ST-02` reserved/unavailable notification UI is implemented on [PR #13](https://github.com/kyashp/shepherd/pull/13) | Keep initial-config behavior separate from optional product notification behavior. Any delivery capability requires a new approved issue/PR. | UI review; security review if a delivery surface is proposed |
| Scheduler | `SCH-02` pre-persistence validation, then `SCH-01` real waves/capacity/occupancy | Keep general graph contract below service orchestration. | Security review if mutation/authority paths change |
| Timeline/UI | `UI-02`, `UI-01`, then per-surface browser gaps | Branch after required API/domain data exists; preserve current design and use 1280x800/1440x900 evidence. | UI review |
| Browser harness | reusable harness, then `E2E-01..08` grouped only by shared fixture | The harness can be an independent PR. Behavior fixes stay in their owning feature PR, not hidden in E2E-only PRs. | UI review; security review for fault fixtures |
| Sparse live runtime | `LIVE-01` current-`main` legacy Playground/restart smoke plus one final live Shepherd Mission after P0 fixes | Keep opt-in and separate from deterministic required CI; never print credentials or raw prompts. | Security/integration review |
| Assurance/freeze | `SEC-REVIEW`, `UI-GATE`, `PERF-01..06`, `DEL-01..05` | Start only after dependent behavior is stable. Do not refactor while generating final evidence. | Integrator/release review |

Refactoring is not a blanket task. Create a dedicated `refactor/*` issue/PR only
after tests lock behavior, with a named target such as demonstrable dead code,
duplication, or excessive complexity. Reduced line count alone is not acceptance
evidence. Run baseline and post-refactor behavior tests and keep the original UI and
public contracts unchanged.

## 2. Repository and worktree state

At the assessed implementation checkpoint:

- `main` and `origin/main` both resolved to
  `6c1a948c52b8c6b8107ffcc87e63a1352e62481a`.
- The working tree was clean before the documentation/workflow changes in this
  handover update.
- `e3aa667` (control plane and six-screen UI) and the earlier handover commits are
  already ancestors of current `main`; the old statement that they were unmerged
  was stale and has been removed.
- Local historical branches `feature/shepherd-phase-0-baseline` through
  `feature/shepherd-phase-3-live-runtime` remain visible. Treat them as historical
  evidence unless a linked open issue/PR establishes an active claim.
- `docs/TikTok_TechJam_2026_Complete_Brief.md` is now tracked on `main`.
- No deployment, cloud change, GitHub issue/PR mutation, or merge was performed by
  this documentation update.
- `.env` values were never printed. Only the presence of expected variable names
  was checked while diagnosing `OPS-01`; continue treating `.env` as secret.
- Repository-local smoke state was created only under ignored
  `.tmp/handover-smoke-doc/` for the documented deterministic run.

Useful first commands:

```sh
git branch --show-current
git status --short
git log --oneline --decorate -8
npm ci
npm run typecheck
npm run test -w @launchpad/server
npm run build
```

## 3. What is implemented

### 3.1 Kernel and runtime foundation (Phases 1–3)

The existing Phase 1–3 implementation provides:

- Real Git-backed Planes and protected-branch promotion.
- Deterministic auth demo fixture with different frontend/backend files, clean textual integration, and a semantic `auth.transport` collision.
- Strict `.shepherd/result.json` ingestion and declared-claim validation.
- Scoped-authority validation against the actual Git diff.
- Independent disposable-container verification with trusted check profiles and no model credentials.
- Deterministic collision detection, two speculative resolution Planes from one immutable integration commit, evidence-derived winner selection, final re-verification, protected-head compare-and-swap, and inspectable losing Plane.
- Winner-flip coverage proving the strategy name is not the decision rule.
- Versioned JSON persistence, atomic mutation, monotonic event cursors, restart reconciliation, and multiple process-kill recovery checkpoints.
- Live `CodexShepherdExecutor` runs in separate ephemeral container identities and separate Codex homes/sessions.
- A bounded, schema-validated `ArkModelReviewer` adapter with timeout/size/redaction/degradation tests, but no Mission-service composition yet.

The Phase 3 opt-in live gate recorded in `docs/BUILD_LOG.md` completed two fresh live Missions with eight isolated runtime sessions. Do not repeat live calls unless the test inherently requires the external model; the default suite must stay network/model-free.

### 3.2 Phase 4/5 service controls in `e3aa667`

`apps/server/src/shepherd/service.ts` now exposes and tests:

```ts
planeDetail(id: string): ShepherdPlaneDetail | null
collisionDetail(id: string): ShepherdCollisionDetail | null
candidateDetail(id: string): ShepherdCandidateDetail | null
settings(): ShepherdSettings
updateSettings(input: ShepherdSettingsUpdate): Promise<ShepherdSettings>
projectGroupMessages(projectId: string, limit?: number): ProjectGroupMessage[]
sendProjectGroupMessage(projectId, input): Promise<ProjectGroupMessage>
startMissionFromMessage(input): Promise<{ missionId: string; message: ProjectGroupMessage }>
cancelMission(id: string): Promise<Mission>
selectTiedCandidate(collisionId, candidateId): Promise<ShepherdMissionDetail>
resetDeterministicDemo(): Promise<DeterministicDemoResetResult>
```

Implemented behavior:

- The existing DAG scheduler is invoked for the fixed initial Contract batch.
- Plane concurrency is enforced as `2..16`; the minimum keeps the required speculative pair concurrent.
- Timeouts and concurrency settings are read at execution time.
- Turning automatic resolution off still executes and verifies both candidates, then pauses before selection/promotion.
- Mission cancellation first persists `cancelled`, interrupts eligible entities, releases Agents/project ownership, then cancels the exact executor/verifier identities.
- Cancellation wins while final verification is `reverifying`; once the durable `promoting` marker exists, cancellation returns a conflict and the promotion path owns completion.
- One retry is automatic and bounded. It creates a fresh Plane from the same integration commit and archives the previous attempt. There is intentionally no manual retry endpoint.
- Human confirmation/selection accepts only independently passing candidates and resumes the same trusted promotion gate.
- Human-selection verifier/infrastructure failures return durably to `attention_required` rather than stranding `resolving` state.
- Demo reset is fixed to the trusted `auth-demo` sentinel. It removes only Shepherd-managed Planes/branches/state, restores the known initial commit, preserves unrelated Launchpad data, preserves unrelated event sequence numbers, never reuses the high-water cursor, and resumes if Git reset succeeded but store persistence failed.
- Project Group messages are bounded and idempotent, and draft PR #9 fixes parser-safe mention-button insertion for canonically valid, identifier-unambiguous Agent directories. The complete chat workflow remains defective: unmentioned text is persisted without Shepherd processing/reply, the only executable `@Agent` path targets an existing active demo Contract, and create/update canonical-name validation is weaker than the parser directory contract. See `GC-02..07` in the canonical ledger.
- Shepherd emits bounded lifecycle summaries for Mission accepted, verified manifests, collision, candidate outcomes, attention, promotion, completion, and cancellation.

### 3.3 Strict HTTP API and public data boundary

`apps/server/src/app.ts` now has authenticated, schema-validated routes for:

- `GET /api/shepherd/state`
- `GET /api/shepherd/missions/:id`
- `GET /api/shepherd/events?cursor=&limit=`
- `POST /api/shepherd/messages`
- `GET|POST /api/shepherd/projects/:id/group-messages`
- `POST /api/shepherd/missions/:id/cancel`
- `POST /api/shepherd/collisions/:id/select`
- `GET /api/shepherd/planes/:id`
- `GET /api/shepherd/collisions/:id`
- `GET /api/shepherd/candidates/:id`
- `GET|PATCH /api/shepherd/settings`
- `POST /api/shepherd/demo/reset` (explicit demo mode only)
- Existing demo-Mission start route (explicit demo mode only)

Public serializers omit or transform:

- repository/worktree paths;
- execution identities and raw session fingerprints;
- raw Agent prompts;
- raw manifest/control metadata not required by the browser;
- verifier stdout, stderr, and error strings;
- configured secrets and sensitive event-detail keys;
- nested prior-attempt diagnostics;
- reset worktree paths.

The API uses stable `400`, `403`, `404`, `409`, and `422` responses. Browser inputs cannot supply arbitrary host paths or commands.

### 3.4 Agent roles and authority

Agent create/edit supports roles:

- `Frontend`
- `Backend`
- `Verification`
- `Generalist`

Inputs may use a safe authority preset (`frontend`, `backend`, `verification`, `generalist`) or a strict advanced authority object, never both. Only normalized resolved role/authority are persisted. Name-only legacy creation defaults to Generalist. A role-only patch resets authority to that role's safe preset. Traversal, host paths, null bytes, and unsupported glob syntax are rejected.

### 3.5 Six UI surfaces implemented in source (rendered gate pending)

The React application now routes:

- `/shepherd`
- `/project-group`
- `/agents`
- `/agents/new`
- `/agents/:id`
- `/agents/:id/edit`
- `/settings`

Implemented UI capabilities:

- Dark Launchpad sidebar, cream/off-white surfaces, purple accent, green success, red failure/collision, and responsive laptop layouts.
- Shepherd event stream with filters, state pills, collision/candidate/promotion events, evidence expanders, and composer.
- Timeline driven by actual persisted timestamps (no invented estimates).
- Plane Tree with persisted lineage, status badges, short SHAs, and detail drawer.
- Cancel and human candidate-selection controls.
- Retry-count and previous-attempt evidence display; no invented retry button.
- Project Group display/polling, bounded parser-backed routing attempts, parser-safe
  mention-button insertion on draft PR #9, and Contract links; end-to-end routing
  remains defective under `GC-02..07`.
- Agents table, legacy Playground, lifecycle controls, role/current-Contract/Plane information.
- Create/Edit role selector, authority presets, and advanced authority section.
- Settings tabs for real timeout/concurrency/automatic-resolution values, a persisted-only model-review value, reserved/read-only notification values, locked mode/retention/authority controls, and safe demo reset. The model-review control still requires `MR-02`; notification truthfulness is implemented by `ST-02` on PR #13.
- Loading, empty, error, and reconnect states.

Decorative gradients were removed. The remaining CSS gradient draws timeline grid lines. `prefers-reduced-motion` is present.

Rendered verification is still pending; do not claim the UI matches `docs/UI.jpeg` until the browser and visual gate in the canonical pending-test ledger is complete.

## 4. How a Mission currently works

1. The browser posts a bounded Mission message with preset `auth-demo`.
2. `ShepherdService` creates or opens the trusted demo project, claims the single-project mutation slot, and persists the original human intent.
3. The service creates fixed frontend/backend Contracts with distinct Agents, authority, expected artifacts, acceptance profiles, and declared `auth.transport` claims.
4. `selectRunnableContracts()` validates the DAG and selects the initial safe batch.
5. Each Contract receives a real Git Plane and isolated execution workspace. The deterministic executor is used in deterministic mode; `CodexShepherdExecutor` uses fresh ephemeral container/Codex identities in live mode.
6. The trusted control plane builds the prompt envelope. The Agent writes project files and `.shepherd/result.json` in its disposable workspace.
7. The control plane imports the workspace, checks the real diff against authority, strictly ingests the manifest, removes control metadata, commits the Plane, and sends an immutable snapshot to the independent verifier.
8. Only independently verified/corroborated claims become durable trusted claims.
9. Verified Contract Planes merge into an integration Plane. The demo intentionally has no textual Git conflict.
10. Deterministic collision detection compares canonical exclusive claims and persists the `bearer-jwt` versus `http-only-session-cookie` collision.
11. Two resolution candidates fork from the identical integration SHA and execute concurrently.
12. Independent verification checks frontend, backend, and project security behavior. The winner policy uses mandatory evidence; the fixture invariant selects the cookie strategy unless the invariant is deliberately flipped.
13. Immediately before promotion, the gate rechecks authority, mandatory acceptance, selected-candidate identity, candidate/head consistency, and expected protected HEAD.
14. The trusted Git path promotes only the selected verified candidate; the event trail, winner, loser, and evidence remain inspectable.

## 5. Model responsibilities and deterministic responsibilities

### Live Agent model (`ARK_MODEL`)

When `SHEPHERD_EXECUTION_MODE=live`, the Agent model implements each bounded Contract/candidate in a fresh ephemeral runtime. Its output is untrusted until diff inspection, manifest ingestion, semantic corroboration, and independent verification succeed.

The model never decides protected-branch promotion and never supplies host paths or verification commands.

### Shepherd advisory model (`SHEPHERD_MODEL`)

`apps/server/src/shepherd/model-reviewer.ts` implements a bounded Ark Responses client for advisory semantic review:

- strict input/output schemas;
- bounded request/response sizes and findings;
- one request, fixed timeout, no automatic authority;
- cancellation and transport/provider/configuration degradation;
- evidence-reference validation;
- sensitive-value checks and safe failure results.

**Active PR #16:** `apps/server/src/index.ts` constructs the adapter only when
`SHEPHERD_MODEL` passes the adapter-aligned configuration gate and injects it into
`ShepherdService`. A review runs
after verified Contract integration and before deterministic collision detection;
`modelReviewEnabled` causally gates the call. Any non-disabled failure records a
bounded `model_review_degraded` event, while completed output records only closed
counts/enums and Shepherd-supplied keys. The service validates the closed bounded
result shape even for an injected reviewer, degrades malformed values explicitly,
and settles durable cancellation without depending on reviewer cooperation. Reviewer
output cannot reach collision, winner, or promotion decisions.

The double-gated post-composition live smoke made exactly one request. Composition,
durable degradation, and deterministic independence passed, but the real adapter
reported `invalid_response`; the provider's otherwise valid finding used a manifest
reference representation rejected by the adapter. `MR-03`/#21 owns that separately.
No live completed finding has been observed yet.

### Deterministic trusted components

The following must remain deterministic/trusted:

- authority intersection and actual-diff enforcement;
- manifest schema and declared-claim-key checks;
- trusted verifier profile selection;
- canonical collision rule;
- candidate mandatory-pass determination;
- objective winner policy and human tie selection validation;
- cancellation/promotion linearization;
- protected-head compare-and-swap and Git promotion;
- event cursors, persistence validation, restart reconciliation, and reset path guards.

## 6. Settings behavior

Writable settings:

- `contractTimeoutMs` — `1_000..3_600_000`
- `candidateTimeoutMs` — `1_000..3_600_000`
- `maxConcurrentPlanes` — `2..16`
- `autoResolution`
- `modelReviewEnabled` (persisted/UI only until P0 composition is fixed)
- notification preferences (public schema and stored values preserved; the browser
  displays them read-only as reserved/unavailable under `ST-02`)

Locked/derived settings:

- execution mode is derived from startup/runtime composition;
- completed Plane retention is locked on so evidence remains inspectable;
- authority enforcement and independent verification cannot be disabled in the browser.

Settings updates are rejected while a Mission is active.

## 7. Latest observed verification

The following evidence was observed on 2026-08-29 against assessed implementation
checkpoint `6c1a948` before documentation changes.

```sh
npm run check
# PASS: server and web TypeScript checks
# PASS: 26 files passed, 1 opt-in live file skipped
#       544 tests passed, 1 skipped
# PASS: web production build, 40 modules transformed
# PASS: server production build
```

Environment used: Node `24.17.0`, npm `11.17.0`, Git `2.43.0`, Docker
`29.7.2`, Linux host. The check took approximately 52 seconds for the Vitest
portion. Test TypeScript remains excluded from the server production typecheck.

Deterministic local API flow was then executed with isolated state under
`.tmp/handover-smoke-doc/`, `SHEPHERD_EXECUTION_MODE=deterministic`, and
`SHEPHERD_DEMO_MODE=true`:

- Runtime image built and bind-mount preflight passed.
- Production web/server builds passed and the server listened on
  `http://127.0.0.1:3010`.
- `GET /api/health` returned 200.
- `GET /api/system` returned 200 and reported deterministic Shepherd execution.
- `GET /shepherd` returned 200.
- `POST /api/shepherd/demo/missions` returned 202.
- The Mission reached `completed` with both Contracts `verified`, one collision,
  33 Mission events, one failed/rejected candidate, and one passed/selected
  candidate.
- Post-run `POST /api/shepherd/demo/reset` returned 200, removed five managed
  Plane paths, and left zero Missions, Contracts, Planes, collisions, or candidates.

Negative operational evidence from the same run:

- Root `npm run poc` failed before startup because its shell child did not receive
  `.env` Ark variables (`OPS-01`).
- The first safe wrapped attempt then failed because the host inherited the
  `.env` non-loopback/container path configuration; explicit loopback and
  repository-local Shepherd roots were required (`OPS-02`).
- Clean-start `POST /api/shepherd/demo/reset` returned 500 `Auth demo was not
  found`; reset passed only after initialization. This historical reproduction
  became the causal RED baseline for `RST-01` and is fixed on
  [draft PR #10](https://github.com/kyashp/shepherd/pull/10).

### RST-01 active-branch verification

Observed on 2026-08-29 against
`19a2e45f7a67c575d9acced3dfcfbc6a32f5718e` on
`fix/7-rst-01-idempotent-reset`:

- The original clean-start service/API regressions failed before the fix because
  the service threw `Auth demo was not found` and the authenticated route
  returned 404; both passed after the empty-success implementation.
- Two reset/start concurrency regressions failed before reservation because the
  concurrent Mission entered execution on a clean root and the initialized reset
  lost the race. Both passed after reset reserved `auth-demo` until `finally`.
- Reset-focused service/API tests passed 8/8; adjacent persistence/recovery tests
  passed 100/100; the complete service suite passed 23/23.
- The complete server suite passed with one worker: 25 files passed, 2 skipped;
  547 tests passed, 2 skipped. `npm run check` under Node 24.17/npm 11.17 with
  the same external worker constraint also passed both typechecks and production
  builds. `npm audit --json` reported 0 vulnerabilities across 251 dependencies,
  and `git diff --check` passed.
- Three unconstrained full-check attempts exposed `TST-01`: varying existing
  fixed-timeout Git-heavy tests failed under parallel contention but passed
  isolated and serialized. No unrelated timeout or assertion changed in PR #10.
- An independent read-only security/correctness review first found the missing
  reset reservation. After the causal TDD fix, its follow-up reported no Critical,
  Important, or Minor finding and marked the change ready to merge.
- Live GitHub state at this documentation update: issue
  [#7](https://github.com/kyashp/shepherd/issues/7) and
  [draft PR #10](https://github.com/kyashp/shepherd/pull/10) are open, the PR is
  mergeable, and GitHub reports no automated checks (`CI-01`).

Current-main integration was subsequently observed after OPS-05 merged through
PR #32 at `8110aa3ed49bd0586cbb275d7c4067552cd9a144`. RST-01 merge commit
`4673edfff0d6a205b48ca4d90821ce852a9952e4` resolved conflicts only in
`docs/BUILD_LOG.md` and this file by preserving current-main evidence and
reapplying RST-01-specific entries. Its effective diff against `origin/main`
contained exactly `apps/server/src/app.test.ts`,
`apps/server/src/shepherd/service.test.ts`,
`apps/server/src/shepherd/service.ts`, `docs/BUILD_LOG.md`, and this file.

Fresh integrated verification passed:

- reset-focused service/API tests: 8/8;
- complete `service.test.ts`: 28/28;
- complete `app.test.ts`: 19/19;
- standalone typecheck and production build;
- literal `npm run check` without overrides: launcher 3/3; server 25 files
  passed, 2 skipped; 554 tests passed, 2 skipped; both production builds;
- `npm audit --json`: 0 vulnerabilities across 251 dependencies;
- `git diff --check origin/main...HEAD` with a clean worktree.

An independent read-only final review of the integrated five-file diff at
`ecd14228e0b83f8a9087d8bce675a3ae689fd29e` reported no Critical, Important,
or Minor finding and returned **Ready to merge: Yes**. It specifically confirmed
the reset reservation/`finally` release, fail-closed path and identity boundaries,
causal clean/initialized concurrency and API coverage, exact scope, and browser
non-applicability.

Not run after this checkpoint:

- Playwright/browser journeys, screenshots, or accessibility automation because
  browser evidence is not applicable to this service/API-only correction: no UI
  source, layout, interaction, or response consumer changed, and the authenticated
  route is covered through the real Fastify injection boundary;
- custom `ui-reviewer` gate;
- broad custom `security-reviewer` gate for the remaining API/cancellation/public
  DTO and startup-path work; the scoped independent RST-01 review above is complete;
- live `SHEPHERD_MODEL` call;
- five consecutive full-suite runs;
- three timed clean demo rehearsals;
- a final live Mission on current `main`;
- a post-merge gate for these documentation changes.

### TST-02 recovery fixture clock candidate (`#33`)

Draft PR [#34](https://github.com/kyashp/shepherd/pull/34) contains a one-line,
test-only correction on code commit
`1dc3133c332b9fd31ec27d2ed5e8d620a0dae08f`. In the exact post-CAS recovery test,
the Plane was created with real wall time but reconciled with fixed 12:05Z time.
After 12:05Z, the validator correctly rejected the resulting
`updatedAt < createdAt` state. The candidate passes the fixture's existing 12:00Z
timestamp to that `PlaneManager` through its existing `now` option; recovery
behavior and assertions are unchanged.

The unmodified exact target reproduced RED after the rollover with
`Refusing to persist invalid database state`. On the candidate at real 15:08Z, the
exact target passed 1/1 and the complete `recovery.test.ts` file passed 17/17. A
literal `npm run check` in clean Node 24 Linux with the process wall clock held at
the shared 12:00Z fixture baseline passed launcher 3/3, 25 server files with 2
opt-in files skipped, 551 tests with 5 skipped, and both production builds. This is
controlled full-gate evidence, not an unconstrained real-clock pass.

Unconstrained real-clock full-suite attempts continued to expose unrelated
current-main cross-suite instability in unchanged service/recovery-process cases;
the changed recovery file remained 17/17, and the full unchanged files passed
28/28 and 5/5 in real-clock isolation. `npm audit --json` reported zero
vulnerabilities across 251 dependencies, and `git diff --check` passed. The owned
implementation scope is only `apps/server/src/shepherd/recovery.test.ts`; PR #34
does not modify production recovery, schemas/validation, SettingsPage, PR #13,
launcher files, dependencies, or unrelated tests.

An independent read-only review of the exact code range reported no Critical,
Important, or Minor finding and returned **Ready to merge: Yes**. It confirmed the
fixed clock supplies all persisted Plane lifecycle timestamps, precedes recovery by
five minutes, introduces no mutable shared clock, and leaves the fail-closed,
cleanup, event, and idempotency assertions unchanged. The evidence-only ledger
changes are restricted to `docs/BUILD_LOG.md` and this HANDOVER section.

### Merged test-lifecycle stabilization (`#11`)

[PR #19](https://github.com/kyashp/shepherd/pull/19) merged into `main` at
`120fff066d962f4f30ed6cd62bc367cc869e02db`. It contains test-only lifecycle
hardening whose causal regressions prove that a
sentinel-bound service fixture can remove
a read-only trusted-verification snapshot, rejects an external root, and neither
follows nor chmods a symlinked external target. Background-Mission tests now cancel
and join through the existing `cancelMission()` path before fixture cleanup. Three
measured service journeys plus the measured Git and recovery journeys have explicit
15-second budgets; global/unit defaults are unchanged. Five target-substitution runs
and two complete `npm run check` runs passed (547 passed, 2 opt-in skipped; web and
server builds passed). The recovery fixture's Git helper now uses a fixed child
environment rather than inheriting repository-routing variables. A disposable
fixture/decoy regression poisons `GIT_DIR`, proves the selected fixture advances,
and proves the decoy's HEAD and tree remain unchanged.

At an intermediate candidate checkpoint, the branch was resolved against `main` at
`2f7a9fd8122cb62f2f2ed4e2b08cc87f311e8887`. `npm run check` on that exact head
passed 25 files, 548 tests, with 2 opt-in tests skipped; both production builds
completed. The following paragraphs record the test-only teardown follow-up and its
final green gate before merge.

The resulting test-only teardown follow-up begins at `d8c4dff`. It retains tracked Missions
until cancellation/joining succeeds, cancels `attention_required` Missions, and
releases blocked promotion checkpoints in `finally` paths. Its bounded RED was safe
and its focused promotion/attention teardown slice plus full `service.test.ts`
passed. The first repository gate on `d8c4dff` was not green: the unmodified
Git-plane merge-conflict integration test timed out at the generic five-second
budget (24 files passed, 1 failed, 2 skipped; 549 tests passed, 1 failed, 2
skipped). That real-Git case is also owned by #11, so `0e0e743` gives only it an
explicit 15-second budget; five focused runs and its 19-test integration file pass.

A later full gate exposed the background real-Planes journey's shared 15-second
completion-helper limit, despite the test already having a 30-second Vitest budget.
`a14c3f7` permits a 25-second helper limit only at that measured call; it is not a
seventh explicit Vitest timeout. Five focused background-journey runs and the full
25-test service file pass. `npm run check` on exact head
`a14c3f71446ff5c46a84db6482fc445e9d1944d9` passed 25 files and 550 tests, with 2
opt-in tests skipped; both production builds passed. #11 now has six measured
integration tests with explicit 15-second budgets, while global/unit defaults remain
unchanged.

The draft OPS-01 fix in PR [#8](https://github.com/kyashp/shepherd/pull/8) remains a
separate startup change. #19 is merged and the combined GC-01/current-main gate is
green, but OPS-01 is not marked resolved here.

### Draft PR #17 scoped UI correction and evidence

This is newer, narrowly scoped evidence than the historical checkpoint immediately
above. It does **not** close the overall `UI-GATE` or replace the pending browser
journeys.

[Draft PR #17](https://github.com/kyashp/shepherd/pull/17) targets `main` from
`fix/15-ui-viewport-layout`. Its three implementation commits are
`3a4e24c`, `abc0c9a`, and `1406b7e`. The owned implementation files are
`apps/web/src/styles.css`, `apps/web/src/ui.tsx`, and
`apps/web/src/pages/ShepherdPage.tsx`; it deliberately does not edit
`ProjectGroupPage.tsx`, which is owned by the active Group Chat branch.

Implemented in the draft parent:

- replaced the Shepherd navigation/avatar glyph with the official Iconoir solid
  `cube-scan` geometry while retaining the existing icon wrapper and colors;
- made the application shell own the laptop viewport and moved overflow into the
  affected internal panels instead of allowing document-level X/Y scrolling;
- made the Shepherd grid consume its available main-canvas height, retained the
  composer as a fixed flex child, and reduced excess event-stream/Plane-tree bottom
  padding;
- made the Project Group panel use the same fixed-composer/flexible-scroll-history
  structure as private Agent chat, fixing the optional-reconnect-row layout bug that
  stretched the composer upward;
- improved only directly affected compact text and timeline legibility, including
  seconds for short actual timestamps and target values on Resolution rows.

Observed verification on 2026-08-29:

- `npm run typecheck -w @launchpad/web` passed;
- `npm run build -w @launchpad/web` passed;
- `npm run check` passed after the final Project Group CSS correction: 26 server
  test files passed and one opt-in live file was skipped; 544 tests passed and one
  was skipped; both application typechecks and production builds passed;
- `git diff --check` passed;
- a repository-local Playwright Chromium run used mocked authenticated API data for
  the clean-start Project Group state at `1280x800` and `1440x900`. At `1280x800`,
  the panel occupied Y `92..776`, messages `133..682`, and composer `682..775`. At
  `1440x900`, the corresponding bounds were `92..876`, `133..782`, and `782..875`.
  Both runs reported no document X/Y overflow and screenshots were visually
  inspected against the existing Launchpad aesthetic;
- the browser binary was installed only inside the ignored worktree and removed
  after verification. The temporary screenshots were not committed, so the final
  durable screenshot corpus is still pending.

Confirmed limitations and required next checks:

- the same Playwright run observed `textarea.disabled === true` in the clean-start
  Project Group state. This is existing defect `GC-05`, not fixed by PR #17;
- the Shepherd page, populated Project Group history, all remaining routes,
  keyboard/focus behavior, loading/error/reconnect states, and accessibility were
  not rendered after the final correction and must not be inferred from the scoped
  empty-state result;
- no model/API capacity was consumed for this UI verification;
- the required independent `ui-reviewer` role was unavailable, so PR #17 remains
  draft pending that review and the remaining rendered gates;
- preserve the mandatory minimal-fix and existing-UI instructions above when
  addressing any remaining UI defect. Do not broaden PR #17 into Group Chat product
  behavior; coordinate `GC-05` with the active Group Chat owner and merge stacks in
  documented parent order.

### Draft PR #9 post-#19 `GC-01` evidence

[Draft PR #9](https://github.com/kyashp/shepherd/pull/9) was integrated on merged
current `main` commit `120fff066d962f4f30ed6cd62bc367cc869e02db`, the merge commit
for [PR #19](https://github.com/kyashp/shepherd/pull/19). The detached integration
contained only `ProjectGroupPage.tsx`, `project-group-mention.ts`, and
`project-group-mention.test.ts`; all three blob hashes matched PR #9.

Observed on that exact integration:

- mention-format RED reproduced `@Frontend Agent` instead of
  `@"Frontend Agent"`; draft-preservation RED found no pure prepend contract;
  GREEN passed 3/3 formatter/preservation tests;
- `npm run check` passed: 25 test files passed, 2 opt-in files skipped; 550 tests
  passed, 2 skipped; both workspace typechecks and both production builds passed;
- terminal Playwright exercised the real Vite page with deterministic API
  interception at exact `1280x800` and `1440x900` viewports;
- mouse click, keyboard Enter, and keyboard Space each produced
  `@"Frontend Agent" Keep this draft\nincluding its second line`, preserved the
  multiline draft, returned focus to `#group-message`, and left a collapsed
  `59..59` caret for the 59-character value;
- keyboard focus matched `:focus-visible` with a solid 2 px outline; neither
  viewport had horizontal overflow, console/page errors, unexpected API calls,
  clipping, or overlap;
- both screenshots were visually compared with `docs/UI.jpeg` and preserved the
  existing Launchpad visual language. The temporary harness/screenshots were not
  committed.

A final review found a second causal edge case: the server normalizes the complete
message before decoding a quoted target, so a valid stored name such as
`Frontend  Agent` could be collapsed to a different lookup key. RED failed 2/5
focused tests: the formatter emitted the changed name instead of the target Agent
ID, and syntax-changing compatibility punctuation remained unnormalized. GREEN
passed 5/5 and fed the generated mentions through the production server parser.
A second review then found the parser directory's post-NFKC trim edge; its RED
failed 1/6 for U+037A and GREEN passes 6/6. Normal parser-valid names stay readable
and quoted, compatibility punctuation is normalized before JSON escaping, and
parser-valid names that cannot survive whole-message normalization use the Agent
UUID when the shared ID/name lookup namespace is unambiguous. No stored data,
schema, or server routing behavior changed.

After integrating current `main` at `d27dea6`, the pure regression moved from the
unconfigured web test location into the default server Vitest workspace. Its
packaging RED reported no matching test file before the move. Independent review
then found an in-flight mention/draft-loss race and a 2,000-character programmatic
insertion edge; their RED failed 2/8 and GREEN passes 8/8 after native submission
locking, a defensive callback guard, and bounded prepend/status behavior.

The current-head Node 24 `npm run check` completed both typechecks, the 3/3 launcher
tests, and all GC-01 coverage, but failed two unchanged server cases under full-suite
load (24 files passed, 2 failed, 2 skipped; 557 tests passed, 2 failed, 5 skipped).
The service case passes 1/1 alone. Recovery-process isolation rotated from an earlier
5/5 pass to a later 4/5 failure in a different checkpoint; the PR has no diff in
either path. Both production builds pass independently, `git diff --check` passes,
and the dependency audit reports 0 vulnerabilities. Terminal Playwright at both
exact viewports retains the green mouse/Enter/Space, focus-visible, `59..59` caret,
no-overflow, and visual results; it also proves the deferred-POST lock, draft
preservation, and exact/over-limit behavior without unexpected writes or runtime
errors. Final independent follow-up reported no Critical, Important, or Minor
finding and returned **Ready to merge: Yes**. The full check is still explicitly
**not** claimed green; integrator disposition of the existing suite instability,
required checks, and post-merge verification remain.

This closes `GC-01`'s scoped formatting, draft-preservation, native activation,
focus/caret, and required-viewport uncertainty. It does not close `GC-02..07`,
polling/reconnect or populated-history browser coverage, accessibility, the
committed E2E harness/screenshot corpus, independent UI review, or post-merge
verification after PR #9 itself lands.

## 8. Failure-matrix audit

PRD Section 12 is **not complete**.

| Category | Current status |
|---|---|
| Agent timeout | Missing at Contract orchestration level; Contract timeout becomes generic `unknown`. |
| Agent runtime error | Candidate path is typed/retried; Contract path is generic `unknown`. |
| Missing result manifest | Durable implementation exists; no service-level fault/state/event/API test. |
| Malformed manifest | Parser coverage exists; service-level durable transition test missing. |
| Invalid semantic evidence | Strong backend coverage for Contract and candidate target corroboration. |
| Omitted declared claim key | Parser coverage only; durable service/event test missing. |
| Unauthorized file change | Strong Contract/candidate/promotion fail-closed coverage. |
| Failed independent acceptance | Strong candidate evidence path; Contract fault test incomplete. |
| Worktree creation failure | Missing durable Plane/Mission event path; initial creation fails before entity persistence. |
| Git textual merge conflict | Git layer detects it, but service converts it to a generic throw. |
| Semantic collision | Strong durable backend coverage. |
| Candidate timeout | Partial; classification is brittle and orchestration test is missing. |
| Single-candidate failure | Strong backend coverage; loser remains inspectable. |
| All-candidate failure | Strong backend coverage and no promotion. |
| Objective tie | Winner-policy unit tests exist; real service tie/escalation/promotion test missing. |
| Final re-verification failure | Promotion-gate unit coverage; durable service state/event test missing. |
| Protected branch moved | Strong gate/service/restart fail-closed coverage. |
| Verification infrastructure error | Human-promotion path covered; Contract verifier exception can strand active-looking entity states. |
| Server restart mid-Mission | Strong four-checkpoint process recovery coverage. |
| Persistence error | Store atomic rollback covered; no durable `persistence_failed` recovery-visible Mission path. |
| UI polling interruption | UI retries and shows reconnect state; no browser interruption/cursor-reconciliation test. |
| Model reviewer failure | Active PR #16 composes the adapter and causally covers disabled, cancelled, timeout, thrown/provider, configuration/redaction, hostile/malformed results, and an abort-ignoring injected reviewer. Failures durably degrade without failing or changing the deterministic Mission; cancellation settles independently; merge/post-merge evidence remains. |

Related gaps:

- The scheduler handles only the fixed first batch in the service. It does not yet run general dependency waves with real Agent occupancy/mutation-lock/active-Plane inputs.
- Cycles are rejected at scheduler evaluation, not before Contract graph persistence.
- Retry is capped at one, but transient classification is too broad and a second-failure/no-second-retry test is missing.
- A normal `failed` Mission's specific failure is not prominent in the UI; the detailed attention panel is limited to attention states.
- Every failure category still lacks the PRD-required browser assertion.

## 9. API/UI security notes

Preserve these invariants while fixing the remaining work:

- Never expose `.env`, Ark keys, app tokens, Codex credentials, raw prompts, raw session IDs, host paths, execution identities, or verifier diagnostics.
- Do not add public fault/debug endpoints for Playwright. Use a test-only composition or browser network fixtures for visual-state tests and pair them with causal backend fault tests.
- Browser requests may select only trusted IDs/presets; never accept filesystem paths or commands.
- Keep reset fixed to `auth-demo` and validate exact trusted repository/branch identity before cleanup.
- Keep model review advisory-only. Findings may flag evidence; they must never select a candidate or authorize promotion.
- Do not weaken assertions to make failure-matrix tests pass.

Because this checkpoint materially changed scoped authority, public DTOs, cancellation, reset/file handling, and model-controlled execution surfaces, run the required read-only `security-reviewer` before merge. Because it materially changed every primary UI surface, run the read-only `ui-reviewer` after browser screenshots.

## 10. Required continuation plan

### P0 — correctness and truthfulness

1. **Restore the documented local run path (`OPS-01`, `OPS-02`)**
   - Load `.env` into the local-PoC shell child without sourcing it or printing
     values.
   - Resolve all host PoC data roots inside the documented local root unless an
     explicit validated override is supplied.
   - Add causal script/config tests and rerun the exact startup reproduction.
   - Keep these changes separate from reviewed
     [RST-01 draft PR #10](https://github.com/kyashp/shepherd/pull/10); after it
     merges, run the clean and initialized reset post-merge gate.

2. **Typed failure hardening**
   - Introduce typed stage failures for Contract timeout/runtime, verifier infrastructure, Plane creation, integration conflict, and persistence failure.
   - Persist exact Contract/Plane/Agent/Mission states and evidence; never leave `verifying`, `inspecting`, or `busy` after a terminal error.
   - Preserve error type through `recordMissionFailure()` instead of converting every unknown path to code `unknown`.

3. **Complete service fault tests**
   - Add causal tests for every partial/missing row in Section 8.
   - Assert entity state, event, public API representation, and absence of promotion.
   - Add exactly-once retry failure coverage and idempotent repeated cancellation.

4. **Finish and merge the Shepherd model reviewer composition**
   - PR #16 implements the optional dependency, configured `index.ts` composition,
     bounded trusted input, safe completed/degraded events, toggle causality,
     cancellation/deadline containment, and deterministic independence.
   - Complete final security/correctness review, merge through the protected PR,
     then repeat the scoped deterministic flow on updated `main`. The final diff has
     no rendered UI behavior after the presentation-only regex deltas were removed.
   - Keep `MR-03`/#21 separate; do not weaken evidence-reference validation in PR #16.

5. **Fix or disable misleading UI states**
   - Until item 3 is complete, disable or clearly label the model-review setting as unavailable.
   - `ST-02` labels notification preferences reserved/unavailable on PR #13; preserve
     that state until a separately approved notification capability exists.
   - Show typed failure evidence for ordinary `failed` Missions, not only `attention_required` Missions.
   - Produce and persist real trusted duration estimates for the `est.` timeline
     layer (`UI-02`), clearly distinct from actual timestamps.
   - Follow the mandatory minimal UI and visual-preservation policy in the canonical ledger.

6. **Repair Project Group end to end**
   - Merge the parser-safe mention formatting and pure draft-preservation coverage for `GC-01` from [draft PR #9](https://github.com/kyashp/shepherd/pull/9).
   - Treat the scoped `GC-01` button/keyboard/focus/caret/viewport gate as complete on the post-#19 integration; after PR #9 merges, rerun it on merged `main`.
   - Fix `GC-02..07` with the smallest coherent changes; `GC-07` belongs to a separate server/schema validation change, must align canonical length and cross-ID/name namespace rules, and requires a non-destructive existing-data repair plan.
   - Preserve the existing bounded parser and security boundary; do not turn chat text into arbitrary commands or model-controlled host actions.
   - Add causal service/API tests and real browser journeys for every corrected behavior.

### P1 — browser and visual gate

7. Create `playwright.config.ts`, a repo-local deterministic startup harness, and a fake Codex CLI for legacy Playground tests. Keep all state/browser cache under repository `.tmp` and never read `.env`.
8. Drive all eight PRD journeys. Use real HTTP/service behavior where safe. For visual states that require fault injection, use test-only composition/network fixtures and pair each with its backend causal test; do not expose production debug routes.
9. Capture every stage at `1280x800` and `1440x900` under `docs/ui-review/`.
10. Measure event persistence-to-visible latency (`<=1.5s`), retry/reconnect cursor reconciliation, responsive overflow, focus/labels/contrast, long-ID title behavior, and loading/empty/error states.
11. Compare the result to `docs/UI.jpeg` with the PRD checklist, then invoke the read-only `ui-reviewer` and fix every high/medium finding.

Repository-local Chromium was reported present at `.tmp/playwright-browsers/`; no Playwright harness/files were created during this checkpoint.

### P1 — scheduler and review gates

12. Extend service scheduling to real DAG waves with actual busy-Agent IDs, mutation lock, active Plane count, dependency blocking, and pre-persistence cycle rejection.
13. Run the read-only `security-reviewer` after all startup/failure/model/browser changes. Fix findings, then rerun targeted and full gates.

### P2 — freeze and deliverables

14. Add test-file TypeScript checking; production `apps/server/tsconfig.json` excludes `*.test.ts`.
15. Run the complete suite at least five consecutive times and fix flakiness by cause.
    PR #19 removes the demonstrated temporary-repository route by giving its Git
    fixture helper a fixed child environment. The pre-push hook itself still needs a
    separate infrastructure audit: use `ECC_SKIP_PREPUSH=1` only after manual gates,
    and inspect history/artifacts rather than accepting hook-created changes.
16. After PR #10 merges, run three clean reset-to-completion demo rehearsals and
    record timings, including both a clean-root no-op reset and an initialized reset.
    Use a second machine/state only if genuinely available; otherwise document that
    limitation.
17. Finish/update:
    - `docs/SHEPHERD.md`
    - `docs/BUILD_LOG.md`
    - `docs/DEVIATIONS.md`
    - `docs/SHEPHERD_ARCHITECTURE.md` with locally validated Mermaid
    - `docs/SHEPHERD_TEST_REPORT.md`
    - `README.md`
    - this `docs/HANDOVER.md` from final merged evidence (do not create a competing `HANDOFF.md`)
18. Run `npm run check`, secret/store/DOM scans, artifact audit, final deterministic demo, and the separately opt-in live smoke.
19. Commit each coherent feature/gate on its branch. Merge to `main` only after all relevant gates pass, then rerun typecheck, full tests, build, browser smoke, and one clean demo on `main`.

## 11. File map for the next agent

Workflow/startup:

- `.github/ISSUE_TEMPLATE/work-item.yml`
- `.github/pull_request_template.md`
- `CONTRIBUTING.md`
- `package.json`
- `scripts/start-local-poc.sh`
- `.env.example`

Core orchestration:

- `apps/server/src/shepherd/service.ts`
- `apps/server/src/shepherd/service.test.ts`
- `apps/server/src/shepherd/state-machine.ts`
- `apps/server/src/shepherd/scheduler.ts`
- `apps/server/src/shepherd/resolution.ts`
- `apps/server/src/shepherd/promotion-gate.ts`

Runtime/trust boundaries:

- `apps/server/src/shepherd/codex-executor.ts`
- `apps/server/src/shepherd/prompt.ts`
- `apps/server/src/shepherd/manifest.ts`
- `apps/server/src/shepherd/authority.ts`
- `apps/server/src/shepherd/verifier.ts`
- `apps/server/src/shepherd/model-reviewer.ts`

Git/demo/recovery:

- `apps/server/src/shepherd/git-client.ts`
- `apps/server/src/shepherd/plane-manager.ts`
- `apps/server/src/shepherd/demo-project.ts`
- `apps/server/src/shepherd/recovery.ts`

Persistence/API/composition:

- `apps/server/src/database-schema.ts`
- `apps/server/src/database.ts`
- `apps/server/src/store.ts`
- `apps/server/src/agent-service.ts`
- `apps/server/src/app.ts`
- `apps/server/src/index.ts`
- `apps/server/src/config.ts`

UI:

- `apps/web/src/App.tsx`
- `apps/web/src/Shell.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/types.ts`
- `apps/web/src/shepherd-hooks.ts`
- `apps/web/src/pages/ShepherdPage.tsx`
- `apps/web/src/pages/ProjectGroupPage.tsx`
- `apps/web/src/pages/AgentsPage.tsx`
- `apps/web/src/pages/AgentPage.tsx`
- `apps/web/src/pages/AgentFormPage.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/styles.css`

Authoritative requirements/evidence:

- `docs/PRD.md`
- `docs/UI.jpeg`
- `docs/BUILD_LOG.md`
- `docs/SHEPHERD.md`
- this file

## Run and test the current solution

### Safety and current caveats

- Do not source or print `.env`. The command below lets Node parse it and passes
  the resulting environment to the existing startup script without echoing values.
- Default tests and the deterministic Shepherd Mission do not call Ark. The legacy
  Agent Playground does call `ARK_MODEL`; the opt-in live Shepherd test calls the
  configured model and consumes real capacity.
- Use repository-local state for QA. Do not point the demo at another repository or
  an existing data directory.
- Merged PRs #8/#28 make `./scripts/start-local-poc.sh` the `.env`-based entry
  point, but the current ignored `.env` also carries a container-wide host value.
  Until `OPS-04` merges, add an explicit `HOST=127.0.0.1` override or run the
  verified `fix/29-ops-04-local-loopback` candidate; do not weaken the application
  token validation.
- On this branch, **Reset demo state** is safe before the first Mission and returns
  a deliberate empty success. Until
  [PR #10](https://github.com/kyashp/shepherd/pull/10) merges, unmodified `main`
  still has the historical `RST-01` clean-start failure.
- The trusted verifier needs Docker, Colima, or Podman. The command below was
  verified with Docker.

### 1. Preflight and deterministic checks

From the repository root:

```sh
node --version               # must be 22+
npm --version
docker info                  # or podman info
npm ci
npm run check
```

Latest current-main GC-01 evidence is recorded against `d27dea6`: the default
server-workspace regression passes 8/8, both workspace typechecks and both
production builds pass, and the audit reports 0 vulnerabilities. The full suite is
not green: the current-head attempt exposed two unchanged server failures under
suite load (557 passed, 2 failed, 5 skipped); the service case passes 1/1 alone and
the recovery file rotates across checkpoints even in isolation. Preserve those
exact results rather than copying an older green count.

### 2. Start the local PoC

On draft PR #28 and after it merges, configure the required values in the ignored
repository `.env` and run the direct entry point without additional parameters:

```sh
./scripts/start-local-poc.sh
```

Node parses `.env`; the script never sources it. Exact Docker-default `/app/...`
data paths are mapped to the platform's local state root, while explicit custom
host paths remain unchanged. On current `main` before #28 merges, use `npm run poc`.

Wait for `Server listening at http://127.0.0.1:3000`. Keep this terminal open.
The first run may build `volc-agent-runtime:local`.

Open <http://127.0.0.1:3000>. If an unlock screen appears, enter the
`APP_AUTH_TOKEN` from your own `.env`; do not paste it into an issue, screenshot,
terminal log, or chat message.

### 3. Full deterministic Shepherd hero flow

Perform these steps in order and capture a screenshot plus a short note whenever
actual behavior differs:

1. Open **Shepherd**. On a clean root, expect an empty Contract stream, waiting
   timeline, empty Plane Tree, and enabled Mission composer. Do not reset yet.
2. Enter:

   ```text
   Implement the authentication demo and resolve any incompatible frontend and backend assumptions using independently verified evidence.
   ```

   Press Enter once. The UI always maps this current composer to the fixed safe
   `auth-demo` preset.
3. Verify the Mission appears and ultimately reaches `completed`. The deterministic
   run may finish in several seconds, so intermediate polling frames may be brief.
4. In the Contract stream, verify evidence for this causal order:

   ```text
   Mission/Contracts created
   → two isolated Contract Planes
   → both Contracts independently verified
   → clean textual integration
   → auth.transport semantic collision
   → two Resolution Planes
   → one candidate failed/rejected and one passed/selected
   → promotion completed
   → Mission completed
   ```

5. Select each stream filter: **All**, **Contracts**, **Verification**,
   **Collisions**, and **Resolution**. Confirm each shows only relevant real events
   and no secret, absolute host path, raw prompt, raw verifier output, or session ID.
6. Inspect the timeline. Confirm real Contract/candidate rows and actual times. Also
   note the known `UI-02` gap: a real `est.` duration layer is not expected yet.
7. Expand the `auth.transport` collision and confirm it shows `bearer-jwt` versus
   `http-only-session-cookie` with a resolved state.
8. Click every Plane Tree node. Confirm the detail drawer has purpose, short SHAs,
   changed-file information, status, and verification evidence; close the drawer
   and check that no panel overlaps or escapes the viewport.
9. Resize or repeat at `1280x800` and `1440x900`. Check horizontal overflow,
   clipped controls, unreadable state pills, truncated IDs without titles, focus
   visibility, keyboard order, contrast, and modal/drawer behavior against
   `docs/UI.jpeg`. This is manual discovery, not a substitute for the pending
   Playwright/UI-review gate.

Expected backend result from the recorded smoke: two Contracts `verified`, one
collision, 33 Mission events, one candidate `failed/rejected`, one candidate
`passed/selected`, and Mission `completed`. UI wording/counts may evolve only with
updated tests and handover evidence.

### 4. Exercise settings and manual promotion

1. Open **Settings → General → Reset demo state** now that one Mission has
   initialized the fixture. Confirm the warning and success message.
2. Open **Settings → Execution**.
3. Change **Maximum parallel Planes** within 2–16 and change one timeout; select
   **Save settings**, refresh, and confirm the values round-trip. Restore the
   original values afterward.
4. Turn **Automatic resolution** off and save.
5. Return to **Shepherd**, start the same Mission again, and wait for
   `attention_required` with **Human decision required**.
6. Only the independently passing future should offer **Select verified future**.
   Select it, confirm the dialog, and verify the same trusted promotion path reaches
   `completed`.
7. Restore **Automatic resolution** to its original value.
8. On current `main`, treat **Bounded model review** as inert until PR #16 merges.
   On PR #16 it causally gates a bounded advisory call when configured; an
   unconfigured server still needs separate truthful unavailable/configured copy.
   Under **Notifications**, verify the PR #13 `ST-02` state:
   the section says **Unavailable**, each stored preference is labelled **Reserved**,
   controls are disabled and cannot receive focus or mutate, and interaction sends no
   settings `PATCH`. Persistence remains future-state data, not delivery evidence.

### 5. Exercise cancellation

1. Reset after a completed Mission using **Settings → General → Reset demo state**.
   Confirm the warning. It should now report success.
2. Start a Mission and immediately choose **Cancel Mission** before the
   deterministic work completes.
3. Confirm cancellation and verify the Mission reaches durable `cancelled`, work
   stops, Agents are released, evidence remains, and no candidate is promoted.
4. If the button disappears because the fast deterministic Mission already
   completed, record this timing limitation; do not call cancellation a pass.

### 6. Exercise Project Group and compare remaining defects

Open **Project Group** after the demo project exists. First confirm the `GC-01` fix:
click `@Frontend Agent` with an existing multiline draft, verify it prepends
`@"Frontend Agent"`, preserves the draft, returns focus/caret to the composer, and
works with mouse, Enter, and Space. The following separate defects should remain
reproducible until their task IDs merge:

1. Send an unmentioned message such as `Summarize the current Mission.` It persists,
   but no bounded Shepherd reply/action occurs (`GC-02`).
2. Manually enter a quoted mention such as:

   ```text
   @"Frontend Agent" Create a bounded frontend authentication contract.
   ```

   The parser accepts the quoting form, but targeted work still depends on an
   already-active matching Contract and can return a conflict once the fast Mission
   has completed (`GC-03`, `GC-04`).
3. On a completely clean project, the composer is disabled until a Mission creates
   the Shepherd project (`GC-05`).
4. Verify completion summaries are authored by Shepherd rather than manifest-derived
   Agent senders (`GC-06`).
5. Create/update validation does not yet reject source-short names whose NFKC+trim
   form exceeds the parser's 128-character key limit or names canonically equal to
   another Agent's ID. Do not exercise either case against persistent QA data; fix
   `GC-07` with disposable API/parser fixtures and an explicit repair plan for any
   pre-existing invalid or colliding names.

If the behavior differs from these descriptions, record it as new evidence; do not
silently delete a defect row.

### 7. Optional real Agent Playground flow (uses `ARK_MODEL`)

Run this only when one bounded live test is justified:

1. Select **Create Agent**.
2. Name it `Manual QA Agent`, choose **Generalist**, retain the recommended authority
   preset, add a short description, and create it.
3. In its **Legacy Playground**, send exactly one small task:

   ```text
   Create a dependency-free hello.js that prints "Hello, Shepherd", add a Node test, run it, and report the exact test result.
   ```

4. Wait for `queued → running → completed` and inspect the response. Send one small
   follow-up: `Reply with only the exact greeting produced by hello.js.` Confirm the
   conversation continues rather than starting a new history.
5. Stop the server with Ctrl+C, rerun the same startup command against the same
   `.tmp/manual-qa` root, unlock, and confirm the Agent, both turns, Runs, and
   workspace continuity remain.

This exercises the legacy Agent model, not Shepherd's reviewer. Current `main` is
still uncomposed until PR #16 merges; on PR #16 the reviewer has its separate,
double-gated `test:shepherd:model-review:live` command. Do not run either live suite
merely to inspect the UI; both are opt-in and consume real capacity.

### 8. Record bugs so agents can act on them

For every observation, create or update a GitHub issue with:

```text
HANDOVER/PRD ID:
Assessed commit:
Viewport and browser:
Flow step:
Expected behavior:
Actual behavior:
Exact reproduction:
Screenshot/video/log (redacted):
Frequency:
Safety/data impact:
Proposed acceptance test:
Known existing ID or NEW:
```

Never include `.env`, tokens, model credentials, raw prompts, absolute private paths,
or unbounded logs. Link the issue and draft PR back into the relevant handover row.

### 9. Stop safely

Press Ctrl+C in the server terminal. The startup script removes only this instance's
remaining Runtime containers and keeps `.tmp/manual-qa` for restart testing. Do not
recursively delete a broad path; clean only the exact ignored QA directory after you
no longer need its evidence.

## 13. Current confidence, scoped honestly

- **Confidence that this checkpoint's implemented and tested backend behavior works:** 88/100.
- **Confidence that the entire PRD currently works exactly as intended:** 64/100.
- **Current hackathon-win confidence:** 52/100.

All three values are below 100 and therefore require review under this handover's
policy. The lower full-product scores are driven by known, enumerated gaps—not
unexplained instability. The kernel story is differentiated and the server suite is
strong, but judges will directly experience browser polish, demo reliability, and
transparent failure evidence. Completing the P0/P1 items would materially raise both
estimates.
