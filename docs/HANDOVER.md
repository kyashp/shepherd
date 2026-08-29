# Shepherd Engineering Handover

**Date:** 2026-08-29 (Asia/Singapore)

**Track:** TikTok TechJam 2026, Track 1 — Agent Launchpad middleware

**Assessed branch:** `main`

**Assessed implementation checkpoint:** `6c1a948c52b8c6b8107ffcc87e63a1352e62481a`
(`chore(docs): add techjam brief docs`)

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
pending. The latest production type checks, production builds, and full server suite
are green.

The remaining work is material:

- `SHEPHERD_MODEL` is implemented only as a bounded standalone `ArkModelReviewer`; it is not composed into Mission orchestration.
- Several PRD Section 12 failures still collapse to a generic Mission failure or lack service-level fault tests.
- No Playwright configuration, eight-journey suite, screenshots, or independent rendered UI review exists yet.
- Final architecture/test-report/README completion, repeated stability runs, and
  three timed rehearsals are not complete.
- `npm run poc` currently fails to pass `.env` values into its shell child in this
  environment; the verified safe workaround is documented below.
- A clean-start demo reset returns `500 Auth demo was not found`; reset succeeds
  after the first demo project has been initialized.

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
| Guarded `auth-demo` reset, unrelated-data preservation, cursor preservation, hostile-path protection, and recovery after Git-reset/store-persist failure | Reset/service/database tests; full server suite | **95%** |
| Authenticated Shepherd HTTP schemas, stable error statuses, path-free controls, demo-mode guards, and public DTO redaction | API tests; focused 116-test gate; full server suite | **95%** |
| Project Group **parser only**: bounded normalization, exact/quoted mentions, ambiguity rejection, and inert untrusted content | `group-routing.test.ts`: 10/10 passed | **97%** |
| Standalone `ArkModelReviewer` adapter only: schema validation, bounded I/O, timeout/cancellation, sensitive-value rejection, and explicit degradation results | `model-reviewer.test.ts` and Phase 3 full suite | **94%** |
| Phase 3 live Codex runtime isolation at the Phase 3 checkpoint | Two fresh live Missions, eight isolated sessions, real collision/promotion evidence recorded in `docs/BUILD_LOG.md` | **88%**; not rerun after Phase 4 changes |

The following are **not** included in the fully-tested claim above: rendered UI behavior, complete Group Chat behavior, general DAG scheduling, model-review Mission composition, and every missing/partial row in the failure matrix.

### Confirmed defects and partial behavior

| ID | Area | Confirmed defect / mismatch | User-visible or safety impact | Required minimal correction |
|---|---|---|---|---|
| `OPS-01` | Local startup / `.env` | On Node 24.17/npm 11.17, root `npm run poc` executes `node --env-file-if-exists=.env --run=poc:inner`, but the shell child did not receive `ARK_API_KEY`/`ARK_MODEL`; direct `node --env-file-if-exists=.env -e ...` proved the variables are present. | The documented `.env`-based one-command startup exits with “ARK_API_KEY and ARK_MODEL are required.” | Add the smallest safe Node-to-shell launcher that inherits the already parsed environment, or otherwise fix the root script without sourcing arbitrary shell content; add an env-presence regression that never prints values. |
| `OPS-02` | Local startup paths | `.env.example` contains container paths such as `/app/data/shepherd`. When `.env` is loaded for host PoC startup, `start-local-poc.sh` does not rebase `SHEPHERD_ROOT`/`SHEPHERD_CODEX_HOME_ROOT` into `LOCAL_POC_DATA_ROOT`. | Host startup can target unintended absolute paths or fail permissions; this also violates repository-local test-state expectations. | In local-PoC mode, derive all Agent and Shepherd data roots from the one documented local root while preserving explicit, validated opt-in overrides. Add path-resolution tests. |
| `OPS-03` | Verifier image fallback | **Resolved on `main` by [PR #22](https://github.com/kyashp/shepherd/pull/22).** `.env.example` deliberately leaves `SHEPHERD_VERIFIER_IMAGE` empty; the schema now lets that value reach the existing `CONTAINER_RUNTIME_IMAGE` fallback, with a causal regression. | The previous Zod `too_small` startup failure is fixed. | Post-merge config tests passed 16/16 and the exact `.env`-loaded local-PoC smoke reached the listener and served HTTP 200. No `OPS-03` code work remains; keep unresolved `OPS-01` and `OPS-02` separate. |
| `RST-01` | Demo reset | `POST /api/shepherd/demo/reset` on a clean data root returns HTTP 500 with `Auth demo was not found`; after one Mission initializes `auth-demo`, reset succeeds and removes all managed state. | “Reset demo state” fails on first launch and exposes a server error instead of an idempotent clean result. | Make clean-start reset an idempotent success or return a deliberate non-error empty result; add service/API/UI regression tests. |
| `GC-01` | Group Chat mention buttons | `main` inserts `@Frontend Agent`, while names containing spaces require `@"Frontend Agent"`. [Draft PR #9](https://github.com/kyashp/shepherd/pull/9) generates parser-safe JSON-quoted/escaped mentions and causally covers preservation of existing multiline composer content. | Until PR #9 merges, mention buttons do not route the demo Agents. After merge, real button/keyboard/focus behavior still requires browser evidence. | Merge PR #9 after button-to-composer, keyboard activation, focus/caret, and `1280x800`/`1440x900` browser checks; keep `GC-02..06` as separate behavior defects. |
| `GC-02` | Unmentioned Group Chat messages | The backend persists a human message with no target, but does not invoke Shepherd, create work, or post a Shepherd response. | UI says “Unmentioned → Shepherd,” but no Shepherd action occurs. | Route through an existing bounded Shepherd action/response contract; do not add free-form shell/model authority. |
| `GC-03` | `@Agent` assignment | It only links to an already-created Contract in an active Mission; it cannot create a new bounded Contract. | The required targeted Contract journey is incomplete. | Add a constrained, schema-validated Contract-creation path or change the copy/acceptance contract if product direction is explicitly revised. |
| `GC-04` | Mission timing | `@Agent` returns `409` after the active Mission finishes, and the deterministic Mission may finish before a human can use Group Chat. | The demo interaction is unreliable. | Make the bounded targeted journey independent of a narrow timing race while retaining one-project/one-mutation safety. |
| `GC-05` | Pre-Mission chat | Composer is disabled until a Shepherd project exists. | Group Chat appears broken on a clean start. | Either initialize the safe demo project read model without starting execution or provide a clear in-panel Mission-start action. |
| `GC-06` | Agent summaries | Lifecycle summaries are sent as Shepherd; Agents do not post concise manifest-derived completion summaries as `senderType: agent`. | Required human/Shepherd/Agent conversation is incomplete. | Map verified manifest summaries to bounded server-authored Agent messages after verification. |
| `MR-01` | Shepherd advisory model | `ArkModelReviewer` is not injected into `ShepherdService` or composed in `index.ts`. | `SHEPHERD_MODEL` is unused by Missions. | Add advisory-only composition after trusted Contract evidence exists; deterministic collision/winner/promotion must remain authoritative. |
| `MR-02` | Model-review setting | `modelReviewEnabled` persists and the UI presents it as functional, but it changes no execution behavior. | Misleading control. | Wire `MR-01`, or disable and label the control unavailable until wired. |
| `ST-01` | Startup settings | `SHEPHERD_AUTO_RESOLUTION` and `SHEPHERD_MAX_PARALLEL_PLANES` are parsed by config but not passed to `ShepherdService` as initial settings. | Environment configuration can be silently ignored. | Add explicit initial-setting composition and tests without overriding later persisted operator settings unexpectedly. |
| `ST-02` | Notifications | Notification toggles persist but no notification delivery or in-app notification behavior consumes them. | Functional-looking settings have no effect. | Implement a bounded in-app behavior or label the preferences as reserved/unavailable; no external integration without approval. |
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

### Implemented but not fully tested

| Feature/path | What exists | Missing evidence before it may be called complete |
|---|---|---|
| Six UI surfaces and shared navigation/design system | All requested routes compile and production-build | Real browser interaction, screenshots, responsive review, accessibility, and independent UI review |
| Shepherd stream, filters, timeline, Plane Tree, detail drawer, cancel/selection controls | React components and API bindings exist | Populated deterministic browser journey, real Git/tree comparison, event visibility timing, failure slices |
| Project Group message display/polling | Read API, sorting, connection/error/empty states exist; parser-safe mention formatting and pure draft preservation are implemented in [draft PR #9](https://github.com/kyashp/shepherd/pull/9) | Browser polling/reconnect and mention-button keyboard/focus/viewport evidence; fixes for `GC-02..06` |
| Legacy Playground in the new shell | Existing workflow retained in source | Create → task → follow-up → stop/restart Playwright regression |
| Create/Edit Agent UI | Role/preset/advanced forms compile | Browser validation, keyboard/accessibility, and persistence round-trip |
| Settings UI | Timeout/concurrency/auto-resolution values call real API | Browser round-trip; fix misleading model/notification controls and startup-env composition |
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
| Host local-PoC startup | Runtime build/preflight and deterministic server were reached through a safe Node env-wrapper with repository-local roots; merged [PR #22](https://github.com/kyashp/shepherd/pull/22) fixes the empty verifier-image fallback (`OPS-03`), and the post-merge smoke reached the listener and served HTTP 200 | Fix and regression-test `OPS-01`/`OPS-02`; then verify the documented one-command path without shell-sourcing `.env` |

### Unimplemented required behavior

| Required behavior | Status |
|---|---|
| Mission-composed bounded `SHEPHERD_MODEL` semantic review and durable `model_review_degraded` event | **Unimplemented**; standalone adapter only |
| General multi-wave DAG scheduling with actual Agent occupancy, mutation lock, active Plane capacity, and downstream re-evaluation | **Unimplemented in service orchestration**; scheduler module exists |
| Complete unmentioned-message → Shepherd action/reply behavior | **Unimplemented**; persistence only |
| Bounded Project Group `@Agent` Contract creation independent of an already-existing active Contract | **Unimplemented** |
| Manifest-derived Agent completion messages in Project Group | **Unimplemented** |
| Durable recovery-visible persistence-failure evidence | **Unimplemented** |
| Complete typed implementation for every PRD Section 12 failure row | **Unimplemented/partial**, itemized above and in the failure matrix |
| Playwright configuration, deterministic browser harness, fake Codex CLI, and all eight journeys | **Unimplemented** |
| Required screenshot corpus and visual checklist report | **Unimplemented** |
| Notification delivery/consumption for the added notification settings | **Unimplemented** |
| Persisted/served trusted Contract duration estimates for the timeline | **Unimplemented**; UI has an optional dead-data rendering branch only (`UI-02`) |
| Final generated architecture document, final test report, and final README refresh | **Unimplemented**; this `HANDOVER.md` is the single continuation entry point and must be kept current rather than duplicated as `HANDOFF.md` |

### Pending test and review ledger

The next agent must explicitly mark each item pass/fail with the exact command and observed evidence:

1. Fix and test `OPS-01`, `OPS-02`, and `RST-01`: `.env` propagation, repository-local host paths, and idempotent clean-start reset. `OPS-03` is merged in [PR #22](https://github.com/kyashp/shepherd/pull/22), and its post-merge focused test and local-PoC smoke pass.
2. Add service fault-injection tests for `F-01..08`, missing/malformed/omitted manifests, Contract acceptance failure, objective tie, final re-verification, repeated cancellation, and persistence recovery.
3. Complete Group Chat API/browser regressions for `GC-01..06`. PR #9 covers quoted/escaped whitespace names and pure draft preservation; still prove real mention-button keyboard/focus/viewport behavior, a clean-start state, a message that produces a bounded Shepherd result, a targeted Contract, post-Mission behavior, and manifest-derived Agent summaries.
4. Add fake-reviewer Mission tests for completed findings, zero findings, disabled review, timeout, cancellation, malformed response, transport/provider/config failure, sensitive-value rejection, and deterministic-collision independence.
5. Run at most one opt-in live `SHEPHERD_MODEL` structured smoke after item 4 passes; never print credentials.
6. Add real service DAG-wave tests for dependencies, failed-required blocking, busy Agent, mutation lock, capacity, cycle rejection before persistence, and overlapping timestamps.
7. Implement and test real `estimatedDurationMs` production data for `UI-02`, clearly separated from actual timestamps.
8. Implement and run all eight PRD Playwright journeys: baseline Playground, Mission, `@Agent`, authority failure, all-fail attention, objective tie/human choice, cancellation, and restart.
9. Capture and review every required browser stage at `1280x800` and `1440x900`; verify no overlap/truncation, loading/empty/error/disabled/reconnect states, keyboard navigation, focus visibility, labels, contrast, and long-ID titles.
10. Measure event persistence → browser visibility `<=1.5s`, candidate timestamp overlap, Plane creation time, collision-to-promotion time, and full demo time.
11. Verify Plane Tree nodes/branches/SHAs against real persisted Plane data and `git worktree list`/branch reality.
12. Run the read-only `ui-reviewer` after screenshots and fix every high/medium finding with the mandatory minimal UI policy above.
13. Run the read-only `security-reviewer` after Group Chat/model/failure/startup changes and fix material findings.
14. Add TypeScript checking for test files; current server production typecheck excludes `*.test.ts`.
15. Run the literal `npm run check` on the final feature commit.
16. Run the complete suite at least five consecutive times and fix flakiness by root cause.
17. Run secret scans over source, generated prompts, persisted store, API payloads, and browser DOM after a complete demo.
18. Perform three clean reset-to-completion rehearsals and record exact timings; use a second machine/state only if genuinely available.
19. Run one final clean deterministic demo and the separately gated sparse live smoke on the final commit.
20. After merge, rerun typecheck, full tests, production build, browser smoke, secret scan, and one clean demo on `main`.

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
| `G-12` | Explicit `@Agent` Project Group routing | **Defective/partial, 45%** | Parser is strong; composed behavior fails requirements. `GC-01`, `GC-03`, `GC-04`, `GC-05`. |
| `G-13` | Advisory model reviewer, never demo-critical | **Unimplemented composition, 35%** | Standalone adapter only. `MR-01`, `MR-02`. |
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
| `K-06` | 8.6 bounded model-assisted reviewer and degradation event | **Unimplemented composition, 35%** | `MR-01`, `MR-02`. |
| `K-07` | 8.7 live speculative resolution | **I+T backend, 93% — review required** | Deterministic/current run and Phase 3 live evidence pass; sparse current live smoke pending. |
| `K-08` | 8.8 winner policy and winner flip | **I+T, 97% — review required** | Unit/service/integration flip evidence passes; service tie journey pending. |
| `K-09` | 8.9 final promotion gate | **I+T core, 96% — review required** | Negative gate/compensation tests pass; durable final reverify failure journey remains. |
| `K-10` | 8.10 credential-free bounded verifier | **I+T, 94% — review required** | Container boundary tests pass; final security audit remains. |
| `K-11` | 8.11 cancel and retry E2E | **I-U/partial, 84%** | `F-07`, `F-08`, repeated-cancel test, `E2E-07`. |
| `P-01` | 9.1 versioned atomic persistence, migration, restart, secret-free state | **I+T core / Partial failure, 92%** | Migration/restart/redaction tests pass; recovery-visible persistence failure remains `F-06`. |
| `P-02` | 9.2 authenticated schema-validated API and polling | **I+T core / Partial group path, 91%** | API tests pass; Group behavior, clean reset, and polling browser evidence remain. |
| `FIX-01` | 10 deterministic network-free auth fixture and safe reset | **I+T hero path / Defective clean reset, 92%** | Current deterministic Mission passed; `RST-01`, reset safety browser/rehearsal evidence remain. |

### PRD 11 UI surfaces and user journeys

| ID | Requirement | Status | Blocking work/evidence |
|---|---|---|---|
| `UI-S01` | 11.1 sidebar/navigation | **I-U** | Source/build only; visual/responsive/keyboard review pending. |
| `UI-S02` | 11.2 real event stream, filters, evidence, composer | **I-U** | Backend data exists; browser polling/latency/error evidence pending. |
| `UI-S03` | 11.3 timeline with actuals and labelled estimates | **Partial** | Actual timestamp UI exists; real estimates absent (`UI-02`). |
| `UI-S04` | 11.4 Plane Tree and Git-reality detail | **I-U** | Data/detail UI exists; browser-to-`git worktree` comparison pending. |
| `UI-S05` | 11.5 Project Group, Agent, Create/Edit | **Defective/I-U** | `GC-01` formatting/preservation is implemented in draft PR #9 but lacks browser evidence; `GC-02..06` and remaining Agent/browser form/Playground evidence are pending. |
| `E2E-01` | 11.6.1 baseline create/task/follow-up/restart | **Not evaluated on current UI** | Build a deterministic browser harness plus one sparse live Runtime acceptance. |
| `E2E-02` | 11.6.2 full Mission hero chain | **Backend pass; browser not evaluated** | Eight-stage browser assertions/screenshots and timing. |
| `E2E-03` | 11.6.3 `@Agent` journey | **Blocked by defects** | PR #9 browser evidence for `GC-01`, plus `GC-03`, `GC-04`, and `GC-05`. |
| `E2E-04` | 11.6.4 unauthorized-change journey | **Backend protected; browser not evaluated** | Causal service/API/UI failure fixture and screenshots. |
| `E2E-05` | 11.6.5 all-candidates-fail attention | **Backend pass; browser not evaluated** | Browser fault composition and preserved-evidence assertions. |
| `E2E-06` | 11.6.6 objective tie and human selection | **Unit/control exists; service/browser not evaluated** | Real tie state → verified choice → promotion. |
| `E2E-07` | 11.6.7 cancellation | **Backend pass; browser not evaluated** | Mid-Mission browser cancellation plus repeated-cancel check. |
| `E2E-08` | 11.6.8 restart interruption | **Backend process pass; browser not evaluated** | Browser reconnect shows durable interrupted state and nothing green. |
| `UI-GATE` | 11.7 visual checklist and all UI states at 1280x800/1440x900 | **Assurance pending** | No current Shepherd screenshot corpus, accessibility run, or independent `ui-reviewer` result. Preserve the mandatory minimal UI policy above. |

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
| Local run/reset | `OPS-01`, `OPS-02`, `RST-01` (`OPS-03` resolved) | `OPS-03` merged independently in [PR #22](https://github.com/kyashp/shepherd/pull/22) and passed its post-merge smoke. `OPS-02` may stack on `OPS-01`; `RST-01` is independent. Keep startup secret/path work separate from reset behavior. | Security review for env/path handling |
| Typed failures | `F-01/F-02` common typed-stage foundation, then `F-03`, `F-04`, `F-05`, `F-06`, `F-07/F-08` | Use short stacks only where a shared typed error contract is required. Each PR includes its entity/event/API tests. | Security review after the workstream |
| Group Chat | `GC-05` safe project initialization, `GC-02` Shepherd handling, `GC-03/GC-04` targeted Contract lifecycle, `GC-06` Agent summaries, `GC-01` mention UI | One stack steward; keep parser/security foundation below service behavior and UI. Browser tests land with each UI-visible correction. | Security + UI review |
| Advisory model | `MR-01` service composition/degradation, then `MR-02` truthful setting/UI | Deterministic collision independence is a mandatory lower-layer test. One sparse live smoke only after fake-adapter gates. | Security + UI review |
| Settings truthfulness | `ST-01` startup setting composition; `ST-02` implement bounded in-app notifications or label them unavailable | Keep initial-config behavior separate from optional product notification behavior. | UI review; security review if delivery surface expands |
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
- Project Group messages are bounded and idempotent, but the complete chat workflow is defective: unmentioned text is currently persisted without Shepherd processing/reply, and the only executable `@Agent` path targets an existing active demo Contract. See `GC-01..06` in the canonical ledger.
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
- Project Group display/polling, bounded parser-backed routing attempts, and
  Contract links; end-to-end routing remains defective under `GC-01..06`.
- Agents table, legacy Playground, lifecycle controls, role/current-Contract/Plane information.
- Create/Edit role selector, authority presets, and advanced authority section.
- Settings tabs for real timeout/concurrency/automatic-resolution values, persisted-only model-review/notification values, locked mode/retention/authority controls, and safe demo reset. The model-review and notification controls must be fixed or labeled unavailable; see `MR-02` and `ST-02`.
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

**Important:** the adapter is not passed into `ShepherdService` in `apps/server/src/index.ts`. `modelReviewEnabled` currently changes persisted settings/UI only and has no behavioral effect. No `model_review_degraded` Mission event is emitted. This is a P0 truthfulness defect: either wire it before demoing the control, or disable/label the UI control until composition is complete.

No post-composition live `SHEPHERD_MODEL` smoke was run in this checkpoint.

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
- notification preferences

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
  found`; reset passed only after initialization (`RST-01`).

Not run after this checkpoint:

- Playwright/browser journeys or screenshots;
- rendered browser interaction in this session because no browser connection was
  available;
- UI accessibility automation;
- custom `ui-reviewer` gate;
- custom `security-reviewer` gate for the API/reset/cancellation/public DTO and
  newly found startup-path behavior;
- live `SHEPHERD_MODEL` call;
- five consecutive full-suite runs;
- three timed clean demo rehearsals;
- a final live Mission on current `main`;
- a post-merge gate for these documentation changes.

### Draft PR #9 (`GC-01`) and merged PR #22 (`OPS-03`) evidence

[Draft PR #9](https://github.com/kyashp/shepherd/pull/9) targets `main` from
`fix/5-gc-01-quoted-mentions`; its remaining functional diff against current
`main` is limited to the Group Chat correction and documentation. Its history
still contains the original `OPS-03` commit, so GitHub may list those two config
files, but that content is identical to current `main` and was not rewritten under
the branch's no-rebase/no-force-push constraint. The independent fallback was
merged in [PR #22](https://github.com/kyashp/shepherd/pull/22). The following was
observed on 2026-08-29 without printing or copying `.env` values:

- Mention-format RED reproduced `@Frontend Agent` instead of
  `@"Frontend Agent"`; GREEN passed parser-safe quoting/escaping tests.
- Draft-preservation RED found no pure prepend contract; GREEN passed 3/3 focused
  formatter/preservation tests and preserves multiline composer content exactly.
- Verifier-fallback RED reproduced the startup `ZodError` for an empty
  `SHEPHERD_VERIFIER_IMAGE`; GREEN passed 16/16 config tests after allowing the
  existing `loadConfig()` fallback to execute.
- `npm run check` passed: 25 test files passed, 2 skipped; 544 tests passed,
  2 skipped; web/server typechecks and production builds passed.
- On updated `origin/main`, the focused config suite passed 16/16. An isolated
  deterministic local-PoC run loaded the main-worktree `.env` with an empty
  verifier-image value, built the Runtime and application, reached
  `Server listening at http://127.0.0.1:3000`, and served HTTP 200 responses.
- Browser evidence is still pending: the browser runtime reported zero attachable
  browsers, so button activation, keyboard behavior, focus/caret, and
  `1280x800`/`1440x900` screenshots are not claimed.

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
| Model reviewer failure | Standalone adapter covered; not composed, so no Mission degradation event. |

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

1. **Restore the remaining documented local run/reset path (`OPS-01`, `OPS-02`, `RST-01`; `OPS-03` resolved)**
   - Load `.env` into the local-PoC shell child without sourcing it or printing
     values.
   - Resolve all host PoC data roots inside the documented local root unless an
     explicit validated override is supplied.
   - `OPS-03` is merged in [PR #22](https://github.com/kyashp/shepherd/pull/22): an empty `SHEPHERD_VERIFIER_IMAGE` resolves to `CONTAINER_RUNTIME_IMAGE`, and the post-merge focused test and local-PoC smoke pass.
   - Make reset idempotent on a clean root.
   - Add causal script/config/service/API tests and rerun the exact startup +
     clean-start reset reproduction.

2. **Typed failure hardening**
   - Introduce typed stage failures for Contract timeout/runtime, verifier infrastructure, Plane creation, integration conflict, and persistence failure.
   - Persist exact Contract/Plane/Agent/Mission states and evidence; never leave `verifying`, `inspecting`, or `busy` after a terminal error.
   - Preserve error type through `recordMissionFailure()` instead of converting every unknown path to code `unknown`.

3. **Complete service fault tests**
   - Add causal tests for every partial/missing row in Section 8.
   - Assert entity state, event, public API representation, and absence of promotion.
   - Add exactly-once retry failure coverage and idempotent repeated cancellation.

4. **Compose the Shepherd model reviewer**
   - Add an optional `ModelReviewer` dependency to `ShepherdService`.
   - Construct `ArkModelReviewer` in `apps/server/src/index.ts` with `config.shepherdModel`, Ark base URL/key, bounded timeout, and sensitive values.
   - Build bounded input from verified objectives, manifest summaries, trusted claims, changed files, and Plane diff summaries after integration and before/alongside deterministic collision detection.
   - Emit a safe completion/finding event; on any non-disabled failure emit durable `model_review_degraded` with bounded reason.
   - Never allow reviewer output to influence the deterministic collision required by the demo, winner selection, or promotion.
   - Prove collision succeeds with reviewer disabled and degraded.
   - Run at most one opt-in live `SHEPHERD_MODEL` structured smoke after fake-adapter tests pass. Do not print credentials.

5. **Fix or disable misleading UI states**
   - Until item 3 is complete, disable or clearly label the model-review setting as unavailable.
   - Until notification behavior exists, label notification preferences as reserved/unavailable.
   - Show typed failure evidence for ordinary `failed` Missions, not only `attention_required` Missions.
   - Produce and persist real trusted duration estimates for the `est.` timeline
     layer (`UI-02`), clearly distinct from actual timestamps.
   - Follow the mandatory minimal UI and visual-preservation policy in the canonical ledger.

6. **Repair Project Group end to end**
   - Merge the parser-safe mention formatting and pure draft-preservation coverage for `GC-01` from [draft PR #9](https://github.com/kyashp/shepherd/pull/9).
   - Complete the remaining `GC-01` browser button/keyboard/focus/viewport gate and fix `GC-02..06` with the smallest coherent changes.
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
16. Run three clean reset-to-completion demo rehearsals and record timings. Use a second machine/state only if genuinely available; otherwise document that limitation.
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
- `npm run poc` is currently affected by `OPS-01`; use the verified command below
  until that issue merges.
- On `main`, an empty `SHEPHERD_VERIFIER_IMAGE` now deliberately falls back to
  `CONTAINER_RUNTIME_IMAGE`; merged [PR #22](https://github.com/kyashp/shepherd/pull/22)
  covers the behavior and passed a post-merge local-PoC smoke.
- Do not click **Reset demo state** before the first Mission initializes the demo;
  `RST-01` currently returns a 500 on a completely clean root.
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

Latest GC-01/OPS-03 evidence: both workspace typechecks pass, 25 test files pass
with two files skipped, 544 tests pass with two skipped, and both production builds
pass. The merged OPS-03 config suite also passes 16/16 on updated `origin/main`.
If counts change, record the new exact result rather than copying these numbers.

### 2. Start a clean deterministic QA instance

Copy this command exactly. If port `3000` is already in use, change the `PORT` line
and use that same port in every URL below.

If `.tmp/manual-qa` already contains evidence you want to preserve, replace
`manual-qa` with one new exact suffix in all three path variables; do not delete an
ambiguous or broad directory merely to obtain a clean run.

```sh
HOST=127.0.0.1 \
PORT=3000 \
LOCAL_POC_DATA_ROOT="$PWD/.tmp/manual-qa" \
SHEPHERD_ROOT="$PWD/.tmp/manual-qa/data/shepherd" \
SHEPHERD_CODEX_HOME_ROOT="$PWD/.tmp/manual-qa/data/shepherd-codex-homes" \
SHEPHERD_EXECUTION_MODE=deterministic \
SHEPHERD_DEMO_MODE=true \
node --env-file-if-exists=.env --input-type=module -e '
import { spawn } from "node:child_process";
const child = spawn("./scripts/start-local-poc.sh", {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
'
```

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
8. Treat **Bounded model review** and **Notifications** as known misleading/inert
   controls until `MR-01/MR-02` and `ST-02` are fixed. Their persistence alone is
   not functional evidence.

### 5. Exercise cancellation

1. Reset after a completed Mission using **Settings → General → Reset demo state**.
   Confirm the warning. It should now report success.
2. Start a Mission and immediately choose **Cancel Mission** before the
   deterministic work completes.
3. Confirm cancellation and verify the Mission reaches durable `cancelled`, work
   stops, Agents are released, evidence remains, and no candidate is promoted.
4. If the button disappears because the fast deterministic Mission already
   completed, record this timing limitation; do not call cancellation a pass.

### 6. Exercise Project Group and compare known defects

Open **Project Group** after the demo project exists. The following are known defects
and should be reproducible until their task IDs merge:

1. Send an unmentioned message such as `Summarize the current Mission.` It persists,
   but no bounded Shepherd reply/action occurs (`GC-02`).
2. On `main` before [draft PR #9](https://github.com/kyashp/shepherd/pull/9)
   merges, clicking an Agent mention button whose name contains spaces inserts an
   unquoted mention and routing can return `unknown_agent` (`GC-01`). On PR #9,
   verify the button inserts `@"Frontend Agent"`, preserves any existing draft,
   returns focus/caret to the composer, and works via keyboard activation at both
   required viewports.
3. Manually enter a quoted mention such as:

   ```text
   @"Frontend Agent" Create a bounded frontend authentication contract.
   ```

   The parser accepts the quoting form, but targeted work still depends on an
   already-active matching Contract and can return a conflict once the fast Mission
   has completed (`GC-03`, `GC-04`).
4. On a completely clean project, the composer is disabled until a Mission creates
   the Shepherd project (`GC-05`).
5. Verify completion summaries are authored by Shepherd rather than manifest-derived
   Agent senders (`GC-06`).

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

This exercises the legacy Agent model, not Shepherd's currently uncomposed
`SHEPHERD_MODEL` reviewer. Do not run `npm run test:shepherd:live` merely to inspect
the UI; that opt-in suite can be long and expensive.

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
