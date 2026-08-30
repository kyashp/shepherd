# Shepherd Completion Task Ledger

**Canonical implementation branch:** protected `main`.

**Latest verified integration:** PR #53 merge `5ccd0f1` on protected `main`; the
latest product feature in that campaign is PR #40 source `3d1a041`. Exact
post-integration evidence is recorded in `BUILD_LOG.md`.

**Audited:** 2026-08-30, Asia/Singapore

**Requirement authority:** [`PRD.md`](PRD.md)

**Runbook:** [`LOCAL_POC.md`](LOCAL_POC.md)

**As-built design:** [`SHEPHERD.md`](SHEPHERD.md)

**Track 1 brief:** [`TECHJAM.md`](TECHJAM.md)

**Reproduced defects:** [`FIXES.md`](FIXES.md)

This is the canonical entry point and work queue for the protected-`main` completion
campaign. The PRD still defines the required scope; this ledger does not narrow it.
`DEVIATIONS.md` records interpretations and environment limits, `FIXES.md` records
reproduced defects, and `BUILD_LOG.md` preserves exact historical evidence.

## Working contract

- `READY` means an owner may begin now. `BLOCKED` names the dependency.
  `HELD_EXTERNAL` means an open external PR/branch already owns the work and the
  worker/fixer must not edit it. `AUDITED` requires independent end-to-end evidence
  on the exact integrated `main` SHA.
- The worker implements the smallest coherent task, adds causal tests, records
  exact evidence in `BUILD_LOG.md`, then updates completion confidence and test
  counts. The auditor independently reruns the task and adjacent PRD flow before
  setting `AUDITED`. The fixer takes only entries in `FIXES.md` and preserves the
  named failure contract.
- No product task is complete at confidence below 100. Scoped 100 means every
  listed acceptance gate for that row passed; it does not claim unknown defects are
  impossible.
- Do not call a branch implementation integrated until its commit is an ancestor of
  `origin/main` and the post-integration gate passes.
- Default tests are model/network-free. Use live Ark capacity only for the two
  explicitly labelled sparse live gates.

Before editing, follow the ownership workflow in the root `AGENTS.md`: check issues,
PRs, remote branches, and worktrees; claim one task; immediately push its narrow
branch; record owned files and exclusions; then open a linked draft PR when there is
a comparable commit. The integrator alone merges sibling work. True stacks must name
their parent and merge order.

A task is ready only when its issue names the ID, PRD references, current and
expected behavior, acceptance gates, owned files, exclusions, dependencies, and test
plan. It is done only after the smallest coherent implementation, causal tests,
targeted and adjacent checks, the applicable `C/B/S/U/L` gates, independent review,
integration into `origin/main`, and an exact integrated rerun are recorded.

Use this intake shape for a newly discovered defect:

```text
TASKS/PRD ID; assessed commit; viewport/runtime; reproduction;
expected; actual; frequency; safety/data impact; redacted evidence;
proposed causal acceptance test; known ID or NEW
```

## Hackathon-ready completion cut

All incomplete rows remain PRD work. The following subset is the minimum required to
call the repository presentation-ready; “additional” below means optional only for
the hackathon cut, not removed from the PRD.

### Required before submission

- **Exposed product flow ([issue #41](https://github.com/kyashp/shepherd/issues/41)):**
  `GC-02/05`, `GC-03/04`, `GC-06`, and `E2E-03` so the
  visible Project Group surface performs real bounded work rather than dead-end chat.
- **Truthful failure story:** `FM-01`
  ([#42](https://github.com/kyashp/shepherd/issues/42)), then `UI-01` and `E2E-04`
  ([#43](https://github.com/kyashp/shepherd/issues/43)),
  denial journey, while preserving every broader failure row for full PRD follow-up.
- **Advertised controls ([issue #44](https://github.com/kyashp/shepherd/issues/44)):**
  `ST-01`; settings shown in the demo must causally compose.
- **Judge evidence:** `UI-GATE` ([#45](https://github.com/kyashp/shepherd/issues/45)),
  `PERF-01` ([#46](https://github.com/kyashp/shepherd/issues/46)), `LIVE-01` and the
  remaining `OPS-06` host gate ([#47](https://github.com/kyashp/shepherd/issues/47)),
  `STABILITY` ([#48](https://github.com/kyashp/shepherd/issues/48)), `SEC-REVIEW`
  ([#49](https://github.com/kyashp/shepherd/issues/49)), and `DEMO-REHEARSAL`
  ([#50](https://github.com/kyashp/shepherd/issues/50)). `OPS-06` also requires a
  passing rerun on the actual presentation
  host when that host is the affected macOS environment.
- **Submission package ([issue #51](https://github.com/kyashp/shepherd/issues/51)):**
  `DEL-01`–`DEL-05`, including the one-page architecture,
  exact test report, final README, reconciled documents, and final cleanup review.

### Additional full-PRD work after the hackathon cut

- `F-07/08`, `F-09`, the remaining `FM-01` failure variants, and `E2E-05`–`E2E-08`.
- `SCH-02` and `SCH-01` for arbitrary validated DAG waves beyond the fixed hero flow.
- `UI-02` for trusted duration estimates distinct from actual timing.
- A second-machine rehearsal when it is genuinely available and is not the selected
  presentation host.

## Requirement and code navigation

| Need | Start here |
|---|---|
| Workflow, status, and evidence discipline | PRD 0; this working contract; `BUILD_LOG.md` |
| Goals, architecture, domain, kernel, API, persistence | PRD 4–10; `SHEPHERD.md`; P0 rows below |
| UI surfaces and journeys | PRD 11; required-product and P1 rows; `UI.jpeg` |
| Failures and recovery | PRD 12; failure/recovery rows; `FIXES.md`; `DEVIATIONS.md` |
| Security | PRD 13; `SEC-REVIEW`; `SECURITY.md` |
| Performance and judge flow | PRD 14–15; `PERF-01`; `DEMO-REHEARSAL`; `LOCAL_POC.md` |
| Final gates and deliverables | PRD 16–17; `STABILITY`, `LIVE-01`, and `DEL-01`–`DEL-05` |

Primary implementation areas:

- Mission scheduling/state/resolution/promotion: `apps/server/src/shepherd/{service,state-machine,scheduler,resolution,promotion-gate}.ts`
- Runtime, manifest, authority, and verification boundaries:
  `apps/server/src/shepherd/{codex-executor,prompt,manifest,authority,verifier,model-reviewer}.ts`
- Git/demo/recovery: `apps/server/src/shepherd/{git-client,plane-manager,demo-project,recovery}.ts`
- Persistence/API/composition: `apps/server/src/{database-schema,database,store,agent-service,app,index,config}.ts`
- UI: `apps/web/src/{App,Shell,api,types,shepherd-hooks}.ts` and
  `apps/web/src/pages/`; shared styling is `apps/web/src/styles.css`.

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
| Server suite | 739 tests passed; 2 explicit opt-in tests skipped | Pass at the latest verified product candidate |
| Persistence/recovery closeout | `TST-23` 20/20; `TST-24` 30/30; Store 70/70; combined boundary 133/133 | Pass |
| Production build | Web and server production builds passed | Pass |
| Dependency audit | 0 vulnerabilities across 251 dependencies | Pass |
| Script syntax | `bash -n` launcher and Node launcher syntax passed | Pass |
| Deterministic browser hero | `E2E-02` audited across 52 stage/viewport observations with 26 unique final screenshot hashes | Pass for that scoped journey |
| Hosted exact-head gate | GitHub Actions runs `33286090602` and `33286319393` succeeded | Pass |
| Remaining browser/live/model gates | Listed below; no broader completion is implied | Pending |

No model request was made during the final persistence/recovery closeout. Earlier
bounded live evidence remains attached to its exact task rows; it is not generalized
to the open `LIVE-01` gate.

## Integration and external ownership holds — do not assign

| ID | PRD | Status / owner | Current external work | Integration requirement |
|---|---|---|---|---|
| `MR-03` | 8.6, 12 | **AUDITED** at `35ec268` | Invalid findings are dropped individually with bounded count while valid peers survive; all-invalid degrades. Auditor passed MR matrix 165/165, TST-08 stress, full harness/check/security, exactly one external reviewer request (`completed findings=2`), deterministic outcome/advisory assertions, cleanup, and hosted run `33270168480`. | **100% scoped**; `T,A,C,S,L,I` 6/6; audited |

No product-code workstream is externally held. `MR-01` is integrated and
independently audited for its full bounded reviewer scope after MR-03 and the sparse live gate.
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
| `I` | Integrated `origin/main` SHA rerun by the auditor, with task row and build log updated. |

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
| `F-01/02` | 12: Agent timeout/runtime | **AUDITED** at `83cc1d0` | Typed timeout/execution identity, fixed public messages, complete cleanup precedence and the executor filesystem/config boundary pass durable Contract/candidate/API/store/reload/log and no-promotion checks. No model/UI call was required. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `TST-13` | 0.3, 12, 13 | **AUDITED** at `83cc1d0` | The closed runner→executor→durable/public boundary rejects parsed output, stderr, container, hostile typed, secret and path diagnostics while preserving fixed execution/validated timeout identity. | **100% scoped**; `T,C,S,I` 4/4; audited |
| `TST-14` | 0.3, 12, 13 | **AUDITED** at `83cc1d0` | Execution-home cleanup preserves cancellation/timeout/execution primary outcomes; cleanup-only is fixed typed failure, exact retained-home retry succeeds, and public/durable surfaces remain bounded. | **100% scoped**; `T,C,S,I` 4/4; audited |
| `TST-15` | 0.3, 6.1, 12, 13 | **AUDITED** at `83cc1d0` | Sentinel and reconciliation open/handle/unlink/rm edges are cause-free and bounded with exact same-process retry. Restart with an invalid retained sentinel remains a documented Low fail-closed/manual-cleanup availability residual. | **100% scoped**; `T,C,S,I` 4/4; audited |
| `TST-16` | 0.3, 6.1, 12, 13 | **AUDITED** at `83cc1d0` | All 47 executor-owned filesystem/config expressions were manually inventoried; the 31-row injected matrix plus Contract/candidate public/durable proof passed. Independent security review found no High/Medium issue. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `F-03` | 12: verifier infrastructure | **AUDITED** at integrated implementation `dc87553` | Preserved REDs cover thrown diagnostics, returned mandatory `infrastructure_error` misclassification, sequential-check cancellation, and reserved create→start/repeated-cancel ID poisoning. The integrated correction atomically terminalizes the batch for thrown or returned mandatory infrastructure failure, preserves ordinary acceptance failure, releases ownership, blocks late invocation/integration, and makes exact-target cancellation sticky with bounded cleanup/reuse. Auditor independently passed the corrected regressions 8/8, adjacent service/API/recovery/store/state-machine/verifier coverage 185/185, and the literal integrated gate with launcher 3/3 plus server 563/563 and one opt-in live skip; both builds passed. Durable reload/no-promotion, exact target isolation, same-ID cleanup, bounded public/store output, and unchanged UI/workflow/dependency scope were inspected. | **100% scoped**; `T,A,C,S,I` passed (5/5); audited |
| `F-04` | 12: worktree creation | **AUDITED** at `2cef988` | First/second initial Plane creation failures persist bounded owning Contract/Mission evidence. Successful unwind removes only current-batch durable/physical resources; cleanup failure retains truthful failed Plane/interrupted Contract evidence under attention without masking the primary failure. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `TST-17` | 0.3, 6.1, 12 | **AUDITED** at `2cef988` | Second-of-two failure leaves zero durable/physical batch Planes, planeIds, worktrees or branches. Cleanup double-fault retains bounded exact recovery evidence, releases Agents, preserves active-project attention invariant and protected HEAD, and emits no raw cause or false cleanup claim. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `F-05` | 8.4, 12: Git conflict | **AUDITED** at `f8d7f71`; final stability restored by `cdcfa95` | Real conflict, cleanup attention, pre-merge identity and reset contracts passed local, security and both hosted gates. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `TST-18` | 0.3, 8.4, 12 | **AUDITED** at `f8d7f71` | Mandatory abort and truthful bounded cleanup evidence pass. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `TST-19` | 0.3, 8.4, 12 | **AUDITED** at `f8d7f71` | Five pre-mutation identity mismatch rows preserve all target/source state. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `TST-20` | 0.2, 12, 16 Phase 9B, 17 | **AUDITED** at `cdcfa95`; test-only | Immediate rejection observation, unconditional release, exact backend lifecycle join and queued store sentinel prevent teardown with pending persistence while preserving fail-fast and durable assertions. | **100% scoped**; `T,C,I` 3/3; audited |
| `F-06` | 9.1, 12: persistence error | **AUDITED** at `7d51ec6` with TST-21–24 | Representative running→verifying recovery uses exact-byte digest and bounded journal; uncommitted/ambiguous writes reconcile once, pending recovery locks unrelated mutations/events, and no downstream promotion occurs. Crash-safe temp authority and deterministic fixture joins passed local, security and hosted gates. No arbitrary-mutation recovery is claimed. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `TST-21` | 0.3, 9.1, 12, 13 | **AUDITED** at `7d51ec6` | Journal read faults are fixed/cause-free; database/journal double faults converge without raw detail or unrelated deletion. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `TST-22` | 0.3, 9.1, 12, 13 | **AUDITED** at `7d51ec6` | Owner-validated `0700` private namespace plus pre-published fixed-schema marker makes tested publication/removal prefixes idempotent across same-instance and two restarts. Store 70/70, combined 133/133, security 0 High/Medium and hosted `33286090602` passed. | **100% scoped**; `T,A,C,S,I` 5/5; audited |
| `TST-23` | 0.2, 9.1, 12, 16 Phase 9B | **AUDITED** at `7d51ec6`; test-only | A no-op original-Store sentinel joins Plane-unwind persistence before reload/teardown; Auditor passed 20/20 without late work. | **100% scoped**; `T,C,I` 3/3; audited |
| `TST-24` | 0.2, 9.1, 12, 16 Phase 9B | **AUDITED** at `7d51ec6`; test-only | Exact intent clearance plus a no-op original-Store sentinel joins reconciliation before durable evidence/teardown; Auditor passed 30/30. | **100% scoped**; `T,C,I` 3/3; audited |
| `F-07/08` | 8.11, 12: candidate timeout/retry | `READY`; Worker | Timeout mapping is inconsistent and retry eligibility is too broad. Retry only typed transient failures, exactly once, from the immutable base; cover second failure/no second retry; `T,A,C,I`. | **55%**; 0/4; not audited |
| `F-09` | 8.11, 12: repeated cancellation | `READY`; Worker | Promotion race coverage exists; explicit repeated service/API cancellation idempotence is absent. Preserve evidence and exact cancellation identities; `T,A,C,I`. | **70%**; 0/4; not audited |
| `FM-01` | 7.6–7.7, 8.9, 12 | `READY`; [issue #42](https://github.com/kyashp/shepherd/issues/42) | Add service/API state-event-no-promotion tests for missing/malformed manifests, omitted declared key, Contract acceptance failure, final re-verification failure, and objective tie. UI assertions belong to E2E rows. `T,A,C,I`. | **55%**; 0/4; not audited |

## P0 — required composed product behavior

| ID | PRD ref | Status / owner / dependencies | Evidence and required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `GC-01` | 4.1.12, 11.5–11.6.3 | **AUDITED** at merge/fix `de3e631`; source `main` `662a7e7` | Parser-safe buttons preserve the draft and exact Agent routing for simple, spaced, escaped quote/backslash, Unicode, NFKC and unsafe-name ID-fallback cases. Auditor passed focused Web 8/8, full Web 9/9, Server routing 10/10, clean install/audit, both strict test typechecks, and a real-browser 2/2 protocol at 1280x800 and 1440x900 covering mouse/Tab/Enter/Space, focus-visible, caret, multiline draft, exact 2,000/2,001 boundaries, in-flight disable/no duplicate, parser ID round-trip, no document/body X/Y overflow, and no private output. Full harness passed unit 6/6 plus Chromium 6/6; literal check passed launcher 3/3, Server 563/563 plus one opt-in skip, Web 9/9 and both builds; hosted Node 22 run `33266624301` passed. Independent UI fallback found no GC-01 theme or accessibility regression; the accepted internally scrollable page requires scrolling the composer into view when the runtime banner is present, and disabled-button visual distinction remains a Low `UI-GATE` review item. This row does not claim `GC-03/04` lifecycle behavior. | **100% scoped**; `T,A,C,B,U,I` passed (6/6); audited |
| `ST-02` | 11.5, 12 | **AUDITED** at integrated merge `d5df930` | PR #13 was merged to `main` as `d27dea6` and then merged into `mock-main` without product-code conflict. Notifications remain deliberately undelivered; the Settings surface now labels the capability **Unavailable** and every preserved preference **Reserved**, with three native disabled controls. Auditor passed focused rendering 1/1, web type/build, two-viewport real-browser semantics/no-PATCH/no-overflow, full harness unit 2/2 plus Chromium 4/4, and literal `npm run check` with launcher 3/3, server 563/563 plus one opt-in skip, strict typechecks and both builds. Independent rendered fallback review returned READY/no scoped findings; the configured `ui-reviewer` role was unavailable. No notification integration, public API/schema, persistence, or theme change. | **100% scoped**; `T,C,B,U,I` passed (5/5); audited |
| `MR-01` | 4.1.13, 8.6, 12 | **AUDITED** through `35ec268` | Bounded reviewer consumes trusted verified summaries/refs, validates output, remains advisory-only, degrades truthfully and cannot alter deterministic authority. Provider-free, MR-03 partial, browser/security, one-request live and hosted gates passed. | **100% scoped**; `T,A,C,B,S,U,L,I` 8/8; audited |
| `MR-02` | 4.1.13, 8.6, 11.5, 12 | **AUDITED** at `577255e` | The server exposes only `shepherdModelReviewConfigured`, derived from the same fail-closed startup predicate used to compose the reviewer. Settings preserves the stored preference but renders a native disabled control plus explicit **Unavailable** process-scoped copy when false; it issues no PATCH. Configured mode retains normal mouse/keyboard PATCH behavior. Auditor passed reviewer/config/service 173/173, Settings 5/5, adjacency 100/100, harness unit 6/6 and Chromium 8/8, literal check (launcher 3/3, Server 588/588 plus two opt-in skips, Web 13/13), audit/scans and hosted run `33268567614`; no live call. | **100% scoped**; `T,A,C,B,S,U,I` passed (7/7); audited |
| `OPS-06` | 6.1, 8.10, 17 baseline | **INTEGRATED / AUDITED provider-free** at `68dbd59`; affected collaborator/macOS validation remains | Closed bounded stage/reason diagnostics are actionable while every hardening gate remains fail-closed. TST-12 removes the executor cleanup `Error.cause` leak. Auditor passed focused runner/executor/config/service/live-runtime 95 plus one explicit live skip, literal check (launcher 3/3, Server 602 plus two explicit skips, Web 17/17, strict/build), security fallback and hosted run `33274769957`. No live/model call ran. `T,A,C,S,I`; `L` pending. | **85% overall**; `T,A,C,S,I` passed for integrated diagnostics; affected-macOS `L` unverified, so no compatibility claim |
| `TST-12` | 0.3, 6.1, 13 | **AUDITED** at `68dbd59` | Executor correction discards raw mount-cleanup cause and throws fixed bounded cleanup stage/reason. A planted failure proves message/String/stack/inspect/JSON/cause surfaces contain no secret/private-path/OS detail; cleanup continuation, fail-closed cache reset/retry and primary typed diagnostic remain. Focused/adjacent, strict/literal, independent security review and hosted run `33274769957` passed. | **100% scoped**; `T,C,S,I` 4/4; audited |
| `GC-02/05` | 8.1, 11.5–11.6.3 | `READY`; [issue #41](https://github.com/kyashp/shepherd/issues/41) | Clean Project Group disables composition; unmentioned messages only persist despite UI promise. Initialize a safe read model or offer a clear Mission action, then route unmentioned text through a bounded Shepherd action/reply. `T,A,C,B,S,U,I`. | **20%**; 0/7; not audited |
| `GC-03/04` | 8.1, 11.5–11.6.3 | `PARTIAL`; exact Project Group path blocked by `GC-02/05`; [issue #41](https://github.com/kyashp/shepherd/issues/41) | The Shepherd Mission composer now selects existing Frontend/Backend role Agents and two incompatible typed auth transports, atomically reserves them, durably binds idempotency, and exposes their complete Contracts; scoped Server/UI/Chromium/security review passed. This is a safe alternate demo path, not completion of the required Project Group `@Agent` click/type → targeted Contract → Agent summary journey. Finish that path without arbitrary shell/model authority. `T,A,C,B,S,U,I`. | **35%**; scoped alternate path verified, required journey 0/7; not fully audited |
| `GC-06` | 11.5 | `BLOCKED` by targeted lifecycle; [issue #41](https://github.com/kyashp/shepherd/issues/41) | Emit concise server-authored Agent messages only from verified manifest summaries, with `senderType=agent`; `T,A,C,B,S,U,I`. | **20%**; 0/7; not audited |
| `ST-01` | 6 configuration, 11.5 | `READY`; [issue #44](https://github.com/kyashp/shepherd/issues/44) | Parsed startup `autoResolution` and max Plane count are not composed into `ShepherdService`; preserve later persisted operator settings. `T,A,C,I`. | **40%**; 0/4; not audited |
| `SCH-02` | 8.3 | `READY`; Worker | Reject DAG cycles before Contract graph persistence using the existing validator; `T,A,C,I`. | **50%**; 0/4; not audited |
| `SCH-01` | 4.1.6, 8.3 | `BLOCKED` by `SCH-02`; Worker | Service schedules only one fixed initial batch. Implement dependency waves using real Agent occupancy, mutation lock, active Plane count/capacity, failure blocking and downstream re-evaluation; prove overlap. `T,A,C,S,I`. | **35%**; 0/5; not audited |
| `UI-01` | 11.2, 12 | `BLOCKED` by `FM-01`; [issue #43](https://github.com/kyashp/shepherd/issues/43) | Ordinary failed Missions need the same bounded failure evidence clarity as attention states. Reuse current components; no redesign. `T,C,B,U,I`. | **40%**; 0/5; not audited |
| `UI-04` | 11.1–11.3, 12 | **AUDITED** at `412a010` | Promotion-completed events select/label `promotionEvidence`; candidate events retain candidate verification and promotion-started claims none. Drawer exposes both safe stages with complete roving/focus lifecycle and internal scroll. Auditor passed fixture 7/7, Web 17/17, focused browser 2/2 twice, full Chromium 10/10, literal check, private-field/security/UI review and hosted run `33271397185`. Frontend/CSS/tests only; no backend/schema/live change. | **100% scoped**; `T,C,B,U,I` 5/5; audited. The fixture prerequisite integrated here; `E2E-02` was subsequently audited at `338f1e4`. |
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
| `E2E-03` | 11.6.3 | `BLOCKED` by Group Chat work; [issue #41](https://github.com/kyashp/shepherd/issues/41) | Targeted Project Group Contract from click/type through Agent summary; `C,B,S,U,I`. | **10%**; 0/5; not audited |
| `E2E-04` | 11.6.4, 12 | `BLOCKED` by `FM-01`; [issue #43](https://github.com/kyashp/shepherd/issues/43) | Unauthorized diff visibly denied with evidence and no promotion; `C,B,S,U,I`. | **45%**; 0/5; not audited |
| `E2E-05` | 11.6.5, 12 | `BLOCKED` by failure UI | Both candidates fail → durable `attention_required`, preserved evidence, no promotion; `C,B,S,U,I`. | **55%**; 0/5; not audited |
| `E2E-06` | 11.6.6 | `BLOCKED` by `FM-01` | Real service tie → human verified choice → trusted promotion; `C,B,S,U,I`. | **40%**; 0/5; not audited |
| `E2E-07` | 11.6.7 | `BLOCKED` by `F-09` product behavior | Cancel mid-Mission → durable cancelled, released Agents, no promotion; `C,B,S,U,I`. | **55%**; 0/5; not audited |
| `E2E-08` | 11.6.8, 12 | `BLOCKED` by restart/reconnect product composition | Kill/restart mid-Mission → reconnect/cursor reconciliation, interrupted visible, no false green/duplicates; `C,B,S,U,I`. | **50%**; 0/5; not audited |
| `UI-GATE` | 0.4, 11.1–11.7 | `BLOCKED` by E2E rows; [issue #45](https://github.com/kyashp/shepherd/issues/45) | All six surfaces plus loading/empty/error/disabled/reconnect states at both viewports, screenshot corpus under `docs/ui-review/`, keyboard/focus/labels/contrast/long-ID/no-page-overflow checks. Preserve theme. The scoped Agent-assignment/full-Contract/human-review Shepherd flow passed four Chromium journeys at both viewports, no-page-overflow assertions and independent UI review; the remaining surfaces/states and committed corpus still keep this global gate open. GC-01 review also requires honest top/composer framing and disabled mention-button distinction. `C,B,U,I`. | **35%**; scoped Shepherd flow passed, global 0/4; not audited |
| `PERF-01` | 14 | `BLOCKED` by [#41](https://github.com/kyashp/shepherd/issues/41) and [#43](https://github.com/kyashp/shepherd/issues/43); [issue #46](https://github.com/kyashp/shepherd/issues/46) | Measure persisted event → visible `<=1.5s`, Plane creation, verification, candidate overlap, collision-to-promotion and total demo time; record method/sample/limits. `B,I`. | **10%**; 0/2; not audited |
| `TEST-TS` | 16 Phase 9B | **AUDITED** at integrated implementation `8995605` | Separate strict no-emit server test-source config is enforced by root `typecheck`/`check`; production emit config is unchanged. RED evidence covers 14 errors across 4 test files (4 implicit callback types, 5 invalid Vitest matcher generics, 4 stale promotion fixtures, 1 stale verifier fixture), then 2 nullable fixture values exposed after matcher typing was restored. Auditor confirmed no suppression, broad exclusion, compiler weakening, blanket `any`, assertion weakening, product/UI change, or dependency churn. Candidate and integrated strict test-source checks passed; both production typechecks/builds passed; affected suites passed 73/73; literal candidate and integrated gates passed with launcher 3/3, server 563/563 and one unchanged opt-in live skip, plus both production builds. | **100% scoped**; `T,C,I` passed (3/3); audited |
| `CI-01` | 0.1, 16, 17 | **AUDITED** at workflow `cda2446`; hosted run `33259565232` succeeded | `required-checks.yml` uses supported official checkout/setup-node actions, Node 22, lockfile-backed npm cache, `npm ci`, Docker availability, and literal `npm run check`; it triggers every PR, pushes to protected `main`, and merge-queue `checks_requested`. Token permission is only `contents: read`; checkout credentials are not persisted; no `.env`, secrets, artifacts, privileged actions, or live/model path is configured. Independent local validation passed Docker 29.7.2 and launcher 3/3 plus server 555/555 with one opt-in skip. Hosted Node 22.23.2/npm 10.9.8 and Docker client/server 28.0.4 passed locked install, launcher 3/3, server 551 passed/5 environment-gated skips, typechecks, 40-module web build and server build. Stable job check: `Node 22 / npm run check`. Administrator must require that check on protected `main`; this external rule change is not performed by agents. `C,I`. | **100% scoped**; `C,I` passed (2/2); audited |
| `SEC-REVIEW` | 0.3, 13, 17 | `BLOCKED` by feature freeze; [issue #49](https://github.com/kyashp/shepherd/issues/49) | Repository/store/prompt/API/DOM canary scan, five invariant mutation evidence, artifact/debug/bypass audit, then independent read-only security review and fixes. `C,S,I`. | **45%**; 0/3; not audited |
| `STABILITY` | 16 Phase 9B | `BLOCKED` by deterministic feature freeze; [issue #48](https://github.com/kyashp/shepherd/issues/48) | Literal full suite passes five consecutive times; fix flakiness by cause, never sleeps/weakened assertions. `C,I`. | **0%**; 0/2; not audited |
| `LIVE-01` | 16 Phase 3/7/8 | `BLOCKED` by current exact-head live Mission; [issue #47](https://github.com/kyashp/shepherd/issues/47) | Reviewer sub-gate is satisfied: command attempt two made exactly one external request and completed with two bounded findings while deterministic outcome/security/cleanup stayed green. Current live Shepherd Mission and legacy continuity remain required. `L,S,I`. | **55%**; 1/3; not audited |
| `DEMO-REHEARSAL` | 14–15, 16 Phase 8 | `BLOCKED` by all demo-critical rows; [issue #50](https://github.com/kyashp/shepherd/issues/50) | Three clean reset-to-completion judge flows under three minutes, including clean no-op reset and initialized reset; second machine/state if genuinely available. `B,S,I`. | **0%**; 0/3; not audited |

## P2 — feature freeze deliverables

| ID | PRD ref | Status / dependencies | Required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `DEL-01` | 16 Phase 9A | `BLOCKED` by feature freeze; [issue #51](https://github.com/kyashp/shepherd/issues/51) | Create `SHEPHERD_ARCHITECTURE.md` from as-built code with locally validated Mermaid and one judge-facing diagram. | **0%**; 0/2; not audited |
| `DEL-02` | 16 Phase 9C | `BLOCKED` by all tests; [issue #51](https://github.com/kyashp/shepherd/issues/51) | Create `SHEPHERD_TEST_REPORT.md` from exact final commands, failures, repeated runs, browser/container/live scope and limitations. | **0%**; 0/2; not audited |
| `DEL-03` | 16 Phase 9D | `BLOCKED` by freeze; [issue #51](https://github.com/kyashp/shepherd/issues/51) | Finish README problem/pitch/setup/demo/tests/security/limitations without removing starter setup; every claim links to evidence. | **30%**; 0/2; not audited |
| `DEL-04` | 0.1, 16 Phase 9E | **PARTIALLY AUDITED** at `5a38d37`; final pass [issue #51](https://github.com/kyashp/shepherd/issues/51) | The canonical navigation is `TASKS.md` → PRD/as-built/runbook/evidence documents. The stale handover is removed, PRD-required ledgers are retained, and all current links resolve. Reconcile `SHEPHERD.md`, `DEVIATIONS.md`, `BUILD_LOG.md`, `LOCAL_POC.md`, `TECHJAM.md`, this ledger, and `FIXES.md` again after final product evidence. | **75% overall**; consolidation `C,I` passed and independent docs review passed; final frozen-state audit pending |
| `DEL-05` | 16 Phase 9E, 17 | `BLOCKED` by all work; [issue #51](https://github.com/kyashp/shepherd/issues/51) | Final dead/debug/duplicate/artifact/refactor/security review. Refactor only named proven debt with behavior locked; run final `C,B,S,L,I`. | **0%**; 0/5; not audited |

## Count and current verdict

- **69 tracked work items:** 40 fully audited and 29 not fully audited; no external
  hold items across P0/P1/P2.
- **Ready non-overlapping assignments:** `F-07/08`, `F-09`, `FM-01`, `GC-02/05`,
  `ST-01`, `SCH-02`, and `UI-02`, subject to the ownership check above. `PERF-01`
  remains blocked by the completed Project Group and visible-denial journeys.
- **Presentation-host caveat:** `OPS-06` is integrated and audited provider-free;
  only the affected collaborator/macOS compatibility rerun remains unverified.
- **Current completion verdict:** **82% of the minimum hackathon-ready cut** and
  incomplete. The deterministic core is green; issues #41–#51 still require their
  stated implementation, integration, and audit evidence. Full-PRD completion is a
  broader target and is not represented by this hackathon percentage.
