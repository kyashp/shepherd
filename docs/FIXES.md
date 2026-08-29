# Shepherd Defect Queue

**Assessed branch/SHA:** `mock-main` / `349897d3d9167fe711bf720f7c3fadd213938d11`  
**Audited:** 2026-08-29, Asia/Singapore  
**Task ordering and dependencies:** [`TASKS.md`](TASKS.md)

This file contains only reproduced defects or defects strongly evidenced by the
current source/tests and earlier bounded build-log reproductions. It is the Fixer
queue, not a second PRD. When an observation is only reported from another machine,
that limitation is explicit.

## Fixer rules

1. Re-run the exact failure contract before editing. If it does not reproduce,
   preserve the report and record the missing condition; do not call it fixed.
2. Make the smallest coherent correction. Do not refactor unrelated code, weaken
   schema/lifecycle/security assertions, bypass the sandbox, or change public/UI
   contracts unless the supported root cause requires it.
3. Add the causal regression, run targeted and adjacent tests, then literal
   `npm run check`. The auditor independently reruns the relevant PRD flow on the
   integrated `mock-main` SHA.
4. Preserve the accepted UI exactly as directed in `TASKS.md`. UI changes are only
   for required clarity/data or causal bugs, at both required viewports.
5. Update the defect row with before/after evidence, exact tests, confidence, commit,
   and audit status. Anything below scoped 100% remains review-required.

## Immediate queue

### `TST-02` — deterministic recovery test becomes invalid after its fixed clock

- **Evidence class:** reproduced twice: once inside `npm run check`, once as the
  isolated recovery test.
- **Failure contract:** the post-CAS recovery fixture creates Planes with the real
  wall clock, then injects `recoveredAt = 2026-08-29T12:05:00Z`. When run later that
  day, reconciliation writes a Plane `updatedAt` earlier than `createdAt`. Observed
  bounded values were `createdAt=14:05:54Z`, `updatedAt=12:05:00Z`; `JsonStore`
  correctly rejected the invalid lifecycle with `Refusing to persist invalid
  database state`.
- **Supported root cause:** the test mixes a fixed recovery clock with an
  uninjected PlaneManager clock. This is a deterministic test time-bomb, not
  evidence that production recovery should accept backwards timestamps.
- **Minimal correction:** inject the same deterministic clock into this fixture's
  PlaneManager (or otherwise derive all fixture times from one injected clock).
  Do not loosen `notBefore`, store validation, or recovery lifecycle rules.
- **Acceptance:** original isolated test passes; entire `recovery.test.ts` passes;
  literal `npm run check` passes; auditor repeats on integrated `mock-main`.
- **Owner/status:** first Worker task / `READY`; **0%**, 0/4 gates, not audited.

### `F-03` — Contract verifier infrastructure failure strands active-looking state

- **Evidence class:** strongly source-evidenced and recorded in the PRD failure
  audit; no current causal service regression closes it.
- **Failure contract:** a verifier exception during Contract verification can let
  the Mission fail generically while Contract remains `verifying`, Plane remains
  `inspecting`, and Agent remains `busy`.
- **Impact:** durable API/UI state lies about ongoing work and blocks safe recovery.
- **Minimal correction:** at the existing service error boundary, atomically map
  the exact Contract, Plane, Agent and Mission into a bounded non-green terminal or
  attention state, release ownership, persist a typed safe event, and prove no
  integration/promotion occurs. Do not collapse all verifier results or weaken
  independent verification.
- **Acceptance:** causal service fault test asserts every entity, event, public DTO,
  recovery state and no-promotion invariant; adjacent service/API/recovery tests,
  full gate, security review, integrated auditor gate.
- **Owner/status:** first Fixer task after `TST-02` / `READY THEN`; **25%**, 0/5
  gates, not audited.

### `OPS-06` — macOS Docker Desktop live Shepherd preflight fails opaquely

- **Evidence class:** strong collaborator report from macOS with a complete bounded
  stack trace; not reproduced on this Linux audit host.
- **Failure contract:** production builds succeed, server selects live Shepherd,
  then `CodexShepherdExecutor.performPreflight()` throws only `Live Shepherd Runtime
  preflight failed`; process exits before listening. The no-key preflight failure is
  collapsed to a boolean by `ContainerCodexRunner.isEphemeralAvailable()`, so the
  failed filesystem/version/socket subprobe is unknown.
- **Impact:** a correctly configured collaborator cannot run the live demo, and the
  message is not actionable. This is not evidence of an Ark credential failure.
- **Minimal correction:** first expose only a bounded safe stage/reason code; run
  the exact preflight on the affected Mac; correct only the proven compatibility
  mismatch. Preserve the non-root/read-only/home-denial/socket-denial/version gates
  and fail closed. Never use `danger-full-access` or silently fall back from an
  explicit live request.
- **Acceptance:** Linux plus macOS/container-engine regressions, full gate, security
  review, and one sparse live startup/Mission smoke on the affected platform.
- **Owner/status:** Fixer / `READY WHEN MAC EVIDENCE AVAILABLE`; **20%**, 0/6 gates,
  not audited.

## Confirmed defect inventory

| ID | Evidence class and current failure contract | Minimal-fix boundary | Owner/status |
|---|---|---|---|
| `F-01` | Source-evidenced: Contract timeout may surface as failure code `unknown` instead of `agent_timeout`. | Typed timeout propagated through Contract/Plane/Agent/Mission/event/API/UI; no message-regex classification. | Worker / ready after `TST-02` |
| `F-02` | Source-evidenced: Contract runtime errors can become generic `unknown`. | Shared typed stage error only; preserve candidate-specific handling. | Worker / ready after `TST-02` |
| `F-04` | Source-evidenced: initial Plane creation can fail before durable stage evidence; later mapper is too late. | Evidence on owning Contract/Mission without inventing a successful Plane. | Worker / depends typed foundation |
| `F-05` | Existing Git test proves conflict detection, while service path converts it to a generic throw. | Persist bounded conflict files, integration state/event and no promotion. | Worker / ready |
| `F-06` | Store rollback is tested; recovery-visible `persistence_failed` evidence is absent. | Journal/reconciliation-safe evidence; never claim a failed write persisted itself. | Worker / depends typed foundation |
| `F-07` | Source-evidenced: candidate timeout state mapping is inconsistent and partly regex-based. | One typed timeout class and canonical state mapping. | Worker / ready |
| `F-08` | Source-evidenced: most non-authority candidate exceptions are retryable; second-failure coverage absent. | Retry only typed transient failures, once, from the immutable base. | Worker / ready |
| `GC-01` | Earlier reproduction and current UI source: buttons insert bare `@Name With Spaces`, while parser requires JSON quoting. | Parser-safe mention formatting plus draft-preservation/browser regression; no parser weakening. | **Held external: PR #9** |
| `GC-02` | Current service/UI evidence: unmentioned message persists, but no bounded Shepherd action/reply occurs despite UI copy. | Use an existing schema-bounded Shepherd action; no free-form host/model authority. | Worker / ready |
| `GC-03` | Current service path only links an assignment to an already-created active Contract. | Add schema-validated targeted Contract creation under existing authority. | Worker / blocked by GC-01/02 |
| `GC-04` | Earlier reproduction: assignment returns conflict after the fast Mission finishes. | Remove the narrow timing dependency while keeping one mutation owner. | Worker / blocked by GC-03 |
| `GC-05` | Current UI source disables textarea when no project exists; earlier browser observation confirmed it. | Safe read-model initialization or explicit in-panel Mission-start action; preserve composer design. | Worker / ready with GC-02 |
| `GC-06` | Current lifecycle summaries use Shepherd sender; verified manifest-derived Agent summaries are absent. | Server-authored bounded summary only after verification, attributed to the real Agent ID. | Worker / blocked by targeted lifecycle |
| `MR-01` | Current `index.ts` constructs no `ArkModelReviewer`; standalone adapter is unused by Missions. | Advisory-only composition after trusted evidence, durable degradation, deterministic independence. | **Held external: PR #16** |
| `MR-03` | External stack evidence: one invalid evidence ref can discard otherwise valid advisory findings. | Retain independently valid bounded findings; reject only invalid ones. | **Held external: PR #25** |
| `MR-02` | Current Settings UI presents model review as functional while current mock-main orchestration does not consume it. | Resolved only by integrating MR-01 or truthfully disabling/labeling it. | Blocked by external MR-01 |
| `ST-01` | Current config parses startup auto-resolution/max Planes, but `index.ts` does not pass them into `ShepherdService`. | Explicit initial-settings composition without overwriting later persisted settings. | Worker / ready |
| `ST-02` | Current notification toggles persist but no notification behavior consumes them. | Truthfully mark unavailable or implement bounded in-app behavior; no external delivery expansion. | **Held external: PR #13** |
| `SCH-01` | Current service invokes scheduler for one fixed initial batch without real busy/lock/active inputs. | Extend existing scheduler/service boundary for dependency waves; no architecture replacement. | Worker / blocked by SCH-02 |
| `SCH-02` | Cycles are rejected during scheduling rather than before graph persistence. | Call existing DAG validator before durable Contract creation. | Worker / ready |
| `UI-01` | Current detailed failure panel is attention-focused; ordinary failed Missions may hide typed detail. | Reuse existing failure/attention primitives; no visual redesign. | Worker / blocked by typed failures |
| `UI-02` | Current web type has optional `estimatedDurationMs`, but no server/domain producer exists. | Persist and serve trusted estimates, clearly distinct from actuals; preserve timeline design. | Worker / ready |
| `TEST-TS` | Current server tsconfig explicitly excludes `src/**/*.test.ts`. | Add a separate no-emit test typecheck without changing production emit. | Worker / ready |
| `CI-01` | Repository contains no `.github/workflows` required check. | Network/model-free Node install/typecheck/test/build workflow; preserve protected-main policy. | Integrator / ready |

## Assurance gaps that are not yet defects

Missing Playwright journeys, screenshots, performance measurements, repeated-run
evidence, final security/UI reviews, sparse live smokes, rehearsals, and Phase 9
documents remain tasks in `TASKS.md`. They become defects here only when an executed
gate produces a reproducible failure.

