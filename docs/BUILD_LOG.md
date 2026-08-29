# Shepherd Build Log

This log records commands actually executed and evidence actually observed. Secrets, raw prompts, and unbounded process output are intentionally excluded.

This is a chronological evidence record, not the current task/status authority.
Branch and phase statements remain true only for the commit named in their entry.
Use [`HANDOVER.md`](HANDOVER.md) for the current repository snapshot, defects,
pending checks, and workflow.

## TST-03 deterministic concurrent-verifier regression candidate

**Date:** 2026-08-30 (Asia/Singapore)
**Branch/base:** `fix/mock-main` / `346ab91bd807ee787ac275d43f10bfe08b5a5532`

The controlled RED remains hosted run
[`33261198788`](https://github.com/kyashp/shepherd/actions/runs/33261198788):
the thrown-verifier row exhausted its existing 30-second budget and emitted an
unhandled `ContractVerificationInfrastructureError` after 558 passed, 5 skipped,
and 1 failed tests. The prior disposable backend pre-verifier hold reproduced the
same ordering defect in one second. A subsequent unmodified docs-only hosted run
[`33261491905`](https://github.com/kyashp/shepherd/actions/runs/33261491905) on
`346ab91` passed, which corroborates schedule sensitivity but does not make the
fixture deterministic.

The candidate changes only `service.test.ts`. A reusable two-arrival barrier makes
the selected frontend thrown/returned infrastructure outcome wait until the backend
has entered the verifier. A `then` success/failure observer is attached to the
Mission promise immediately, before `siblingEntered` or any other gate is awaited.
The assertion still requires the typed infrastructure failure. `finally` releases
the pair and sibling gates idempotently and joins both the Mission and sibling exit,
so an assertion failure cannot strand deferred work or create an unhandled
rejection. Existing atomic terminalization, durable reload, ownership release,
late-return, no `verification_passed`, no collision/candidate/promotion, and bounded
Plane assertions remain intact.

Observed GREEN evidence:

- focused parameterized test: 2/2 passed initially in 1.47s (929ms test time);
- 20 independent focused invocations: both parameter rows passed 40/40 in 37s;
- Shepherd service/container-verifier slice: 43/43 passed in 32.29s;
- strict `typecheck:tests`: passed;
- literal `npm run check` passed twice, in 39s and 40s: both production and strict
  test-source typechecks, launcher 3/3, server 563/563 with one opt-in live skip,
  and both production builds passed;
- `git diff --check`: passed.

No timeout changed, no sleep/retry was added, no failure was swallowed, and no
product, service, verifier, API, persistence, UI, workflow, dependency, or live/model
path changed. `TST-03` is a **100% scoped candidate** with `T,C` passed; integrated
Auditor/hosted gate `I` is pending. UI-03 stays at 98% until that hosted closeout,
and E2E-01 remains blocked only on the deterministic baseline integration.

## TEST-TS strict server test-source typecheck candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/base:** `work/mock-main` / `39211213bc1f77e8873673eda9e7c87da2b24abd`

The production server compiler excludes `*.test.ts`, so its existing typecheck did
not validate test sources. A separate `tsconfig.test.json` now reuses the production
compiler options with `noEmit`, includes production and test sources, and is invoked
after the unchanged workspace production typechecks by the root `typecheck` script.
The production build/emit configuration remains unchanged.

The initial strict RED found 14 errors across four test files: four implicit callback
types, five Vitest 4 matcher calls using removed generic parameters, four promotion
fixtures missing the required persistence callback, and one container verifier fixture
missing its required owner identity. Restoring matcher typing then exposed two nullable
fixture values. The test-only fixes add exact inferred/imported types, use `satisfies`
for matcher shapes, complete the fixtures with inert deterministic callbacks/identity,
and assert the already-established non-null candidate-head invariant. No assertion,
production behavior, UI, compiler strictness, or test coverage was removed.

```sh
./node_modules/.bin/tsc -p apps/server/tsconfig.test.json --pretty false
# RED: exit 2; 14 errors across 4 files in the categories recorded above

npm run typecheck:tests -w @launchpad/server
npm run typecheck -w @launchpad/server
npm run build -w @launchpad/server
# all passed; test-source and production typechecks plus production server emit

npm run test -w @launchpad/server -- --run src/app.test.ts \
  src/shepherd/git-plane-promotion.integration.test.ts \
  src/shepherd/service.container.test.ts src/shepherd/service.test.ts
# 4 files passed; 73/73 tests passed

npm run check
# both workspace production typechecks and the new server test-source typecheck passed
# launcher tests: 3/3 passed
# server: 26 files passed, 1 opt-in file skipped;
# 563 tests passed, 1 opt-in test skipped
# web 40-module production build and server production build passed
```

This is implementation evidence only. Independent Auditor integration/review on
`mock-main` remains the `I` gate, so confidence is scoped to 95%, not 100%.

### TEST-TS independent integration audit

The Auditor reviewed and integrated the candidate as `8995605`. The new config is
strict, no-emit, and additive: the production server `tsconfig.json`, emitted files,
web compiler, dependencies, runtime, API, and UI are unchanged. Source review found
no `ts-nocheck`/`ts-ignore`, new broad exclusion, `skipLibCheck` weakening, blanket
`any`, assertion removal, or matcher weakening. Runtime matcher objects are unchanged;
the required fixture callback and owner identity complete existing production
contracts, while the non-null assertions encode commit invariants already established
earlier in the same tests.

Independent candidate and integrated evidence:

```sh
npm run typecheck:tests -w @launchpad/server
# passed on candidate and integrated implementation

npm run typecheck -w @launchpad/server
npm run typecheck -w @launchpad/web
npm run build -w @launchpad/server
npm run build -w @launchpad/web
# both production typechecks and builds passed; web transformed 40 modules

npm run test -w @launchpad/server -- --run src/app.test.ts \
  src/shepherd/git-plane-promotion.integration.test.ts \
  src/shepherd/service.container.test.ts src/shepherd/service.test.ts
# 4 files passed; 73/73 tests passed

npm run check
# passed on candidate and integrated implementation: launcher 3/3; server 26
# files and 563/563 tests passed with one unchanged opt-in live file/test skipped;
# strict test-source and production typechecks plus web/server builds passed

git diff --check
# passed
```

The recorded RED categories match the exact corrected sites and TypeScript/Vitest
contracts; the audit did not retain a weakening mutation merely to recreate them.
`TEST-TS` is **AUDITED, scoped 100%**, with `T,C,I` passed 3/3. Hosted Node 22
evidence is recorded after the final audit-documentation push.

## UI-03 Create Agent preset-radio overflow correction

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/base:** `fix/mock-main` / `39211213bc1f77e8873673eda9e7c87da2b24abd`

The causal real-browser regression was added before production CSS changed. At
`1280x800`, Create Agent failed with document scroll/client width `2299/1280`; at
`1440x900`, it failed with `2579/1440`. The accessible four-radio group, initial
Generalist selection, one native Tab stop, ArrowLeft focus/selection, and wrapping
label click all passed before the overflow assertion, preserving the existing
semantic baseline.

The correction changes only the preset-radio CSS: each transparent absolute native
radio is `1x1`, and inherited `min-height`, margin, padding, and border are reset.
No ancestor overflow rule, React/API contract, visible card geometry, or theme was
changed. Independent read-only review then found that the global focus outline was
computed on the transparent radio rather than visibly painted on its card. A second
minimal selector applies the same existing purple 2px focus outline to the wrapping
label through `:has(input:focus-visible)`; the browser regression asserts that
visible card treatment directly.

Observed final evidence:

- focused Chromium: 2/2 passed at exact `1280x800` and `1440x900`; document
  scroll/client widths were `1280/1280` and `1440/1440`, document/body X/Y
  invariants passed, and all four computed radio boxes were `1x1` with zero
  inherited minimum height and spacing;
- semantics: four radios under the `Authority preset` group, Generalist initially
  checked, one Tab stop, arrow-key focus plus selection, visible focused-card
  outline, all four wrapping labels selectable, and exactly one checked radio;
- full deterministic browser harness: 4/4 passed across the two viewports;
- screenshots inspected at
  `docs/ui-review/ui-03-create-agent/{1280x800,1440x900}.png`; hashes are
  `b64a61aa0c01566a710e3a480f6186a95e97075a06d97c89c327ea10cfec2de9` and
  `ac630408a97445d439f79305b8c25854bdc07d3bb6fa741f45e3509055a26804`;
- literal `npm run check`: both typechecks, launcher 3/3, server 563/563 with one
  opt-in live skip, and both production builds passed.

The independent read-only re-review reran the focused browser slice 2/2, observed
the visible card outline, passed `git diff --check`, and closed its earlier Medium
finding with no remaining UI-03 findings.

No live/model request was made. `UI-03` is a **100% scoped candidate** with
`T,C,B,U` passed; integrated Auditor gate `I`, `E2E-01`, and `UI-GATE` remain
pending and are not claimed here.

### UI-03 independent integration audit

The Auditor integrated the candidate as `83954f7` while preserving the newer
TEST-TS gate and its evidence. The only product change remains eleven lines in the
existing preset-radio CSS: a locally bounded transparent native input and the
existing purple two-pixel focus treatment painted on its wrapping card. No React,
API, navigation, ancestor overflow, dependency, runtime, or unrelated design change
was introduced.

Independent integrated evidence:

```sh
node --test tests/e2e/harness.test.mjs
# 2/2 passed

PLAYWRIGHT_BROWSERS_PATH=.tmp/playwright-browsers \
  npx playwright test --config=playwright.config.ts -g "Create Agent presets"
# 2/2 passed at 1280x800 and 1440x900

PLAYWRIGHT_BROWSERS_PATH=.tmp/playwright-browsers \
  npx playwright test --config=playwright.config.ts
# 4/4 passed across both required viewports

npm run check
# strict server test-source plus both production typechecks passed; launcher 3/3;
# server 26 files and 563/563 tests passed with one unchanged opt-in live skip;
# web 40-module and server production builds passed

git diff --check
# passed
```

The browser gate observed document/body scroll width and height within client
geometry, four `1x1` radios with zero inherited minimum height/padding/border/margin,
an accessible `Authority preset` group and radio names, Generalist initially checked,
one native Tab stop, ArrowLeft focus/selection, a visible theme-matched 2px outline,
all four label clicks, and exactly one checked radio. Regenerated screenshots exactly
matched the committed hashes and were visually inspected for adjacent layout,
spacing, hierarchy, clipping, and theme consistency. The authenticated token was not
rendered, temporary browser/run artifacts remained ignored, and no model/network call
occurred. This establishes `T,B,U,I` for UI-03. Final hosted `C` remained pending
the audit-documentation push.

### UI-03 hosted closeout failure / TST-03

Required-check run
[`33261198788`](https://github.com/kyashp/shepherd/actions/runs/33261198788),
job `99123330844`, failed on final audit head `2ba5cb9`. Setup, checkout, Node 22,
Docker and locked install passed. The repository gate reached server tests, then
`atomically interrupts a blocked sibling after 'thrown verifier exception'` timed
out at 30 seconds and emitted an unhandled
`ContractVerificationInfrastructureError`. Hosted results were 24 files passed, 2
skipped and 1 failed; 558 tests passed, 5 environment-gated skipped and 1 failed.
Builds did not run. The five-skip hosted profile was unchanged.

The UI-03 diff does not touch that backend service test or orchestration. Source
inspection instead found a schedule-sensitive test contract: it awaits the backend
fixture's `siblingEntered` promise before attaching rejection handling to the
already-started Mission. Under contention, the frontend can terminalize first, so
the awaited sibling signal never arrives and the Mission rejection becomes
temporarily unhandled. The test has no unconditional sibling release/join when a
timeout or assertion wins. Five isolated local repetitions subsequently passed 5/5,
which confirms intermittency and does not correct the hosted RED.

A disposable controlled fault probe then held the backend only at
`contract_verification_snapshot_ready`, immediately before verifier entry, and
shortened only that temporary test's budget to one second. The thrown-verifier row
deterministically timed out and Vitest reported the same unhandled
`ContractVerificationInfrastructureError`. The mutation lived only in the Auditor's
temporary worktree and was not integrated. This separates the orchestration race
from machine speed and directly validates the supported root cause.

`TST-03` now owns the smallest test-only correction: deterministic two-arrival
coordination, immediate rejection handling, and unconditional bounded release/join;
no sleep, timeout increase, swallowed rejection, weakened F-03 assertion, or product
change. Until its repeated/full/hosted acceptance is green, UI-03 remains **98%
scoped** with `T,B,U,I` passed 4/5 and hosted `C` pending; E2E-01 remains blocked by
the baseline rather than by its resolved Create Agent browser prerequisite.

## CI-01 required-check workflow candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/base:** `work/mock-main` / `7217c1c055df76ace392d3804bc6517df85ce768`

The repository had no workflow capable of reporting the stable required status
named `Required checks / Node 22 / npm run check`. This candidate adds one workflow
and changes no product, UI, server, test, package, lockfile, dependency, or runtime
configuration.

The workflow follows the current official GitHub Actions contracts reviewed on
2026-08-29: every `pull_request` runs; `push` is limited to `main` and `mock-main`;
and `merge_group` is limited to `checks_requested`, which GitHub documents as
necessary for merge-queue required checks. Workflow concurrency is scoped by the
workflow name and event ref, so a newer run cancels only an older run for the same
workflow/ref. The job runs on `ubuntu-latest`, installs Node 22 through
`actions/setup-node@v7`, caches npm's download cache against the checked-in
`package-lock.json`, verifies the hosted Docker client/daemon, executes `npm ci`,
and then executes the literal `npm run check`. The job has a 20-minute timeout.

Security and isolation are explicit:

- top-level token permission is only `contents: read`; all unspecified permissions
  are `none` under GitHub's workflow permission semantics;
- `actions/checkout@v6` uses `persist-credentials: false`;
- no `pull_request_target`, write permission, secret reference, `.env` loader,
  artifact upload, custom/privileged action, deployment, or external/live/model
  command exists;
- `SHEPHERD_LIVE_TEST` is fixed to `false`, and repository secrets are not mapped
  into the job environment.

No Action-specific linter was installed on this host. The available PyYAML 6.0.1
parser loaded the workflow with `BaseLoader`, and custom structural assertions
verified the exact events/branches, merge-group activity, permission, runner,
timeout, official action versions, and command sequence:

```sh
python3 -c '<YAML parse and structural assertions>'
# workflow YAML and required structure: pass

docker version --format '{{.Client.Version}} {{.Server.Version}}'
# client 29.7.2; server 29.7.2

npm run check
# Node 24.17.0 / npm 11.17.0 local evidence
# both workspace typechecks passed
# launcher tests: 3/3 passed
# server: 26 files passed, 1 opt-in file skipped;
# 555 tests passed, 1 opt-in test skipped
# web and server production builds passed

git diff --check
# passed
```

The Worker branch is intentionally not a `push` trigger, and the user prohibited a
PR for this campaign. After pushing the candidate, the authenticated read-only
query `gh run list --repo kyashp/shepherd --branch work/mock-main ...` returned
`[]`, confirming no hosted run exists for that branch. CI-01 remains below 100%
until the Auditor integrates it into `mock-main`, observes the real hosted Node
22/Docker run, records the resulting check identity, and confirms the
protected/merge-queue rule consumes that stable status. No external model request
was made.

### Independent Auditor pre-hosted integration review

**Candidate:** `bdab32da9305a3787ec4b0c1d2061d521230eeae`

**Integrated workflow:** `cda2446584d0f5d6c07ec8d2521d08fb6711f971`

The Auditor independently confirmed the exact three-file diff: the workflow plus
`TASKS.md` and this log. Product, UI, server, tests, dependencies, lockfile, runtime
configuration, and environment examples are unchanged. PyYAML `BaseLoader` parsing
and structural assertions covered the complete event map, branch filters,
`checks_requested`, permissions, concurrency expression, runner, timeout, child
environment, action inputs, and exact command sequence.

Current official GitHub documentation reviewed on 2026-08-29 confirms that
`pull_request:` without filters runs every PR; `push.branches` limits pushes to the
two named branches; merge queues require the separate `merge_group` trigger and
currently support `checks_requested`; unspecified permissions become `none`; the
workflow/ref concurrency expression cancels only an older matching run; and the
20-minute positive integer is a valid bounded job timeout. Official action refs
also resolve: `actions/checkout@v6` is still supported, while v7 is latest and its
documented breaking safety change concerns `pull_request_target`, which this
workflow does not use; `actions/setup-node@v7` is current and its npm cache hashes
the named `package-lock.json` while caching npm data rather than `node_modules`.

Independent local evidence on the candidate:

```sh
python3 -c '<BaseLoader parse and structural assertions>'
# pass

docker version --format 'client={{.Client.Version}} server={{.Server.Version}}'
# client=29.7.2 server=29.7.2

npm run check
# typechecks passed; launcher 3/3; server 26 files and 555 tests passed;
# one opt-in live file/test skipped; web 40-module and server builds passed

git diff --check
# pass
```

The workflow maps no repository secret and invokes no env loader, model/live test,
artifact upload, deployment, privileged container, or write-capable command.
`contents: read` is the only token permission and checkout credential persistence
is disabled. Hosted Node 22, `npm ci`, Docker daemon availability, the emitted check
identity, and the real trigger remain pending until the first `mock-main` push run
completes; CI-01 is not yet marked audited.

### Hosted integration result

The combined `mock-main` push at `cd23488b29d9f45ba854e11ef1b6bf41c1bcda3f`
triggered the newly integrated workflow exactly once:

- run: `33259565232`
- URL: `https://github.com/kyashp/shepherd/actions/runs/33259565232`
- event/ref: `push` / `mock-main`
- job/check: `Node 22 / npm run check` (`99119063014`)
- conclusion: `success`
- duration: 91 seconds, from `2026-08-29T15:11:31Z` to `15:13:02Z`

Every hosted step succeeded: checkout with credential persistence disabled,
setup-node, Docker client/daemon probe, `npm ci`, literal repository gate, both
post-action cleanups, and job completion. Bounded logs established the real hosted
environment and counts:

```text
Node 22.23.2; npm 10.9.8
Docker client 28.0.4; server 28.0.4
launcher: 3/3 passed
server: 25 files passed, 2 environment-gated files skipped;
        551 tests passed, 5 skipped, 556 total
web: 40 modules transformed; production build passed
server: TypeScript production build passed
```

The hosted skip delta is explicit rather than hidden: local Docker evidence passed
555 server tests with only the opt-in live test skipped, while hosted `CI=true`
retained five repository-defined environment-gated skips. The dedicated hosted
Docker probe proved both client and daemon availability independently. No secret,
model, live-test, deployment, artifact, or write-capable path ran.

**Verdict:** `CI-01` is **AUDITED at scoped 100%**, `C,I` 2/2. The stable branch
protection check to select is `Node 22 / npm run check` from workflow `Required
checks`. A repository administrator must still add this check to the protected
`main` ruleset/branch-protection rule (and enable merge queue there if desired);
that external administrative mutation was not performed by an agent.

## E2E-01 stopped at Create Agent overflow defect

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/base:** `work/mock-main` / `ace01ae0a6875f102ea0fec30e871a0e2f6d60a8`

The Worker extended only the deterministic test composition toward PRD 11.6.1,
then stopped at the first reproduced production defect as required. Before the
browser stage, the real web/server production build passed and the existing
isolated harness causal tests passed 2/2. No `.env` was read and no external/model
request was made.

The focused command drove the built authenticated application with Playwright
`1.62.1` / Chromium `151.0.7922.34`:

```sh
npm run test:e2e:starter-kit
# build passed; harness unit 2/2 passed
# browser 0/2: Create Agent overflow assertion failed at both viewports
# 1280x800: document scrollWidth 2299, clientWidth 1280
# 1440x900: document scrollWidth 2579, clientWidth 1440
```

The earliest divergence occurs after the four recommended authority radios render,
before creating an Agent, calling fake Codex, changing workspace files, or testing
restart continuity. A one-project diagnostic rerun at `1280x800` enumerated every
overflowing element. Each transparent absolute `.preset-grid input` retained the
global `input { width: 100%; min-height: 38px; ... }` sizing: all four inputs had
`clientWidth=1280`, and their static grid positions produced right edges `1589`,
`1826`, `2063`, and `2299`. The accepted visible form looked clipped only because
the main content surface hides X overflow; the document geometry was still invalid.

This establishes `UI-03` causally. The minimal correction belongs to the Fixer:
bound only the visually hidden native radio dimensions while preserving labels,
selection, keyboard semantics, and all accepted styling. The Worker did not edit
React, CSS, or any production file, did not weaken the no-overflow gate, and did not
attempt the separately labelled sparse live acceptance while deterministic E2E-01
was red. Live call count: **0**. E2E-01 remains blocked with no acceptance gate
claimed.

### Independent Auditor reproduction

**Evidence candidate:** `7b92813550f192d2b45e3e4e39f473b99c084615`

**Docs integrated as:** `eb44d8633aa7e78cc7b89ea69e9215e3755be178`

The candidate diff from `ace01ae` contains only this log, `FIXES.md`, and the
`E2E-01` ledger row. It does not contain the Worker's unfinished E2E-01 code or any
React, CSS, API, runtime, test configuration, dependency, or production change.
The Auditor independently drove the integrated built application through access
token unlock and the Create Agent link using the audited deterministic harness.

At `1280x800`, document geometry was `clientWidth=1280`, `scrollWidth=2299`;
the four transparent absolute radios were each `1280x38`, with bounds ending at
`1589`, `1825.75`, `2062.5`, and `2299.25`. At `1440x900`, document geometry was
`clientWidth=1440`, `scrollWidth=2579`; the radios were each `1440x38`, ending at
`1749`, `2025.75`, `2302.5`, and `2579.25`. In both cases document height and all
body X/Y measurements stayed within the viewport. This isolates the failure to
the root X extent created by the hidden inputs; it is not ordinary page content or
a vertical-overflow defect.

The browser-computed radio style was `position:absolute`, `opacity:0`, and
`pointer-events:none`, while global form rules still supplied `width:100%`,
`min-height:38px`, padding, and a border. The source/geometry causal account is
therefore confirmed. Existing native semantics were also measured as the
preservation baseline: Generalist was the initial checked radio and the radio group
was reached as one Tab stop; ArrowLeft moved both focus and selection to
Verification; direct focus plus ArrowRight selected the next radio; clicking the
wrapping Verification label left exactly one radio checked.

No live/model request, Agent creation, fake Codex turn, product edit, or sibling
branch integration occurred. Temporary screenshots/scripts and the isolated run
root were removed; no server process remained.

**Verdict:** `UI-03` is independently reproduced with **100% causal-diagnosis
confidence** and **0% correction completion**. The Fixer must constrain only the
hidden radio box, explicitly overriding inherited size/spacing properties without
changing the visible form or native focus/selection/label contract. Required gates
are focused causal Playwright coverage, `1280x800` and `1440x900` browser/screenshots
with document/body X/Y invariants, literal `npm run check`, independent rendered
`ui-reviewer`, and post-integration Auditor rerun. `E2E-01` remains blocked.

## E2E-HARNESS deterministic browser foundation

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/base:** `work/mock-main` / `42d3b517c05a20f6a9e526390e9e82d95306e859`

The repository had the Playwright package but no checked-in configuration, browser
test, deterministic real-server composition, or fake Codex executable. This
candidate adds only test infrastructure, two baseline screenshots, root test
scripts, and evidence documentation. Production server, React, CSS, API, and
runtime behavior are unchanged.

`tests/e2e/support/test-app.mjs` starts the built Fastify application directly on
an ephemeral loopback port. Every data, workspace, home, temporary, Codex, and
Shepherd path is under one exact `.tmp/playwright-harness/run-*` directory. The
child environment is constructed from an allowlist instead of spreading
`process.env`: Ark/model values are empty, the execution mode is deterministic,
and no `.env` loader or live model path runs. Startup uses a bounded fake Codex
protocol executable and a startup-only fake container engine that permits only the
two ownership-filtered empty `ps` reconciliation calls. There is no production
debug/fault route. Readiness polls the real health endpoint; teardown sends
`SIGTERM`, bounds the wait, retains a `SIGKILL` fallback, removes only the exact
allocated run root, and is tested to close the port.

Observed focused verification with Playwright `1.62.1` and repo-local Chrome for
Testing/Chromium `151.0.7922.34`:

```sh
npm run test:e2e:install
# Chromium, headless shell, and FFmpeg installed below ignored .tmp/

npm run test:e2e:harness
# build passed
# Node harness tests: 2/2 passed
# Playwright Chromium: 2/2 passed using one worker
```

The Node tests verify the fake Codex version/run/resume protocol, output/prompt
bounds, real HTTP health, required bearer authentication, unauthenticated 401,
authenticated system state, `codexAvailable=true`, deterministic/local runtime,
real production HTML, ambient-Ark exclusion, and state/process/port cleanup. A
planted ambient Ark canary and the test bearer token were absent from persisted
state, the system API payload, and bounded server logs.

The Playwright test unlocks the real app through the access-token form, waits for
the Shepherd heading and `Kernel online`, verifies the exact browser dimensions,
asserts document and body scroll sizes do not exceed their client dimensions on
either axis, and verifies the token is absent from rendered text. Captures were
written to:

- `docs/ui-review/e2e-harness/1280x800.png`
- `docs/ui-review/e2e-harness/1440x900.png`

Both captures were visually inspected against PRD 11.7. They preserve the accepted
cream surface, charcoal sidebar, violet accent, restrained borders/shadows,
typography and spacing, with no overlap, raw state, or document-level overflow.
The expected deterministic clean-start runtime warning and empty Mission panels
are visible. This is harness/baseline evidence only; it does not satisfy the eight
full PRD journeys, populated/intermediate states, accessibility review, or the
independent `UI-GATE`.

Repository regression evidence:

```sh
npm run check
# both workspace typechecks passed
# launcher tests: 3/3 passed
# server: 26 files passed, 1 opt-in file skipped;
# 555 tests passed, 1 opt-in test skipped
# web and server production builds passed

git diff --check
# passed
```

No external/model API request was made. Secret isolation was exercised through
store/API/log/DOM checks; no production trust boundary changed, so an independent
security-reviewer is not required for this test-only candidate. `T`, `C`, `B`, and
`S` are evidenced. Auditor integration and the `I` gate remain pending.

### Independent Auditor integration

**Candidate:** `fd4953defd4a2e9331bb7dc39f79aea8fbc05342`

**Integrated implementation:** `5b152a0c54ac1ed97c69d69cc84a7e093f5250e9`

The Auditor reviewed the exact parent-relative diff and dependency graph before
integration. The implementation scope is the Playwright configuration, root test
scripts, E2E support/fixtures/tests, two PNG baselines, and evidence documentation.
The existing Playwright `1.62.1` lock entry is reused; `package-lock.json` did not
change. No server source, web source, CSS, API route, runtime configuration,
production launcher, `.env` example, or production debug/fault route changed.

Source and focused runtime review confirmed that the built server is spawned
directly with a constructed child-environment allowlist rather than `process.env`;
there is no env-file flag or dotenv loader. Ark/model variables are empty, the
runtime is deterministic and loopback-only, and no model request is possible in
the exercised state. The real API still requires bearer authentication. The fake
Codex limits invocation shape, prompt size and output; the fake container engine
returns only an empty result for the two ownership-filtered startup `ps` probes.
Readiness is capped at 15 seconds, captured output at 16 KiB, and shutdown at
`SIGTERM` plus a bounded `SIGKILL` fallback. Each run uses a single exact
repository-local ignored root; tests proved state-root deletion and port closure.

The candidate was independently tested in a detached audit worktree, then the
same gates were repeated after integration on `mock-main`:

```sh
npm run test:e2e:harness:unit
# build passed; Node harness 2/2 passed

PLAYWRIGHT_BROWSERS_PATH=.tmp/playwright-browsers \
  npx playwright test --config=playwright.config.ts
# Chromium 2/2 passed: 1280x800 and 1440x900

npm run check
# typechecks passed; launcher 3/3; server 26 files and 555 tests passed;
# one opt-in live file/test skipped; web 40-module build and server build passed

git diff --check
# passed
```

Both fresh screenshots had the exact committed dimensions and hashes:

- `1280x800.png`: `07acf85b0cdfe947aca71a3bf26c476a20305761aa7d2f4bf0dca334014bfd05`
- `1440x900.png`: `3b54e1afe689acee16a8c6a0991e3178f7440f6d2cd9118a03a480bb975ed355`

The Auditor visually inspected both captures. They preserve the accepted charcoal,
cream and violet design language with legible empty-state hierarchy, no overlap,
and no document/body X/Y overflow. The access token is absent from DOM text and
the screenshots; the ambient Ark canary is absent from state, API payloads and
bounded logs. No server process or per-run state remained after either run. Only
the expected ignored browser binaries and Playwright last-run metadata remain.

**Verdict:** `E2E-HARNESS` is **AUDITED at scoped 100%** with `T,C,B,S,I` 5/5.
No independent UI or security reviewer was required because production UI and
trust-boundary code did not change. This verdict covers only the deterministic
authenticated clean-shell foundation. `E2E-01` through `E2E-08`, populated and
composer interactions, accessibility, live-model acceptance, and `UI-GATE` remain
separate pending work.
## F-03 Contract verifier infrastructure failure candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/base:** `fix/mock-main` / `origin/mock-main@ace01ae`

The causal regression planted a Contract-only verifier exception containing a
canary and private diagnostic path. Before the correction, the raw exception
escaped; the Mission became `failed` with code `unknown` at
`deterministic_demo`, both Contracts remained `verifying`, both Contract Planes
remained `inspecting`, and both Agents remained `busy` with
`currentContractId` retained.

The correction is confined to the existing Contract verification service and
verifier cancellation boundaries. A thrown verifier infrastructure error or a
returned mandatory check with status `infrastructure_error` now produces fixed
`verification_infrastructure_error` evidence at `contract_verification`. Ordinary
mandatory checks with status `failed` retain `failed_independent_acceptance`.
One durable mutation sets the throwing/returning Contract and its Plane to
`verification_failed`/`failed`, interrupts every active sibling Contract/Plane,
releases all mission-owned Agent and project ownership, and fails the Mission.
The batch returns promptly, makes bounded best-effort cancellation calls, and
rejects late sibling completion. Target cancellation remains sticky across
sequential checks and reserved container creation, prevents later invocation or
container start, contains repeated cancellation during bounded removal, and allows
clean exact-ID reuse only after cleanup. Passing verification still requires
independent evidence; no integration, candidate, or promotion path is entered.

Three read-only review rounds prevented incomplete candidates from release. The
first found an active sibling beneath a failed Mission. The second fault probe
found the production container verifier returns infrastructure evidence rather
than always throwing, plus non-sticky sequential/reserved cancellation. The third
found a repeated cancel during delayed removal could leave a stale marker and
cancel later same-ID work. Regressions preserve each failure: blocked sibling plus
durable reload and late return; returned mandatory infrastructure evidence;
no sibling verifier invocation; no second sequential check; no `start` after
reserved cancellation; and delayed removal plus repeated cancel and bounded ID
reuse. Final re-review reported no blocker, high, or medium finding. The configured
custom reviewer role was unavailable, so reviews used a separate read-only
fallback agent.

Observed verification:

```sh
npm run test -w @launchpad/server -- --run \
  src/shepherd/service.test.ts src/shepherd/verifier.container.test.ts \
  -t "terminalizes Contract verification infrastructure failures without promotion or sensitive diagnostics|terminalizes returned Contract verification infrastructure evidence|preserves ordinary failed mandatory Contract acceptance semantics|atomically interrupts a blocked sibling after|does not invoke a sibling verifier after infrastructure terminalization|keeps target cancellation sticky across sequential checks and permits bounded ID reuse|keeps cancellation sticky across reserved container creation before start"
# 2 files; 8 passed, 34 skipped

npm run test -w @launchpad/server -- --run \
  src/shepherd/service.test.ts src/shepherd/verifier.container.test.ts \
  src/shepherd/codex-executor.test.ts src/shepherd/executor.test.ts src/app.test.ts \
  src/shepherd/recovery.test.ts src/shepherd/recovery.process.test.ts \
  src/shepherd/state-machine.test.ts src/database.test.ts src/store.test.ts
# 10 files passed; 185/185 tests passed

npm run check
# exit 0: both workspace typechecks; launcher 3/3; server 26 files and
# 563/563 tests passed with one opt-in live file/test skipped;
# web and server production builds passed

git diff --check
# exit 0
```

The planted canary, private path, and raw verifier message were absent from the
durable Mission detail, public Mission DTO, and persisted store file. No Ark/model
request was made. Browser/UI and live Runtime gates were not run because this
candidate changes only backend failure/cancellation orchestration and deterministic tests.
`T,A,C,S` are fixer-verified; independent Auditor integration gate `I` remains
pending.

### F-03 independent integration audit

The Auditor reviewed and integrated the corrected candidate as `dc87553` without
changing UI, dependencies, runtime configuration, public routes, or the existing
required-check workflow. The state transition uses fixed bounded
`verification_infrastructure_error` evidence, preserves ordinary mandatory
acceptance failure, terminalizes all Mission-owned Contract/Plane/Agent/project
ownership in one durable mutation, and rejects late sibling success before any
integration, collision, candidate, or promotion path. The container boundary keeps
cancellation sticky through sequential checks and reserved creation/removal,
contains repeated cancellation, and releases only the exact target for bounded
same-ID reuse.

Independent observed results on the candidate and integrated tree:

```sh
# exact corrected service/verifier selection
# 2 files passed; 8 passed, 34 skipped

# service/API/recovery/store/state-machine/executor/verifier adjacency
# 10 files passed; 185/185 tests passed

npm run check
# launcher 3/3; server 26 files and 563/563 tests passed with one opt-in live
# file/test skipped; both workspace typechecks and production builds passed

git diff --check
# passed
```

The failure regressions reload the durable store after terminalization, release a
blocked late sibling, and assert the terminal state is unchanged with no green
verification, integration, collision, candidate, selection, or promotion evidence.
Canary diagnostics and private paths remain absent from durable state, public DTOs,
and the store file. No model/network call was made. `F-03` is **AUDITED, scoped
100%** with `T,A,C,S,I` passed 5/5; hosted Node 22 evidence is recorded after the
final audit documentation push.

## TST-02 deterministic recovery fixture clock

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/base:** `work/mock-main` / `6f7660d`

The post-CAS startup-reconciliation fixture created its Git Planes with
`PlaneManager`'s wall clock but reconciled them at the fixed instant
`2026-08-29T12:05:00.000Z`. Once wall time passed that instant, recovery attempted
to persist an `updatedAt` earlier than the Plane's `createdAt`; the store correctly
rejected the invalid lifecycle state.

The original isolated reproduction was preserved before editing:

```sh
npm run test -w @launchpad/server -- --run src/shepherd/recovery.test.ts \
  -t "fails closed, recognizes the exact post-CAS window, cleans private artifacts, and is idempotent"
# RED: 1 failed, 16 skipped; JsonStore reported
# "Refusing to persist invalid database state"
```

The smallest correction is test-only: the affected fixture now passes its existing
deterministic `12:00Z` clock to `PlaneManager`, so Plane creation precedes the
deliberate `12:05Z` recovery instant. Production recovery, store validation, and
lifecycle ordering assertions are unchanged.

Observed GREEN verification:

```sh
npm run test -w @launchpad/server -- --run src/shepherd/recovery.test.ts \
  -t "fails closed, recognizes the exact post-CAS window, cleans private artifacts, and is idempotent"
# 1 passed, 16 skipped

npm run test -w @launchpad/server -- --run src/shepherd/recovery.test.ts
# 17/17 passed

npm run check
# exit 0: both workspace typechecks passed; launcher 3/3 passed;
# server 26 files and 555 tests passed with one opt-in live file/test skipped;
# web and server production builds passed
```

No Ark/model request was made. The implementation has `T`, `A`, and `C` evidence;
independent Auditor integration and the `I` gate remain pending.

### Independent Auditor integration

**Candidate:** `bab6de18e7c28e5f8a132f8d80163f509c890a1e`

**Integrated implementation:** `0cb431a0420e3d7f77784fe4c62b42f92710446c`

The Auditor fetched the candidate without touching the Worker's worktree, reviewed
the exact parent-relative diff, and found one production-adjacent test change:
`recovery.test.ts` injects the fixture's existing `12:00Z` clock into its
`PlaneManager`. The only other changes were this build-log entry and the task row.
No production, UI, store, recovery, lifecycle-validation, API, security, dependency,
or configuration file changed. `git show --check` and the parent-to-candidate diff
check passed.

The candidate was first verified in a separate detached repository-local audit
worktree:

```sh
npm run test -w @launchpad/server -- --run src/shepherd/recovery.test.ts \
  -t "fails closed, recognizes the exact post-CAS window, cleans private artifacts, and is idempotent"
# 1 passed, 16 skipped

npm run test -w @launchpad/server -- --run src/shepherd/recovery.test.ts
# 17/17 passed

npm run check
# launcher 3/3; server 26 files and 555 tests passed;
# one opt-in live file/test skipped; both production builds passed
```

After cherry-picking the candidate onto `mock-main` as `0cb431a`, the Auditor ran
the same integrated-SHA gates again with the same counts: isolated 1/1, recovery
17/17, launcher 3/3, server 555/555 with one opt-in skip, and both builds green.
The audit worktree was clean and removed after verification; the main worktree was
clean before integration.

**Verdict:** `TST-02` is **AUDITED at scoped 100%** with `T,A,C,I` 4/4. The fixed
fixture clock removes the time-dependent test failure while strict lifecycle/store
validation remains unchanged. Browser, live-model, UI-review, and security-review
gates were not run because this correction changes only deterministic test setup
and evidence documentation.

## OPS-05 canonical launcher-entry candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch:** `fix/31-ops-05-canonical-launcher-entry`
**Issue:** [#31](https://github.com/kyashp/shepherd/issues/31)

On macOS, `os.tmpdir()` returned a lexical `/var/...` path while `realpath()`
returned its `/private/var/...` filesystem identity. The launcher compared the
lexical `process.argv[1]` with ESM's canonical module path, misclassified direct
execution as an import, and exited before starting its child. The preserved initial
launcher suite RED was 1/2: the direct-shell fixture failed with missing
`startup-environment`. A new deterministic symlink-entry RED then failed 0/1
because its child-side-effect marker was absent even though the launcher exited 0.

The launcher now canonicalizes both entry paths with `realpath()` before comparing
them. An identity-resolution failure is an explicit generic launcher error (exit 1),
never a safe import classification. The regression invokes a symlink alias and
asserts that its child writes the marker. The existing direct-shell fixture now uses
a temporary `HOME` and asserts Darwin's documented user-local state root while
retaining Linux's repository-local root; exact Docker-default localization, explicit
custom paths, Node-only dotenv parsing, inherited child environment, and secret
non-disclosure assertions remain intact.

Observed GREEN verification:

```sh
node --test scripts/start-local-poc-launcher.test.mjs
# 3/3 passed, repeated five consecutive times

npm run check
# exit 0: workspace typechecks passed; launcher 3/3; server 25 files passed,
# 550 tests passed, 2 opt-in tests skipped; web and server production builds passed

npm audit
# found 0 vulnerabilities
```

No Ark or Shepherd model request was made. A real zero-parameter Docker smoke was
unavailable in this session: the Docker CLI was installed but `docker info` exited
1, so no live Runtime claim is recorded.

## OPS-04 local loopback candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/commit:** `fix/29-ops-04-local-loopback` / `a0a2d60`
**Issue:** [#29](https://github.com/kyashp/shepherd/issues/29)

The first exact post-#28 command, `./scripts/start-local-poc.sh`, used the real
ignored `.env` without printing values. Runtime preflight and both builds passed,
but server configuration then failed closed because the inherited host was an
any-address value and the configured application token was a placeholder. A
classification-only check confirmed those facts without exposing either value.

The candidate changes only the local launcher: an empty host or the exact container
any-address values `0.0.0.0` and `::` become `127.0.0.1`. Other custom hosts remain
unchanged, and the server's non-loopback token validation is untouched. The causal
RED fixture captured `0.0.0.0`; GREEN captured `127.0.0.1` through the real launcher
boundary.

The exact direct command was then run from the candidate worktree against the real
ignored `.env` through a temporary ignored symlink; no credential was copied,
printed, or committed. Observed results:

- listener: `127.0.0.1:3000` only;
- `GET /api/health`: 200;
- `GET /`: 200;
- unauthenticated `GET /api/system`: 401;
- authenticated `GET /api/system`: 200 with Ark configured, Codex available, and
  the container/Docker Runtime selected;
- SIGINT closed port 3000 and left zero Runtime containers owned by the configured
  instance; the temporary `.env` symlink was removed;
- no Agent or Shepherd model request was made.

Final local verification before PR creation:

```sh
node --test scripts/start-local-poc-launcher.test.mjs
# 2/2 passed

npm run check
# exit 0: both workspace typechecks passed
# launcher tests 2/2 passed
# 26 server test files passed, 1 opt-in live file skipped
# 551 tests passed, 1 opt-in live test skipped
# web and server production builds passed
```

The configured custom security-reviewer role was unavailable. An independent
read-only fallback review reported no high or medium finding and confirmed that
non-loopback hosts still reach the unchanged server token-enforcement boundary.
It reported one Low test gap for empty, IPv6-any, and explicit custom hosts. The
launcher regression now covers empty and `::` normalization plus preservation of
the concrete documentation-range host `192.0.2.10`; the focused test remains 2/2.

## OPS-02 direct local startup candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch/commit:** `fix/27-ops-02-direct-env-launch` / `e4cb2e5`
**Draft PR:** [#28](https://github.com/kyashp/shepherd/pull/28)

Direct `./scripts/start-local-poc.sh` previously exited 2 before Runtime detection
because it did not read the repository `.env`. The preserved RED launcher fixture
observed the generic missing-Ark-variable error. The candidate performs one guarded
handoff through Node's dotenv parser and marks the returned shell environment to
prevent recursion; `.env` is never sourced or printed.

The same fixture established the adjacent host-path defect: `.env.example` Docker
defaults would otherwise remain `/app/...`. The candidate maps only those exact
defaults into the existing platform local-state root and leaves explicit custom host
paths unchanged. The fake engine/npm boundary captures values only in a private
temporary test file and asserts that planted Ark/model sentinels never reach stdout
or stderr.

Observed verification:

```sh
node --test scripts/start-local-poc-launcher.test.mjs
# 2/2 passed: npm launcher compatibility; direct dotenv/path behavior

bash -n scripts/start-local-poc.sh
node --check scripts/start-local-poc-launcher.mjs
git diff --check
# all passed

npm run check
# exit 0: both workspace typechecks passed
# launcher tests 2/2 passed
# 26 server test files passed, 1 opt-in live file skipped
# 551 tests passed, 1 opt-in live test skipped
# web and server production builds passed
```

No live Ark or Shepherd-model request was made. The configured custom security
reviewer role was unavailable, so an independent read-only fallback reviewer
inspected the exact `origin/main...8266c46` delta. It reported no critical, high,
medium, or low finding: Node parses rather than executes `.env`; the recursion
marker adds no privilege boundary; paths remain quoted; only exact Docker defaults
are localized; and container isolation is unchanged. It reran the launcher suite
2/2. A post-merge real zero-parameter startup smoke remains before `OPS-02` may be
marked complete on `main`.

## Phase 0 — Baseline Lock

**Date:** 2026-08-29 (Asia/Singapore)
**Branch:** `feature/shepherd-phase-0-baseline`  
**Starting commit:** `12479cf`  
**Environment:** Node 24.17.0, npm 11.17.0, Git 2.43.0, Docker client/server 29.7.2, Linux host. The application Runtime image is based on Node 22.

### Configuration and credential hygiene

- Confirmed ignored `.env` contains configured `ARK_API_KEY`, `ARK_MODEL`, `SHEPHERD_MODEL`, and `ARK_BASE_URL` without printing their values.
- Removed real values from tracked `.env.example`; it now contains placeholders only.
- Direct Responses API probes returned HTTP 200 and exact output `OK` for the configured Agent model (`gpt-5.6-terra`) and Shepherd model (`gpt-5.6-sol`).
- Added ignored `.tmp/` so test/browser temporary state can remain inside the repository boundary.

### Locked dependency baseline

Commands:

```sh
npm ci
npm audit fix
npm audit
```

Observed:

- Locked install completed.
- The initial audit reported five high and one moderate advisory.
- Non-force audit remediation updated seven transitive packages.
- Final audit: `found 0 vulnerabilities`.
- Added exact development dependency `@playwright/test@1.62.1`; Chromium 151 test binaries are held under ignored repository-local `.tmp/`.

### Real starter Runtime acceptance

Started the actual local PoC on loopback with repository-local persistent state and the disposable Docker Runtime. The first build produced `volc-agent-runtime:local`. Runtime preflight observed that Landlock was unavailable and correctly used the documented `danger-full-access` inner fallback inside the disposable outer container.

Observed API/system state:

```json
{
  "arkConfigured": true,
  "arkModel": "gpt-5.6-terra",
  "codexAvailable": true,
  "runtimeProvider": "container",
  "containerEngine": "docker"
}
```

Acceptance journey:

1. Created one real Agent through `POST /api/agents`; it entered `ready`.
2. Sent a dependency-free hello-world CLI task through `POST /api/agents/:id/messages`.
3. Observed Run transition `queued → running → completed`.
4. Agent created `hello.js` and `hello.test.js`; the exact Runtime-container command `node --test hello.test.js` passed 1/1.
5. Sent a minimal follow-up in the same persisted Codex thread; observed exact response `Hello, world!`.
6. Stopped and restarted the server against the same data root.
7. After restart, observed the Agent still `ready`, its Codex thread present, four ordered messages (`user, assistant, user, assistant`), two completed Runs, and the original workspace files.

The first live turn reported 79,196 input tokens (58,062 cached) and the follow-up reported 91,339 input tokens (67,739 cached). This is why later live-model verification is intentionally limited to required gates.

### Diagnosed baseline discrepancy

Reproduction on the host:

```sh
node --test .local/baseline-poc/workspaces/<agent-id>/hello.test.js
```

Observed: failure because the host resolves the nested workspace under the repository's root `"type": "module"`, while the Agent generated CommonJS `.js` files.

Root cause: the same mounted workspace is `/workspace` inside the disposable Runtime and has no ancestor `package.json`; Node therefore evaluates the generated files as CommonJS there. Re-running the exact test in `volc-agent-runtime:local` passed 1/1. No starter code was changed because the supported execution boundary behaved correctly; the host-only command is not the Runtime acceptance path.

### Rendered baseline evidence

Used headless Chromium against the real production server and real persisted backend data.

- `docs/ui-review/baseline/1440x900.png`: Agent, session, first response, and follow-up rendered; no horizontal overflow.
- `docs/ui-review/baseline/1280x800.png`: same persisted state rendered; no horizontal overflow.

Both screenshots were visually inspected. They establish the starter's cream surface, charcoal sidebar, violet accent, typography, spacing, chat treatment, and compact control conventions to preserve.

### Phase 0 gate

Commands and observed results:

```sh
TMPDIR="$PWD/.tmp/test-temp" npm run check
# type checks passed; 5 test files / 12 tests passed; web and server builds passed

terraform fmt -check -recursive deploy/volcengine
# passed

docker compose config --quiet
# passed

npm audit
# found 0 vulnerabilities

git diff --check
# passed
```

**Verdict:** starter deterministic checks, real model/container execution, session continuation, restart persistence, and rendered baseline are verified for this local environment. This does not yet establish any Shepherd behavior.

## Phase 1 — Deterministic Walking Skeleton

**Date:** 2026-08-29 (Asia/Singapore)

**Branch:** `feature/shepherd-phase-1-kernel`

### Built kernel chain

Implemented the deterministic chain before connecting any live model:

```text
Contracts → real Git worktrees → deterministic executors → manifest ingestion
→ actual-diff authority → independent Docker verification → trusted integration
→ normalized semantic collision → concurrent resolution Planes
→ independent candidate evidence → deterministic selection
→ final re-verification + expected-HEAD CAS promotion
```

The V2 store migration preserves the captured V1 Agent/message/Run fixture. Mission and Contract transitions, 22 failure codes, authority envelopes, Plane/candidate evidence, collision state, group messages, settings, and monotonically sequenced events are durable. Store mutations are serialized and written through an atomic temporary-file rename.

The managed authentication fixture uses different frontend/backend files, so both contract commits merge without a textual conflict. Their normalized exclusive `auth.transport` claims conflict semantically. Under the default invariant the cookie candidate passes and is promoted; flipping the invariant selects bearer instead. Both resolution Planes begin at the exact same integration SHA.

### Trust-boundary verification

- Git is invoked with argv arrays, sanitized refs, disabled prompts/hooks/signing, bounded output, and explicit timeouts.
- Public protected-worktree/ref mutation methods reject direct use; the configured protected branch changes only through the final promotion gate.
- Contract and candidate executors receive authority-filtered, Git-free exports with opaque handles; they never receive a linked Git worktree or trusted repository metadata.
- Trusted import compares the complete exported tree with the source Plane, validates the derived actual diff, and rejects escapes, symlinks, FIFOs/special files, `.git`, protected `.shepherd` contents, and out-of-scope writes. A partial import is restored before the error is surfaced.
- Contract and candidate commits are inspected against actual changed paths at the import/Plane boundary and again before promotion.
- Result manifests are strict-schema parsed. The exact `.shepherd/result.json` ingestion exception is removed before trusted commit creation and is absent from every Plane commit.
- The independent verifier creates a fresh snapshot of the exact trusted commit, creates a named container, mounts only that snapshot read-only, uses `--network none`, no capabilities, no new privileges, cleared environment, bounded resources/output/time, then forcibly removes both the container and snapshot on every exit path.
- Independently observed fixture facts must corroborate manifest claim values before claims are persisted as collision inputs. A forged value produces `claim_rejected` and `invalid_semantic_evidence` instead of participating in selection.
- Protected compare-and-swap promotion rolls the ref back to the expected commit if worktree synchronization fails and proves both ref and worktree restoration. Synchronization failure and unprovable rollback are distinct fail-closed errors.
- Agent workspaces use isolated execution UUIDs outside all protected repositories and Planes. Public DTOs expose allowlisted logical fields only.
- Server binding defaults to loopback. Every non-loopback bind requires a URL-safe, non-placeholder token of at least 24 characters; internal errors are bounded/redacted and public 500 responses are generic.
- The JSON store sanitizes configured canaries and common credential forms before state can become observable in memory or on disk. Public Shepherd DTOs strip repository, worktree, and Agent workspace host paths.

An independent read-only security review first identified mutable verification input, linked worktree metadata at the executor boundary, public-bind authentication defaults, uncorroborated claims, incomplete production authority intersection, raw error/path exposure, and a protected-ref synchronization edge. Each finding received a regression test and the smallest fail-closed remediation above. A second independent review re-ran its focused 38-test security slice and reported no remaining critical, high, or medium findings.

### Automated and real-boundary evidence

Focused real-container Mission test:

```sh
npm run test -w @launchpad/server -- --run src/shepherd/service.container.test.ts
# 1 file / 1 test passed; real Docker Mission completed in 5.53 s
```

The test observed persisted contract/candidate/final-promotion evidence, the cookie winner, common resolution base SHA, selected Plane HEAD equal to protected HEAD, trusted profile output, no committed `.shepherd` path, and no remaining containers owned by that Mission.

Full parallel server suite after integration:

```sh
npm run test -w @launchpad/server
# 19 files / 225 tests passed
```

Real built-server HTTP smoke used isolated repository-local data and the real `volc-agent-runtime:local` verification image. Observed:

```json
{
  "unauthenticatedStatus": 401,
  "rejectedInputStatus": 400,
  "missionState": "completed",
  "selectedTransport": "http-only-session-cookie",
  "corroboratedClaimEvents": 2,
  "eventCount": 33,
  "elapsedMs": 6798,
  "pathAndTokenLeakCheck": "passed"
}
```

After graceful stop/restart against the same store, the Mission remained `completed`, persisted protected HEAD matched real Git `HEAD`, no control metadata was tracked, and neither the configured Ark key nor application token appeared in the persisted JSON. The execution-export, trusted-materialization, and trusted-verification directories were empty; Git listed no materialization worktrees; a global Docker label query returned zero remaining verifier containers.

### Five invariant mutation checks

Each guard was temporarily disabled only in the working tree, its hostile test was run red, the guard was restored, and the same test was run green. No mutation was retained.

| Invariant | Temporary mutation | Red observation | Restored observation |
| --- | --- | --- | --- |
| Agent cannot self-certify | Allowed `agent_runtime` to perform `verifying → verified` | Independent-actor assertion failed (1 failed / 7 passed) | State-machine suite 8/8 passed |
| Out-of-scope changes cannot integrate/promote | Forced writable-scope result to `true` | Authority suite failed twice and direct Plane-boundary bypass test failed | Authority + Git suites 56/56 passed |
| Protected branch only changes through promotion | Disabled protected-root mutation guard | Structural bypass test resolved instead of rejecting | Git/Plane suite 10/10 passed |
| Winner is evidence-derived | Forced first assessment to pass | Invariant-flip expected cookie but selected bearer (1 failed / 27 passed) | Resolution suite 28/28 passed |
| Secrets never persist | Replaced recursive redaction with identity | New-write and existing-V2 canaries both leaked (2 failed / 5 passed) | Store suite 7/7 passed |

### Problem-resolution record: parallel Docker cleanup assertion

Reproduction:

```sh
npm run check
# verifier.container.test.ts reported containers owned by service.container.test.ts
```

Root cause: Vitest runs test files in parallel, while both real-container tests queried the shared `io.codejam.shepherd=independent-verifier` label and incorrectly treated another test's live container as their own leak.

Fix: cleanup assertions now combine the shared label with each test's owned `io.codejam.verification-target` labels. This preserves parallelism and still proves each executor destroys its own containers. The original full-suite reproduction then passed 19/19 files and 225/225 tests; an additional phase-boundary global query proves no actual leftovers after all work stops.

### Problem-resolution record: authority denial misclassification

Reproduction: an executor changed an out-of-scope file after Git-free export, and the service initially persisted generic `execution_failed` because trusted import occurred inside the broad executor error boundary.

Root cause: authority validation had moved to the trusted import boundary, but the orchestration layer still classified every pre-import exception as an execution failure.

Fix: execution completion and trusted import now have distinct transitions/error handling. An import-scope rejection durably records `authority_denied` (and candidate `unauthorized_file_change`) while preserving the fail-closed Plane. The focused service/container/Git slice passed 23/23 after the original reproduction was rerun.

### Problem-resolution record: real-Git integration timeout under suite load

Reproduction: the full parallel suite crossed Vitest's generic 5-second default in one real-Git background Mission journey (observed 5.13 seconds) even though the Mission was progressing normally.

Root cause: the integration test intentionally performs multiple real worktree, commit, merge, snapshot, and container-adjacent operations and can exceed a unit-test timeout under parallel contention.

Fix: only that real-boundary integration test declares a 30-second ceiling; unit-test defaults remain unchanged. No sleep or polling delay was added. The full 225-test server suite passed afterward.

### Problem-resolution record: empty control directory in snapshots

Reproduction: after trusted import removed `.shepherd/result.json`, the optimized snapshot copier rejected the now-empty root `.shepherd/` directory even though no control content could enter the snapshot.

Root cause: the hardened tree copier correctly rejected protected control content but did not distinguish a harmless empty root directory left by manifest ingestion from actual metadata.

Fix: snapshot creation skips only an empty root `.shepherd/`; any file or nested content still rejects the source. A regression also proves `.git`, live-only files, and control content never enter a verification snapshot and every snapshot is removed.

### Hardened Phase 1 focused gate

```sh
npm run test -w @launchpad/server -- --run \
  src/config.test.ts src/app.test.ts src/shepherd/auth-fixture.test.ts \
  src/shepherd/service.test.ts src/shepherd/git-plane-promotion.integration.test.ts
# 5 files / 38 tests passed

npm run test -w @launchpad/server
# 19 files / 225 tests passed (includes the real Docker Mission)

npm run typecheck -w @launchpad/server
# passed
```

**Security review verdict:** no critical, high, or medium findings remain at the Phase 1 boundary.

### Phase 1 branch gate

```sh
TMPDIR="$PWD/.tmp/test-temp" npm run check
# exit 0: both workspace type checks passed; 19 files / 225 server tests
# passed; web and server production builds passed

npm audit
# found 0 vulnerabilities

terraform fmt -check -recursive deploy/volcengine
# passed

docker compose config --quiet
# passed

git diff --check
# passed
```

A repository-wide text scan compared the configured non-placeholder Ark credential against 145 files (excluding the ignored source `.env`, dependency/build/browser scratch, and Git metadata) and found zero occurrences. The global verifier-container label query returned zero containers.

The sample environment now defaults `HOST` to `127.0.0.1`; Compose and Terraform retain explicit service binds with their required application token. The user's current ignored `.env` has both requested models and the Ark credential configured, but also has a non-loopback host without a strong application token. Test/rehearsal processes therefore use an explicit loopback override until the private file is intentionally changed; the server correctly refuses that unsafe combination.

**Phase verdict:** the deterministic kernel, its hardened executor/import/verifier boundaries, real Git/container/HTTP path, restart persistence at a completed boundary, and all Phase 1 security regressions are verified. General in-flight recovery and the remaining PRD capabilities are intentionally deferred to subsequent phase gates.

## Phase 2 — Domain, Persistence, and Crash Recovery Hardening

**Date:** 2026-08-29 (Asia/Singapore)
**Branch:** `feature/shepherd-phase-2-recovery`

### Strict durable state

The version-2 store now validates every persisted and outgoing field with strict,
bounded schemas rather than accepting shape-compatible JSON. Validation covers
canonical host and project-relative paths, supported authority patterns, safe Git
branches, full object IDs, bounded collections/text/numbers/timestamps, unique IDs,
references, event cursors, one active non-terminal Mission, and lifecycle/evidence
relationships. The captured version-1 fixture is independently validated before its
lossless migration.

False-green completion is rejected unless verified Contracts have non-vacuous
mandatory acceptance evidence tied to their exact Plane diff and manifest claims.
Collision sources must be verified Contracts with canonical embedded claims. For the
managed authentication fixture, candidate evidence must contain exactly the trusted
frontend, backend, and project-security mandatory suite; final promotion evidence
must repeat that exact suite. Completed collision Missions require one resolved,
selected, promoted candidate whose verified Plane HEAD matches the protected project
HEAD. A no-collision completion requires a verified integration Plane at the promoted
protected HEAD.

The JSON reader uses bounded, no-follow, non-blocking regular-file reads. Outgoing
state is validated and recursively scrubbed before a unique exclusive `0600`
temporary file is synced and atomically renamed. Oversized reads/writes, symlinks,
fixed-name temporary symlinks, FIFOs, invalid outgoing state, and persistence failure
before in-memory publication all have negative tests. The supported concurrency model
is one server process per data root; mutation serialization is in-process and the JSON
store is not a distributed database.

### Restart reconciliation and trust adoption

Startup now validates the sentinel-bound managed root, project metadata, repository,
Plane roots, Plane sentinels, Git worktree registration, protected branch, index, and
worktree before serving. Trusted identity files are bounded `O_NOFOLLOW | O_NONBLOCK`
reads with pre/opened inode and size checks. Persisted host paths are comparison values
only; server-derived sentinel identities select filesystem locations. Missing,
substituted, symlinked, special-file, out-of-root, dirty, detached, unregistered, or
unexpected artifacts fail closed.

In-flight Contracts, candidates, and Planes become `interrupted`; their Mission and
Collision become `attention_required`; Agent leases are released; private execution,
materialization, and verification artifacts are removed. Evidence and the event cursor
are preserved, and a second restart is idempotent.

Promotion has a durable intent boundary. After final authority, immutable-head,
selection, protected-head, and independent-verification checks—and immediately before
compare-and-swap—Shepherd atomically records `promotionState=promoting`, the complete
passing promotion evidence, and its Plane evidence link. Recovery never trusts the
earlier `reverifying` state. It recognizes a post-CAS window only when the exact
selected resolution Plane, expected-head ancestry, derived branch/worktree identity,
live Git registration, clean/index-synchronized protected checkout, candidate HEAD,
and complete verifier suite all corroborate. Ordinary post-marker promotion failures
retain evidence and fence the project in `attention_required`; a same-process second
Mission cannot silently adopt an external branch move.

An empty/replaced database cannot establish a new trust root over old managed project
artifacts. Only a missing/empty root or an existing sentinel-only root with empty known
containers is a valid zero-project state. A non-empty unsentinelled root is still never
adopted.

### Stable verifier and Agent identities

Verifier cleanup ownership is installation-scoped and restart-stable:
`verifier.<runtime-instance>.<128-bit persisted nonce>`. A separately persisted marker
distinguishes first boot/one-time upgrade from nonce loss; corruption, symlink/special
files, or deletion after establishment fail closed. Concurrent first starts converge
on one nonce, while different data roots remain distinct. Cleanup targets only the
exact owner label.

Persisted Agent workspaces are revalidated at startup and before execution against the
canonical configured workspace root and exact Agent-ID-derived path. Escapes,
cross-Agent substitutions, root/leaf symlinks, and durable Shepherd references during
Agent deletion are rejected.

### Problem-resolution records

**Persisted state initially proved shape, not truth.** Hostile V2 fixtures could label
evidence-free or weakly related records as verified/completed. The root cause was that
the first V2 loader validated DTO shapes and references but not completion proofs.
Strict semantic/lifecycle validation plus false-green fixtures now rejects invented,
substituted, incomplete, or cross-target evidence.

**A restart-unstable verifier owner could collide or leak cleanup scope.** A random
per-process fallback changed on every boot and a configured default could be shared by
unrelated installations. Persisted installation identity and exact-owner cleanup
remove both ambiguities.

**A persisted `reverifying` candidate was not proof that CAS had been attempted.** An
external move to the candidate SHA during re-verification could resemble a post-CAS
crash. The durable pre-CAS evidence marker makes the distinction explicit; recovery
accepts only `promoting` with the exact full suite. A kill immediately before CAS keeps
the trusted/protected head unchanged, while a kill immediately after a successful CAS
can be corroborated and adopted.

**Promotion failure could release the project fence.** The initial compensation marked
only the Candidate/Collision before generic failure handling terminalized the Mission
and cleared `activeMissionId`. The fixed atomic compensation preserves final evidence,
sets Candidate promotion failure plus Mission/Collision `attention_required`, and keeps
the project fenced. A synchronous regression proves a second Mission is rejected and
neither the stored trusted head nor externally moved Git head changes.

**Deleting only the database could orphan and then re-adopt an old repository.** The
empty state previously looked like first boot. Startup now rejects any established
managed project artifacts when no durable Project record exists; a hostile external
branch move remains untrusted.

**A live server could adopt an external head between Missions.** Startup reconciliation
runs once, while the fixture re-opener returns the repository's current branch head.
After a completed Mission, an external commit could therefore become the next Mission's
base without a restart. Mission preparation now re-derives the sentinel-backed project
identity and requires the protected ref, checked-out branch, HEAD, index, and worktree
to equal the durable trusted record before any new Mission, Plane, Agent, workspace, or
store mutation. A regression completes one Mission, commits externally, and proves a
second synchronous run is rejected with all durable counts and both heads unchanged.

**No-follow reads could still block on a FIFO.** Opening a FIFO read-only can block
before `fstat`. Adding `O_NONBLOCK` while retaining post-open regular-file and identity
checks makes database, verifier identity, sentinel, metadata, and policy reads reject
special files immediately.

**A real-Git winner-flip test retained a unit-test timeout.** An independent full-suite
run exceeded Vitest's five-second default while parallel real-Git tests were active;
the still-running test then raced teardown of a read-only snapshot. The production path
was not failing. That integration-style test now has the same 30-second ceiling as its
adjacent real-Git journeys. Two consecutive complete server-suite reruns passed after
the fix (31.31 s and 31.47 s) with no teardown failure.

### Phase 2 verification evidence

Real process tests send `SIGKILL` at five boundaries:

1. contract execution workspace ready;
2. contract verification snapshot ready;
3. complete promotion proof persisted immediately before CAS;
4. successful CAS complete before final database persistence; and
5. protected ref updated before protected index/worktree synchronization.

Each ordinary boundary is restarted twice and proves non-green durable state,
artifact cleanup, and cursor idempotence. The internal ref/index gap is rejected on
both restarts with the original trusted head preserved.

Commands and observed results:

```sh
TMPDIR="$PWD/.tmp/test-temp" npm run test -w @launchpad/server -- \
  src/database.test.ts src/shepherd/git-plane-promotion.integration.test.ts \
  src/shepherd/recovery.test.ts src/shepherd/recovery.process.test.ts \
  src/shepherd/service.test.ts
# 5 files / 111 tests passed

TMPDIR="$PWD/.tmp/test-temp" npm run check
# exit 0: both workspace type checks passed; server suite passed;
# web and server production builds passed

TMPDIR="$PWD/.tmp/test-temp" npm run test -w @launchpad/server -- \
  --reporter=json --outputFile="$PWD/.tmp/phase2-vitest.json"
# 21 files / 326 tests passed; 0 failed or pending

# repeated twice after stabilizing the real-Git test ceiling
# run 1: 21 files / 326 tests passed in 31.31 s
# run 2: 21 files / 326 tests passed in 31.47 s

npm audit
# found 0 vulnerabilities

terraform fmt -check -recursive deploy/volcengine
docker compose config --quiet
git diff --check
# all passed
```

A repository-local exact-value scan checked 150 tracked/ignored project files outside
`.env`, Git metadata, dependencies, builds, and test/browser scratch against the one
configured non-placeholder secret and found zero matching files. The global verifier
container label query returned zero containers after the suite.

The dedicated `security-reviewer` role was requested after stabilization but was not
available in this environment. A separate read-only fallback reviewer inspected the
complete Phase 2 trust boundary and ran a 5-file/111-test security slice, server
typecheck/build, production fault-seam scan, and whole-tree diff check. Its final
verdict was **no remaining critical, high, or medium findings**. Residual lows are:
directory entries are not explicitly fsynced after atomic rename (process-crash, not
sudden-power-loss, durability is tested); one server per data root is operationally
required; `RUNTIME_INSTANCE_ID` must remain stable for prior-owner container cleanup;
and test-only fault seams remain constructor-injectable but are absent from config,
API, and production composition.

**Phase verdict:** strict persistence, exact evidence proof, stable ownership,
sentinel-bound identity, five process-kill boundaries, idempotent reconciliation,
pre/post-CAS distinction, live-process protected-head fencing, secret scanning, and
the complete deterministic gate are verified for Phase 2.

## Phase 3 — Live Plane Runtime and Bounded Advisory Modules

**Date:** 2026-08-29 (Asia/Singapore)

**Branch:** `feature/shepherd-phase-3-live-runtime`

### Versioned execution envelopes and semantic authority

Contract and resolution work now receive bounded, JSON-escaped
`SHEPHERD_EXECUTION_ENVELOPE_V1` prompts assembled by trusted code. Prompts contain
logical IDs, the intersected authority, expected artifacts, dependency outputs, and
the exact strategy or objective; configured secret values are rejected before a
prompt can be returned. Contract Agents must write the one schema-validated
`.shepherd/result.json` ingestion artifact. Resolution Agents are explicitly forbidden
from writing any `.shepherd/**` path and are evaluated from the imported Git diff and
independent evidence instead.

Contract envelopes now include both the declared canonical claim keys and the
Contract's declared canonical semantic scopes. Manifest ingestion rejects an
undeclared scope, just as it already rejected an undeclared or omitted key. This
prevents independently correct Contracts from avoiding collision only because their
model-selected scope labels differ.

Resolution envelopes state the candidate's exact canonical key/value strategy and
forbid substituting a different value based on project policy. Prompt compliance is
not trusted: after the fixed candidate acceptance suite runs, server code derives the
verified `auth.transport` fact from its outputs and requires it to equal the
candidate's persisted target. A candidate whose checks pass for a substituted target
fails with `invalid_semantic_evidence` at
`candidate_target_corroboration`; it cannot tie, win, or promote.

### Isolated live Codex execution

`SHEPHERD_EXECUTION_MODE` now accepts `auto`, `live`, or `deterministic`. `auto`
selects live execution only when a usable Ark Agent-model configuration and the
container Runtime are both present. Explicit `live` fails closed if either condition
is absent, and live execution additionally requires `CODEX_SANDBOX_MODE=workspace-write`.
The resolved mode is exposed by system/demo metadata so a deterministic run cannot be
presented as live-model evidence.

Each Contract or candidate execution uses a fresh Git-free export, a unique opaque
execution identity, a new private `0700` `CODEX_HOME`, and one disposable container.
The exact in-container Codex shape is:

```text
codex exec --ephemeral --json --sandbox workspace-write \
  --skip-git-repo-check -C /workspace -
```

The complete prompt is sent only on standard input. No thread is resumed. The Runtime
container is created first and then started/attached by the validated immutable
container ID, avoiding name-retargeting between creation and attachment. The
container runs non-root with a read-only root filesystem, a dedicated `/tmp` tmpfs,
all capabilities dropped, `no-new-privileges`, and configured CPU, memory, and PID
limits. Only the Git-free workspace and that execution's private home are mounted.

The outer container uses bridge networking because the Codex control process must
reach Ark. The generated Codex config gives model-authored shell processes a fixed,
key-free environment. Startup preflight, without an Ark credential, requires the
exact pinned `codex-cli 0.111.0`, proves a sandboxed write succeeds in `/workspace`,
proves a write to `/codex-home` is denied, and proves sandboxed TCP listen and connect
attempts are denied. This is distinct from the independent acceptance verifier, which
continues to run with no network and no model credential at all.

Private-home roots use an exact sentinel and refuse non-empty unsentinelled adoption.
Runtime containers carry the restart-stable installation owner labels introduced in
Phase 2. Startup reconciliation removes only exact-owner interrupted containers,
private homes, and preflight workspaces; normal completion and timeout/cancellation
paths also verify cleanup.

Codex thread IDs exist only long enough to validate that exactly one fresh session was
created. Shepherd persists only a SHA-256 fingerprint and rejects fingerprint reuse
across Plane executions. Public state and Mission DTOs omit that fingerprint and
expose only `runtimeSessionEstablished: boolean`. Raw session IDs, raw prompts, and
prompt-envelope text are not persisted or returned.

### Implemented modules not yet connected to Mission orchestration

Three Phase 3 modules are implemented with focused deterministic tests, but are not
yet invoked by `ShepherdService` or exposed by the current HTTP/UI surfaces:

- The DAG scheduler validates the duplicate/unknown/self/cyclic dependency cases and
  selects a stable maximal batch subject to verified dependencies, failed-dependency
  blocking, one active assignment per Agent, the mutation lock, and configured Plane
  capacity.
- Project Group routing normalizes and bounds input, routes unmentioned text to
  Shepherd, resolves one leading Agent name/ID mention, supports JSON-quoted names,
  and rejects malformed, ambiguous, unknown, or multiple mentions. It interprets no
  paths or commands.
- `ArkModelReviewer` is an advisory-only Responses client. It canonicalizes and caps
  input at 48 KiB, performs at most one HTTPS request with redirects rejected,
  `store:false`, no tools, no prior-response chain, and a strict structured-output
  schema. It caps streamed response bytes at 128 KiB, output tokens at 1,536,
  findings at eight, evidence references at six per finding, and its deadline at
  120 seconds (30-second default). All provider/configuration/timeout/schema/storage
  failures return an explicit typed degraded result; no result grants authority or
  changes deterministic collision/selection. The current service does not yet call
  this adapter or emit its `model_review_degraded` event.

### Live-gate corrective episodes

The opt-in gate uses the configured Agent model only for this explicit evidence path:

```sh
npm run test:shepherd:live
```

It is single-worker, has no test retries, and creates fresh Mission state inside the
sentinel-guarded repository-local live-gate root. Four failed gate episodes were
preserved as causal evidence before the final pass:

1. **Two sessions, no semantic collision.** Both contract executions and their
   independent checks passed, but one model used a file-oriented scope while the
   other used a conceptual scope, so the exact-scope collision predicate found zero
   collisions. Root cause: semantic scopes existed on the Contract but were absent
   from the prompt and were not checked during manifest ingestion. Supplying the
   canonical declared scope and rejecting undeclared scopes fixed the contract.
2. **Four sessions, objective tie.** The collision then appeared and both candidates
   ran, but the bearer-target candidate substituted the policy-preferred cookie
   implementation. Its independent checks passed the cookie implementation, as did
   the actual cookie candidate, so the deterministic selector correctly stopped in
   `attention_required` with `objective_tie`. Root cause: the prompt did not make
   speculative target fidelity sufficiently explicit and trusted selection checked
   acceptance success without corroborating the implemented value against the
   candidate target. The exact-target rules and trusted target corroboration above
   close both gaps.
3. **Completed Mission, outdated all-pass assertion.** After those product fixes, the
   Mission completed with the secure cookie candidate selected and the bearer
   alternative objectively rejected by the project-security check. The gate itself
   still expected every candidate's verification to pass. The assertion was corrected
   to require the evidence-derived bearer failure and cookie promotion; no production
   behavior changed for this harness-only failure.
4. **Completed Mission, missing test import.** The next product Mission again
   completed, after which the test referenced a fixture transport constant it had not
   imported. The missing test-only import was added; no production behavior changed.

The final gate then passed in **121.49 seconds**. It completed two fresh Missions with
eight total live Codex sessions: two Contract and two resolution sessions per Mission.
Both Missions persisted two verified Contracts, one resolved semantic collision, the
bearer candidate rejected by independent acceptance, the cookie candidate selected
and promoted, and 33 bounded events. All eight persisted session fingerprints were
present, valid, and unique; no raw session ID was stored or exposed. Both resolution
Planes shared their Mission's exact immutable integration base.

The gate also proved the protected repository HEAD equals the promoted result,
`.shepherd/**` is absent from the promoted tree, and no prompt-envelope marker or
configured secret appears in persisted state, reachable Git blobs, or managed
worktree files. Exact-owner queries found no remaining live-Runtime or verifier
containers, and every per-execution private home and Git-free execution export was
gone after cleanup.

### Security review and verification evidence

The independent Phase 3 live-Runtime review identified four Medium findings during
implementation: unsafe private-root adoption, an incomplete sandbox preflight, raw
Runtime error/secret propagation, and a cleanup rejection race. Sentinel-only
adoption, the positive/negative filesystem plus socket probes, bounded redacted
Runtime errors, and immediately handled/awaited cleanup failures closed them. The
reviewer's final 58-test focused slice reported no remaining critical, high, or
medium finding at the live-Runtime boundary.

The independent model-reviewer review later found two Medium stream-handling issues:

- **M1:** a hostile asynchronous `reader.cancel()` rejection could surface as an
  unhandled rejection. Every fire-and-forget cancellation now attaches a rejection
  handler, with an exact regression.
- **M2:** an endless stream of zero-byte chunks could make no byte progress and starve
  the intended deadline path. Zero-byte chunks are now rejected immediately as an
  invalid response, with an exact regression.

The same reviewer re-inspected both fixes and reported both Mediums closed, no new
critical/high/medium findings, and a **PASS** merge gate. Its fake-only focused suite
passed **121/121**; the review made no network call and did not read `.env`.

A final independent security delta review then covered the canonical-scope and
candidate-target changes together with the live-gate scanner and Ark adapter. Its
focused suite passed **174 tests with the opt-in live test skipped**, its diff check
passed, and it reported **no critical, high, or medium finding**. It made no network
call and did not read `.env` or credentials. Residual lows are recorded explicitly:
the generic manifest-ingestion API treats an omitted declared-scope list as
unrestricted, although every production service call supplies a non-empty list; the
live gate scans current/reachable Git blobs and managed worktrees rather than dangling
Git objects; and the Ark reviewer requires a trusted HTTPS endpoint configuration but
does not pin a hostname.

The first final repository check exposed one test-harness concurrency flake: an
executor test used a 15 ms sleep as a proxy for proving two Contract executions had
overlapped. Under full-suite scheduling, the first execution could finish before the
second arrived even though production still dispatched them concurrently. The test
now uses a deterministic two-arrival barrier and still records the maximum active
executions. Its focused service suite passed **12/12** after the correction.

Final commands and observed results:

```sh
npm_config_cache="$PWD/.tmp/npm-cache" \
  TMPDIR="$PWD/.tmp/test-temp" npm run check
# exit 0: both workspace type checks passed
# 26 test files passed, 1 opt-in live file skipped
# 520 tests passed, 1 opt-in live test skipped
# web and server production builds passed

npm run build -w @launchpad/server
# passed on a separate rerun
```

The final exact-owner container query returned no container. The two-Mission live
gate above is separate opt-in evidence; its PASS is not presented as proof of
unrelated UI or Phase 4 behavior.

**Phase 3 scope verdict:** isolated live Contract/candidate execution and the fixed
demo Mission are proven across two fresh end-to-end Missions. Scheduler, Project
Group parser, and Ark advisory-reviewer modules exist and are focused-test-backed, but
their service/API integration remains Phase 4 work and is not claimed here.

## RST-01 — Idempotent and Serialized Demo Reset

**Date:** 2026-08-29 (Asia/Singapore)

**Branch:** `fix/7-rst-01-idempotent-reset`

**Draft PR:** [#10](https://github.com/kyashp/shepherd/pull/10)

**Reviewed implementation commit:** `19a2e45f7a67c575d9acced3dfcfbc6a32f5718e`

### Root cause and correction

`resetDeterministicDemo()` classified a missing durable `auth-demo` project as
`not_found`, although a missing project is the expected state before the first demo
Mission. The initial empty-result correction then exposed a check-without-reserve
race: reset checked `activeProjects` but did not claim `auth-demo` across its later
asynchronous validation and cleanup work.

The scoped correction:

- returns a deliberate path-free empty success with `restoredHead: null` and zero
  removal counts when the durable project is absent;
- creates no Mission, Agent, repository, worktree, or fixture merely to reset;
- still calls `assertNoManagedProjectState()` so the empty path fails closed on
  orphaned, symlinked, or unknown managed-root artifacts;
- synchronously reserves `auth-demo` before the first reset await and releases it in
  `finally`, serializing both clean and initialized resets against Mission startup;
- leaves initialized trusted-identity checks, guarded Git/Plane cleanup, unrelated
  data preservation, cursor high-water preservation, and partial-reset recovery
  intact.

### TDD and verification evidence

Original clean-start RED:

```sh
npm test -w @launchpad/server -- src/shepherd/service.test.ts src/app.test.ts \
  -t "returns the same empty result|returns an authenticated empty demo reset"
# 2 failed as intended: service rejected "Auth demo was not found";
# authenticated API returned 404 instead of 200
```

Concurrency RED and GREEN:

```sh
npm test -w @launchpad/server -- src/shepherd/service.test.ts \
  -t "reserves .* demo reset against a concurrent Mission start"
# RED: 2 failed; clean start reached the executor and initialized reset lost the race
# GREEN after reservation: 2 passed, 21 skipped
```

Additional observed results:

- reset-focused service/API selection: **8 passed, 34 skipped**;
- adjacent persistence/recovery suites: **100 passed**;
- complete Shepherd service suite: **23 passed**;
- complete server suite with one worker: **25 files passed, 2 skipped; 547 tests
  passed, 2 skipped**;
- `npm run check` under Node 24.17.0/npm 11.17.0 with Vitest externally constrained
  to one worker: both workspace typechecks, the same complete server suite, and both
  production builds passed;
- `npm audit --json`: **0 vulnerabilities across 251 dependencies**;
- `git diff --check`: passed.

Three unconstrained `npm run check` attempts after the concurrency correction hit
different existing fixed 1-second/5-second timeouts in Git-heavy service, recovery,
and Plane integration tests. Every affected test passed isolated, and the complete
suite passed serialized without weakening assertions. This is recorded as `TST-01`
in `HANDOVER.md`; no unrelated timeout or test behavior changed in PR #10.

### Current-main integration verification

After OPS-05 merged through PR #32 at
`8110aa3ed49bd0586cbb275d7c4067552cd9a144`, only `origin/main` was merged into
the RST-01 branch. Merge commit
`4673edfff0d6a205b48ca4d90821ce852a9952e4` had conflicts only in this file and
`docs/HANDOVER.md`; resolution preserved current-main evidence and reapplied only
RST-01-specific entries. The effective diff against `origin/main` remained limited
to the three reset implementation/test files and these two evidence files.

Fresh results observed on that integrated commit:

- reset-focused service/API selection: **2 files passed; 8 tests passed, 39
  skipped**;
- complete `service.test.ts`: **28/28 passed**;
- complete `app.test.ts`: **19/19 passed**;
- `npm run typecheck`: both workspace typechecks passed;
- `npm run build`: web and server production builds passed;
- literal `npm run check` with no worker or timeout override: launcher tests
  **3/3 passed**; server **25 files passed, 2 skipped; 554 tests passed, 2
  skipped**; both production builds passed;
- `npm audit --json`: **0 vulnerabilities across 251 dependencies**;
- `git diff --check origin/main...HEAD`: passed; worktree status was clean.

Browser evidence is not applicable to this service/API-only correction. No UI
source, layout, interaction, or response consumer changed; the authenticated
reset route is exercised through the real Fastify injection boundary in
`app.test.ts`.

### Independent review and remaining gates

An independent read-only security/correctness review found the reset/start race.
After causal regressions and the reservation fix, its follow-up reported no Critical,
Important, or Minor finding and marked the implementation ready to merge.

A final independent read-only review of the OPS-05-bearing integrated diff at
`ecd14228e0b83f8a9087d8bce675a3ae689fd29e` likewise reported no Critical,
Important, or Minor finding. It confirmed the synchronous reservation and `finally`
release, fail-closed empty-root validation, initialized path/head guards, causal
concurrency and authenticated API coverage, exact five-file scope, and browser
non-applicability, with a **Ready to merge: Yes** verdict.

GitHub reported the draft PR open and mergeable at this checkpoint, but with no
automated status checks. `CI-01` tracks required pull-request automation separately.
The remaining RST-01 work is lifecycle evidence: the final literal check/push gate,
required/merge-group checks when available, clean and initialized reset verification
on updated `main`, issue closure, and a merged-SHA ledger update. None requires
another scoped product-code change on this branch.

## Test-lifecycle stabilization candidate (`#11`)

**Date:** 2026-08-29 (Asia/Singapore)
**Candidate branch/commits:** `fix/11-shepherd-test-flake-clean` /
`de986b9a3ecdd1e1360050209742497f8c6b2813`, `f2db22c`
**Draft PR:** [#19](https://github.com/kyashp/shepherd/pull/19)

The generic five-second Vitest budget was exceeded by three real service journeys
and measured Git/recovery integration journeys under full-suite contention. A timed
out background-Mission test could also race fixture cleanup; raw recursive cleanup
could not remove a deliberately read-only trusted-verification snapshot.

The candidate adds only test lifecycle changes. Service fixtures now require an
exact sentinel, restore write permission only after validating the allocated path,
and skip symlinks. Causal RED checks observed `EACCES` on a `0400` file beneath a
`0500` snapshot and, under a temporary unsafe symlink mutation, an external marker
became unreadable. Restored GREEN checks prove the fixture is removed while the
external marker and permissions survive. Background test Missions cancel and join via
the existing `cancelMission()` behavior before cleanup. Six measured
integration cases declare 15-second budgets; global defaults stay unchanged.

The contamination route was also causal: `runFixtureGit()` spread `process.env`, so
an inherited `GIT_DIR` could override `git -C` and route a fixture commit elsewhere.
The helper now gives Git a fixed environment (path/locale plus non-interactive,
system/global-config-disabled settings). Its regression creates only disposable
fixture and decoy repositories, poisons `GIT_DIR` with the decoy, and proves the
fixture advances while the decoy's HEAD and tracked file remain unchanged. The RED
against the old inherited environment left the fixture HEAD unchanged; the restored
implementation is GREEN.

Observed verification:

```sh
# target-substitution regression: 5 consecutive passes (2.51–3.59 s)
npm run check
# pass twice: 25 files passed, 2 opt-in skipped; 547 tests passed, 2 skipped;
# web and server production builds passed
git diff --check
# passed
```

The initial PR #18 was closed as contaminated: the documented defective pre-push hook
created commit `9d252957` and tracked `external-move.txt` before the intended fix.
The clean candidate contains only the causal test files. The demonstrated recovery
fixture route is fixed; the pre-push hook itself remains separate infrastructure work,
so manual verification is required before using `ECC_SKIP_PREPUSH=1` for a scoped
push.

### Resolved-base verification

The clean candidate was resolved against current `main` at
`2f7a9fd8122cb62f2f2ed4e2b08cc87f311e8887`. On that exact resolved head,
`npm run check` passed: 25 files passed, 548 tests passed, 2 opt-in tests skipped,
and both production builds completed. A subsequent teardown-only audit identified a
test-lifecycle follow-up; its final commit and verification are recorded separately
once that bounded correction is complete.

### Teardown follow-up evidence

Commit `d8c4dff7e6a6c3b1597e56c8b493e436a4f227c2` is test-only. It retains tracked
Missions until cancellation and background-run joining succeed, treats
`attention_required` as cancellable, and releases both blocked promotion checkpoints
in `finally` paths. The promotion verifier release is idempotent. Its causal RED
timed out safely against the prior blocked verifier (the test's `finally` released
the fixture); GREEN focused coverage passed the four promotion/attention teardown
paths, and the full `service.test.ts` file passed 25/25.

The first repository `npm run check` on `d8c4dff` was **not green**: the unmodified
Git-plane integration test `reports a real textual merge conflict and leaves the
integration Plane clean` timed out at Vitest's five-second default. The observed
test phase had 24 files passed, 1 failed, 2 skipped; 549 tests passed, 1 failed, 2
skipped. This follow-up did not broaden into that separately owned timeout; its
production builds therefore did not run after the failing test phase.

That Git-plane test is also an owned #11 real-Git integration case. Commit
`0e0e743` gives only that test a 15-second Vitest budget. It passed five consecutive
focused runs (1.23–1.90 s) and the complete Git-plane integration file passed 19/19.
A subsequent full gate exposed a distinct RED: the background real-Planes service
journey has a 30-second test budget but its shared completion helper stopped at 15
seconds. Commit `a14c3f7` makes that helper accept an optional timeout and passes
25 seconds only to this measured journey; it does not add another Vitest budget.
The journey passed five consecutive focused runs (4.27–6.33 s) and the complete
service test file passed 25/25.

On final head `a14c3f71446ff5c46a84db6482fc445e9d1944d9`, `npm run check` passed:
25 files passed, 550 tests passed, 2 opt-in tests skipped, and both production
builds completed. Six measured integration cases now have explicit 15-second
Vitest budgets; the one 25-second internal completion wait remains confined to the
already-30-second background real-Planes test.
