# Shepherd Defect Queue

**Assessed branch/SHA:** `mock-main` / `0b1c4017f01d37823b13c5da7360f00a8d8e7814`

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
- **Owner/status:** `RESOLVED + AUDITED` at integrated implementation `0cb431a`;
  **100% scoped**, `T,A,C,I` passed 4/4.

### `TST-03` — F-03 blocked-sibling regression is schedule-sensitive in hosted CI

- **Evidence class:** reproduced on the required hosted Node 22 gate at exact
  head `2ba5cb9`, run [`33261198788`](https://github.com/kyashp/shepherd/actions/runs/33261198788),
  job `99123330844`, then reproduced deterministically with a disposable local fault
  probe that held only the backend immediately before verifier entry and shortened
  only the temporary test budget to one second. The probe produced the same timeout
  and unhandled rejection. The unmodified integrated local gate passed 563/563 with
  one opt-in skip and five subsequent isolated thrown-verifier runs passed 5/5,
  establishing the schedule boundary rather than a UI regression or correction.
- **Failure contract:** the hosted full suite timed out
  `atomically interrupts a blocked sibling after 'thrown verifier exception'` at
  its explicit 30-second budget. Vitest also reported an unhandled
  `ContractVerificationInfrastructureError` from the same Mission. Final hosted
  counts were 558 passed, 5 environment-gated skipped, and 1 failed; builds did not
  run. The five-skip hosted profile was unchanged.
- **Supported root cause:** the test starts `runDeterministicDemo()`, then awaits
  `verifier.siblingEntered` before attaching `expect(run).rejects`. The frontend
  fixture may throw and terminalize the Mission before the backend reaches its
  verifier under suite contention, leaving `siblingEntered` unresolved and the
  already-rejected Mission promise temporarily unhandled. The test also lacks a
  `finally` that releases/joins the sibling if an assertion or timeout wins. This is
  test orchestration debt; the UI-03 CSS and browser path do not touch it.
- **Minimal correction:** test/fixture only. Establish a deterministic two-arrival
  barrier before the selected frontend failure is released, attach rejection
  handling immediately, and unconditionally release and join every deferred sibling
  in `finally`. Do not add sleeps, merely increase the timeout, swallow unhandled
  rejection, weaken durable reload/no-promotion assertions, or change F-03 product
  orchestration.
- **Acceptance:** preserve the hosted RED evidence; both parameterized boundary rows
  pass causally; the thrown row passes repeatedly alone and under full-suite
  contention with zero unhandled errors; literal local `npm run check` passes; the
  final `mock-main` hosted `Node 22 / npm run check` passes with the expected
  environment-gated skip profile; Auditor integrates and closes UI-03 `C`.
- **Observed correction:** test fixture only. A reusable two-arrival barrier now
  holds the selected frontend failure until both Contract verifiers arrive. The
  Mission promise gets a success/failure observer immediately before any gate is
  awaited, and `finally` idempotently releases both gates and joins the Mission and
  sibling. The durable failure/reload/late-return/no-verification-event/no-candidate/
  no-promotion assertions are unchanged. Both rows passed 40/40 across 20 isolated
  invocations in 37 seconds; the full service/verifier slice passed 43/43; strict
  test-source typecheck passed; and literal `npm run check` passed twice in 39s and
  40s with launcher 3/3, server 563/563 plus one opt-in live skip, and both builds.
  No timeout, sleep/retry, suppressed rejection, production/UI edit, or weakened
  assertion was introduced. Unmodified hosted run `33261491905` also passed and
  corroborates intermittency. Auditor independently repeated both rows 40/40,
  passed the 43/43 service/container-verifier slice, strict test-source typecheck,
  the literal local repository gate, and integrated focused 2/2. Hosted Node 22 run
  [`33262227553`](https://github.com/kyashp/shepherd/actions/runs/33262227553)
  passed on integrated implementation `0b1c401`.
- **Owner/status:** `RESOLVED + AUDITED` at integrated implementation `0b1c401`;
  **100% scoped**, `T,C,I` passed 3/3. UI-03 hosted closeout is restored and E2E-01
  is ready.

### `F-03` — Contract verifier infrastructure failure strands active-looking state

- **Evidence class:** causally reproduced on `fix/mock-main`. The planted verifier
  exception surfaced its raw diagnostic while the Mission failed with code
  `unknown`; both Contracts remained `verifying`, both Planes `inspecting`, and
  both Agents `busy` with Contract ownership retained. A production-shaped returned
  mandatory `infrastructure_error` reproduced a second path: both Contracts were
  misclassified `failed_independent_acceptance`, Planes remained `inspecting`,
  Agents remained owned/busy, and the Mission again failed as `unknown`.
- **Supported root cause:** the Contract verifier await had no infrastructure-error
  boundary after durable verification state was entered, and the container verifier
  intentionally represents launch/cancel/exit infrastructure failures as returned
  evidence. Cancellation was also non-sticky between sequential checks and during
  reserved container creation, allowing later work to start after terminalization.
- **Impact:** durable API/UI state lies about ongoing work and blocks safe recovery.
- **Minimal correction implemented:** the existing Contract verification boundary
  now maps thrown errors and only returned mandatory `infrastructure_error` checks
  to typed, bounded evidence; ordinary mandatory `failed` checks retain acceptance
  failure semantics.
  One store transaction fails the throwing Contract/Plane, interrupts every active
  sibling Contract/Plane, releases all mission Agent/project ownership, and fails
  the Mission. The Contract batch fails fast, makes bounded best-effort cancellation
  calls, and rejects late sibling completion without allowing integration,
  candidate creation, or promotion. Independent verification success remains owned
  exclusively by the independent verifier. Target cancellation is sticky across
  sequential checks and reserved create-to-start, repeated cancellation cannot
  poison bounded ID reuse, and a terminalized sibling cannot invoke the verifier.
- **Observed acceptance:** focused service/verifier tests 8/8; adjacent service/API/
  verifier/executor/store/state-machine/recovery tests 185/185; literal
  `npm run check` passed with launcher 3/3 and server 563/563 plus one opt-in live
  skip. Fresh store reloads contained no active child ownership; late successful
  returns produced no `verification_passed` event. Delayed-create/removal tests
  proved no post-cancel container start and safe exact-ID reuse. Planted private
  diagnostics were absent from durable state, public DTOs, and the store file.
- **Owner/status:** `RESOLVED + AUDITED` at integrated implementation `dc87553`;
  **100% scoped**, `T,A,C,S,I` passed 5/5. Auditor independently observed the
  focused 8/8, adjacent 185/185, and literal integrated repository gate; durable
  reload/no-promotion, redaction, cancellation isolation, and exact-ID reuse
  assertions passed.

### `UI-03` — invisible authority radios create document-wide horizontal overflow

- **Evidence class:** reproduced by the E2E-01 real-browser journey at both required
  viewports on `ace01ae`; the first Create Agent no-overflow assertion failed before
  Agent creation or any Runtime/model turn.
- **Failure contract:** after the authenticated user opens Create Agent and the four
  recommended authority presets render, `document.documentElement.scrollWidth` is
  `2299` at `1280x800` and `2579` at `1440x900`, rather than remaining within the
  viewport. The page looks clipped because `.main-content` hides X overflow, but
  the document invariant and keyboard/browser geometry remain incorrect.
- **Supported root cause:** the global `input { width: 100%; min-height: 38px; ... }`
  rule also applies to `.preset-grid input`. That narrower rule makes the radios
  absolute and transparent but does not reset their size. Browser diagnostics
  observed four invisible `INPUT` elements, each exactly one viewport wide, with
  right edges at `1589`, `1826`, `2063`, and `2299` in the 1280 case. Their grid
  static positions cumulatively expand the root scroll area.
- **Independent audit:** Auditor reproduced the same document widths on integrated
  `ace01ae`. At `1440x900`, the radio right edges were `1749`, `2026`, `2303`, and
  `2579`; every radio was `1440x38`. Body width/height stayed within the viewport,
  isolating the failure to document-root X geometry. Native semantics still work:
  the checked Generalist radio is reached as one Tab stop, ArrowLeft moves focus and
  selection to Verification, direct focus plus ArrowRight selects the next radio,
  and clicking a wrapping label leaves exactly one radio checked. The fix must
  preserve these observed behaviors.
- **Minimal correction:** in the existing `.preset-grid input` rule, bound the
  visually hidden native radios. Explicitly neutralize the inherited width,
  `min-height`, padding, border, and margin so the hidden box is locally bounded,
  while preserving the label hit target, native radio semantics, checked selection,
  keyboard order, and accepted appearance. Do not hide the symptom by weakening
  the document-overflow assertion, clipping another ancestor, or redesigning the
  form.
- **Acceptance:** reproduce RED first; then Create Agent at `1280x800` and
  `1440x900` has document/body X/Y scroll sizes within client sizes, all four labels
  remain clickable, Generalist remains the checked recommended preset, Tab reaches
  the radio group as one native stop, arrow keys move focus/selection, screenshots
  preserve the current theme, E2E-01 proceeds beyond its first gate, and literal
  `npm run check` passes. Independent rendered `ui-reviewer` review and integrated
  Auditor rerun remain required.
- **Observed correction:** the hidden native radio alone is now `1x1`, with inherited
  `min-height`, margin, padding, and border neutralized. Document scroll/client width
  is `1280/1280` and `1440/1440`; document/body Y invariants also pass. The visible
  wrapping card receives the existing purple focus treatment through
  `:has(input:focus-visible)`, rather than relying on an outline around a transparent
  one-pixel control. Causal Playwright passed 2/2 and proves four accessible radios,
  Generalist checked, one native Tab stop, arrow focus/selection, visible card focus,
  every label click, exactly one checked radio, and bounded computed box styles.
  Full browser harness passed 4/4. Literal `npm run check` passed launcher 3/3,
  server 563/563 with one opt-in live skip, both typechecks, and both builds.
  Screenshots `docs/ui-review/ui-03-create-agent/{1280x800,1440x900}.png` preserve
  the accepted theme. No live/model call occurred.
- **Owner/status:** `RESOLVED + AUDITED` at integrated implementation `83954f7`;
  **100% scoped**, `T,C,B,U,I` passed 5/5. Focused 2/2 and full 4/4 browser gates plus
  harness unit 2/2 passed; screenshots matched and the local strict/full gate
  passed. Unrelated TST-03 was corrected test-only at `0b1c401`, and hosted Node 22
  run `33262227553` passed. E2E-01 is ready.

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
| `UI-03` | E2E-01 reproduced document widths of 2299/2579 on Create Agent because four transparent absolute preset radios retained global viewport-wide input sizing. | Resolved by bounding only the visually hidden preset-radio dimensions while preserving native semantics, labels, keyboard behavior, and accepted form visuals. | Integrated/browser-audited at `83954f7`; hosted `C` waits on TST-03 |
| `TEST-TS` | Current server tsconfig explicitly excludes `src/**/*.test.ts`. | Add a separate no-emit test typecheck without changing production emit. | Worker / ready |
| `CI-01` | Repository contains no `.github/workflows` required check. | Network/model-free Node install/typecheck/test/build workflow; preserve protected-main policy. | Integrator / ready |

## Assurance gaps that are not yet defects

Missing Playwright journeys, screenshots, performance measurements, repeated-run
evidence, final security/UI reviews, sparse live smokes, rehearsals, and Phase 9
documents remain tasks in `TASKS.md`. They become defects here only when an executed
gate produces a reproducible failure.
