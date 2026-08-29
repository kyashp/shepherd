# Shepherd Completion Task Ledger

**Canonical implementation snapshot:** `mock-main` at
`5b152a0c54ac1ed97c69d69cc84a7e093f5250e9`

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

## External ownership holds — do not assign

| ID | PRD | Status / owner | Current external work | Integration requirement |
|---|---|---|---|---|
| `GC-01` | 4.1.12, 11.5–11.6.3 | `HELD_EXTERNAL` | Issue #5 / draft PR #9 / `fix/5-gc-01-quoted-mentions` | Review the latest external SHA, integrate into `mock-main`, run focused mention tests, Project Group browser journey, and full gate. |
| `ST-02` | 11.5, 12 | `HELD_EXTERNAL` | Issue #6 / draft PR #13 / `fix/6-st-02-notification-truth` | Integrate only after confirming the controls are truthfully unavailable or actually consumed; browser and full gates required. |
| `MR-01` | 4.1.13, 8.6, 12 | `HELD_EXTERNAL` | Issue #12 / PR #16 / `feat/12-mr-01-compose-model-reviewer` | Preserve advisory-only authority; integrate and run fake-reviewer Mission matrix before one sparse live review. |
| `MR-03` | 8.6, 12 | `HELD_EXTERNAL`, stacked on `MR-01` | Issue #21 / draft PR #25 / `fix/21-mr-03-partial-review-findings` | Integrate after MR-01; validate partial valid findings survive one rejected evidence reference. |

These four workstreams are dependencies, not available tasks. Historical
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

## P0 — failure and recovery correctness

| ID | PRD ref | Status / owner / dependencies | Evidence and required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `F-01/02` | 12: Agent timeout/runtime | `READY` after `TST-02`; Worker | Contract timeout/runtime exceptions can become `unknown`. Add typed stage errors through Contract, Plane, Agent, Mission, event, API and UI; `T,A,C,I`. | **35%**; 0/4; not audited |
| `F-03` | 12: verifier infrastructure | **READY — first Fixer task after `TST-02` is green** | A thrown Contract verifier error can strand Contract=`verifying`, Plane=`inspecting`, Agent=`busy`. Atomically land all affected entities non-green with safe evidence and no promotion; `T,A,C,S,I`. | **25%**; 0/5; not audited |
| `F-04` | 12: worktree creation | `READY` after typed failure foundation; Worker | Initial Plane creation can fail before durable stage evidence. Persist owning Contract/Mission failure without inventing a Plane; `T,A,C,S,I`. | **25%**; 0/5; not audited |
| `F-05` | 8.4, 12: Git conflict | `READY`; Worker | Git detects conflict files but service converts the result to generic failure. Preserve bounded conflict files, integration state, Mission evidence and no promotion; `T,A,C,S,I`. | **45%**; 0/5; not audited |
| `F-06` | 9.1, 12: persistence error | `READY` after typed foundation; Worker | Atomic rollback exists but no recovery-visible `persistence_failed` path. Add a journal/reconciliation-safe path that does not claim durability through the failed write; `T,A,C,S,I`. | **30%**; 0/5; not audited |
| `F-07/08` | 8.11, 12: candidate timeout/retry | `READY`; Worker | Timeout mapping is inconsistent and retry eligibility is too broad. Retry only typed transient failures, exactly once, from the immutable base; cover second failure/no second retry; `T,A,C,I`. | **55%**; 0/4; not audited |
| `F-09` | 8.11, 12: repeated cancellation | `READY`; Worker | Promotion race coverage exists; explicit repeated service/API cancellation idempotence is absent. Preserve evidence and exact cancellation identities; `T,A,C,I`. | **70%**; 0/4; not audited |
| `FM-01` | 7.6–7.7, 8.9, 12 | `READY` after typed foundation; Worker | Add service/API state-event-no-promotion tests for missing/malformed manifests, omitted declared key, Contract acceptance failure, final re-verification failure, and objective tie. UI assertions belong to E2E rows. `T,A,C,I`. | **55%**; 0/4; not audited |

## P0 — required composed product behavior

| ID | PRD ref | Status / owner / dependencies | Evidence and required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `OPS-06` | 6.1, 8.10, 17 baseline | `READY`; Fixer, collaborator/macOS evidence required | Docker Desktop macOS reaches live Shepherd preflight then exits with only `Live Shepherd Runtime preflight failed`; the exact subprobe is swallowed. Preserve fail-closed sandboxing, add bounded stage diagnostics, reproduce on macOS, and correct only a proven compatibility mismatch. Never bypass socket/home restrictions. `T,A,C,S,L,I`. | **20%**; 0/6; not audited |
| `GC-02/05` | 8.1, 11.5–11.6.3 | `READY`; Worker; do not touch held `GC-01` files | Clean Project Group disables composition; unmentioned messages only persist despite UI promise. Initialize a safe read model or offer a clear Mission action, then route unmentioned text through a bounded Shepherd action/reply. `T,A,C,B,S,U,I`. | **20%**; 0/7; not audited |
| `GC-03/04` | 8.1, 11.5–11.6.3 | `BLOCKED` by `GC-01` integration and `GC-02/05`; Worker | `@Agent` only targets an already-active Contract and races the fast Mission. Add schema-constrained Contract creation independent of the narrow active timing window; no arbitrary shell/model authority. `T,A,C,B,S,U,I`. | **15%**; 0/7; not audited |
| `GC-06` | 11.5 | `BLOCKED` by targeted lifecycle; Worker | Emit concise server-authored Agent messages only from verified manifest summaries, with `senderType=agent`; `T,A,C,B,S,U,I`. | **20%**; 0/7; not audited |
| `ST-01` | 6 configuration, 11.5 | `READY`; Worker | Parsed startup `autoResolution` and max Plane count are not composed into `ShepherdService`; preserve later persisted operator settings. `T,A,C,I`. | **40%**; 0/4; not audited |
| `SCH-02` | 8.3 | `READY`; Worker | Reject DAG cycles before Contract graph persistence using the existing validator; `T,A,C,I`. | **50%**; 0/4; not audited |
| `SCH-01` | 4.1.6, 8.3 | `BLOCKED` by `SCH-02`; Worker | Service schedules only one fixed initial batch. Implement dependency waves using real Agent occupancy, mutation lock, active Plane count/capacity, failure blocking and downstream re-evaluation; prove overlap. `T,A,C,S,I`. | **35%**; 0/5; not audited |
| `UI-01` | 11.2, 12 | `BLOCKED` by typed failure work; Worker | Ordinary failed Missions need the same bounded failure evidence clarity as attention states. Reuse current components; no redesign. `T,C,B,U,I`. | **40%**; 0/5; not audited |
| `UI-02` | 4.1.16, 11.3, 14 | `READY`; Worker | UI has an optional estimate renderer but backend produces no `estimatedDurationMs`. Persist/serve a trusted clearly labelled estimate distinct from actual timing. `T,A,C,B,U,I`. | **20%**; 0/6; not audited |

## P1 — browser, cross-surface and assurance gates

| ID | PRD ref | Status / dependencies | Required acceptance | Confidence; gates passed; audit |
|---|---|---|---|---|
| `E2E-HARNESS` | 0.4, 16 Phase 6 | **AUDITED** at integrated implementation `5b152a0` | Auditor independently verified the candidate and integrated SHA: allowlisted child environment with no `.env` or ambient Ark/model ingress; required bearer auth; bounded fake Codex/container fixtures, readiness, logs, termination, port and run-root cleanup; ignored artifacts; no production debug route or UI/runtime change. Node harness passed 2/2 and Chromium passed 2/2 at exact `1280x800` and `1440x900`; regenerated screenshot hashes matched, document/body X/Y overflow was absent, and both images preserved the accepted clean-shell UI. Literal `npm run check` passed launcher 3/3, server 555/555 with one opt-in live skip, typechecks and both builds. This foundation does not satisfy `E2E-01`–`08`, populated/composer states, accessibility, or `UI-GATE`. `T,C,B,S,I`. | **100% scoped**; `T,C,B,S,I` passed (5/5); audited |
| `E2E-01` | 11.6.1, 17 baseline | `BLOCKED` by harness | Create Agent → live/fake Playground task → follow-up → restart continuity. Deterministic browser test plus one sparse live `ARK_MODEL` acceptance; `C,B,L,S,U,I`. | **35%**; 0/6; not audited |
| `E2E-02` | 11.6.2, 15 | `BLOCKED` by harness/P0 | Full hero chain with every intermediate Contract/Plane/collision/candidate/promotion state and real backend data; `C,B,S,U,I`. | **50%**; 0/5; not audited |
| `E2E-03` | 11.6.3 | `BLOCKED` by Group Chat work | Targeted Project Group Contract from click/type through Agent summary; `C,B,S,U,I`. | **10%**; 0/5; not audited |
| `E2E-04` | 11.6.4, 12 | `BLOCKED` by failure UI | Unauthorized diff visibly denied with evidence and no promotion; `C,B,S,U,I`. | **45%**; 0/5; not audited |
| `E2E-05` | 11.6.5, 12 | `BLOCKED` by failure UI | Both candidates fail → durable `attention_required`, preserved evidence, no promotion; `C,B,S,U,I`. | **55%**; 0/5; not audited |
| `E2E-06` | 11.6.6 | `BLOCKED` by `FM-01` | Real service tie → human verified choice → trusted promotion; `C,B,S,U,I`. | **40%**; 0/5; not audited |
| `E2E-07` | 11.6.7 | `BLOCKED` by harness/`F-09` | Cancel mid-Mission → durable cancelled, released Agents, no promotion; `C,B,S,U,I`. | **55%**; 0/5; not audited |
| `E2E-08` | 11.6.8, 12 | `BLOCKED` by harness | Kill/restart mid-Mission → reconnect/cursor reconciliation, interrupted visible, no false green/duplicates; `C,B,S,U,I`. | **50%**; 0/5; not audited |
| `UI-GATE` | 0.4, 11.1–11.7 | `BLOCKED` by E2E rows | All six surfaces plus loading/empty/error/disabled/reconnect states at both viewports, screenshot corpus under `docs/ui-review/`, keyboard/focus/labels/contrast/long-ID/no-page-overflow checks. Preserve theme. `C,B,U,I`. | **25%**; 0/4; not audited |
| `PERF-01` | 14 | `BLOCKED` by harness | Measure persisted event → visible `<=1.5s`, Plane creation, verification, candidate overlap, collision-to-promotion and total demo time; record method/sample/limits. `B,I`. | **10%**; 0/2; not audited |
| `TEST-TS` | 16 Phase 9B | `READY`; Worker | Add a test-file TypeScript gate; production server tsconfig currently excludes `*.test.ts`. Keep production emit unchanged. `T,C,I`. | **0%**; 0/3; not audited |
| `CI-01` | 0.1, 16, 17 | `READY`; integrator | No `.github/workflows` required check exists. Add Node 22+ install/typecheck/test/build for PR/push and merge-group where applicable; no live models. `C,I`. | **0%**; 0/2; not audited |
| `SEC-REVIEW` | 0.3, 13, 17 | `BLOCKED` by P0/E2E | Repository/store/prompt/API/DOM canary scan, five invariant mutation evidence, artifact/debug/bypass audit, then independent read-only security review and fixes. `C,S,I`. | **45%**; 0/3; not audited |
| `STABILITY` | 16 Phase 9B | `BLOCKED` by all deterministic tests | Literal full suite passes five consecutive times; fix flakiness by cause, never sleeps/weakened assertions. `C,I`. | **0%**; 0/2; not audited |
| `LIVE-01` | 16 Phase 3/7/8 | `BLOCKED` by P0 and external MR integration | Exactly one current live Mission plus legacy Playground continuity and exactly one live model-review smoke; bounded/redacted evidence only. `L,S,I`. | **35%**; 0/3; not audited |
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

- **44 tracked work items:** 2 audited, 4 externally held, and 38 other incomplete
  items across P0/P1/P2.
- **Next ready worker assignment:** `F-01/02` unless the integrator selects another
  non-overlapping ready row.
- **First fixer assignment:** `F-03`; `TST-02` has restored the baseline.
- **Current completion verdict:** incomplete. Strong kernel evidence exists, but the
  current deterministic full gate is green and all remaining rows above still
  require their stated integration/audit evidence.
