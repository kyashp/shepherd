# Shepherd Defect Queue

**Assessed branch/SHA:** `mock-main` / `de3e631361763a91272f044e94bbf7a50f1a7d98`

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

### `TST-10` — E2E-02 promotion stage screenshot does not show promotion

- **Evidence class:** independently reproduced from unintegrated candidate
  `85550e0a6c6c8f2263375943b22271d72c814c05` after two focused runs at both
  required viewports.
- **Failure contract:** `05-candidate-outcomes.png` and
  `06-promotion-reverifying.png` are byte-identical at 1280x800
  (`66159d4f...`) and at 1440x900 (`f35e34c3...`). The Playwright assertion finds
  “Started final authority and independent verification gate,” but that event is
  below the internally scrollable contract pane, so capture 06 does not visibly
  evidence its named stage. There are 24 distinct images, not 26.
- **Impact:** functional/API/Git/store/security assertions pass, but the visual
  evidence and BUILD_LOG phrase “13 material stages” overclaim the screenshot
  corpus. E2E-02 remains unintegrated.
- **Supported cause:** the test captures immediately after a DOM visibility check
  without scrolling the promotion event into the visible contract-pane region.
- **Minimal correction:** test only. Scroll the exact promotion event card into
  view and assert its rectangle intersects the contract pane before capture 06.
  Do not change production UI/CSS/theme, introduce sleeps/retries, weaken the event
  assertion, or fake a state. Preserve the truthful `GC-06` and `UI-02` exclusions.
- **Acceptance/status:** **OPEN / READY for Fixer.** Captures 05 and 06 must differ
  in both viewports; run the hero journey twice at each viewport and inspect all
  52 observations, then full Chromium/harness, strict test typecheck, literal
  `npm run check`, cleanup/security/UI fallback and hosted integrated gate.

### `UI-04` — promotion surfaces display candidate verification evidence

- **Evidence class:** fresh deterministic browser/API reproduction on integrated
  `mock-main` `3846591`, using the bounded verifier fixture rebased as `d09e445`.
- **Failure contract:** the selected candidate has distinct non-null
  `verificationEvidence.id` and `promotionEvidence.id`. A promotion-completed event
  rendered **UI04 VERIFICATION EVIDENCE MARKER** and omitted the distinct promotion
  marker. Screenshot: ignored repo-local
  `.tmp/playwright-evidence/ui-04/promotion-shows-verification.png`.
- **Supported cause:** `EventEvidence` unconditionally chooses
  `candidate.verificationEvidence`, including promotion events, and
  `PlaneDetailDrawer` also renders only candidate verification evidence. The API
  already supplies both evidence objects; no backend/schema change is required.
- **Minimal correction:** UI data selection only. Promotion-started/completed
  events and the appropriate candidate/Plane promotion detail must use
  `promotionEvidence`; candidate verification events retain `verificationEvidence`.
  Reuse `EvidenceSummary`; do not change layout, styling, theme or backend evidence.
- **Observed correction:** frontend-only. Completed promotion events select and
  label only final `promotionEvidence`; candidate events retain candidate evidence,
  and promotion-started shows no premature final evidence. Resolution Plane detail
  offers both stages in an existing-theme tablist with one/none fallback, safe
  reset, full roving keyboard semantics, visible focus, internal scroll and managed
  drawer focus/Escape/restoration. `EvidenceSummary` remains the sole renderer and
  ignores planted evidence IDs/stdout/stderr/errors/private diagnostics.
- **Acceptance/status:** **RESOLVED + AUDITED** at `412a010`, **100% scoped**,
  `T,C,B,U,I` 5/5.
  Helper/component 4/4, Web 17/17, harness 7/7, focused browser 2/2 and full
  Chromium 10/10 at both required viewports, strict/build and two final literal
  checks passed. Screenshots and independent UI/security re-reviews passed with no
  remaining finding. Hosted run `33271397185` passed. The bounded verifier fixture
  prerequisite is integrated; `E2E-02` itself remains incomplete.


### `MR-02` — Settings implies an unavailable reviewer will run

- **Evidence class:** reproduced in the real deterministic E2E harness on local
  merge `1422fd6` at both 1280x800 and 1440x900; supported by production
  composition and an independent security fallback.
- **Failure contract:** with no usable Ark reviewer configuration,
  `GET /api/system` reports `arkConfigured=false` while
  `GET /api/shepherd/settings` reports the persisted preference
  `modelReviewEnabled=true`. The Security tab renders the enabled, checked copy
  “Run advisory structured semantic review” with no unavailable/not-configured
  capability or operational status. Keyboard toggles false then true and both real
  PATCH requests succeed, but `index.ts` deliberately composes no reviewer, so the
  enabled preference cannot cause a call or advisory/degraded event.
- **Impact:** the preference is durably correct, and MR-01 remains deterministic
  and secure, but the operator-facing control implies behavior the running process
  cannot perform. Silence is indistinguishable from “no findings.”
- **Minimal correction:** preserve the stored preference, expose a bounded
  server-derived reviewer capability/operational state, and render truthful
  unavailable/ready/degraded wording or control state using the existing Settings
  visual language. Do not expose credentials, models, prompts, endpoints or probe
  the provider from the browser; do not redesign or weaken MR-01's silent
  unconfigured production composition.
- **Acceptance:** causal server/API tests for configured/unconfigured readiness and
  persisted preference; real browser at both viewports proves unavailable cannot
  imply a call, configured enabled/disabled semantics and PATCH persistence, and
  advisory/degraded events remain visibly truthful; no X/Y overflow/theme drift;
  security/UI fallback, literal check and hosted integrated gate pass.
- **Observed correction:** the candidate exposes only a reviewer-specific boolean
  derived from the same fail-closed startup predicate used to compose the reviewer.
  Settings preserves the stored preference but uses the existing disabled/locked
  visual language and explicit **Unavailable** process-scoped copy when false; it
  cannot issue PATCH. Configured mode retains normal mouse/keyboard PATCH behavior.
  Server 12/12, Web 5/5, reviewer/API matrix 71/71, harness 6/6, Chromium
  8/8 (dedicated MR-02 2/2 at both viewports), strict test typechecks, two literal
  checks, audit 0 vulnerabilities and independent security/UI reviews passed. No live
  request ran and no credential/configuration-failure reason is public.
- **Owner/status:** **RESOLVED + AUDITED** at `577255e`; **100% scoped**,
  `T,A,C,B,S,U,I` 7/7. Hosted run `33268567614` passed. The UI review noted
  only a non-blocking evidence gap: stored-off has component rather than browser
  screenshot coverage.

### `TST-07` — GC-01 test violates strict cross-workspace ownership

- **Evidence class:** deterministically reproduced on local integration merge
  `c834c3907abe84fb0bd79250ac93c2bbf78c87c0`, before any `mock-main` push.
- **Failure contract:** `npm run typecheck:tests -w @launchpad/server` exits 2.
  `apps/server/src/project-group-mention.test.ts` imports the Web TSX component and
  Web helper. TypeScript reports TS6142 because the Server test config has no JSX
  setting and TS6059 because `apps/web/src/pages/project-group-mention.ts` lies
  outside Server `rootDir`. Literal `npm run check` therefore cannot pass.
- **Supported cause:** GC-01 moved Web formatter/component coverage under the Server
  suite so the default test runner would discover it, but the repository's later
  strict test-source gate correctly enforces workspace ownership. This is a test
  packaging defect, not evidence of a product parser/UI failure.
- **Minimal correction:** relocate or split the regression into the correct Web and
  Server test ownership so both pieces are discovered and strictly typechecked.
  Preserve formatter cases, production parser round-trips including exact Agent-ID
  fallback, multiline draft preservation, native in-flight disablement, and exact
  2,000/2,001 boundaries. Do not enable JSX or broaden `rootDir` in the Server test
  config, add exclusions/suppressions, remove assertions, or change product code.
- **Acceptance:** preserve this RED; focused GC-01 and group-routing tests pass;
  strict Server and Web test sources pass; Web type/build and literal
  `npm run check` pass; Auditor then performs the full two-viewport Project Group
  interaction/parser round-trip and hosted integration gates before GC-01 closes.
- **Observed correction:** exact TS6142/TS6059 RED reproduced. The full eight-case
  formatter/parser/component test moved to Web ownership; Web now has explicit
  Vitest and strict test-source configs/scripts, and root `test`/`typecheck` execute
  both workspaces. Focused Web passed 8/8, adjacent Server routing passed 10/10,
  strict Web/Server tests and Web production type/build passed, and literal
  `npm run check` passed twice with launcher 3/3, Server 563/563 plus one unchanged
  opt-in skip, Web 9/9 and both builds. Lock dry-run and audit reported zero
  vulnerabilities. No product, Server JSX/rootDir or assertion change.
- **Audit closeout:** Auditor passed focused Web 8/8, full Web 9/9, Server
  routing 10/10, both strict test typechecks, the full deterministic harness
  (unit 6/6 and Chromium 6/6), literal `npm run check`, and the complete GC-01
  browser protocol 2/2. Hosted Node 22 run `33266624301` passed on integrated
  `de3e631`; no product/UI/Server-config change belongs to this correction.
- **Owner/status:** **RESOLVED + AUDITED** at `de3e631`; **100% scoped**,
  `T,C,I` 3/3.

### `TST-05` — E2E-01 visual evidence is non-reproducible and overclaims the down state

- **Evidence class:** independently reproduced while auditing unintegrated candidate
  `592699d140145165c5ca0d9511478171e5051271`.
- **Failure contract:** a routine `npm run test:e2e:harness` passed its Node 3/3 and
  Chromium 6/6 assertions but rewrote 16 of the 18 tracked E2E-01 PNGs plus the
  unrelated tracked UI-03 1280 capture. Both `08-server-down.png` files remained
  byte-identical, but visual inspection showed blank white canvases. The test only
  proves that the original port is closed, catches the failed reload, and captures
  the blank page without a DOM or visible-state assertion. The 1280 Create Agent
  capture also does not show the primary action within the viewport, and the
  journey does not fully prove actual Tab traversal, focus-visible treatment, or
  lifecycle-action keyboard activation.
- **Impact:** ordinary successful verification leaves a dirty tree and the checked-in
  images cannot be reproduced exactly. The evidence log calls a blank canvas a
  visually inspected down state and does not prove that the full Create Agent and
  keyboard journey is reachable.
- **Minimal correction:** keep routine generated screenshots under ignored `.tmp`
  output, with a separate explicit deterministic review/update path for committed
  evidence. Treat port closure as infrastructure evidence; do not invent or fake a
  reconnect UI. At both required viewports capture and assert primary-action
  reachability, actual Tab/focus-visible behavior, and keyboard activation of the
  relevant lifecycle controls. Do not change production UI or its accepted design.
- **Acceptance:** causal regression demonstrates the prior tracked-file mutation;
  routine harness unit/browser runs leave an exactly clean tree; an explicit bounded
  screenshot-update command is documented and reproducible; the down step is
  truthfully recorded as port-down rather than rendered app evidence; Create Agent
  completion and keyboard/focus behavior pass at `1280x800` and `1440x900`; full
  harness, literal `npm run check`, independent rendered review, and integrated/
  hosted gates pass.
- **Observed correction:** candidate routes default captures to ignored
  `.tmp/playwright-evidence` and exposes `test:e2e:starter-kit:evidence` as the
  explicit non-default docs update path. It removes the blank down-state canvas,
  retaining only the proved closed-port assertion. Create is scrolled within the
  existing form at 1280 and 1440, and Create/Stop/Start each passed actual Tab,
  visible focus and Enter activation. Harness unit passed 6/6, Chromium passed 6/6,
  all 16 journey stages were inspected, tracked screenshot hashes were byte-identical
  before/after the ordinary run, and literal check passed twice. No UI/CSS change.
- **Owner/status:** `RESOLVED + AUDITED` at `f6df2d9`, evidence `284994d`;
  **100% scoped**, `T,C,B,U,I` 5/5. Auditor passed three ordinary full harness runs,
  explicit evidence 2/2, byte-clean tracked-image checks, exact 16-image scope,
  rendered review and hosted run `33265640400`.

### `TST-06` — E2E harness failure paths can retain or disclose sensitive evidence

- **Evidence class:** independently source-confirmed in unintegrated candidate
  `592699d140145165c5ca0d9511478171e5051271`; fault-path regressions are required
  before claiming correction.
- **Failure contract:** secret values are passed directly into Playwright matcher
  arguments and therefore may be rendered in assertion output. A retained
  `runRoot` cannot be removed by a later idempotent `stop()` after a stop/restart
  failure. Repository containment checks validate the selected reusable root but
  do not canonically reject symlinked managed harness ancestors before `mkdtemp` or
  recursive removal. Opt-in live Playwright failure traces/screenshots can retain
  prompt or model output.
- **Impact:** a failing CI/local run may disclose a credential or live content and
  may leave state/workspace artifacts behind; ancestor indirection weakens the
  intended repository-confined cleanup boundary.
- **Minimal correction:** assert only secret-safe booleans or hashes; make stop
  idempotence permit a later explicit cleanup of a retained root; validate every
  managed ancestor canonically inside the repository before creation/removal; and
  suppress, sanitize, or safely isolate live failure artifacts. Add causal unit and
  injected-failure coverage. Do not broaden child environment ingress, deletion
  scope, filesystem authority, production debug behavior, or live-call count.
- **Acceptance:** fault tests prove redacted matcher failures, retained-root cleanup
  after restart failure, ancestor-symlink rejection before write/delete, and no
  prompt/output/secret in bounded live failure artifacts. Existing run-root/
  workspace/symlink/outside-canary tests, harness unit/browser suites, literal
  `npm run check`, independent security review, and integrated/hosted gates pass.
- **Observed correction:** candidate uses boolean-only sensitive-value assertions,
  disables live trace/screenshot/video, and preserves exact live opt-in, no retry,
  two-turn cap, loopback binding, bearer auth, environment allowlist and empty live
  `SHEPHERD_MODEL`. Repository, `.tmp`, harness and run-root identities are checked
  with lstat/realpath before allocation/removal. New fault tests reject a
  repo-contained ancestor symlink without following it and prove a retained stopped
  root can be removed after restart failure; fresh pre-spawn setup failure also
  leaves no allocated root. Harness unit passed 6/6, strict test
  typecheck and literal check twice passed, and no run root remained. No live call
  was made; the prior separately bounded live evidence remains exactly 2/2 turns.
- **Owner/status:** `RESOLVED + AUDITED` at `f6df2d9`; **100% scoped**,
  `T,C,S,U,I` 5/5. Auditor passed the causal 6/6 unit set three times, browser/full/
  strict/hosted gates and artifact/root scans. No High/Medium finding remains. Low
  same-user TOCTOU and exceptional spawn/concurrent-mkdir residuals are documented
  and do not broaden the local harness threat model.

### `TST-09` — reviewer-only live gate inherits unrelated hosting validation

- **Evidence class:** the sole authorized live command failed deterministically at
  `loadConfig` before reviewer construction or network egress.
- **Failure contract:** a non-loopback `HOST` plus placeholder/short
  `APP_AUTH_TOKEN` from local `.env` triggers production HTTP-server validation.
  This isolated reviewer test starts no HTTP server. External reviewer/network
  calls are 0; no live root or outcome artifact remained; no retry occurred.
- **Minimal correction:** test/launcher only. Force a safe loopback `HOST` for this
  explicit process while still loading real Ark/SHEPHERD key, model, base URL and
  the production reviewer configuration predicate/filter. Do not weaken production
  non-loopback auth, edit `.env`, hide fatal reviewer configuration/auth, or add an
  automatic retry. Add causal environment-precedence coverage if practical.
- **Observed correction:** test-only. The reviewer gate passes `loadConfig` a
  cloned environment whose only override is loopback `HOST`; real Ark key/model/
  base URL, SHEPHERD model resolution and all other config remain intact. The
  source environment is not mutated. Causal coverage proves production still
  rejects the original non-loopback weak-token input and the isolated clone passes
  the same reviewer predicate. Package-script gating, one worker, fatal reviewer
  handling, retry 0 and the production sensitive-value filter are unchanged.
- **Acceptance/status:** **RESOLVED + AUDITED** at `35ec268`, **100% scoped**,
  `T,C,S,L,I` 5/5.
  Focused config/default-skip passed 27 plus one skip, TST-08 passed 20/20 and
  40/40, MR-03 matrix 165/165, strict tests and two literal checks passed (Server
  592/592 plus two live skips; Web 13/13). Independent security review passed
  with no finding, as did dependency/diff/secret/artifact scans. The single
  Auditor's corrected command made external request 1/1 and completed with two
  bounded findings; hosted run `33270168480` passed.

### `TST-08` — returned verifier evidence can race fixture teardown

- **Evidence class:** literal `npm run check` RED on local MR-03 merge `3c878b3`;
  isolated 1/1 and repeated 20/20 GREEN.
- **Failure contract:** Server reported 590 passed, two opt-in skipped and one
  failed. `terminalizes returned Contract verification infrastructure evidence`
  completed its behavior but `afterEach -> makeDeletable -> realpath` received
  `ENOENT` for an exact sibling `.trusted-verification/verify-*` root removed during
  traversal. MR-03 changes only the reviewer adapter/tests and is not on this path.
- **Supported cause:** the returned-infrastructure fixture does not block/join the
  sibling verification snapshot. Fail-fast Mission rejection therefore permits
  the sibling `withVerificationSnapshot` finally to overlap teardown, the same
  causal class proven for TST-04 but an uncovered fixture row.
- **Minimal correction:** test fixture only. Reuse or narrowly generalize the
  TST-04 two-arrival, early rejection observer and exact snapshot removal join.
  Never swallow ENOENT, change the cleanup walker or product, add sleeps/retries/
  timeouts, or weaken state/no-promotion/security assertions.
- **Observed correction:** test fixture only. The returned-evidence verifier now
  uses the existing two-arrival barrier, captures the exact sibling
  `VerificationRequest.planePath`, and exposes bounded release/return joins. The
  row observes rejection immediately, proves the Mission rejects while that exact
  contained `verify-*` root still exists, arms the exact-basename removal watcher
  before release, then joins Mission, sibling and removal in `finally` before
  teardown. Product, cleanup walker and MR-03 code are unchanged.
- **Acceptance/status:** **RESOLVED + AUDITED** at `35ec268`, **100% scoped**,
  `T,C,S,I` 4/4.
  Exact row passed 20/20, both infrastructure rows 40/40, MR-03 matrix 164/164,
  adjacent service/container/API/store/recovery 82/82, strict test typecheck and
  two literal checks (Server 591/591 plus two opt-in skips; Web 13/13). Auditor
  integrated hosted run `33270168480` passed; no cleanup/product weakening.

### `TST-04` — F-03 fail-fast verification can race service fixture teardown

- **Evidence class:** reproduced once inside the literal `npm run check` at
  `e88dbef`; the exact isolated row immediately passed 1/1, demonstrating an
  order-dependent full-suite condition rather than a deterministic assertion
  failure.
- **Failure contract:** after all typechecks passed, Vitest reported 562 passed,
  one skipped, and one failed. The failure was
  `terminalizes Contract verification infrastructure failures without promotion or
  sensitive diagnostics`. Its stack was
  `afterEach -> removeServiceCaseRoot -> makeDeletable -> readdir`, where `readdir`
  received `ENOENT` for
  `.tmp/shepherd-tests/service-*/managed/planes/auth-demo/.trusted-verification/verify-*/src`.
  The test's behavioral assertions were not the failing surface.
- **Supported diagnosis:** `runDeterministicDemo()` rejects on the first Contract
  verification infrastructure failure. Each concurrent Contract runs inside
  `withVerificationSnapshot`, whose `finally` removes its trusted snapshot. The
  fail-fast rejection can therefore reach the test and `afterEach` while a sibling
  snapshot's `finally` is still deleting the subtree that `makeDeletable` is
  traversing. The full-suite RED plus isolated GREEN and the exact disappearing
  trusted-snapshot path strongly support this race; the fixer must still capture
  the sibling `request.planePath` and establish the removal/quiescence ordering in a
  controlled causal test before editing.
- **Minimal correction:** test/fixture only. Record the sibling verification path
  and explicitly join the Contract batch/snapshot cleanup before teardown, following
  the existing TST-03 release/join pattern. Do not broadly ignore `ENOENT` in the
  security-sensitive cleanup walker, add sleeps, extend timeouts, weaken assertions,
  or change F-03 production orchestration.
- **Acceptance:** controlled RED proves teardown begins before sibling snapshot
  cleanup completes; corrected original row passes repeatedly; entire
  `service.test.ts`, strict test-source typecheck, literal `npm run check`, and
  independent integrated/hosted gates pass.
- **Observed correction:** test fixture only. A controlled verifier records the
  blocked backend `VerificationRequest.planePath` and uses the existing two-arrival
  coordination so the frontend typed failure cannot precede that capture. After
  the Mission rejects, the test proves the exact owned
  `.trusted-verification/verify-<uuid>` root still exists. It then arms
  `fs.promises.watch` on that root's parent, releases and joins the sibling, and
  requires an event for the exact basename followed by `lstat -> ENOENT` through
  the existing five-second quiescence helper. `finally` joins the Mission, sibling,
  and removal outcome before teardown. Exact row passed 20/20 in 28s; full
  service/container-verifier slice passed 43/43 in 33.22s; strict test typecheck
  passed; and literal `npm run check` passed twice in 39s/39s with launcher 3/3,
  server 563/563 plus one opt-in live skip, all typechecks and both builds. The
  security-sensitive cleanup walker and production code are unchanged.
- **Owner/status:** `RESOLVED + AUDITED` at integrated implementation `00c81ae`;
  **100% scoped**, `T,A,C,I` passed 4/4. Auditor independently passed exact-row
  repeats 20/20, adjacent 43/43, strict typecheck, two literal repository gates,
  integrated focused 1/1, and hosted Node 22 run `33263688794`. E2E-01 is ready.

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
| `GC-01` | Earlier reproduction proved buttons inserted bare `@Name With Spaces`, while the parser requires JSON quoting. | Resolved with parser-safe mention formatting, exact Agent-ID fallback, draft-preservation and two-viewport browser coverage; no parser weakening. | **RESOLVED + AUDITED** at `de3e631`; hosted run `33266624301` |
| `GC-02` | Current service/UI evidence: unmentioned message persists, but no bounded Shepherd action/reply occurs despite UI copy. | Use an existing schema-bounded Shepherd action; no free-form host/model authority. | Worker / ready |
| `GC-03` | Current service path only links an assignment to an already-created active Contract. | Add schema-validated targeted Contract creation under existing authority. | Worker / blocked by GC-01/02 |
| `GC-04` | Earlier reproduction: assignment returns conflict after the fast Mission finishes. | Remove the narrow timing dependency while keeping one mutation owner. | Worker / blocked by GC-03 |
| `GC-05` | Current UI source disables textarea when no project exists; earlier browser observation confirmed it. | Safe read-model initialization or explicit in-panel Mission-start action; preserve composer design. | Worker / ready with GC-02 |
| `GC-06` | Current lifecycle summaries use Shepherd sender; verified manifest-derived Agent summaries are absent. | Server-authored bounded summary only after verification, attributed to the real Agent ID. | Worker / blocked by targeted lifecycle |
| `MR-01` | Full bounded/advisory reviewer, degradation, deterministic independence, truthful capability UI and sparse live smoke passed through `35ec268`. | Keep advisory-only authority and bounded trusted inputs/outputs. | **RESOLVED + AUDITED**; 100% scoped |
| `MR-03` | Valid findings survive invalid peers with bounded dropped count; all-invalid degrades. Deterministic/security/live/hosted gates passed. | Retain per-finding isolation and schema/ref validation. | **RESOLVED + AUDITED** at `35ec268`; 100% scoped |
| `MR-02` | No-Ark browser/API RED showed an enabled “Run” toggle although the process composed no reviewer. The integrated fix publishes one fail-closed capability boolean and renders the preserved preference disabled with explicit **Unavailable** copy; configured PATCH remains functional. | Preserve preference and existing theme; expose no credential/model/endpoint/failure reason. | **RESOLVED + AUDITED** at `577255e`; `T,A,C,B,S,U,I` 7/7 |
| `ST-01` | Current config parses startup auto-resolution/max Planes, but `index.ts` does not pass them into `ShepherdService`. | Explicit initial-settings composition without overwriting later persisted settings. | Worker / ready |
| `ST-02` | Notification toggles persisted although no notification behavior consumed them. | Resolved by preserving stored values behind visibly Reserved/Unavailable native disabled controls; no delivery expansion. | **RESOLVED + AUDITED** at merge `d5df930`; `T,C,B,U,I` 5/5 |
| `SCH-01` | Current service invokes scheduler for one fixed initial batch without real busy/lock/active inputs. | Extend existing scheduler/service boundary for dependency waves; no architecture replacement. | Worker / blocked by SCH-02 |
| `SCH-02` | Cycles are rejected during scheduling rather than before graph persistence. | Call existing DAG validator before durable Contract creation. | Worker / ready |
| `UI-01` | Current detailed failure panel is attention-focused; ordinary failed Missions may hide typed detail. | Reuse existing failure/attention primitives; no visual redesign. | Worker / blocked by typed failures |
| `UI-02` | Current web type has optional `estimatedDurationMs`, but no server/domain producer exists. | Persist and serve trusted estimates, clearly distinct from actuals; preserve timeline design. | Worker / ready |
| `UI-03` | E2E-01 reproduced document widths of 2299/2579 on Create Agent because four transparent absolute preset radios retained global viewport-wide input sizing. | Resolved by bounding only the visually hidden preset-radio dimensions while preserving native semantics, labels, keyboard behavior, and accepted form visuals. | **RESOLVED + AUDITED** at `83954f7`; hosted closeout restored by TST-03 `0b1c401` |
| `TEST-TS` | Server production config deliberately excludes tests, which previously had no separate strict typecheck. | Resolved with a separate no-emit strict test project without changing production emit. | **RESOLVED + AUDITED** at `8995605` |
| `CI-01` | Repository previously had no required hosted repository gate. | Resolved with network/model-free Node 22 install/typecheck/test/build plus Docker verification; preserve protected-main policy. | **RESOLVED + AUDITED** at `cda2446`; hosted `33259565232` |
| `TST-05` | Candidate `592699d` routine harness run passed but modified 16/18 E2E PNGs plus an unrelated UI-03 image; the two stable down captures were unasserted blank canvases. | Resolved with ignored routine output, explicit review-update path, truthful port-down evidence, reachable Create action and real keyboard/focus coverage; no production UI/design change. | **RESOLVED + AUDITED** at `f6df2d9`, evidence `284994d` |
| `TST-06` | Candidate `592699d` passed secrets to matcher output, could not later clean a retained run root, did not canonically reject symlinked managed ancestors, and could retain live prompt/output in failure artifacts. | Resolved with secret-safe assertions, idempotent later cleanup, canonical ancestor confinement, disabled live artifacts and causal fault tests; no authority broadening. | **RESOLVED + AUDITED** at `f6df2d9` |
| `TST-07` | Local GC-01/current-main merge failed strict Server test typecheck with TS6142/TS6059 because a Server test imported Web TS/TSX outside its JSX/rootDir contract. | Resolved by assigning the complete regression to discovered, strictly typed Web ownership; no config weakening, assertion loss or product edit. | **RESOLVED + AUDITED** at `de3e631`; hosted run `33266624301` |

## Assurance gaps that are not yet defects

Missing Playwright journeys, screenshots, performance measurements, repeated-run
evidence, final security/UI reviews, sparse live smokes, rehearsals, and Phase 9
documents remain tasks in `TASKS.md`. They become defects here only when an executed
gate produces a reproducible failure.
