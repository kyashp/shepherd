# Shepherd Engineering Handover

**Date:** 2026-08-29 (Asia/Singapore)

**Track:** TikTok TechJam 2026, Track 1 — Agent Launchpad middleware

**Active branch:** `feature/shepherd-phase-4-control-plane`

**Code checkpoint:** `e3aa667` (`checkpoint: add Shepherd control plane and six-screen UI`)

**Base / current `main`:** `1dc2f6b`
**Merge status:** intentionally **not merged to `main`** because the browser journeys, model-review composition, and full PRD failure matrix are incomplete.

## 1. Read this first

This is a truthful checkpoint, not a Definition-of-Done claim for `docs/PRD.md`.

The repository now has a strong deterministic Shepherd kernel, a proven live Codex-in-container boundary, a strict authenticated API, durable cancellation/retry/tie/reset controls, Agent roles and scoped authority, and a complete six-surface React UI. The latest production type checks, production builds, and full server suite are green.

The remaining work is material:

- `SHEPHERD_MODEL` is implemented only as a bounded standalone `ArkModelReviewer`; it is not composed into Mission orchestration.
- Several PRD Section 12 failures still collapse to a generic Mission failure or lack service-level fault tests.
- No Playwright configuration, eight-journey suite, screenshots, or independent rendered UI review exists yet.
- Final architecture/test-report/README/Shepherd documentation, repeated stability runs, and three timed rehearsals are not complete.

Do not merge this branch merely because the current test suite is green. Close the P0 items in Section 10, run the review gates, then merge and rerun the post-merge gate.

## Canonical implementation and verification ledger

This section is the authoritative status inventory for the checkpoint. If a later descriptive section sounds more optimistic, this ledger wins. Confidence is scoped to the behavior named in the row; it is not a claim that adjacent behavior works.

### Status definitions

| Label | Meaning |
|---|---|
| **Implemented + tested** | The production path exists and relevant automated evidence passed. Browser confidence still requires a browser test where the behavior is user-facing. |
| **Implemented, not fully tested** | Production code exists, but one or more required integration, failure, live, browser, accessibility, responsive, or repeated-run checks are absent. |
| **Defective / partial** | The path exists but a reproduced defect, misleading control, unsafe generic failure, stranded state, or material requirement mismatch is known. |
| **Unimplemented** | No production composition exists for the required behavior; standalone helpers or UI shells do not count. |

### Mandatory change policy for every next agent

All fixes must make the **smallest coherent change** that completely restores the named requirement:

- Do not perform unrelated refactoring, renaming, formatting, dependency changes, architecture replacement, or speculative cleanup.
- Preserve existing public contracts, trust boundaries, persistence invariants, security checks, tests, and working starter behavior unless the supported root cause requires a narrowly documented contract change.
- Add or strengthen the smallest regression test that reproduces the defect. Never weaken an assertion or remove a quality gate merely to make a check pass.
- Work feature-by-feature on a branch. Commit only coherent, tested checkpoints. Merge to `main` only after the feature-specific gate and the combined gate pass.
- Continue to protect the untracked user-provided TechJam brief and all secrets.

For **every UI fix**, the following additional rules are mandatory:

- Preserve the existing Launchpad visual language and layout: dark charcoal sidebar, cream/off-white work surfaces, restrained purple primary accent, green success, red failure/collision, compact starter typography, restrained borders/shadows, and the existing spacing rhythm.
- Reuse the current React components, CSS variables, classes, layout primitives, and interaction patterns before adding new primitives.
- Fix the affected component or state only. Do not redesign unrelated pages, replace the navigation, introduce a new visual system, or apply generic AI-dashboard styling.
- Keep the result human-faithful to `docs/UI.jpeg`; pixel-perfect matching is not required, but it must remain immediately recognizable as the same product.
- Do not add decorative gradients, neon effects, particles, 3D effects, excessive motion, or unrelated animation. The timeline grid gradient is a functional line-rendering exception.
- Preserve complete loading, empty, error, disabled, reconnecting, success, failure, focus, and keyboard states.
- Verify every material UI fix in a real browser at both `1280x800` and `1440x900`, including overflow, overlap, truncation/title behavior, keyboard focus, and screenshots. Source inspection or a successful TypeScript build is not visual verification.

### Fully implemented and tested features

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
| `GC-01` | Group Chat mention buttons | UI inserts `@Frontend Agent`, while names containing spaces require `@"Frontend Agent"`. The UI-generated value reproduces `unknown_agent`. | Mention buttons do not route the demo Agents. | Quote/escape whitespace-containing names using the parser's existing JSON mention syntax; add a browser regression test. |
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

### Implemented but not fully tested

| Feature/path | What exists | Missing evidence before it may be called complete |
|---|---|---|
| Six UI surfaces and shared navigation/design system | All requested routes compile and production-build | Real browser interaction, screenshots, responsive review, accessibility, and independent UI review |
| Shepherd stream, filters, timeline, Plane Tree, detail drawer, cancel/selection controls | React components and API bindings exist | Populated deterministic browser journey, real Git/tree comparison, event visibility timing, failure slices |
| Project Group message display/polling | Read API, sorting, connection/error/empty states exist | Browser polling/reconnect test plus fixes for `GC-01..06` |
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
| Live Mission on Phase 4 branch | Phase 3 runtime previously passed | One sparse post-integration live Mission after P0 fixes; no repeated unnecessary model calls |

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
| Final generated architecture document, final test report, final README refresh, and final PRD `HANDOFF.md` | **Unimplemented** |

### Pending test and review ledger

The next agent must explicitly mark each item pass/fail with the exact command and observed evidence:

1. Add service fault-injection tests for `F-01..08`, missing/malformed/omitted manifests, Contract acceptance failure, objective tie, final re-verification, repeated cancellation, and persistence recovery.
2. Add Group Chat unit/API/browser regressions for `GC-01..06`, including quoted whitespace names, a clean-start state, a message that produces a bounded Shepherd result, a targeted Contract, post-Mission behavior, and manifest-derived Agent summaries.
3. Add fake-reviewer Mission tests for completed findings, zero findings, disabled review, timeout, cancellation, malformed response, transport/provider/config failure, sensitive-value rejection, and deterministic-collision independence.
4. Run at most one opt-in live `SHEPHERD_MODEL` structured smoke after item 3 passes; never print credentials.
5. Add real service DAG-wave tests for dependencies, failed-required blocking, busy Agent, mutation lock, capacity, cycle rejection before persistence, and overlapping timestamps.
6. Implement and run all eight PRD Playwright journeys: baseline Playground, Mission, `@Agent`, authority failure, all-fail attention, objective tie/human choice, cancellation, and restart.
7. Capture and review every required browser stage at `1280x800` and `1440x900`; verify no overlap/truncation, loading/empty/error/disabled/reconnect states, keyboard navigation, focus visibility, labels, contrast, and long-ID titles.
8. Measure event persistence → browser visibility `<=1.5s`, candidate timestamp overlap, Plane creation time, collision-to-promotion time, and full demo time.
9. Verify Plane Tree nodes/branches/SHAs against real persisted Plane data and `git worktree list`/branch reality.
10. Run the read-only `ui-reviewer` after screenshots and fix every high/medium finding with the mandatory minimal UI policy above.
11. Run the read-only `security-reviewer` after Group Chat/model/failure changes and fix material findings.
12. Add TypeScript checking for test files; current server production typecheck excludes `*.test.ts`.
13. Run the literal `npm run check` on the final feature commit.
14. Run the complete suite at least five consecutive times and fix flakiness by root cause.
15. Run secret scans over source, generated prompts, persisted store, API payloads, and browser DOM after a complete demo.
16. Perform three clean reset-to-completion rehearsals and record exact timings; use a second machine/state only if genuinely available.
17. Run one final clean deterministic demo and the separately gated sparse live smoke on the final commit.
18. After merge, rerun typecheck, full tests, production build, browser smoke, secret scan, and one clean demo on `main`.

## 2. Repository and worktree state

At handover:

- All product changes are committed in `e3aa667` on `feature/shepherd-phase-4-control-plane`.
- `main` remains at the already verified Phase 3 commit `1dc2f6b`.
- `docs/TikTok_TechJam_2026_Complete_Brief.md` is an untracked user-provided file. Preserve it; do not delete, overwrite, or stage it without explicit direction.
- This handover is intended to be committed separately after `e3aa667` so future agents can identify the exact code checkpoint it describes.
- No deployment, cloud change, external write, or merge was performed.
- `.env` was not read or printed during this closeout. Continue treating it as secret.

Boundary transparency from the earlier work session: one delegated read-only probe mistakenly ran `find .. -name AGENTS.md -print`, which printed sibling `AGENTS.md` pathnames only; it did not read their contents. A separate malformed npm availability probe caused npm to use its normal cache outside the repository transiently. Neither incident read or changed user files outside this codebase, but both were outside the requested operational boundary and should not be repeated.

Useful first commands:

```sh
git branch --show-current
git status --short
git log --oneline --decorate -8
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

### 3.5 Six UI surfaces

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
- Project Group polling, bounded `@Agent` routing, and Contract links.
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

These commands were run from the repository root **after** the final code edits and before this handover:

```sh
npm run typecheck
# PASS: server and web TypeScript checks

npm run test -w @launchpad/server -- \
  src/shepherd/service.test.ts \
  src/app.test.ts \
  src/agent-service.test.ts \
  src/database.test.ts
# PASS: 4 files, 116 tests

git diff --check
# PASS

npm run build
# PASS: web production build (40 modules) and server production build

npm run test -w @launchpad/server
# PASS: 26 files passed, 1 opt-in live file skipped
#       544 tests passed, 1 skipped
```

This is equivalent to the current components of `npm run check`, but the literal single `npm run check` command was not rerun during closeout.

Additional delegated evidence before the root combined gate:

- API suite: 18/18 passed.
- AgentService authority/persistence suite: 11/11 passed.
- Shepherd service suite: 20/20 passed before the final `32 -> 16` bound alignment; the final full root suite above includes that alignment.
- Reset/cancellation-promotion race slice: 2/2 passed.
- Database suite after event-cursor gap changes: 66/66 passed.
- UI typecheck/build passed; a local HTTP smoke returned 200 for canonical UI routes and core read endpoints.

Not run after this checkpoint:

- Playwright/browser journeys or screenshots;
- UI accessibility automation;
- custom `ui-reviewer` gate;
- custom `security-reviewer` gate for the new API/reset/cancellation/public DTO changes;
- live `SHEPHERD_MODEL` call;
- five consecutive full-suite runs;
- three timed clean demo rehearsals;
- a final live Mission on this Phase 4 branch;
- a post-merge gate, because no merge occurred.

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

1. **Typed failure hardening**
   - Introduce typed stage failures for Contract timeout/runtime, verifier infrastructure, Plane creation, integration conflict, and persistence failure.
   - Persist exact Contract/Plane/Agent/Mission states and evidence; never leave `verifying`, `inspecting`, or `busy` after a terminal error.
   - Preserve error type through `recordMissionFailure()` instead of converting every unknown path to code `unknown`.

2. **Complete service fault tests**
   - Add causal tests for every partial/missing row in Section 8.
   - Assert entity state, event, public API representation, and absence of promotion.
   - Add exactly-once retry failure coverage and idempotent repeated cancellation.

3. **Compose the Shepherd model reviewer**
   - Add an optional `ModelReviewer` dependency to `ShepherdService`.
   - Construct `ArkModelReviewer` in `apps/server/src/index.ts` with `config.shepherdModel`, Ark base URL/key, bounded timeout, and sensitive values.
   - Build bounded input from verified objectives, manifest summaries, trusted claims, changed files, and Plane diff summaries after integration and before/alongside deterministic collision detection.
   - Emit a safe completion/finding event; on any non-disabled failure emit durable `model_review_degraded` with bounded reason.
   - Never allow reviewer output to influence the deterministic collision required by the demo, winner selection, or promotion.
   - Prove collision succeeds with reviewer disabled and degraded.
   - Run at most one opt-in live `SHEPHERD_MODEL` structured smoke after fake-adapter tests pass. Do not print credentials.

4. **Fix or disable misleading UI states**
   - Until item 3 is complete, disable or clearly label the model-review setting as unavailable.
   - Until notification behavior exists, label notification preferences as reserved/unavailable.
   - Show typed failure evidence for ordinary `failed` Missions, not only `attention_required` Missions.
   - Follow the mandatory minimal UI and visual-preservation policy in the canonical ledger.

5. **Repair Project Group end to end**
   - Fix `GC-01..06` with the smallest coherent changes.
   - Preserve the existing bounded parser and security boundary; do not turn chat text into arbitrary commands or model-controlled host actions.
   - Add causal service/API tests and real browser journeys for every corrected behavior.

### P1 — browser and visual gate

6. Create `playwright.config.ts`, a repo-local deterministic startup harness, and a fake Codex CLI for legacy Playground tests. Keep all state/browser cache under repository `.tmp` and never read `.env`.
7. Drive all eight PRD journeys. Use real HTTP/service behavior where safe. For visual states that require fault injection, use test-only composition/network fixtures and pair each with its backend causal test; do not expose production debug routes.
8. Capture every stage at `1280x800` and `1440x900` under `docs/ui-review/`.
9. Measure event persistence-to-visible latency (`<=1.5s`), retry/reconnect cursor reconciliation, responsive overflow, focus/labels/contrast, long-ID title behavior, and loading/empty/error states.
10. Compare the result to `docs/UI.jpeg` with the PRD checklist, then invoke the read-only `ui-reviewer` and fix every high/medium finding.

Repository-local Chromium was reported present at `.tmp/playwright-browsers/`; no Playwright harness/files were created during this checkpoint.

### P1 — scheduler and review gates

11. Extend service scheduling to real DAG waves with actual busy-Agent IDs, mutation lock, active Plane count, dependency blocking, and pre-persistence cycle rejection.
12. Run the read-only `security-reviewer` after all failure/model/browser changes. Fix findings, then rerun targeted and full gates.

### P2 — freeze and deliverables

13. Add test-file TypeScript checking; production `apps/server/tsconfig.json` excludes `*.test.ts`.
14. Run the complete suite at least five consecutive times and fix flakiness by cause.
15. Run three clean reset-to-completion demo rehearsals and record timings. Use a second machine/state only if genuinely available; otherwise document that limitation.
16. Finish/update:
    - `docs/SHEPHERD.md`
    - `docs/BUILD_LOG.md`
    - `docs/DEVIATIONS.md`
    - `docs/SHEPHERD_ARCHITECTURE.md` with locally validated Mermaid
    - `docs/SHEPHERD_TEST_REPORT.md`
    - `README.md`
    - final `HANDOFF.md` if the project still wants the original PRD filename in addition to this requested `docs/HANDOVER.md`
17. Run `npm run check`, secret/store/DOM scans, artifact audit, final deterministic demo, and the separately opt-in live smoke.
18. Commit each coherent feature/gate on its branch. Merge to `main` only after all relevant gates pass, then rerun typecheck, full tests, build, browser smoke, and one clean demo on `main`.

## 11. File map for the next agent

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

## 12. Safe startup and test notes

- Do not source or print `.env` in logs. Use `node --env-file=.env` only for an explicitly approved live smoke.
- Default tests require no live Ark call.
- The opt-in live command is `npm run test:shepherd:live`; it consumes real model capacity and should be used sparingly.
- Demo controls require `SHEPHERD_DEMO_MODE=true`.
- The trusted verifier needs the configured container engine and prebuilt image.
- Prefer deterministic mode for browser work: `SHEPHERD_EXECUTION_MODE=deterministic`.
- Keep generated data, Playwright browser/cache, and screenshots inside this repository; clean only exact known generated paths.
- Preserve the untracked TechJam brief.

## 13. Current confidence, scoped honestly

- **Confidence that this checkpoint's implemented and tested backend behavior works:** 88/100.
- **Confidence that the entire PRD currently works exactly as intended:** 64/100.
- **Current hackathon-win confidence:** 52/100.

The lower full-product scores are driven by known, enumerated gaps—not unexplained instability. The kernel story is differentiated and the server suite is strong, but judges will directly experience browser polish, demo reliability, and transparent failure evidence. Completing the P0/P1 items would materially raise both estimates.
