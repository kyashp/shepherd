# Shepherd Completion Task Ledger

**Canonical implementation snapshot:** `mock-main` at
`577255e6f4980499f032451d18557f8eefcf80ef`

**Audited:** 2026-08-29, Asia/Singapore

**Requirement authority:** [`PRD.md`](PRD.md)

**Background and runbook:** [`HANDOVER.md`](HANDOVER.md)

**Reproduced defects:** [`FIXES.md`](FIXES.md)

This is the canonical work queue for the `mock-main` completion campaign. It
supersedes status, branch, and “active PR” wording in `HANDOVER.md` wherever that
wording describes an older checkpoint. The PRD still defines the required scope;
this ledger does not narrow it.

## Working contract

- `READY` means an owner may begin now. `BLOCKED` names the dependency.
  `HELD_EXTERNAL` means an open external PR/branch already owns the work and the
  worker/fixer must not edit it. `AUDITED` requires independent end-to-end evidence
  on the exact integrated `mock-main` SHA.
- The worker implements the smallest coherent task, adds causal tests, records
  exact evidence in `BUILD_LOG.md`, then updates completion confidence and test
  counts. The auditor independently reruns the task and adjacent PRD flow before
  setting `AUDITED`. The fixer takes only entries in `FIXES.md` and preserves the
  named failure contract.
- No product task is complete at confidence below 100. Scoped 100 means every
  listed acceptance gate for that row passed; it does not claim unknown defects are
  impossible.
- Do not call a branch implementation integrated until its commit is an ancestor of
  `origin/mock-main` and the post-integration gate passes.
- Default tests are model/network-free. Use live Ark capacity only for the two
  explicitly labelled sparse live gates.

## UI freeze

The current UI theme and layout are accepted. Preserve the charcoal sidebar,
cream/off-white surfaces, restrained purple accent, green/red semantic colors,
typography, spacing, borders, and interaction patterns. UI edits are allowed only
to add required clarity/data or fix causal behavior. Reuse existing components and
CSS. Do not redesign. Every material UI correction must be browser-checked at
`1280x800` and `1440x900` against [`UI.jpeg`](UI.jpeg), with no document-level X/Y
scrolling.

## Baseline at this snapshot

| Check | Observed result | Verdict |
|---|---|---|
| Environment | Node `24.17.0`; npm `11.17.0`; Git `2.43.0`; Docker client/server `29.7.2` | Recorded |
| Workspace typecheck | Both server and web passed during `npm run check` | Pass |
| Launcher tests | 3/3 passed | Pass |
| Server suite | 26 files and 555 tests passed; 1 opt-in live file/test skipped | Pass after audited `TST-02` integration |
| Targeted `TST-02` gate | Original RED is preserved in `BUILD_LOG.md`; integrated fix passed 1/1 and full recovery passed 17/17 | Pass |
| Production build | Web: 40 modules; server TypeScript build passed | Pass |
| Dependency audit | 0 vulnerabilities across 251 dependencies | Pass |
| Script syntax | `bash -n` launcher and Node launcher syntax passed | Pass |
| Deterministic browser harness | Node harness 2/2 and Chromium 2/2 at `1280x800` and `1440x900`; screenshots inspected | Pass after audited `E2E-HARNESS` integration |
| Full PRD journeys/live/model gates | Not run in this audit | Pending |

No model request was made during these audits. The literal full gate and the
deterministic clean-shell browser harness are green at the snapshot named above.

## Integration and external ownership holds — do not assign

| ID | PRD | Status / owner | Current external work | Integration requirement |
|---|---|---|---|---|
| `MR-03` | 8.6, 12 | **AUDITED** at `35ec268` | Invalid findings are dropped individually with bounded count while valid peers survive; all-invalid degrades. Auditor passed MR matrix 165/165, TST-08 stress, full harness/check/security, exactly one external reviewer request (`completed findings=2`), deterministic outcome/advisory assertions, cleanup, and hosted run `33270168480`. | **100% scoped**; `T,A,C,S,L,I` 6/6; audited |

No workstream is externally held. `MR-01` is integrated and independently audited
for its full bounded reviewer scope after MR-03 and the sparse live gate.
Historical
`feature/shepherd-phase-*`, merged startup/reset/UI branches, and remote branches
without an open issue/PR are not active ownership claims.

## Acceptance gate codes

| Gate | Required evidence |
|---|---|
| `T` | Causal targeted test(s), including the original RED reproduction where applicable. |
| `A` | Adjacent service/API/persistence/recovery tests. |
| `C` | Literal `npm run check` passes without weakened assertions or hidden worker overrides. |
| `B` | Real Playwright/DOM journey at both required viewports with screenshots and intermediate states. |
| `S` | Secret/store/API/DOM scan and read-only security review where trust boundaries change. |
| `U` | Read-only UI review after rendered evidence; all high/medium findings resolved. |
| `L` | Explicit opt-in sparse live Runtime/model smoke; credentials and raw prompts remain undisclosed. |
| `I` | Integrated `origin/mock-main` SHA rerun by the auditor, with task row and build log updated. |

## P0 — restore a trustworthy green baseline

| ID | PRD ref | Status / owner / dependencies | Evidence and required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `TST-02` | 0.2, 16 Phase 9B, 17 | **AUDITED** at integrated implementation `0cb431a`; test fixture only | Worker and Auditor reproduced the fixed-clock cause. Auditor verified candidate and integrated trees: isolated test 1/1, full recovery 17/17, literal `npm run check` with launcher 3/3, server 555/555 plus one opt-in skip, and both production builds. Exact diff is one test clock injection plus evidence docs; production/UI/security files and lifecycle validation are unchanged. | **100% scoped**; `T,A,C,I` passed (4/4); audited |
| `TST-03` | 0.2, 12, 16 Phase 9B, 17 | **AUDITED** at integrated implementation `0b1c401`; test fixture only | Hosted RED run `33261198788` and a controlled pre-verifier hold proved the scheduling race. The two-arrival barrier, early rejection observer, and unconditional release/join preserve the typed failure and durable reload/late-return/no-promotion assertions. Auditor independently passed both rows 40/40, the service/container-verifier slice 43/43, strict test typecheck, the literal local gate (launcher 3/3, server 563/563 plus one opt-in skip, both builds), and integrated focused 2/2. Hosted Node 22 run `33262227553` passed the final implementation gate. No timeout, sleep/retry, assertion weakening, rejection suppression, or product/UI change. | **100% scoped**; `T,C,I` passed (3/3); audited |
| `TST-04` | 0.2, 12, 16 Phase 9B, 17 | **AUDITED** at integrated implementation `00c81ae`; test fixture only | Preserved full-suite RED: `afterEach -> makeDeletable -> readdir` received `ENOENT` beneath a sibling `.trusted-verification/verify-*/src`. The correction records the exact blocked backend snapshot, proves Mission rejection precedes its removal, arms an exact-basename watcher before release, requires `lstat -> ENOENT`, and unconditionally joins Mission/sibling/removal before teardown. Auditor independently passed the exact row 20/20, service/container-verifier slice 43/43, strict test typecheck, literal `npm run check` twice (563/563 plus one opt-in skip and both builds), and integrated focused 1/1. Hosted Node 22 run `33263688794` passed. No cleanup suppression, sleep/retry/timeout increase, assertion/sentinel/path/symlink weakening, or product/UI change. | **100% scoped**; `T,A,C,I` passed (4/4); audited |
| `TST-08` | 0.2, 12, 16 Phase 9B, 17 | **AUDITED** at `35ec268`; test fixture only | Exact returned row passed 20/20 and paired infrastructure rows 40/40 independently. The exact contained snapshot is joined through removal without cleanup suppression, timing inflation, assertion weakening or product change; full/hosted gates passed. | **100% scoped**; `T,C,S,I` 4/4; audited |
| `TST-09` | 0.2, 16 live gate, 17 | **AUDITED** at `35ec268`; test-only env clone | Only reviewer-test `HOST` is cloned to loopback; real provider configuration, predicate/filter and fatal handling remain. Config 27/27, MR 165/165, full/security/hosted passed. Command attempt two made external request 1/1 and completed with two bounded findings; no retry/artifact/root leak. | **100% scoped**; `T,C,S,L,I` 5/5; audited |
| `TST-07` | 0.2, 16 Phase 9B, 17 | **AUDITED** at integrated implementation `de3e631`; test packaging only | Exact TS6142/TS6059 RED was preserved. The complete eight-case file moved from Server to Web; explicit Web Vitest and strict test-source configs/scripts make both workspaces execute and typecheck under the root gate. Auditor independently passed focused Web 8/8, full Web 9/9, adjacent Server routing 10/10, both strict test projects, lock-backed clean install with zero vulnerabilities, literal `npm run check` (launcher 3/3, Server 563/563 plus one opt-in skip, Web 9/9 and both builds), and hosted Node 22 run `33266624301`. Server JSX/rootDir, product code and assertions are unchanged. | **100% scoped**; `T,C,I` passed (3/3); audited |

## P0 — failure and recovery correctness

| ID | PRD ref | Status / owner / dependencies | Evidence and required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `F-01/02` | 12: Agent timeout/runtime | **WORKER VERIFIED** candidate on `work/mock-main`; Auditor review pending | Shared typed Runtime errors now preserve timeout versus execution through the container/executor redaction boundary. Timeout persists Contract `execution_timed_out`/`agent_timeout`; execution persists `execution_failed`/`agent_runtime_error`; both fail the Plane and logical Agent, release ownership, fail the Mission with the same causal code/stage, emit bounded failure evidence, survive reload/public DTO conversion, and never create collision/candidate/promotion state. Cancellation, verifier infrastructure, candidate mapping and truly untyped `unknown` remain distinct. RED 2/2 became GREEN 3/3; adjacent 102/102 and literal check passed twice (server 606 plus two opt-in skips, Web 17/17). No live/model/UI call or schema migration. `T,A,C,I`. | **95% scoped**; Worker passed 4/4; independent Auditor review and hosted integration pending |
| `F-03` | 12: verifier infrastructure | **AUDITED** at integrated implementation `dc87553` | Preserved REDs cover thrown diagnostics, returned mandatory `infrastructure_error` misclassification, sequential-check cancellation, and reserved create→start/repeated-cancel ID poisoning. The integrated correction atomically terminalizes the batch for thrown or returned mandatory infrastructure failure, preserves ordinary acceptance failure, releases ownership, blocks late invocation/integration, and makes exact-target cancellation sticky with bounded cleanup/reuse. Auditor independently passed the corrected regressions 8/8, adjacent service/API/recovery/store/state-machine/verifier coverage 185/185, and the literal integrated gate with launcher 3/3 plus server 563/563 and one opt-in live skip; both builds passed. Durable reload/no-promotion, exact target isolation, same-ID cleanup, bounded public/store output, and unchanged UI/workflow/dependency scope were inspected. | **100% scoped**; `T,A,C,S,I` passed (5/5); audited |
| `F-04` | 12: worktree creation | `READY` after typed failure foundation; Worker | Initial Plane creation can fail before durable stage evidence. Persist owning Contract/Mission failure without inventing a Plane; `T,A,C,S,I`. | **25%**; 0/5; not audited |
| `F-05` | 8.4, 12: Git conflict | `READY`; Worker | Git detects conflict files but service converts the result to generic failure. Preserve bounded conflict files, integration state, Mission evidence and no promotion; `T,A,C,S,I`. | **45%**; 0/5; not audited |
| `F-06` | 9.1, 12: persistence error | `READY` after typed foundation; Worker | Atomic rollback exists but no recovery-visible `persistence_failed` path. Add a journal/reconciliation-safe path that does not claim durability through the failed write; `T,A,C,S,I`. | **30%**; 0/5; not audited |
| `F-07/08` | 8.11, 12: candidate timeout/retry | `READY`; Worker | Timeout mapping is inconsistent and retry eligibility is too broad. Retry only typed transient failures, exactly once, from the immutable base; cover second failure/no second retry; `T,A,C,I`. | **55%**; 0/4; not audited |
| `F-09` | 8.11, 12: repeated cancellation | `READY`; Worker | Promotion race coverage exists; explicit repeated service/API cancellation idempotence is absent. Preserve evidence and exact cancellation identities; `T,A,C,I`. | **70%**; 0/4; not audited |
| `FM-01` | 7.6–7.7, 8.9, 12 | `READY` after typed foundation; Worker | Add service/API state-event-no-promotion tests for missing/malformed manifests, omitted declared key, Contract acceptance failure, final re-verification failure, and objective tie. UI assertions belong to E2E rows. `T,A,C,I`. | **55%**; 0/4; not audited |

## P0 — required composed product behavior

| ID | PRD ref | Status / owner / dependencies | Evidence and required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `GC-01` | 4.1.12, 11.5–11.6.3 | **AUDITED** at merge/fix `de3e631`; source `main` `662a7e7` | Parser-safe buttons preserve the draft and exact Agent routing for simple, spaced, escaped quote/backslash, Unicode, NFKC and unsafe-name ID-fallback cases. Auditor passed focused Web 8/8, full Web 9/9, Server routing 10/10, clean install/audit, both strict test typechecks, and a real-browser 2/2 protocol at 1280x800 and 1440x900 covering mouse/Tab/Enter/Space, focus-visible, caret, multiline draft, exact 2,000/2,001 boundaries, in-flight disable/no duplicate, parser ID round-trip, no document/body X/Y overflow, and no private output. Full harness passed unit 6/6 plus Chromium 6/6; literal check passed launcher 3/3, Server 563/563 plus one opt-in skip, Web 9/9 and both builds; hosted Node 22 run `33266624301` passed. Independent UI fallback found no GC-01 theme or accessibility regression; the accepted internally scrollable page requires scrolling the composer into view when the runtime banner is present, and disabled-button visual distinction remains a Low `UI-GATE` review item. This row does not claim `GC-03/04` lifecycle behavior. | **100% scoped**; `T,A,C,B,U,I` passed (6/6); audited |
| `ST-02` | 11.5, 12 | **AUDITED** at integrated merge `d5df930` | PR #13 was merged to `main` as `d27dea6` and then merged into `mock-main` without product-code conflict. Notifications remain deliberately undelivered; the Settings surface now labels the capability **Unavailable** and every preserved preference **Reserved**, with three native disabled controls. Auditor passed focused rendering 1/1, web type/build, two-viewport real-browser semantics/no-PATCH/no-overflow, full harness unit 2/2 plus Chromium 4/4, and literal `npm run check` with launcher 3/3, server 563/563 plus one opt-in skip, strict typechecks and both builds. Independent rendered fallback review returned READY/no scoped findings; the configured `ui-reviewer` role was unavailable. No notification integration, public API/schema, persistence, or theme change. | **100% scoped**; `T,C,B,U,I` passed (5/5); audited |
| `MR-01` | 4.1.13, 8.6, 12 | **AUDITED** through `35ec268` | Bounded reviewer consumes trusted verified summaries/refs, validates output, remains advisory-only, degrades truthfully and cannot alter deterministic authority. Provider-free, MR-03 partial, browser/security, one-request live and hosted gates passed. | **100% scoped**; `T,A,C,B,S,U,L,I` 8/8; audited |
| `MR-02` | 4.1.13, 8.6, 11.5, 12 | **AUDITED** at `577255e` | The server exposes only `shepherdModelReviewConfigured`, derived from the same fail-closed startup predicate used to compose the reviewer. Settings preserves the stored preference but renders a native disabled control plus explicit **Unavailable** process-scoped copy when false; it issues no PATCH. Configured mode retains normal mouse/keyboard PATCH behavior. Auditor passed reviewer/config/service 173/173, Settings 5/5, adjacency 100/100, harness unit 6/6 and Chromium 8/8, literal check (launcher 3/3, Server 588/588 plus two opt-in skips, Web 13/13), audit/scans and hosted run `33268567614`; no live call. | **100% scoped**; `T,A,C,B,S,U,I` passed (7/7); audited |
| `OPS-06` | 6.1, 8.10, 17 baseline | **INTEGRATED / AUDITED provider-free** at `68dbd59`; affected collaborator/macOS validation remains | Closed bounded stage/reason diagnostics are actionable while every hardening gate remains fail-closed. TST-12 removes the executor cleanup `Error.cause` leak. Auditor passed focused runner/executor/config/service/live-runtime 95 plus one explicit live skip, literal check (launcher 3/3, Server 602 plus two explicit skips, Web 17/17, strict/build), security fallback and hosted run `33274769957`. No live/model call ran. `T,A,C,S,I`; `L` pending. | **85% overall**; `T,A,C,S,I` passed for integrated diagnostics; affected-macOS `L` unverified, so no compatibility claim |
| `TST-12` | 0.3, 6.1, 13 | **AUDITED** at `68dbd59` | Executor correction discards raw mount-cleanup cause and throws fixed bounded cleanup stage/reason. A planted failure proves message/String/stack/inspect/JSON/cause surfaces contain no secret/private-path/OS detail; cleanup continuation, fail-closed cache reset/retry and primary typed diagnostic remain. Focused/adjacent, strict/literal, independent security review and hosted run `33274769957` passed. | **100% scoped**; `T,C,S,I` 4/4; audited |
| `GC-02/05` | 8.1, 11.5–11.6.3 | `READY`; Worker | Clean Project Group disables composition; unmentioned messages only persist despite UI promise. Initialize a safe read model or offer a clear Mission action, then route unmentioned text through a bounded Shepherd action/reply. `T,A,C,B,S,U,I`. | **20%**; 0/7; not audited |
| `GC-03/04` | 8.1, 11.5–11.6.3 | `BLOCKED` by `GC-02/05`; Worker | `@Agent` only targets an already-active Contract and races the fast Mission. Add schema-constrained Contract creation independent of the narrow active timing window; no arbitrary shell/model authority. `T,A,C,B,S,U,I`. | **15%**; 0/7; not audited |
| `GC-06` | 11.5 | `BLOCKED` by targeted lifecycle; Worker | Emit concise server-authored Agent messages only from verified manifest summaries, with `senderType=agent`; `T,A,C,B,S,U,I`. | **20%**; 0/7; not audited |
| `ST-01` | 6 configuration, 11.5 | `READY`; Worker | Parsed startup `autoResolution` and max Plane count are not composed into `ShepherdService`; preserve later persisted operator settings. `T,A,C,I`. | **40%**; 0/4; not audited |
| `SCH-02` | 8.3 | `READY`; Worker | Reject DAG cycles before Contract graph persistence using the existing validator; `T,A,C,I`. | **50%**; 0/4; not audited |
| `SCH-01` | 4.1.6, 8.3 | `BLOCKED` by `SCH-02`; Worker | Service schedules only one fixed initial batch. Implement dependency waves using real Agent occupancy, mutation lock, active Plane count/capacity, failure blocking and downstream re-evaluation; prove overlap. `T,A,C,S,I`. | **35%**; 0/5; not audited |
| `UI-01` | 11.2, 12 | `BLOCKED` by typed failure work; Worker | Ordinary failed Missions need the same bounded failure evidence clarity as attention states. Reuse current components; no redesign. `T,C,B,U,I`. | **40%**; 0/5; not audited |
| `UI-04` | 11.1–11.3, 12 | **AUDITED** at `412a010` | Promotion-completed events select/label `promotionEvidence`; candidate events retain candidate verification and promotion-started claims none. Drawer exposes both safe stages with complete roving/focus lifecycle and internal scroll. Auditor passed fixture 7/7, Web 17/17, focused browser 2/2 twice, full Chromium 10/10, literal check, private-field/security/UI review and hosted run `33271397185`. Frontend/CSS/tests only; no backend/schema/live change. | **100% scoped**; `T,C,B,U,I` 5/5; audited. E2E-02 fixture prerequisite integrated; journey incomplete. |
| `UI-02` | 4.1.16, 11.3, 14 | `READY`; Worker | UI has an optional estimate renderer but backend produces no `estimatedDurationMs`. Persist/serve a trusted clearly labelled estimate distinct from actual timing. `T,A,C,B,U,I`. | **20%**; 0/6; not audited |

## P1 — browser, cross-surface and assurance gates

| ID | PRD ref | Status / dependencies | Required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `UI-03` | 0.4, 11.1–11.2, 11.7 | **AUDITED** at integrated implementation `83954f7`; hosted closeout restored by `TST-03` at `0b1c401` | Create Agent's transparent preset radios inherited global viewport-wide input sizing, expanding document width to 2299/1280 and 2579/1440. The integrated correction bounds only the hidden radio box and adds a theme-matched visible card focus outline. Auditor independently passed focused Chromium 2/2, full browser 4/4 and harness unit 2/2 at both required viewports; document/body X/Y, exact neutralized 1x1 boxes, accessible group/names, Generalist default, one Tab stop, arrow focus/selection, visible 2px outline, all label clicks and exactly one checked radio passed. Regenerated screenshot hashes matched the committed images; visual review preserved layout/theme. Integrated local check passed. Hosted run `33262227553` passed after the unrelated schedule-sensitive TST-03 fixture was corrected without touching UI code. | **100% scoped**; `T,C,B,U,I` passed (5/5); audited |
| `E2E-HARNESS` | 0.4, 16 Phase 6 | **AUDITED** at integrated implementation `5b152a0` | Auditor independently verified the candidate and integrated SHA: allowlisted child environment with no `.env` or ambient Ark/model ingress; required bearer auth; bounded fake Codex/container fixtures, readiness, logs, termination, port and run-root cleanup; ignored artifacts; no production debug route or UI/runtime change. Node harness passed 2/2 and Chromium passed 2/2 at exact `1280x800` and `1440x900`; regenerated screenshot hashes matched, document/body X/Y overflow was absent, and both images preserved the accepted clean-shell UI. Literal `npm run check` passed launcher 3/3, server 555/555 with one opt-in live skip, typechecks and both builds. This foundation does not satisfy `E2E-01`–`08`, populated/composer states, accessibility, or `UI-GATE`. `T,C,B,S,I`. | **100% scoped**; `T,C,B,S,I` passed (5/5); audited |
| `E2E-01` | 11.6.1, 17 baseline | **AUDITED** at integrated implementation `f6df2d9`; evidence `284994d` | Auditor independently passed harness unit 18/18 and Chromium 18/18 across three runs at both required viewports, plus the explicit evidence path 2/2. The authenticated create → exact artifact/test 2/2 → two-turn same fake session → port-down → restart-continuity journey passed with 401/auth, disabled active composer, exact persisted/API/DOM/log/path checks and actual Tab/focus-visible/Enter Create/Stop/Start. All 20 ephemeral images and the 16 committed journey images were reviewed with no clipping, overflow or theme drift. Strict test typecheck and literal check passed; ordinary runs left tracked evidence byte-identical. The prior bounded live gate remains exactly two ARK turns, no retry, one real Codex thread, artifact test 2/2, restart/security/cleanup pass and no Shepherd call; it was not repeated. Hosted run `33265640400` passed. `C,B,L,S,U,I`. | **100% scoped**; 6/6 gates passed; audited |
| `TST-05` | 0.4, 11.6.1, 11.7 | **AUDITED** at `f6df2d9`; evidence `284994d` | Default screenshots route only to ignored `.tmp/playwright-evidence`; explicit `test:e2e:starter-kit:evidence` wrote exactly the intended 16 E2E-01 files and no blank-down or unrelated evidence. Port closure is infrastructure evidence only. Three ordinary harness runs left tracked screenshot hashes unchanged. Both viewports proved inner-scroll Create reachability plus actual visible keyboard focus and Enter activation for Create/Stop/Start. Independent rendered fallback returned READY with no findings; configured `ui-reviewer` was unavailable. No production UI/CSS/theme change. `T,C,B,U,I`. | **100% scoped**; 5/5 passed; audited |
| `TST-06` | 0.3, 11.6.1, 13 | **AUDITED** at `f6df2d9` | Boolean-only secret assertions, live trace/screenshot/video off, exact live opt-in/two-turn/no-retry cap, loopback/auth/allowlisted environment and empty live `SHEPHERD_MODEL` passed review. Managed repository/`.tmp`/harness/run-root identities are lstat/realpath checked before allocation/removal. Causal tests reject a repo-contained ancestor symlink, prove later cleanup of a retained stopped root after restart failure, prove fresh setup failure leaves no root, and preserve reusable-root rejection. Harness unit 18/18, strict typecheck, literal check and hosted run `33265640400` passed; no run roots, credentials, private paths or live artifacts remained. Configured `security-reviewer` was unavailable; Auditor review found no High/Medium issue. `T,C,S,U,I`. | **100% scoped**; 5/5 passed; audited; documented Low local TOCTOU/exceptional-concurrency residuals remain outside the harness threat model |
| `E2E-02` | 11.6.2, 15 | **AUDITED** at integrated chain `338f1e4` | Authenticated real-server deterministic hero proves Contracts/isolated Planes, independent verification, exact semantic collision, concurrent candidates from one immutable base, cookie pass/bearer fail, objective selection, distinct final re-verification, protected promotion, retained loser, Project Group lifecycle and reset/cleanup. Auditor ran four journeys and inspected all 52 stage/viewport observations: 13/13 named claims are visible at both viewports and 26/26 final hashes are unique. Full harness passed unit 7/7 plus Chromium 12/12; literal check passed launcher 3/3, Server 592 plus two explicit skips, Web 17/17, strict types and builds. Independent UI/security fallback returned READY; hosted run `33273947769` passed. Shepherd summaries remain truthful (`GC-06` open); no `UI-02` estimate or live/model behavior is claimed. `C,B,S,U,I`. | **100% scoped**; 5/5 gates passed; audited |
| `TST-10` | 11.6.2, 15 | **AUDITED** at `338f1e4` | Exact `promotion_started` is scrolled into `.event-list`, positively intersects pane/browser and differs bytewise from stage 05. Auditor verified it in all four focused journeys, full harness/check, independent review and hosted run `33273947769`. | **100% scoped**; `T,C,B,U,I` 5/5; audited |
| `TST-11` | 11.6.2, 15 | **AUDITED** at `338f1e4` | Exact selected/rejected Candidate summaries are scrolled into the drawer and positively intersect drawer/browser before capture. Auditor verified stages 09/11 in all four journeys while stage 10 final evidence, TST-10, keyboard/focus and security assertions remained intact. The 52/52 semantic manifest, 26/26 unique hashes, full harness/check, independent review and hosted run `33273947769` passed; no product/UI/theme/timing change. | **100% scoped**; `T,C,B,U,I` 5/5; audited |
| `E2E-03` | 11.6.3 | `BLOCKED` by Group Chat work | Targeted Project Group Contract from click/type through Agent summary; `C,B,S,U,I`. | **10%**; 0/5; not audited |
| `E2E-04` | 11.6.4, 12 | `BLOCKED` by failure UI | Unauthorized diff visibly denied with evidence and no promotion; `C,B,S,U,I`. | **45%**; 0/5; not audited |
| `E2E-05` | 11.6.5, 12 | `BLOCKED` by failure UI | Both candidates fail → durable `attention_required`, preserved evidence, no promotion; `C,B,S,U,I`. | **55%**; 0/5; not audited |
| `E2E-06` | 11.6.6 | `BLOCKED` by `FM-01` | Real service tie → human verified choice → trusted promotion; `C,B,S,U,I`. | **40%**; 0/5; not audited |
| `E2E-07` | 11.6.7 | `BLOCKED` by harness/`F-09` | Cancel mid-Mission → durable cancelled, released Agents, no promotion; `C,B,S,U,I`. | **55%**; 0/5; not audited |
| `E2E-08` | 11.6.8, 12 | `BLOCKED` by harness | Kill/restart mid-Mission → reconnect/cursor reconciliation, interrupted visible, no false green/duplicates; `C,B,S,U,I`. | **50%**; 0/5; not audited |
| `UI-GATE` | 0.4, 11.1–11.7 | `BLOCKED` by E2E rows | All six surfaces plus loading/empty/error/disabled/reconnect states at both viewports, screenshot corpus under `docs/ui-review/`, keyboard/focus/labels/contrast/long-ID/no-page-overflow checks. Preserve theme. GC-01 review adds two Low evidence items: frame top-of-page and internally scrolled composer states honestly, and verify or minimally improve the visual disabled distinction of mention buttons without changing layout/theme. `C,B,U,I`. | **25%**; 0/4; not audited |
| `PERF-01` | 14 | `BLOCKED` by harness | Measure persisted event → visible `<=1.5s`, Plane creation, verification, candidate overlap, collision-to-promotion and total demo time; record method/sample/limits. `B,I`. | **10%**; 0/2; not audited |
| `TEST-TS` | 16 Phase 9B | **AUDITED** at integrated implementation `8995605` | Separate strict no-emit server test-source config is enforced by root `typecheck`/`check`; production emit config is unchanged. RED evidence covers 14 errors across 4 test files (4 implicit callback types, 5 invalid Vitest matcher generics, 4 stale promotion fixtures, 1 stale verifier fixture), then 2 nullable fixture values exposed after matcher typing was restored. Auditor confirmed no suppression, broad exclusion, compiler weakening, blanket `any`, assertion weakening, product/UI change, or dependency churn. Candidate and integrated strict test-source checks passed; both production typechecks/builds passed; affected suites passed 73/73; literal candidate and integrated gates passed with launcher 3/3, server 563/563 and one unchanged opt-in live skip, plus both production builds. | **100% scoped**; `T,C,I` passed (3/3); audited |
| `CI-01` | 0.1, 16, 17 | **AUDITED** at workflow `cda2446`; hosted run `33259565232` succeeded | `required-checks.yml` uses supported official checkout/setup-node actions, Node 22, lockfile-backed npm cache, `npm ci`, Docker availability, and literal `npm run check`; triggers every PR, pushes to `main`/`mock-main`, and merge-queue `checks_requested`. Token permission is only `contents: read`; checkout credentials are not persisted; no `.env`, secrets, artifacts, privileged actions, or live/model path is configured. Independent local validation passed Docker 29.7.2 and launcher 3/3 plus server 555/555 with one opt-in skip. Hosted Node 22.23.2/npm 10.9.8 and Docker client/server 28.0.4 passed locked install, launcher 3/3, server 551 passed/5 environment-gated skips, typechecks, 40-module web build and server build. Stable job check: `Node 22 / npm run check`. Administrator must require that check on protected `main`; this external rule change is not performed by agents. `C,I`. | **100% scoped**; `C,I` passed (2/2); audited |
| `SEC-REVIEW` | 0.3, 13, 17 | `BLOCKED` by P0/E2E | Repository/store/prompt/API/DOM canary scan, five invariant mutation evidence, artifact/debug/bypass audit, then independent read-only security review and fixes. `C,S,I`. | **45%**; 0/3; not audited |
| `STABILITY` | 16 Phase 9B | `BLOCKED` by all deterministic tests | Literal full suite passes five consecutive times; fix flakiness by cause, never sleeps/weakened assertions. `C,I`. | **0%**; 0/2; not audited |
| `LIVE-01` | 16 Phase 3/7/8 | `BLOCKED` by P0/current live Mission | Reviewer sub-gate is satisfied: command attempt two made exactly one external request and completed with two bounded findings while deterministic outcome/security/cleanup stayed green. Current live Shepherd Mission and legacy continuity remain required. `L,S,I`. | **55%**; 1/3; not audited |
| `DEMO-REHEARSAL` | 14–15, 16 Phase 8 | `BLOCKED` by all demo-critical rows | Three clean reset-to-completion judge flows under three minutes, including clean no-op reset and initialized reset; second machine/state if genuinely available. `B,S,I`. | **0%**; 0/3; not audited |

## P2 — feature freeze deliverables

| ID | PRD ref | Status / dependencies | Required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `DEL-01` | 16 Phase 9A | `BLOCKED` by feature freeze | Create `SHEPHERD_ARCHITECTURE.md` from as-built code with locally validated Mermaid and one judge-facing diagram. | **0%**; 0/2; not audited |
| `DEL-02` | 16 Phase 9C | `BLOCKED` by all tests | Create `SHEPHERD_TEST_REPORT.md` from exact final commands, failures, repeated runs, browser/container/live scope and limitations. | **0%**; 0/2; not audited |
| `DEL-03` | 16 Phase 9D | `BLOCKED` by freeze | Finish README problem/pitch/setup/demo/tests/security/limitations without removing starter setup; every claim links to evidence. | **30%**; 0/2; not audited |
| `DEL-04` | 0.1, 16 Phase 9E | `BLOCKED` by freeze | Reconcile `SHEPHERD.md`, `DEVIATIONS.md`, `BUILD_LOG.md`, `HANDOVER.md`, this ledger and `FIXES.md`; remove stale status contradictions only after evidence. | **25%**; 0/2; not audited |
| `DEL-05` | 16 Phase 9E, 17 | `BLOCKED` by all work | Final dead/debug/duplicate/artifact/refactor/security review. Refactor only named proven debt with behavior locked; run final `C,B,S,L,I`. | **0%**; 0/5; not audited |

## Count and current verdict

- **54 tracked work items:** 20 audited and 34 other incomplete; no external hold
  items across P0/P1/P2.
- **Next ready worker assignment:** `F-01/02` unless the integrator selects another
  non-overlapping ready row.
- **Audited capability correction:** `MR-02` at `577255e`; its exact no-Ark browser/API/source failure
  contract is corrected locally and awaits Auditor integration. `OPS-06` follows only when
  the required collaborator/macOS evidence is available.
- **Current completion verdict:** incomplete. Strong kernel evidence exists, but the
  current deterministic full gate is green and all remaining rows above still
  require their stated integration/audit evidence.
