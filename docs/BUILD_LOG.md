# Shepherd Build Log

This log records commands actually executed and evidence actually observed. Secrets, raw prompts, and unbounded process output are intentionally excluded.

This is a chronological evidence record, not the current task/status authority.
Branch and phase statements remain true only for the commit named in their entry.
Use [`TASKS.md`](TASKS.md) for the current repository snapshot, defects,
pending checks, and workflow.

## 2026-08-30 — ST-01 startup settings composed into the service

Branch `fix/44-st-01-startup-settings`, PR #73, against `main` at `07f4202`. No
live or model call ran.

- `SHEPHERD_AUTO_RESOLUTION` and `SHEPHERD_MAX_PARALLEL_PLANES` were parsed by
  `loadConfig` and then discarded: `ShepherdServiceOptions` had no field for either
  and the only production construction passed neither. The gap was invisible in E2E
  because the harness sets values equal to the persisted defaults.
- Both options are now declared, passed from resolved configuration, and applied by
  the pristine-store seeding block. Seeding applies only while the persisted value
  is still the factory default, so an operator change away from that default
  survives restart. **Stated limit, now asserted by a test rather than only
  commented:** an operator who sets the value back TO the factory default is
  indistinguishable from one who never chose it, and startup configuration seeds
  over that choice on the next restart while the store is still pristine. Removing
  the limit needs a persisted "changed by operator" marker, which is a schema change
  beyond this correction.
- **Stated behaviour change.** `SHEPHERD_MAX_PARALLEL_PLANES` moves from
  `min(1).default(4)` to `min(2).default(2)`. A host that sets `1` previously booted
  because the value was discarded; it now fails at `loadConfig`. That is deliberate:
  `database-schema.ts`, `updateSettings` and the API all require at least 2, so once
  composition works a `1` would fail on its first seed write, and a parse-time error
  is the honest place for it. A host that never set the variable moves from a
  nominal 4 to 2, which is the value it actually ran with before, since the parsed
  number never reached the service. `.env.example` shipped `4` and is aligned to `2`
  so the documented template matches the schema default.
- Eight causal tests in `apps/server/src/shepherd/startup-settings.test.ts`. Each
  verified by mutating the guard it covers: dropping both options from `index.ts`,
  disabling the seeding branch, removing the still-at-default guard so an operator
  value is clobbered, and restoring the `min(1)`/`default(4)` schema all turn their
  tests red.
- An earlier hosted run failed on this branch with `ENOENT` from `mkdtemp`: the test
  allocated case roots under `.tmp/startup-settings` without creating it, and `.tmp`
  is gitignored, so a clean checkout had no such directory. It passed locally only
  because that directory had been created by hand. Corrected in the test; production
  code was unaffected and the same run passed 809 other tests.
- Local full-suite figures from this host are not recorded as evidence: the run
  spanned a branch switch and observed a mixed tree. The hosted exact-head gate is
  the evidence for this branch.

## 2026-08-30 — issue #43 integrated verification

PR #75 merged to protected `main` as
`fbc937fed21ad4441e24ab301f591fe5aa03a025`; issue #43 closed and GitHub
removed the remote feature branch. The required integrated verification ran in
the clean issue worktree detached at that exact SHA before the docs-only
closeout branch was created.

- `git diff` found no tree difference between reviewed candidate `66e0c0e` and
  merge `fbc937f`, so the independent security/UI audit and re-review apply to
  the integrated bytes with no remaining Critical, Important or Minor finding.
- Fresh literal `npm run check` passed: launcher 3/3, Server 808 passed plus
  three explicit skips, Web 20/20, all production/test-source typechecks and
  both builds. The PR's `Required checks` and `Node 22 / npm run check` hosted
  jobs also completed successfully before merge.
- Fresh integrated Chromium passed the real-service unauthorized-diff journey
  2/2 at `1280x800` and `1440x900`, including durable reload, typed visible
  denial, unchanged stored and actual protected heads, zero Candidates,
  integration Planes or promotion, keyboard focus/activation, bounded public
  evidence and no document/body overflow.
- The four reviewed E2E-04 screenshot hashes remain unchanged. No live Runtime,
  model call, credential, product, CSS, schema, dependency or protected-branch
  mutation ran during closeout. Candidate-time unrelated harness limitations
  remain recorded in the preceding entry rather than being reclassified.

## 2026-08-30 — FM-01 integrated verification and event-evidence follow-up

PR #72 merged to `main` as `2e4058107311170ab12cadc6a6d283aeaefef895`.
Issue #42 closed and the feature branch was removed. The required integrated
verification ran from a clean detached worktree at that exact SHA.

- **Integrated evidence:** the FM-01 plus database/service/Git-promotion/recovery
  slice passed 187/187. Literal `npm run check` passed launcher 3/3, Server
  808/808 with three explicit skips, Web 19/19, all production/test typechecks and
  both builds. A lock-backed clean install and `npm audit` reported zero
  vulnerabilities; the merged feature files matched the reviewed branch bytes.
- **Independent audit finding:** the final re-verification row asserted
  `promotion_started` and no completion, but not the resulting
  `resolving -> attention_required` event. The event had a bounded reason but not
  the matching failure code/stage, so event removal or misclassification could
  remain false-green. No schema-widening, protected-promotion, authorization,
  secret-exposure or data-loss blocker was found.
- **Causal follow-up:** branch `test/42-fm-01-final-event-evidence`, implementation
  `471f5e8`, draft PR #74. RED passed 5/6 and failed only because the causal event
  lacked `failureCode` and `stage`. The existing atomic transition now carries
  those two fixed fields, and the matrix asserts its exact summary,
  `resolving -> attention_required`, reason, code and stage through both durable
  service state and the public events API.
- **Follow-up evidence:** matrix 6/6, adjacent 187/187, Server production/test
  types, and a fresh literal gate with the same fully green counts passed. The
  same read-only Auditor returned PASS with no remaining blocker.
  `git diff --check` passed. No UI, dependency, schema, promotion-gate, live
  Runtime or model change ran.
- `T,A,C` are complete. `I` remains pending until PR #74 is integrated and the
  corrected focused flow is rerun on updated `origin/main`.

## 2026-08-30 — issue #43 unauthorized-diff denial candidate

Branch `fix/43-ui-01-unauthorized-denial`, initially based on protected `main`
`2e4058107311170ab12cadc6a6d283aeaefef895` and rebased onto current `main`
`18daa3a`. This is reviewed candidate evidence for issue #43; protected-main
integration is not claimed.

- **RED/correction:** an ordinary failed Mission rendered only a generic Failed
  timeline pill even though its denied Contract retained
  `unauthorized_file_change` at `contract_authority`. The existing attention
  panel now uses that precise Contract cause for failed Missions, labels the
  safety stop and no-promotion outcome, and keeps the shortened Contract ID
  traceable through its full-value title. The focused presentation regression
  failed for each missing behavior before its correction and passes 6/6.
- **Causal browser proof:** a test-only executor wrapper uses the real compiled
  service, store and host-trusted verifier to modify `policy.json` outside a
  delegated `src/frontend/**` scope. The real authority boundary rejects it,
  durable state reloads through the production server, and authenticated
  Chromium proves the typed Contract denial, failed Mission, unchanged stored
  and actual protected heads, zero Candidates, zero integration or promotion,
  keyboard/focus evidence expansion, bounded public evidence and no page
  overflow at `1280x800` and `1440x900`. The focused journey passed 2/2; all
  four committed screenshots were inspected under `docs/ui-review/e2e-04/`.
- **Checks observed:** Web passed 20/20, the exact real-service authority test
  passed, both production builds passed, harness unit passed 7/7, strict syntax
  checks and `git diff --check` passed, and literal `npm run check` passed with
  launcher 3/3, Server 808 passed plus three explicit skips, Web 20/20, strict
  production/test-source types and both builds. `npm audit` reported zero
  vulnerabilities across 251 dependencies.
- The subsequent pre-push hook reproduced the existing parallel interrupted-policy
  cleanup race: Server 806 passed plus three skips while two
  `general-project.test.ts` cases failed. That file then passed 8/8 alone. The
  hook-created staged `policy.json` artifact was cleared, and only the documented
  hook was bypassed for the branch update; no test or assertion was changed.
- The full browser harness passed 22/24. Both failures are unchanged
  `starter-kit.spec.mjs` behavior outside the owned surface and reproduce in
  that spec alone: a 0.09375px legacy viewport-boundary assertion at 1280 and a
  30-second legacy follow-up response timeout at 1440. No assertion, retry,
  timeout, starter UI or unrelated source was changed to conceal them.
- Independent read-only audit and re-review found no remaining Critical,
  Important or Minor issue in #43 scope and returned Pass for security and UI.
  No production backend/schema, CSS, dependency, live Runtime or model path
  changed; the accepted UI design remains frozen. Protected-main integration
  and its rerun remain pending.

## 2026-08-30 — FM-01 deterministic failure matrix candidate

Branch `feat/42-fm-01-failure-matrix`, implementation `051b32a`, draft PR #72.
This is candidate evidence for issue #42; protected-main integration and audit are
not claimed.

- **RED:** the first six-case run passed only the existing objective-tie path. Four
  missing/malformed/omitted-key/acceptance cases persisted `unknown` at Mission
  level, and failed final re-verification omitted its promotion evidence.
- **Correction:** known Contract-boundary failures now retain the exact fixed code
  and stage on Mission, Contract, Plane and bounded event details. Final failed
  promotion evidence is retained on the selected Candidate and linked from its
  Plane; the database admits this only for a promotion-stage
  `final_reverification_failure` while retaining target, diff, mandatory-profile
  and Plane-link invariants.
- **Causal evidence:** `failure-matrix.test.ts` passed 6/6 without sleeps, retries,
  network or model calls. Each case verifies service state, durable reload, public
  Mission/events API, absence of `promotion_completed`, stored protected-head
  immutability and the repository's actual Git HEAD.
- **Adjacent evidence:** database, service, Git promotion and recovery passed
  181/181. Server production and test-source TypeScript checks passed. The root
  production build completed for both Web and Server, and `npm audit` reported
  zero vulnerabilities across 251 dependencies.
- **Literal gate:** the pre-push hook reached Server 806 passed plus three explicit
  skips, with two failures in the pre-existing parallel-only interrupted-policy
  cleanup rows in `general-project.test.ts`. The same failures were observed before
  FM-01 edits; the file passes 8/8 in isolation. The hook-created staged
  `policy.json` artifact was cleared, and only the documented hook was skipped for
  the branch push. `C` remains pending rather than inferred.
- No UI, dependency, live Runtime, model, credential or protected-branch change
  ran. UI evidence remains assigned to the dependent E2E rows.

## 2026-08-30 — issue #41 audited Project Group journey candidate

Branch `feat/41-project-group-journey`, draft PR #64. This is candidate evidence;
protected-main integration is not claimed.

- An explicit Project Group initialization creates the fixed idle auth-demo
  Project without starting a Mission, Contract, Plane, executor, shell or model.
  Unmentioned bounded messages persist with a bounded Shepherd reply. A leading
  ready Frontend/Backend mention captures one fixed authentication transport; a
  complementary opposite-role request enters the existing deterministic
  two-Contract Mission with server-authored objectives and authority.
- Agent-authored Group messages are derived only from verified persisted manifest
  summaries and remain bound to the exact sender, target, Contract and Mission.
  Hostile V2 checks cover non-verified and missing-manifest states from valid
  nonterminal controls, plus wrong sender, target, Contract and summary. The
  pre-Agent-summary V2 shape remains compatible.
- Audit correction made Project Group routing atomic across ordinary and Contract
  idempotency namespaces. The causal regression failed with two accepted requests
  before the correction and passes with exactly one accepted message afterward.
  Private-chat and Project Group pending prompts cannot pair across intake
  provenance, and Mission-preparation failure rolls back only the new prompt.
- Literal `npm run check` passed: launcher 3/3, Server 795 passed with three
  explicit skips, Web 19/19, all production/test-source typechecks and both builds.
  The focused Database plus Shepherd suite passed 136/136; the final independent
  re-review passed its 3 targeted tests and `git diff --check` with no remaining
  finding.
- Authenticated focused Chromium passed 2/2 at `1280x800` and `1440x900` from the
  real mention button through verified Contract evidence; the adjacent Shepherd
  hero journey also passed 2/2. The broader direct Playwright run passed 18/20;
  the two failures were unchanged legacy harness issues outside #41: a 0.09375px
  starter-kit viewport rounding assertion and a separate response timeout. Harness
  unit tests passed 6/7; the one unchanged macOS fixture compares canonical
  `/private/var/...` and non-canonical `/var/...` temporary paths.
- `npm audit` reported zero vulnerabilities. No live/model request ran, no secret
  or raw prompt/output was persisted in evidence, and the accepted UI design was
  not redesigned.

## 2026-08-30 — CRUD-01 clarification-only Agent deletion candidate

- **Branch/review:** `fix/66-crud-01-clarification-draft-delete`, issue #66,
  draft PR #67. No Web or CSS source changed.
- **RED:** a stopped Agent with only unbound `general-contract`
  `clarification_required` messages, zero Contracts/Missions/Planes/events, and an
  inactive managed Project failed deletion with `Cannot delete an Agent referenced
  by durable Shepherd history`.
- **Correction:** deletion classifies only exact human-authored, unbound general
  clarification messages as discardable. All durable or ambiguous references keep
  the 409. Before deleting the exact managed Project, the server validates the
  managed-root sentinel, metadata identity, main-only Git worktree state, absence of
  Shepherd branches and empty private Plane roots. Fixed-schema, fsynced workspace
  intent and Project deletion journals are written before database publication and
  reconciled from on-disk durable Agent/Project state after restart. General Project
  creation/policy journaling now begins inside the serialized Store mutation after
  Agent revalidation, so a racing follow-up cannot strand a journal.
- **Observed checks:** production/test typechecks; focused Agent lifecycle/general
  Project 29/29, including injected pre-publication and post-rename persistence
  faults, exact follow-up/delete and direct-run/delete barriers, active-run join,
  and clean restarts; adjacent API/Shepherd 77/77; literal `npm run check` with
  launcher 3/3, Server 791 passed
  plus two explicit opt-in skips, Web 18/18, and both
  production builds. Authenticated deterministic Chromium passed 2/2 at 1280x800
  and 1440x900, including two clarification turns, exact 200 deletion, empty Agent
  UI/state, exact filesystem absence and no document/body overflow. All four
  screenshots were inspected. Independent UI review found no High/Medium issue;
  it confirmed the frozen theme/layout and keyboard-operable native lifecycle
  controls. Final independent security re-review at `171089b` passed with no High
  or Medium finding after the direct-run race was also reserved, cancelled and
  joined causally. Protected-main integration remains pending. The same-OS-user
  recursive-path swap and Project-journal sudden-power-loss ordering are retained as
  Low residuals under the existing single-owner local PoC threat/availability model.
## 2026-08-30 — OPS-06 `A` and `S` gates, and a corrected reconciliation

Protected `main` advanced to `f900656` (PR #71) while this reconciliation branch was
open; hosted exact-head gate run `33305530655` passed on it. The entry below remains
true for `b80af11`, the head it names. No live or model call ran.

- **`A` gate (PR #68).** Four guards introduced or relied on by the container state
  volume appeared only in source and in no test, so each could be deleted with a
  green suite. Eight causal tests were added for the verifier fail-closed branch,
  the three executor state-root guards, the `index.ts` verifier composition and the
  launcher probe/fallback selection. Each was proven by mutating its guard and
  observing the test fail; all source was restored afterwards. Two of the tests
  initially passed for the wrong reason — one assertion was satisfied by the
  following guard's message, since both end in `escaped CONTAINER_STATE_ROOT`, and
  the launcher assertions read `stdout` while the launcher logs to `stderr`. Both
  were corrected.
- **`S` gate (PR #69).** An independent read-only review of the merged range
  returned **FAIL**: one High and two Medium findings, all against `e6a5878`, which
  removed the non-loopback `APP_AUTH_TOKEN` requirement inside the same merge with
  `gh pr view 56 --json reviews` returning `[]`. The container state volume itself
  passed: the mount construction was attacked directly and no escape was found.
- **Adversarial re-review of both branches then found three defects in the first
  corrections, each reproduced rather than argued.** The new deploy guard was
  defeated by a whitespace-only token and by a CRLF environment file, because the
  shell tested only for the empty string while the server trims before validating,
  so both shapes reached the container as an empty token and disabled the bearer
  boundary — the original finding verbatim. The guard now strips CR and surrounding
  whitespace as the schema does and applies the same 24-character non-placeholder
  floor as `config.ts` and `deploy/volcengine/variables.tf`. Separately, that
  guard's only regression test was executed by no gate: the root `test` script names
  a single file under `scripts/` and is not a glob, so `npm run check` would have
  stayed green with the guard deleted; it is now named in that script, and deleting
  the guard fails the gate. Finally, `index.composition.test.ts` could pass on the
  exact regression it exists to catch, because its `indexOf("});")` end anchor
  overshoots when the call is closed in the expanded argument style; the anchor is
  now a close at column zero, comments are stripped from the window, and the
  reproduction now fails both assertions.
- **The High finding is only partly closed.** The guarded deploy script is one of
  three documented compose entry points; `README` still documents
  `docker compose up --build` and `docker compose --env-file .env.production up -d`
  against the same unguarded `docker-compose.yml`, which binds `0.0.0.0` and
  publishes its port with no address prefix. Pinning that file to loopback was
  rejected because the profile is meant to be reachable behind a security group and
  the same file serves the local Docker path. The remainder is carried into
  `SEC-REVIEW`. This merge must not be recorded as closing it.
- **Corrections to this branch's own earlier entry.** The `CHAT-01` row was left
  internally contradictory: a guarded replacement silently matched nothing, so the
  row still opened `REVIEWED CANDIDATE` while its body already said integration was
  done. It now reads `INTEGRATED` at `cd82ec4`. An earlier local suite run reported
  here was discarded rather than recorded, because it spanned a branch switch and
  observed a mixed tree: it counted 32 test files where `main` has 29.
- **`TST-25` is resolved** at `e06357c` (PR #71, issue #70) by canonicalizing the
  test's own temporary root before `mkdtemp`, leaving the fixture assertion intact.

## 2026-08-30 — post-merge reconciliation at integrated `b80af11`

Protected `main` at `b80af11` (merge of PR #56). That head also carries PR #57
merge `cd82ec4` and PR #60 merge `39cd800`. Same affected host as the entries
below. No live or model call ran; no Mission was started.

- **Hosted exact-head gate.** Run `33300759535`, event `push`, head branch `main`,
  head SHA `b80af11`, job `Node 22 / npm run check` on `ubuntu-latest`: success,
  every step green, 08:06:09Z to 08:08:43Z. This is the green Linux full gate that
  the `OPS-06` row previously listed as outstanding.
- **Local rerun on the same SHA.** `npm run typecheck` passed; launcher tests 3/3;
  web 18/18; both production builds passed. The server suite run serially
  (`--no-file-parallelism --maxWorkers=1`) reported **745 passed, 6 failed, 6
  skipped**. The six failures are the recorded affected-host timing condition, not
  regressions: five in `recovery.process.test.ts` (`Timed out waiting for
  recovered` with empty child stderr — the forked `--import tsx` child never
  crashed, it simply exceeded the 25s budget), plus the previously recorded
  `expected 'resolving' to be 'attention_required'` flake in `service.test.ts`.
  An earlier attempt to run the suite from the repository root is not evidence:
  that invocation left `process.cwd()` outside the workspace, so the executor's
  source-inventory test raised `ENOENT` and the Playwright specs were globbed into
  the Vitest run.
- **`npm run test:e2e:harness:unit` on `b80af11`: 6 passed, 1 failed.** The failure
  is `fake Codex fixture implements bounded deterministic version, run, and
  resume`, with `fake-codex: workspace identity must be canonical`. This is a real
  test-only defect, not an environment quirk: `tests/e2e/harness.test.mjs:38`
  builds its workspace with `mkdtemp(path.join(os.tmpdir(), …))`, and on macOS
  `os.tmpdir()` is a symlink, so the deliberate `realpath` identity assertion at
  `tests/e2e/fixtures/fake-codex.mjs:69` correctly rejects it. The repository's own
  idiom is already `tests/e2e/support/test-app.mjs:93`. This target is not part of
  `npm run check`, so no hosted run covers it. Recorded as a new defect; the
  fixture's assertion must not be weakened.
- **`LIVE-01` cannot run on this host, and the attempt was deliberately not
  spent.** `live-runtime.integration.test.ts:182-185` pins
  `CONTAINER_STATE_ROOT` and `CONTAINER_STATE_VOLUME` to `undefined`, so the gate
  bind-mounts `.tmp/shepherd-live-gate/…` — a host share on this machine — and the
  OPS-06 container-volume correction cannot apply to it. Two zero-spend probes
  against the Runtime image confirmed the split on the exact gate path: a plain
  write to a host-share bind mount inside the container succeeded (exit 0), while
  the identical write under `codex sandbox linux --full-auto` was denied
  (`cannot create /workspace/.p: Permission denied`, exit 2). A named-volume
  control was inconclusive because a freshly created volume is root-owned, so the
  denial there was ownership rather than Landlock; the bind-mount pair above is the
  discriminating evidence. Running the gate here would therefore fail at
  `stage=container_start reason=sandbox_probe_failed` and consume the no-retry
  allowance for no evidence. `LIVE-01` needs a Linux host, or a change making the
  gate volume-aware, which is outside an `L` run.
- **Ledger reconciliation.** The header pointer, the baseline hosted-gate and
  server-suite rows, the presentation-host caveat, and the `OPS-06`, `CHAT-01` and
  `LIVE-01` rows described merged work as unmerged candidates and cited hosted runs
  that were not on the exact head. Corrected from the evidence above.
  `docs/FIXES.md` carried the same stale `CANDIDATE PENDING AFFECTED-HOST GATE`
  wording for `OPS-06` and was corrected with it.
- **Issue split.** `#47` bundled `OPS-06` and `LIVE-01`, which need different
  hosts, so neither could close. `LIVE-01` moved to issue `#65` with the probe
  evidence above; `#47` is re-scoped to `OPS-06` only and remains closeable on this
  host once `A` and `S` land. `main` has since advanced to `a1f1fcc` (PR #62); the
  evidence in this entry is scoped to `b80af11` and is not restated for that head.
- **Not claimed.** The `A` and `S` gates for `OPS-06` remain open. `A` is missing
  the verifier composition at `apps/server/src/index.ts:77-78`, the launcher
  probe/fallback selection, and the verifier fail-closed branch. `S` is unmet and
  must also cover `e6a5878`, which removed the non-loopback `APP_AUTH_TOKEN`
  requirement inside the same merge and carries no recorded independent review.

## 2026-08-30 — the launcher selects its own state layout

Same branch and host. `LOCAL_POC_STATE_MODE` defaulted to `host-bind`, so the
affected host had to be told to use the container state volume even though the
launcher's own probes already knew. The probe, not the operating system, is the
correct signal: what matters is whether the engine sees a native filesystem, and a
host can fail that on any platform.

- Default is now `auto`. The state selection, mount specification and both probes
  became functions, so the launcher can apply the host layout, probe it, and on
  failure apply the volume layout and probe again within one run. `run_state_probes`
  returns a typed status — 1 the engine cannot mount and write the state, 2 the
  Codex sandbox cannot govern the workspace — so the fallback message names the
  actual reason. An explicit `host-bind` or `container-volume` disables the
  fallback, so a host that should work still fails loudly.
- Observed on the affected host with no environment variables set at all:

  ```
  [local-poc] Persistent state: /Users/…/.volc-agent-launchpad
  [local-poc] Checking that the Runtime can mount and write the configured state directories.
  [local-poc] Checking that the Codex sandbox can govern the configured workspace.
  [local-poc] The Codex sandbox cannot govern a workspace on /Users/…/.volc-agent-launchpad.
  [local-poc] Switching to the launchpad-state-auto container state volume and retrying.
  [local-poc] Preparing the launchpad-state-auto state volume for the Agent Runtime.
  [local-poc] Persistent state: launchpad-state-auto (container volume)
  [local-poc] Checking that the Runtime can mount and write the configured state directories.
  [local-poc] Checking that the Codex sandbox can govern the configured workspace.
  [local-poc] Building and starting the containerized control plane.
  ```

  The mount-and-write probe passed on the host share and the sandbox probe failed,
  which is the expected split. `GET /api/health` then returned
  `{"ok":true,"service":"volc-agent-launchpad"}` and the running control plane
  resolved `executionMode: "live"`, `authTokenLength: 0`. The smoke volume was
  removed afterwards.
- `scripts/start-local-poc-launcher.test.mjs` passed 3/3, including the darwin case
  that pins the five exported host paths: under `auto` its stub engine reports
  success, the host layout is kept, and the exported paths are unchanged.

## 2026-08-30 — APP_AUTH_TOKEN requirement removed, capability retained

Same branch and host as the entry below. Requested scope was the requirement, not
the feature: the bearer boundary stays in the product and stays enforced whenever
a token is configured.

- The request originally read as deleting the token entirely. Survey first: the
  request hook at `apps/server/src/app.ts:843` already returns early when the
  token is empty, so every route is open and `/api/auth` reports
  `required:false`. Exactly one line forced a value — the non-loopback guard in
  `loadConfig`. Removing the whole feature would have touched 18 non-test source
  references and 26 test references and left `deploy/volcengine/main.tf` serving
  an unauthenticated Agent-execution API on a public interface, so the narrower
  correction was agreed instead.
- Removed the guard and its two now-unused helpers. Removed the matching guard
  from `scripts/start-local-poc.sh` and the required interpolation in
  `docker-compose.state-volume.yml`. The schema still rejects a token that cannot
  be sent as a bearer credential — non-URL-safe characters, or over 128.
- Replaced rather than deleted the affected assertions. The former
  "requires a strong non-placeholder token for every non-loopback bind" now proves
  the new contract: `0.0.0.0`, `192.0.2.10`, `127.0.0.1` and `::` all start with an
  empty token across all three `NODE_ENV` values, and a short or placeholder value
  is carried verbatim instead of refused. A second case keeps the bearer-shape
  rejections. The reviewer-clone test keeps its non-mutation assertions without the
  removed throw.
- Verified on the affected host with **no token set at all**. The launcher logged
  `No APP_AUTH_TOKEN is set, so the control plane will not require one`, the
  control plane started, `/api/auth` returned `{"required":false}`, and
  `GET /api/system` with no `Authorization` header returned `200`. Resolved
  configuration inside the container was `executionMode: "live"`,
  `authTokenLength: 0`, `host: 0.0.0.0` — so the Codex Runtime preflight still
  passes with the boundary disabled. The smoke volume was removed afterwards.
- Enforcement with a token configured is unchanged: `config.test.ts` and
  `app.test.ts` passed 52/52, including the 401 paths.
- Documentation updated to describe the token as optional in `README.md`,
  `.env.example`, `docs/LOCAL_POC.md`, `docs/SHEPHERD.md` and
  `docker-compose.state-volume.yml`. `SECURITY.md` now states plainly that a
  server started without a token serves every route to anyone who can reach the
  port, and that a token must be set before exposing it beyond the local machine,
  including ECS. Prior log entries are left as written; they remain true for the
  commits they name.

## 2026-08-30 — OPS-06 affected-host cause reproduced and corrected

Branch `fix/47-ops-06-container-state-volume`, PR #56, on the affected host
(macOS, Docker Desktop 29.5.3, LinuxKit 6.12 aarch64, `volc-agent-runtime:local`).

- Reproduced the reported failure from the repository's own generated preflight
  arguments: `docker create` succeeded, `docker start --attach` exited 49, and the
  only Runtime stderr was
  `sh: 1: cannot create /workspace/.shepherd-sandbox-probe: Permission denied`.
- Isolated the cause by holding image, Codex configuration and container flags
  fixed and varying only the workspace filesystem. Inside
  `codex sandbox linux --full-auto`, an ext4 named volume, the image overlayfs and
  a tmpfs all permitted `: > file`; the macOS host share denied it. On that share
  `mkdir`, `rmdir` and `unlink` succeeded while `open()` for read, write, create
  and truncate returned `EACCES`, and the file was left behind by the denied
  create — Landlock grants `MAKE_REG` there but not `WRITE_FILE`.
- `strace -f -y` on both a passing and a failing run showed byte-identical
  `landlock_create_ruleset`, five `landlock_add_rule` calls over the same paths
  (`/`, `/dev/null`, `/codex-home/memories`, `/workspace`, `/tmp`) and
  `landlock_restrict_self`, all returning 0. Only the subsequent
  `openat(AT_FDCWD, "w1", O_WRONLY|O_CREAT|O_TRUNC)` differed: `-1 EACCES` versus a
  file descriptor. The ruleset is identical; the filesystem cannot enforce it.
- Confirmed the independent `touch` probe defect: on the same share `touch`
  exited 0 **and created the file**, while `: >` in the same shell was denied.
- Verified the correction on the same host. With
  `--mount type=volume,...,volume-subpath=...,volume-nocopy=true`, workspace read,
  workspace write and a full `git init`/`add`/`commit` all succeeded inside the
  sandbox while the private `CODEX_HOME` write stayed denied. The **unmodified**
  preflight script then printed `codex-cli 0.111.0` and
  `SHEPHERD_RUNTIME_PREFLIGHT_OK` with exit 0.
- Established that `volume-nocopy` is mandatory. Without it an empty subpath is
  served with the image's own `/workspace` ownership: `ls -ldn` reported `0 0`
  through the mount while the directory on the volume was `10001 10001`, and a
  plain non-sandbox write was already denied. With `volume-nocopy=true` ownership
  was preserved and both the plain write and the sandboxed write succeeded.
- Proved the full loop: a non-root containerized control plane (uid 10001,
  joined to the engine socket group) created its workspace and private home,
  derived the state-relative subpaths, started the sibling Runtime container,
  and read back the file the sandboxed Agent had written.
- Repository gate on this host is **not green, before or after the change**.
  Pristine `origin/main` (`c0802e8`) failed `npm run test -w @launchpad/server`
  with 39 failed / 696 passed; the branch failed with 61 failed / 686 passed.
  Every failure in both runs is `Test timed out` or a `vi.waitFor` state
  assertion behind one, and the `main` failure set is a strict subset of the
  branch set — this machine is too slow to run the suite in parallel with the
  container engine, not a regression. Run serially
  (`--no-file-parallelism --maxWorkers=1`), the five heaviest files passed
  **167/168** on the branch in 434s; the single failure,
  `expected 'resolving' to be 'attention_required'`, is the same timing flake
  observed on pristine `main`. `npm run typecheck` and `npm run build` passed.
  `npm run test:e2e:harness:unit` passed 6/7; the one failure is the documented
  macOS non-canonical `os.tmpdir()` issue in a fixture this change does not
  touch, and the fake-container-engine test pinning the read-only bind mount
  passed. A green full gate on a Linux host remains required before integration.
- Ran the default `host-bind` launch on the affected host after the probe
  correction. It now stops at startup with
  `Codex workspace-write Landlock cannot govern the configured workspace in the
  hardened non-root Runtime`, naming `LOCAL_POC_STATE_MODE=container-volume`,
  instead of passing a false gate and crashing later inside the server. The
  mount-and-write probe passed in the same run, which is the expected split: a
  plain write to the host share succeeds while the Landlock-governed write does
  not.
- Ran the `container-volume` startup smoke on the affected host with a one-off
  token supplied in the environment; the repository `.env` was not modified. The
  first attempt exposed a real wiring defect: the launcher validated its resolved
  `APP_AUTH_TOKEN` while the control plane re-read a different value from
  `env_file`, so the container crash-looped on
  `APP_AUTH_TOKEN must be a non-placeholder token`. Corrected by pinning
  `APP_AUTH_TOKEN` in the compose `environment:` block from the caller's resolved
  value and exporting it from the launcher, so the validated token is the token
  the server receives.
- After that correction the profile came up on the first try: both preflight
  probes passed in volume mode, the control-plane image built, and
  `GET /api/health` returned `{"ok":true,"service":"volc-agent-launchpad"}` with
  the port published to `127.0.0.1` only. Resolved configuration inside the
  running container was `executionMode: "live"`, `runtimeProvider: "container"`,
  `containerStateRoot: /app/state`, `codexSandboxMode: workspace-write`. Live mode
  means `CodexShepherdExecutor.preflight()` ran and passed inside the server —
  the exact call that previously threw
  `Live Shepherd Runtime preflight failed (stage=container_start
  reason=sandbox_probe_failed)`. The smoke volume was removed afterwards.
- No live or model call ran; no Mission was started.
## 2026-08-30 — default general Agent Contract-intake candidate

- Ownership: issue #58, branch `feat/58-general-contract-intake`, stacked draft
  PR #59 on private-chat PR #57. No protected-main integration is claimed.
- Shepherd-managed routing is now the default in every Agent chat; the existing
  toggle remains a direct-Playground escape hatch. The fixed Frontend/Backend auth
  prompts retain their two-Contract collision path.
- Other prompts enter a constrained deterministic planner. It accepts 1–8 bounded
  messages, requires a concrete change, writable project-relative artifact(s), and
  explicit `Acceptance:` evidence. Missing or authority-incompatible fields produce
  a durable in-chat clarification and create no Mission, Contract, or Plane.
- A confirmed draft creates one authority-intersected Contract in a sentinel-bound
  managed project seeded from a secret-filtered Agent snapshot. The existing
  Git-free executor/import path, strict manifest ingestion and exact-diff authority
  check run unchanged. A registry-owned static check independently verifies the
  declared artifacts; the verified Contract is merged into an integration Plane,
  independently re-verified, promoted by expected-head compare-and-swap, and only
  its declared artifacts are synchronized back to the Agent workspace.
- Causal tests cover planner bounds/normalization/authority, secret-filtered project
  initialization, verifier policy, symlink-safe artifact sync, deterministic output,
  clarification idempotency/conflict, absence of premature executable state, final
  verified lifecycle, promotion and workspace output. Security regressions additionally
  reject negated/compound Acceptance criteria, retain post-CAS evidence across a
  one-shot final persistence fault/restart, and roll back an exact journaled policy
  commit when its Project head was not persisted. The literal `npm run check` passed:
  launcher 3/3, Server 771 passed plus two opt-in skips, Web 18/18, strict
  production/test type checks and both builds.
- Authenticated Playwright passed 6/6 across exact `1280x800` and `1440x900`:
  unchanged user-created auth collision, default route plus direct opt-out, general
  clarification and follow-up, verified promotion/workspace output, human-review
  fallback, stale-Agent-status reconciliation and no document overflow. A first
  focused E2E run correctly exposed that the fake verifier allowlist lacked the new
  registry-owned check; adding that exact static check made every rerun pass.
- No live/model request was made. Independent UI and security re-reviews returned
  ready with no High/Medium finding; integration against protected `main` remains
  pending. The final deterministic browser rerun
  passed 6/6 after the direct-Playground fixture was explicitly configured with its
  bounded fake Agent Runtime; the direct request returned 202 and emitted no managed
  Contract request.
## 2026-08-30 — private Agent-chat Contract candidate

- Ownership: issue #55, branch `feat/55-private-chat-contracts`, draft PR #57;
  implementation `6018352`, reviewed correction head `e1fe067`. Protected-main
  integration remains pending.
- Frontend and Backend Agents now have an explicit **Route through Shepherd** mode
  in their existing private chat. Bounded server parsing accepts exactly one
  HttpOnly-cookie assignment and one bearer-JWT assignment; ambiguous, absent,
  same-role, same-transport, stopped/busy, authority-incompatible and reused-ID
  inputs fail closed. Legacy Playground behavior remains available when the mode is
  off.
- The first exact bounded prompt and the second prompt are durable before their
  respective filesystem/Mission work. A restart can resume intake; the second
  prompt idempotently creates one Mission whose two Contract objectives are the
  original user assignments. The existing isolated Contract Planes, independent
  verification, integration, semantic collision, same-base resolution candidates,
  final re-verification and protected promotion remain authoritative.
- The old Shepherd Agent/transport selectors and their unused CSS were removed.
  Private chat shows collection and verified Contract status. A route-mode identity
  regression prevents Frontend state leaking into a Generalist or Backend. Narrow
  `/shepherd` flex containment keeps the full fallback composer in viewport while
  preserving designated internal panel scrolling and the accepted theme.
- Verification found and corrected three causal defects. The first restart RED was
  `Shepherd startup artifact reconciliation failed` because a pending Project lacked
  its trusted Plane-root sentinel. UI review then reproduced hidden route state on a
  Generalist and main-container Y overflow. Security review found Agent deletion
  could archive a workspace while private intake persisted a reference or created
  pre-mutation Project artifacts. Final intake/delete operations serialize through
  the Store queue; actual barrier coverage proves both orderings keep Agent,
  workspace, Project and prompt state consistent and restartable.
- Final literal `npm run check` passed: launcher 3/3; Server 742 passed plus two
  explicit opt-in skips; Web 18/18; strict production/test type checks and both
  production builds passed. Focused security/intake regressions passed 3/3.
- Final authenticated Playwright passed 4/4 at exact `1280x800` and `1440x900`:
  private Frontend prompt, Generalist isolation, private Backend prompt, verified
  private status, exact Contract assignment, complete evidence, collision/candidate
  outcome, human-review fallback, keyboard opt-in, and document/main-container
  no-overflow/composer-in-viewport checks. A source-only rerun before rebuilding the
  production Web bundle served stale assets and failed the new identity assertion;
  the explicit build and every final rerun passed.
- Independent security and UI re-reviews passed with no remaining blocker. The
  configured custom reviewer roles were unavailable, so repository-instructed
  read-only fallback reviewers were used. No live/model request ran; this evidence
  covers deterministic local behavior only. The separate Project Group `@Agent`
  journey remains issue #41.

## 2026-08-30 — protected-main promotion and exact post-merge gate

- PR #52 passed hosted `Node 22 / npm run check` and merged the documentation and
  workflow candidate into retained campaign branch `mock-main` at `017e07e`.
- Promotion PR #53 was mergeable with no main-only commit. Both hosted checks—
  `Required checks` and `Node 22 / npm run check`—passed before it merged into
  protected `main` at `5ccd0f143146b2c303be90dc1337e02bb6986459`.
- On that exact protected-main merge, literal `npm run check` passed locally:
  launcher 3/3; Server 739 passed plus two explicit opt-in skips; Web 18/18; strict
  production/test type checks and both production builds passed.
- The campaign branch was intentionally retained. This follow-up changes only
  promotion provenance in documentation; it does not change product or UI code.

## 2026-08-30 — protected-main hackathon integration candidate

- Base: campaign integration merge `005a51e02ab39a995803b4ed3717ee0ee55cae6c`,
  which contains the independently reviewed user-selected Contract flow from PR #40.
  Branch `docs/hackathon-main-integration` was pushed before edits.
- Active contribution instructions now target protected `main`, require immediate
  issue assignment/comment plus an early remote branch, and provide the replacement
  navigation path after intentional removal of `HANDOVER.md`. `AGENTS.md`,
  `CLAUDE.md`, `CONTRIBUTING.md`, `TASKS.md`, and the active Fixer rules all freeze
  visual design and define “minimal” as a complete functionality-preserving fix.
- `SHEPHERD.md` now inventories implemented Track 1 backend capabilities, separates
  current evidence from open gates, links the today-feasible work, and records the
  dated internal assessment: 82% hackathon completion, 90% core demo readiness,
  85/100 weighted rubric score, 74/100 current winning confidence, and 91/100
  novelty confidence. The deductions and the dependency/rubric weighting method are
  explicit; no official-judge or guaranteed-win claim is made.
- Read-only GitHub audit found only two stale open issues. #35 (MR-02) and #36
  (CI-01) were closed as completed with their integrated evidence; none was deleted.
  Unassigned, dependency-aware issues #41–#51 now cover only the minimum
  hackathon-ready cut and carry `hackathon-ready` plus `priority:P0` labels.
- The manual runbook now creates/selects user Frontend and Backend Agents, displays
  both complete Contracts, explains source versus competing Resolution Planes, and
  verifies the internal human-review ticket. Project Group's unfinished behavior
  remains explicitly open.
- `docs/PRD.md` remained byte-identical at SHA-256
  `478ca55f201b52ba75c5c2134e0eef9d8ded4eb74f6a35d32062927413a70ced`.
  All local Markdown links resolved across 15 files and `git diff --check` passed.
- Literal `npm run check` passed on the candidate: launcher 3/3; Server 739 passed
  plus two explicit opt-in skips; Web 18/18; strict production/test type checks and
  both builds passed. Neither `actionlint` nor the Ruby YAML fallback exists in this
  environment, so no local parser pass is claimed for the one-line workflow trigger
  removal; the hosted required check remains the merge gate.
- No product source, runtime, schema, dependency, secret, live/model request, or UI
  implementation changed in this documentation/workflow candidate.

## 2026-08-30 — user-selected Agent Contract demo candidate

- Base: `mock-main` at `6fddb0e84608a8614f745bcfdcd92b091e4f7fdf`.
  Branch: `feat/demo-agent-contract-flow`, pushed before edits.
- The existing Shepherd Mission composer can now assign one ready user-created
  Frontend Agent and one ready user-created Backend Agent to opposite typed auth
  transports. Reservation and authority are revalidated in the final serialized
  mutation; Mission request idempotency is fingerprinted and persisted atomically
  with the Mission, Contracts and originating human message.
- Every Contract-linked stream event can disclose the complete bounded Execution
  Contract: identity and assignment, objective, dependencies, semantic contract,
  contextual inputs, scoped authority, artifacts, acceptance checks and profile,
  tie-breakers, manifest path and timestamps. Existing evidence remains alongside
  it; public responses do not expose the server-only request fingerprint.
- Collision evidence explains that both Resolution Planes fork from the same
  immutable integration commit and compete by independent project-invariant
  verification. Non-automatic or non-unique outcomes show a truthful internal
  human-review ticket with the full durable collision/Mission reference; no
  external issue-tracker integration is claimed.
- Causal tests cover selected Agents with reversed transports, concurrent and
  restart-safe idempotency, assignment mismatch, the stop-versus-reservation race,
  full Contract rendering and human-review behavior. Literal `npm run check`
  passed launcher 3/3, Server 739 passed plus two explicit opt-in skips, Web 18/18,
  all strict production/test typechecks and both builds.
- The focused real-browser gate passed 4/4: normal completion and forced human
  review at exact `1280x800` and `1440x900`, including Agent creation/selection,
  exact Contract assignment/objectives, both Resolution Planes, full evidence,
  keyboard focus and no document/body overflow. Independent UI review passed at
  5.31:1 minimum contrast; independent security re-review passed with no remaining
  scoped blocker. After the final ticket-label wording edit, the first browser
  invocation served the prior production bundle: both unchanged completion cases
  passed and both new-label assertions failed. Rebuilding the Web bundle and
  repeating the exact command passed 4/4. No live/model request was made.
- This candidate does not claim completion of `GC-03/04`: the separate Project
  Group `@Agent` click/type → Contract → Agent-summary journey remains open.

## 2026-08-30 — DEL-04 documentation consolidation candidate

- Base: `mock-main` at `43fb5d3f40a0b90a744aec70b2ab02a8adab5ed9`.
- Branch: `docs/hackathon-doc-consolidation`, pushed before edits as the ownership
  signal. Documentation and root navigation are the only owned surfaces.
- `TASKS.md` is now the canonical entrypoint and explicitly separates the minimum
  hackathon-ready cut from additional full-PRD work. Its ledger was mechanically
  recounted as 69 work items: 40 fully audited and 29 not fully audited.
- The current startup/manual demo SOP moved to `LOCAL_POC.md`; current as-built
  behavior remains in `SHEPHERD.md`; the competition brief was reduced to Track 1
  and renamed `TECHJAM.md`; optional deployment essentials moved into `README.md`.
- Obsolete `HANDOVER.md`, `DEPLOYMENT.md`, and the five-track source digest were
  removed only after all actionable repository links were redirected. Historical
  mentions inside this immutable chronological log were intentionally retained.
- `PRD.md` remained byte-identical with SHA-256
  `478ca55f201b52ba75c5c2134e0eef9d8ded4eb74f6a35d32062927413a70ced`.
- A repository-local link checker inspected 15 retained Markdown files; every local
  target resolved. `TECHJAM.md` contains no Track 2–5 section, `git diff --check`
  passed, and the stale deviation/browser/count statements were reconciled.
- Literal `npm run check` passed: launcher 3/3; Server 27 files passed with two
  explicit opt-in files skipped and 736 tests passed with two skipped; Web 3 files
  and 17/17 tests passed; strict production/test typechecks passed; Web production
  build transformed 41 modules; Server production build passed.
- No product, UI, schema, dependency, Runtime, secret, or live-model behavior changed;
  no live/model request was made.
- Independent read-only review rejected five stale/incomplete statements; the exact
  E2E-02, branch identity, authenticated deployment verification, link-count, and
  veLinux mapping corrections were applied and the re-review passed with no blocker.
- The reviewed commit `5a38d37a210c255781055648c43896597497f50f` was fast-forwarded
  into `mock-main`. The post-merge local-link/PRD/task-count/Track-1 checks passed,
  literal `npm run check` repeated the 3/3 launcher, 736-pass Server, 17/17 Web,
  strict typecheck, and two-build result, and `origin/mock-main` was verified at the
  same exact commit before this bookkeeping update.

## 2026-08-30 — F-06 and TST-21–24 integrated and audited

Auditor integrated exact corrected chain
`7d51ec69d1ac6c807d42e872b4616b6357967f48` onto `mock-main`. Independent
evidence passed TST-23 20/20, TST-24 30/30, Store 70/70, and combined Store/
recovery/service 133/133. Literal `npm run check` passed launcher 3/3, Server
736 passed plus two explicit opt-in skips, Web 17/17, strict production/test
typechecks and both builds. Independent final security review returned 0 High and
0 Medium; all prior journal-read and sensitive-temp crash-prefix blockers closed.
Hosted Node 22 Required checks run `33286090602` passed the implementation head.

The accepted Low residual is the documented same-UID parent-directory swap or
concurrent independent-Store race under the existing single-process managed-root
threat model. Windows narrowly lacks Unix directory-fsync/mode guarantees; Unix and
macOS errors are not swallowed. F-06 is explicitly representative of the Mission
running-to-verifying boundary and does not claim arbitrary store-mutation recovery.
No live/model/UI call was needed.

## 2026-08-30 — TST-24 Fixer candidate restores the TST-22/F-06 full gate

After visible persistence-error attention, the exact fixture now uses bounded
`vi.waitFor` on `store.persistenceRecoveryIntent()` becoming null and then awaits a
test-owned no-op `store.mutate` sentinel. This proves recovery-journal unlink,
directory sync, in-memory intent clearing and all earlier original-store queue work
have finished before durable reads, cancellation, reset or root teardown. No sleep,
retry, timeout increase, suppression, cleanup catch or product change was added.

The exact row passed 30/30. Combined Store/recovery/service coverage including
TST-23 passed 138/138 without an unhandled rejection or retained artifact. Two
consecutive literal `npm run check` executions each passed launcher 3/3; Server 736
with two explicitly opt-in skips; Web 17/17; strict production/test typechecks; and
both builds. TST-22's prior independent security verdict remains 0 High / 0 Medium
with only the documented same-UID parent-directory swap Low. Auditor integration
and hosted evidence remain pending.

## 2026-08-30 — TST-24 reconciliation-quiescence RED preserved

Auditor tested exact corrected chain
`7d8483a3ef5998002dab6331bd53532640f953ec`. The transient Mission verification
persistence row passed once, then passed 18 contention repetitions before failing
iteration 19. The Mission was visibly `attention_required`, but the complete
recovery intent remained non-null; a late Store operation also rejected with fixed
`recovery_pending`.

Source ordering confirms `mutateForPersistenceReconciliation` publishes attention
before `clearPersistenceRecoveryIntent` finishes journal unlink, parent-directory
sync and in-memory intent clearing. The test must wait for that exact intent to clear
and queue a test-owned no-op mutation sentinel on the original Store before durable/
reload/cancel/teardown work. No sleep, retry, timeout, suppression, assertion
weakening or product edit is authorized. No `mock-main`, hosted, live, model or UI
action occurred.

## 2026-08-30 — TST-23 Fixer candidate

The TST-17 Plane-unwind attention row now awaits one test-owned no-op
`store.mutate` sentinel after observing `attention_required` and before reading
durable reload state. Because Store operations are serialized, this joins all prior
original-store persistence without sleeping, retrying, suppressing a rejection or
changing product behavior. The exact row passed 20/20; combined Store, recovery and
service coverage passed 138/138 with no unhandled rejection or retained root/temp.

The first literal full gate advanced past TST-23 but stopped in a distinct transient
Mission-verification persistence row: Server reported 735 passed, two opt-in skips
and one failure because the row observed attention before its recovery intent was
cleared. That row passed 10/10 isolated, establishing contention sensitivity rather
than closure. It is outside TST-23 ownership and is not edited or hidden here; the
TST-22/F-06 full gate remains blocked pending separately owned evidence/correction.

## 2026-08-30 — TST-23 independently reproduced on TST-22 checkpoint

On exact checkpoint `619e3ddd369d2dd8a0ce3b04134c0064c240142e`, Auditor ran only
`fails closed with bounded attention evidence when initial Plane unwind fails`.
Its assertions passed 1/1, but the command failed with one unhandled cause-free
`PersistenceBoundaryError(cleanup, cleanup_pending)` from `JsonStore.persist` on
the original Store queue. Source ordering confirms the row observes service memory,
then initializes a second Store before joining that queue. The corrected TST-22
marker authority is correctly fail-closed under concurrent independent access.

TST-23 therefore requires only a test-owned no-op Store sentinel after attention
and before reload/teardown, with immediate rejection observation/finally join if
needed. No sleep/retry/timeout/suppression/cleanup catch or production change is
permitted. No `mock-main` push or full/hosted/live/model/UI gate is claimed.

## 2026-08-30 — TST-22 Fixer candidate: crash-safe managed-temp state machine

The correction replaces post-failure temp registration with pre-registration:
before either database or recovery-journal sensitive temp is opened, a small fixed
schema containing only kind, strict temp basename and publication UUID is written,
file-synced, atomically published and directory-synced. All markers and sensitive
temps live in an adjacent fixed-name private directory validated as a current-owner
regular directory with mode `0700` and no symlink. Database/journal rename remains
on the same filesystem; the target parent and private directory are synced at their
respective transitions.

One idempotent cleanup path handles marker+temp and marker+missing-temp states,
preserves the primary database/journal failure with bounded `cleanupPending`, and
consumes any prior marker before another same-instance write can publish. Marker
publication files are opened no-follow and validated through the same handle;
schema-bound UUID provenance is required before deletion. General-parent
lookalikes, malformed foreign files, hostile directory/marker/publication symlinks
and outside canaries remain untouched.

Observed focused evidence: strict test typecheck passed; Store passed 70/70; the
selected Store/recovery/service slice passed 134/134 before the private-directory
hardening and Store returned 70/70 after it. The matrix includes 12 publication
checkpoints, eight removal checkpoints, primary/journal double faults,
same-instance retry, two fresh restarts, missing-temp idempotence and repeated-write
no-accumulation. Independent final security review found 0 High / 0 Medium; the
documented Low residual is a same-UID parent-directory swap race because Node lacks
portable `openat`-style anchored operations, and such an actor already controls the
database parent.

The post-hardening adjacent run exposed a separate deterministic test-quiescence
defect in the TST-17 cleanup-double-fault row: 138/138 assertions passed but Vitest
reported a late unhandled Store rejection; isolated stress failed on repetition 2.
The row observes in-memory `attention_required` then starts a second `JsonStore`
before the original Store queue is quiescent. The private marker correctly fails
closed during that overlap. This is not hidden as TST-22 success; a test-owned Store
queue sentinel is required before reload/teardown. The first post-hardening literal
gate likewise stopped at Server tests (735 passed, two opt-in skips, one teardown
failure). Auditor integration/hosted evidence remains pending.

## 2026-08-30 — F-06/TST-21 correction blocked by TST-22 marker lifecycle

Auditor fast-forwarded exact corrected candidate
`f65681aa48a3bfd384d36fc9320ea63e045d3261` only on the audit ownership branch.
Store passed 43/43; the selected persistence/journal/Plane slice passed 21/21; and
the previously order-sensitive initial Plane-unwind attention row passed 20/20, so
no causal lifecycle or fault-seam-reset defect reproduced there.

The recovery-intent open/stat/read/close boundary is now fixed and cause-free, but
the temp-marker protocol remains Medium-blocked. Auditor changed only the existing
double-fault test's recovery instance for a causal probe: same-instance recovery
failed database and journal rows 2/2 with `cleanup_pending`. The in-memory pass
removes the temp without its marker, then marker scanning rejects the missing temp.
Independent security re-review also confirmed unhandled crash prefixes: marker
publication failure can leave an unmarked full-state temp; temp removal followed by
marker removal failure or a partial marker can permanently block restart. The probe
edit was reverted byte-clean. TST-22 records the required idempotent state-machine
boundary. No product commit was pushed to `mock-main`; full/hosted/live/UI/model
gates were not claimed after the Medium blocker.

## 2026-08-30 — TST-21 Fixer candidate

The correction closes recovery intent open/stat/read/close operational faults as
fixed cause-free `PersistenceBoundaryError(recovery_intent_read, unavailable)` while
retaining fixed schema/symlink/size/owner validation. Database and journal UUID temps
are registered in memory; a primary plus temp-unlink double fault preserves the
primary failure and durably marks the exact artifact. Before state becomes observable on
restart, only a strict matching marker is considered, then fixed content, lstat
regular-file/no-symlink, owner, mode and database/journal size limits are enforced
before exact unlink and parent-directory sync. Two restart rows prove removal; a matching marker symlink remains untouched with its outside
canary unchanged. Two marker-write triple-fault rows preserve the original primary/
journal identity, expose only bounded `cleanupPending`, and consume exact in-memory
ownership on same-instance initialize. Focused store coverage passed 43/43; Auditor remains pending.
The final literal gate passed launcher 3/3, Server 709 passed plus two opt-in skips,
Web 17/17 and both builds. Independent final security review approved with 0 High /
0 Medium; Low residuals are same-UID data-directory races and fail-closed handling
when an external actor removes an exact pending temp.

## 2026-08-30 — F-06 audit blocked by TST-21 persistence-boundary defects

Auditor replayed exact Worker candidate
`6bc67b3272b530897149aa5a9507e46c2393453a` locally as `1a3be1a` over canonical
`mock-main` `19876cb740d80c2e868d401f4b5f6164e20ff330`. The focused persistence/journal
selection passed once (18 passed, 62 skipped) and then passed 10/10 repeated
invocations. The exact-byte digest, bounded schema, no-follow/size/mode/owner
checks, pending-recovery mutation/event lock, representative running-to-verifying
scope, and immediate/two-restart reconciliation design were inspected; no broader
arbitrary-store recovery claim is accepted.

Integration is blocked. Independent read-only security review found two Medium
gaps outside the existing single-stage fault matrix. First, non-`ENOENT`/`ELOOP`
journal open/stat/read failures escape initialization as raw native errors, including
configured path and OS diagnostic. Second, database or journal primary failure plus
temp-unlink failure suppresses the cleanup fault; a database temp can retain the
complete serialized state with no tracking/restart reconciliation, and repetitions
can accumulate sensitive artifacts. Existing tests have no unlink fault checkpoint
or native read-fault rows. These are recorded as `TST-21`; no F-06 product commit was
pushed to `mock-main`, and no full/hosted gate or live/model/UI call was claimed.

## 2026-08-30 — TST-20 audited; F-05 final stability restored

Exact test-only `cdcfa95` passed Auditor row stress 30/30, service/store 56/56,
strict test types and literal `npm run check` (launcher 3/3, Server 676 passed plus
two opt-in skips, Web 17/17, both builds). Rejection observation attaches before the
gates; unconditional `finally` releases and joins the blocked backend checkpoint,
then a test-owned store mutation drains the persistence queue before teardown. No
setImmediate, sleep, retry, timeout increase, suppression, cleanup catch, assertion
weakening or product edit exists. Hosted Node 22 implementation run `33282600354`
passed. F-05/TST18/19 scoped 100% is restored pending the final docs-head hosted gate.

## 2026-08-30 — TST-20 Fixer candidate

The hosted RED returned from the test while its released backend checkpoint and store
queue were not owned through teardown. The test-only correction attaches Mission
rejection observation immediately, always releases and joins the exact backend
checkpoint lifecycle, and then awaits a test-owned no-op `store.mutate` sentinel.
The prior `setImmediate` timing assumption is removed. The exact fail-fast/no-sibling-
verifier/state/no-promotion row passed 20/20 locally; hosted Auditor evidence remains
pending. No product, timeout, retry, cleanup suppression or assertion change was made.
The service/store slice passed 56/56 and two literal local gates each passed launcher
3/3, Server 676 passed plus two opt-in skips, Web 17/17 and both builds.

## 2026-08-30 — F-05 implementation green; final hosted blocked by TST-20

Implementation hosted run `33281977834` passed exact `f8d7f71`. Final docs-head run
`33282108035` failed with an unhandled `JsonStore.persist` rename ENOENT beneath the
case root for service test `does not invoke a sibling verifier after infrastructure
terminalization`. The fail-fast Mission promise had returned, the test released its
blocked sibling and waited only one event-loop turn, and teardown removed the root
while late sibling/store persistence remained active. Exact targeted candidate-
cleanup repeats 10/10 did not reproduce the earlier local contention symptom; this
hosted failure is preserved separately as TST-20. F-05/TST18/19 product/security
evidence remains green, but final hosted I and scoped 100% are withdrawn until the
test owns and joins the exact sibling lifecycle. No retry was used.

## 2026-08-30 — F-05 / TST-18–19 audited and integrated

Exact `f8d7f71` passed the 28-case real-Git suite five consecutive times (140/140),
combined Git/service 72/72, adjacent API/store/state/recovery/executor/verifier
133/133, and literal `npm run check` (launcher 3/3, Server 676 passed plus two opt-in
skips, Web 17/17, both builds). The nine-case identity/cleanup matrix proves clean
ordinary conflict restoration and zero-mutation rejection for detached, sibling-
branch, moved-head, dirty and preexisting-MERGE_HEAD states; target/source refs,
status, MERGE metadata, protected HEAD/canary and downstream state remain unchanged.
Cleanup uncertainty persists bounded attention evidence and cancel→reset exact
resource removal. Independent security review found no High/Medium issue. Hosted
Node 22 run `33281977834` passed. The Low same-host multi-command TOCTOU residual is
documented; no live/model/UI call ran.

## 2026-08-30 — TST-19 Fixer candidate

The source-confirmed RED allowed a clean integration checkout on the wrong persisted
branch/head to reach `git merge`. The candidate passes the persisted Plane branch and
head into the Git boundary and, before mutation, proves no `MERGE_HEAD`, clean
porcelain, the exact symbolic branch and exact HEAD. Real-Git rows for detached HEAD,
sibling branch at the same OID, moved head, dirty worktree and preexisting MERGE_HEAD
all return the fixed cause-free cleanup boundary while preserving integration
HEAD/status/all head refs, exact `MERGE_HEAD` metadata and source HEAD. The existing service maps this typed result
to failed integration Plane plus active-project Mission attention, with released
Agents and no candidate/promotion. Independent review reported 0 High / 0 Medium;
the remaining Low local-host TOCTOU window requires an actor with independent write
access and is not a new privilege boundary. Auditor integration remains pending.
Focused identity rows passed 25/25 across five repeats, combined conflict/identity
passed 9/9, and adjacent Git/service/recovery passed 72/72. Two literal final
`npm run check` gates each passed launcher 3/3, Server 676 passed plus two opt-in
skips, Web 17/17 and both builds.

## 2026-08-30 — TST-18 passes locally; F-05 blocked by TST-19

Auditor replayed exact `53c8415`. Focused Git/service passed 67/67; the two service
conflict rows repeated 10/10 invocations (20/20 cases), and adjacent API/store/state/
recovery/executor/verifier passed 133/133. Enumeration, abort and post-inspection
cleanup rows are fixed/cause-free; ordinary conflict proves absent MERGE_HEAD, clean
status, exact observed pre-head and persisted branch. The attention path retains
truthful cleanup state; an ephemeral cancel-then-reset check removed its exact retained
Plane successfully. The earlier scheduling symptom did not reproduce in 10/10 focused
candidate-cleanup repeats; however one literal full run later failed that pre-existing
candidate-cleanup assertion under contention, so no global-stability claim is made.

Independent security review found a distinct Medium precondition defect: expected
Plane branch/head are compared only after conflict cleanup, not before merge mutation.
A clean worktree switched to another branch/head can be mutated first. TST-19 requires
pre-mutation identity proof. The candidate was not pushed to `mock-main`.

## 2026-08-30 — TST-18 Fixer candidate

The preserved implementation RED showed conflict enumeration/path validation before
abort, accepted abort exit 128, and no combined proof of absent `MERGE_HEAD`, clean
status and unchanged integration HEAD. The candidate makes abort mandatory, validates
and caps paths only afterward, and requires all three post-abort facts. Injected real
conflict rows cover enumeration, abort and inspection failures: each returns the fixed
cause-free cleanup boundary; enumeration/inspection faults leave a clean worktree,
while abort failure truthfully leaves it dirty for operator recovery. The service
persists `git_conflict/integration_cleanup`, a failed integration Plane and an
`attention_required` Mission with active project, verified Contracts, released Agents,
no collision/candidate/promotion and no planted diagnostics. Auditor integration is
still pending. Focused conflict rows passed 4/4, service clean/attention rows 2/2,
and adjacent Git/service/recovery passed 67/67. The final literal `npm run check`
passed launcher 3/3, Server 671 passed plus two opt-in skips, Web 17/17 and both
builds. `npm audit --omit=dev` reported zero vulnerabilities. A read-only security
fallback's initial Medium branch-integrity finding was corrected by also proving the
persisted symbolic branch. Final read-only re-review reported 0 High / 0 Medium and
passed the scoped security boundary.

## 2026-08-30 — F-05 integration blocked by TST-18 merge-abort precedence

Candidate `0208713` was replayed onto canonical F-04 docs as `a7b669b`. Auditor
passed ordinary real conflict/path gates 3/3: the ten-file add/add Mission retained a
clean failed integration Plane, bounded count 10 / preview cap 8 / path length 48,
verified Contracts, released Agents, protected HEAD/canary, no candidates/promotion,
reload/API evidence and explicit reset removal; the lower real-Git conflict stayed
clean. No candidate-owned test artifact remained.

An independent cleanup-double-fault injected a planted exception specifically at
`merge abort` after the real conflict was detected. The exact test reproduced 1/1:
`mergePlane` rejected with the planted raw abort diagnostic instead of returning the
validated conflict, proving original-conflict precedence and clean-retention claims
are not closed. Independent security review additionally found conflict enumeration
and path validation occur before abort, exit 128 is accepted without checking cleanup,
and post-merge inspection does not assert clean/head state. Temporary audit
instrumentation was removed. TST-18 requires a mandatory abort/restore boundary,
bounded primary conflict and truthful cleanup state; F-05 was not pushed to
`mock-main`.

## 2026-08-30 — F-04 / TST-17 audited and integrated

Exact implementation `2cef988` passed Auditor focused creation/unwind/double-fault
3/3, real Git 20/20, adjacent service/executor/container/recovery/store/API/state/
verifier 174/174, and literal `npm run check` (launcher 3/3, Server 665 passed plus
two opt-in skips, Web 17/17, both builds). Successful unwind removes only exact
current-batch durable Plane associations, worktrees and branches; cleanup failure
truthfully retains a failed Plane and interrupted Contract under bounded
`plane_unwind` evidence while Mission keeps the primary `plane_creation` failure.
Agents release, active-project and protected-head invariants hold, and no downstream
work runs. Independent security fallback found no High/Medium issue. Hosted Node 22
run `33280187821` passed. F-04 and TST-17 are audited scoped 100%. The Low partial-
teardown injection granularity limitation is documented; no live/model/UI call ran.

## 2026-08-30 — TST-17 transactional initial Plane unwind candidate

The Fixer preserved the second-of-two RED from `5cc24f5`: one durable ready Plane,
Contract association, worktree and branch survived after the sibling creation failed.
Candidate `fix/f04-plane-unwind` now tracks only Planes successfully created by that
initial batch and destroys them through `PlaneManager` in reverse order before
removing their exact durable records and Contract associations. The original failed
Contract and Mission remain `worktree_creation_failure` / `plane_creation`; Agents
and the terminal Mission's project are released. No downstream executor, verifier,
integration, collision, candidate or promotion path runs, and protected HEAD plus an
outside canary remain unchanged across reload.

A cleanup double-fault retains the exact failed Plane and interrupted Contract,
releases all Agents, and transitions the Mission to existing nonterminal
`attention_required` / `plane_unwind_failed` while retaining the project as required
by the active-Mission invariant. Fixed cleanup evidence is
`worktree_creation_failure` / `plane_unwind`; it does not claim F-06's reserved
`persistence_error`. Raw cleanup secret/path/OS diagnostics do not reach durable,
reload or public DTO surfaces. Causal rows passed 2/2, service plus real-Git 61/61,
security/F-01/recovery/API adjacency 186/186, strict test types and two literal
checks passed (each: launcher 3/3, Server 665 plus two opt-in skips, Web 17/17 and
both builds). Independent security review found no High/Medium issue; explicit
reload-state and non-busy Agent assertions address its actionable Low notes. No
UI/live/model call ran. Auditor integration remains pending.

## 2026-08-30 — F-04 integration blocked by TST-17 batch unwind

The Auditor rebased candidate `d988292` onto canonical docs as `5cc24f5` and
independently passed the focused Contract failure 1/1, real partial-Git rollback 1/1,
both changed suites 59/59, and adjacent executor/container/recovery/store/API/state
125/125. The real-Git case removes the partial worktree and Shepherd branch while
preserving protected HEAD/canary; bounded public failure and candidate-owned temp
cleanup passed. No other-agent artifact was removed.

A causal second-of-two creation injection failed 1/1: after Plane 1 succeeded and
Plane 2 failed, Mission state was failed but one durable `ready` Plane, its Contract
association, worktree and branch remained. Source tracing confirmed no batch unwind
in `executePreparedMission` or `recordMissionFailure`. Independent security fallback
classified this Medium. The temporary audit test was removed after preserving the
RED; product candidate was not pushed to `mock-main`. TST-17 requires exact
batch-owned durable and physical cleanup without weakening the first-call behavior.

## 2026-08-30 — F-01/02 and TST-13–16 independently audited and integrated

Exact implementation `83cc1d0` was pushed to `mock-main`. Auditor verification
passed executor 67/67, combined runner/executor/service 127/127, adjacent API/store/
container/state/recovery/verifier 66/66, and literal `npm run check` (launcher 3/3,
Server 661 passed plus two explicit opt-in skips, Web 17/17, both builds). Manual
inspection matched all 47 executor-owned filesystem/config expressions to a closed
boundary and all 31 injected call-site/double-fault rows. Independent security
fallback returned READY with no High/Medium issue. Secret/artifact/diff scans were
clean apart from documented placeholders and test canaries. Hosted Node 22 run
`33278994572` is the implementation integration gate. No external/model/UI call ran.
The Low restart-invalid-sentinel residual remains fail-closed and may require manual
operator cleanup; cross-process retry is not claimed.

## 2026-08-30 — TST-16 complete filesystem boundary candidate

The Fixer candidate `fix/f-01-02-filesystem-boundary` closes the remaining raw
executor-owned filesystem/config paths with fixed stages for private-root
preparation, private-home and preflight-workspace reconciliation, preflight setup
and execution setup. It preserves existing fixed policy/invariant errors,
containment/symlink checks, typed runtime/cancellation behavior and exact cleanup
precedence; raw native errors are not attached as causes or durable fields.

The causal matrix injects 31 filesystem/config call-site failures across all stages
failures and proves bounded stage/reason output, exact retained-target cleanup and
retry, including distinct canonical roots/workspace and sentinel handle/post-create
edges. TST-15 retains complementary open/handle/unlink/rm coverage. A frozen source
inventory tracks 47 executor filesystem/config expressions. Contract and candidate tests scan
Error/cause/stack/inspect, console, store/reload, Mission/Contract/Plane/Agent/event,
public DTO and real HTTP response surfaces with opaque, secret, path, errno and OS
canaries; no candidate promotes or moves protected head. Executor 55/55, adjacent
runtime/service/config/verifier 141/141, strict test typecheck and the first literal
`npm run check` passed (launcher 3/3, Server 649 plus two explicit opt-in skips, Web
17/17 and both builds). After the first security review identified missing distinct
call-site evidence, the matrix expanded to 31 rows and the inventory to all 47 calls;
focused 67/67, adjacent 154/154 and two corrected literal checks passed (each:
launcher 3/3, Server 661 plus two skips, Web 17/17 and both builds). Independent
security re-review found no remaining material
issue. No model/live/UI call ran. Independent Auditor integration remains pending.
The existing Low restart-only invalid-sentinel manual-cleanup
residual remains fail-closed and is not claimed as cross-process automatic recovery.

## 2026-08-30 — TST-15 passes; F-01/02 blocked by complete TST-16 boundary

The Auditor reviewed exact unintegrated chain `8c7cfc1`. Focused runner/executor/
service passed 93/93 and API/store/container-service/state-machine/recovery/verifier
adjacency passed 66/66. TST-15's sentinel open/close/unlink and exact interrupted-
artifact rm fault matrix, bounded double-fault precedence, same-process pending-
unlink retry, retained cleanup target and containment behavior passed.

The mandated full-source review found remaining Medium raw filesystem/config paths:
private-root preparation, reconciliation enumeration, preflight setup and execution
setup still call mkdir/mkdtemp/lstat/readdir/realpath/chmod/config write outside the
closed boundary. These can expose raw startup inspection or persist as unknown
Contract/candidate failures. The chain was not pushed to `mock-main`; broad checks
stopped after the causal boundary was established. TST-16 must complete the fixed
stage policy and fault matrix. A process restart after both sentinel adoption and
unlink failure remains fail-closed but may require operator cleanup; this is a
documented Low availability residual, not a PRD trust-boundary bypass.

## 2026-08-30 — TST-14 passes; F-01/02 blocked by TST-15 cleanup family

The Auditor reviewed exact unintegrated chain `3afc452`. Focused runner/executor/
service passed 81/81; API/store/container-service/state-machine/recovery/verifier
adjacency passed 66/66; literal `npm run check` passed launcher 3/3, Server 615/615
plus two explicit opt-in skips, Web 17/17, strict test/source types and both builds.
TST-14's success/cancel/timeout/execution precedence, fixed cleanup-only failure,
retained-home reconciliation, retry, Contract/candidate durable/public/Fastify HTTP/
log canary exclusion and no-promotion/head-move behavior passed. No external call ran.

The required exhaustive executor review found one remaining Medium cleanup family:
sentinel open carries raw cause; sentinel validation/adoption close can override
bounded primary errors; failed adoption unlink is swallowed; and interrupted-home/
preflight-workspace reconciliation rm failures escape raw. These paths lack causal
fault coverage. The chain was not pushed to `mock-main`; TST-15 requires fixed
bounded precedence, actionable retained-artifact retry and clean startup/log Error
surfaces before integration.

## 2026-08-30 — F-01/02 + TST-13 remain blocked by TST-14 cleanup path

The Auditor reviewed exact corrected chain `c7b5175`. Focused runner/executor/
service passed 75/75; API/store/container-service/state-machine/recovery/verifier
adjacency passed 66/66; literal `npm run check` passed launcher 3/3, Server 609/609
plus two explicit opt-in skips, Web 17/17, strict test/source types and both builds.
TST-13 successfully bounded parsed stdout/stderr, create/start/spawn/container-
cleanup and hostile typed fields across Contract and candidate durable/public paths;
candidate failure retained attention/no-promotion/protected-head behavior. No
live/model/UI call ran.

Independent exhaustive security fallback found a separate Medium defect: executor
execution-private-home `rm()` runs directly in `finally`. Its raw exception can
leak path/OS detail and override typed timeout/execution or cancellation identity.
That path is not covered by TST-12 preflight or runner container cleanup tests. The
chain was not pushed to `mock-main`; TST-14 requires bounded cleanup precedence and
opaque-canary durable/public regression coverage before integration.

## 2026-08-30 — F-01/02 integration blocked by TST-13 stderr exposure

The Auditor reviewed exact unintegrated candidate `685e4ff`. Focused runner,
executor and service passed 72/72; API/store/container-service/state-machine/
recovery/verifier adjacency passed 66/66; literal `npm run check` passed launcher
3/3, Server 606/606 plus two explicit opt-in skips, Web 17/17, strict test/source
types and both builds. Typed timeout/execution identity, untyped unknown,
cancellation precedence, durable state codes, ownership release and no-promotion
behavior were correct. No live/model/UI call ran.

Independent security fallback found one Medium defect: arbitrary parsed Runtime
error/stderr remains in `RuntimeExecutionError.message`; bounded secret/path
redaction does not remove opaque attacker/runtime-controlled text, which is then
persisted and publicly exposed through Contract, Plane, Mission, Agent, event,
reload and DTO surfaces. F-01/02 was not pushed to `mock-main`. TST-13 requires a
fixed public execution message plus a causal opaque-stderr canary across the full
runner → executor → service boundary before integration.

## 2026-08-30 — OPS-06 diagnostics integrated; TST-12 audited

The Auditor integrated exact corrected chain `68dbd59` into `mock-main`. Focused
runner/executor/config/service/live-runtime tests passed 95 with one explicit live
skip. Literal `npm run check` passed launcher 3/3, Server 602/602 plus two explicit
opt-in skips, Web 17/17, strict test/source types and both builds. Hosted Node 22
required-check run `33274769957` passed.

Independent security fallback returned READY with no finding. The planted cleanup
fault is absent from message, String, stack, deep inspection, JSON and cause
surfaces; private-home cleanup continues, the preflight cache resets and a clean
retry succeeds. Typed diagnostics, non-root/private-home/network/version gates,
output bound, secret exclusion and owner-scoped cleanup remain fail-closed. No
live/model call ran. TST-12 is closed at scoped 100%; OPS-06 has `T,A,C,S,I`
evidence, but affected collaborator/macOS `L` remains explicitly unverified and no
macOS compatibility claim is made.

## 2026-08-30 — TST-12 executor preflight redaction candidate

The Fixer reproduced the source-confirmed Medium leak on exact Auditor evidence
`ed3ceb6`: an injected cleanup failure containing planted secret, private macOS
path and OS diagnostic text emerged unchanged as the uncaught executor preflight
rejection's `Error.cause`. Inspection-capable startup handling could therefore
expose detail despite the fixed outer message.

The minimal executor correction removes the raw cause and rejects with only
`Live Shepherd Runtime preflight failed (stage=cleanup reason=cleanup_failed)`.
The causal regression checks the Error message, String conversion, stack,
`util.inspect`, JSON serialization and cause inspection; none contains the planted
detail. Cleanup remains fail-closed, both mount removals are still attempted, the
cached failure permits a bounded retry, and the existing primary container-start
stage/reason assertion is unchanged. No runner mapping, non-root/read-only-home,
socket-denial, exact-version, output-cap, owner cleanup, fallback, UI or dependency
behavior changed.

Focused cleanup/primary rows passed 3/3. Adjacent config, runner, executor, service
and live-runtime coverage passed 95 tests plus one explicit opt-in skip. Strict
Server test typecheck passed. Two literal `npm run check` gates each passed launcher
3/3, Server 602/602 plus two opt-in skips, Web 17/17, strict types and both builds.
Dependency, diff, credential and artifact/root scans were clean. No live, model or
external request ran. Independent security fallback passed executor/runner 34/34
and strict test typecheck with no High, Medium or Low finding. Affected-macOS
validation and hosted Auditor integration remain required before OPS-06 is audited.

## 2026-08-30 — OPS-06 integration blocked by TST-12 security finding

The Auditor rebased candidate `5a1aef9` onto audited `mock-main` as local
`34477e8`. Focused runner/executor tests passed 186/186 and literal `npm run check`
passed launcher 3/3, Server 601/601 plus two explicit opt-in skips, Web 17/17,
strict test/source types and both builds. No live/model request ran.

Configured `security-reviewer` was unavailable; independent read-only fallback
found one Medium defect. Executor-side preflight mount cleanup attaches raw
`cleanupError` as `Error.cause`; an uncaught startup failure may render a private
path or OS detail even though runner stage/reason diagnostics are closed enums.
The remaining typed mapping, fail-closed sandbox/private-home/non-root/version
gates, output cap, raw stderr discard and owner-scoped cleanup were READY. OPS-06
was not pushed to `mock-main`; TST-12 requires a fixed bounded executor cleanup
error and planted-path causal regression before integration or macOS validation.

## 2026-08-30 — OPS-06 bounded live-preflight diagnostics candidate

The Fixer source-traced the macOS message loss without a live/model request:
`ContainerCodexRunner.isEphemeralAvailable` caught create/start/output/cleanup
failures into one boolean. The candidate uses a closed typed result limited to safe
stage/reason enums. Explicit exits distinguish non-root, private-home denial,
Codex-version and sandbox listen/connect/generic probe classes; unknown engine
failures discard raw content. No path, command, secret, endpoint, prompt, stderr or
fallback is exposed.

All original gates remain mandatory: non-root, read-only root with bounded tmpfs,
writable workspace, denied private-home write, denied listen/connect, exact version,
bounded output, success marker and owner-scoped cleanup. Cleanup failure overrides
success. Runner/executor tests passed 33/33; config/runner/executor/service/default-
live adjacency passed 87 plus one opt-in skip; production/strict Server typechecks
passed. Independent security review found no issue; its mapping/cleanup coverage
note was closed with final table and cleanup regressions. Two final literal checks
passed: launcher 3/3, Server 601/601 with two opt-in live skips, Web 17/17, strict
test projects and both builds. Diff, credential, dependency and artifact scans
passed before commit.

No live/model call ran. Mocked Linux/engine evidence is not affected-macOS evidence:
macOS validation and Auditor integration remain pending, with no compatibility
bypass or full OPS-06 claim.

## 2026-08-30 — E2E-02, TST-10 and TST-11 independently audited

The Auditor integrated exact corrected chain `338f1e4` into `mock-main` only after
four focused real-backend deterministic journeys passed. Harness units passed
14/14 across those invocations; all 52 screenshot observations were reviewed;
13/13 named claims were visibly supported at both 1280x800 and 1440x900; and all
26 final hashes were unique. Exact stages 06, 09, 10 and 11 visibly showed
promotion start, selected Candidate evidence, distinct final re-verification and
rejected Candidate evidence with positive pane/drawer/browser intersection.

Full harness passed unit 7/7 plus Chromium 12/12. Literal `npm run check` passed
launcher 3/3, Server 592/592 plus two explicit opt-in skips, Web 17/17, strict
test/source types and both builds. Independent rendered/security fallback returned
READY with no finding; no production UI/CSS, live/model/network request, secret,
private path, residual process/root or tracked artifact was introduced. Hosted
Node 22 required-check run `33273947769` passed on the integrated implementation.
This closes only E2E-02/TST-10/TST-11; `GC-06` and `UI-02` remain unclaimed.

## 2026-08-30 — TST-11 visible drawer-evidence candidate

The Fixer reproduced the Auditor's four visual REDs on exact parent `041521b`:
stages 09 and 11 at both viewports showed Plane metadata while their named selected
or rejected Candidate verification summaries remained below the internally
scrolling drawer. DOM text assertions alone did not prove screenshot visibility.

The test-only correction scrolls each exact evidence summary inside
`.detail-drawer`, asserts positive intersection with both the drawer content
viewport and browser viewport, and then requires that marker visibly present before
capture. It preserves stage 10's ArrowRight/focus/selected final-promotion evidence,
TST-10's promotion-event visibility, Escape/opener focus, and all functional and
security assertions. No production, frontend, CSS, theme, timeout, retry, sleep,
dependency, live or model behavior changed.

Two focused invocations passed both viewports (4/4 journeys; 52 capture
observations). Manual review of every final image confirmed all 13 named semantic
claims visibly present at both viewports, and all 26 PNGs had unique hashes. Full
harness passed unit 7/7 and Chromium 12/12. Two literal `npm run check` gates each
passed launcher 3/3, Server 592/592 plus two explicit opt-in skips, Web 17/17,
strict server/web test typechecks and both builds. Dependency, cleanup, ignored
artifact, bounded-output, diff and visual-theme review were clean. No external,
live, model or network request ran. Independent hosted Auditor integration remains
required before TST-11 or E2E-02 can be called audited.

## 2026-08-30 — E2E-02 remains blocked by TST-11 drawer evidence

The Auditor independently verified TST-10 on exact corrected chain `79da51a`:
two focused invocations passed harness unit 14/14 and Chromium 4/4; each corpus had
26/26 unique hashes; stage 05/06 differed at both viewports; and promotion start
was visibly intersecting the Contract pane. All 52 captures were inspected. Full
harness passed unit 7/7 plus Chromium 12/12. Literal `npm run check` passed launcher
3/3, Server 592/592 plus two explicit opt-in skips, Web 17/17, strict types and
builds. Dependency audit, diff, ignored-artifact, process/root cleanup, UI and
security scans were clean. No live/model/network request ran.

Before integration, a second independent exhaustive semantic manifest review found
`TST-11`: stage 09 selected-candidate evidence and stage 11 rejected-candidate
evidence show only Plane header/metadata at both 1280x800 and 1440x900. Their DOM
text exists below the internally scrolling drawer but is not in the capture. The
other eleven stage markers are visibly supported in both viewports, and all hashes
are distinct. The minimal correction is test-only scrolling plus drawer/browser
intersection proof for the exact candidate-evidence region before stages 09/11;
stage 10 final evidence and TST-10 must remain intact. Candidate `79da51a` was not
pushed to `mock-main`; E2E-02 and hosted integration remain blocked.

## 2026-08-30 — TST-10 visible promotion-stage candidate

The Fixer reproduced the preserved E2E-02 visual RED on the exact candidate plus
Auditor evidence: stage 05 and stage 06 were byte-identical at both 1280x800 and
1440x900. The DOM assertion located a promotion-start event below the internally
scrolling Contract pane, so it did not establish visible screenshot evidence.

The test-only correction selects the exact persisted `promotion_started` event,
scrolls that card into `.event-list`, asserts positive intersection with both the
pane and browser viewport, and compares the written stage-05/stage-06 PNG bytes.
No production, frontend, CSS, theme, timeout, retry, sleep or dependency changed.

Two corrected focused invocations passed both viewports (4/4), yielding 52 capture
observations. The final 26-file corpus had 26 distinct hashes and every image was
manually inspected; stage 06 visibly shows “Started final authority and independent
verification gate,” while stage 05 remains a distinct candidate-outcome view. Full
harness passed unit 7/7 and Chromium 12/12. Strict test typecheck and two literal
`npm run check` gates passed, each with launcher 3/3, Server 592/592 plus two
explicit opt-in skips, Web 17/17, strict types and both builds. Dependency,
cleanup, ignored-artifact, bounded-output, diff and visual-theme reviews were clean.
No live/model/network request ran. Independent hosted Auditor integration remains
required before TST-10 or E2E-02 can be called audited.

## 2026-08-30 — E2E-02 candidate audit blocked by TST-10 visual evidence

The Auditor reviewed exact candidate
`85550e0a6c6c8f2263375943b22271d72c814c05` without pushing it to
`mock-main`. Its diff is five test/harness/docs files (+420/-2) and contains no
production or UI change. Two focused invocations passed harness unit 14/14 and
Chromium 4/4 across 1280x800 and 1440x900. Full harness passed unit 7/7 plus
Chromium 12/12. Literal `npm run check` passed launcher 3/3, Server 592/592 plus
two explicit opt-in skips, Web 17/17, strict typechecks and both builds; dependency
audit reported zero vulnerabilities. API/Git/store assertions prove the immutable
base, two verified Contracts, exact semantic collision, cookie selection, bearer
rejection, distinct final evidence, protected-main output, preserved loser,
Shepherd-authored Project Group lifecycle, 401 boundary, no network/model use,
source/outside-canary safety and exact reset/process/port/container/root cleanup.

Independent review found `TST-10`: stage 05 and stage 06 are byte-identical at
both viewports (1280 hash `66159d4f...`; 1440 hash `f35e34c3...`). Although the DOM
assertion proves the promotion-start event exists, it is below the internally
scrollable contract pane and is absent from the named stage-06 capture. Therefore
only 24/26 screenshots are distinct, and “13 material stages” is not yet supported
visually. The minimal correction is confined to scrolling and intersection-proof
inside `shepherd-hero.spec.mjs`; no product/UI/theme change, wait inflation or
assertion weakening is authorized. E2E-02 remains blocked and unintegrated. No
live/model request ran.

## 2026-08-30 — UI-04 and verifier fixture integrated audit

The Auditor integrated the bounded verifier fixture, UI-04 frontend correction and
explicit keyboard audit at `412a010`. Independent gates passed: fixture/harness
7/7, Web 17/17, focused Chromium 2/2 twice, full Chromium 10/10 at 1280x800 and
1440x900, and literal `npm run check` with launcher 3/3, Server 592/592 plus two
opt-in skips, Web 17/17, strict types and builds. Screenshots showed the final
promotion marker under the promotion event and distinct candidate/final drawer
tabs without overflow/theme drift. Tab, Space, arrows, Home, End, Enter, Escape,
focus-visible and opener restoration passed. Planted private fields stayed absent
from API/DOM/store/log surfaces.

The fixture accepts only the exact independent-verifier create/start/rm/ps
protocol and validates network-none, readonly/non-root/capability/resource/tmpfs/
environment/check allowlists with bounded output and cleanup. It introduces no
production debug or live path. Configured custom security/UI reviewer roles were
unavailable; independent manual fallbacks found no material issue. Dependency and
artifact scans were clean. Hosted Required checks run `33271397185` passed. UI-04
is audited scoped 100; the fixture prerequisite is integrated, while E2E-02 remains
incomplete and ready for Worker continuation. No live/model call ran.

## 2026-08-30 — UI-04 truthful promotion evidence candidate

The Fixer preserved the API/DOM RED, then changed only Shepherd frontend, scoped
styles and tests. Completed promotion events now bind final promotion
re-verification evidence; candidate events retain candidate verification and a
promotion-started event cannot imply final evidence exists. The Resolution Plane
drawer exposes both safe stages through the existing compact filter visual language
with candidate default and one/none fallback. Roving tab focus, arrows/Home/End,
Tab/Enter/Space, focus-visible, drawer initial focus, Escape close, opener restore,
plane reset and drawer-local scrolling are covered. No backend/schema/API/model
authority or live behavior changed.

Observed local gates:

- causal Web helper/component 4/4 and full Web 17/17;
- harness unit 7/7; focused Chromium 2/2 and full deterministic Chromium 10/10
  across 1280x800 and 1440x900;
- both final screenshots visually preserved the Launchpad theme/layout with zero
  document/body X/Y overflow and readable candidate/final labels;
- planted private evidence ID/stdout/stderr/error values remained absent from body
  text and serialized DOM; public API private-field and store/log route-marker scans
  passed;
- strict test projects, Web build, and two final literal `npm run check` passes:
  launcher 3/3, Server 592/592 with two opt-in live skips, Web 17/17 and both builds;
- independent UI and security re-reviews passed with no remaining finding after
  roving tabs, drawer focus lifecycle and inactive-tab contrast were corrected.

No live/model request ran. Auditor integration/hosted evidence remains pending;
UI-04 is not audited and broader E2E-02 remains incomplete.

## 2026-08-30 — UI-04 promotion evidence misbinding reproduced

After final hosted run `33270319210` passed on `3846591`, the Auditor rebased the
bounded fake-container verifier fixture onto an isolated ownership branch and ran
a fresh 1280x800 browser/API reproduction. The real completed candidate contained
distinct verification and promotion evidence IDs. A route-scoped public-response
decoration assigned safe distinct summaries; expanding the real
`promotion_completed` event displayed the verification marker and omitted the
promotion marker. Screenshot inspection confirmed the wrong evidence under the
promotion card without unrelated theme/layout damage. Source inspection confirms
the same unconditional verification selection in `EventEvidence` and
`PlaneDetailDrawer`. Product code was not changed; UI-04 is ready for a minimal UI
selection fix and two-viewport regression.

## 2026-08-30 — MR-01/MR-03/TST-08/TST-09 integrated audit

Auditor gates passed at `35ec268`: config 27/27 plus one default live skip,
TST-08 returned 20/20 and paired 40/40, reviewer/service/config 165/165, harness
unit 6/6 and Chromium 8/8, and literal check with launcher 3/3, Server 592/592
plus two opt-in skips, Web 13/13, strict types and builds. Audit reported zero
vulnerabilities; diff, credential, snapshot and artifact scans were clean.

The corrected explicit live command was command attempt two overall but made the
only external reviewer request (1/1); the earlier attempt made zero. Bounded result:
`completed findings=2`. The test proved exactly one advisory event, unchanged
deterministic collision/winner/promotion, exact promoted HEAD, store/state secret
absence and live-root cleanup. The 21-byte ignored outcome file was read once and
removed. Hosted Required checks run `33270168480` passed. LIVE-01's reviewer
component is satisfied; its current live Shepherd Mission remains open.

## 2026-08-30 — TST-09 reviewer-only environment isolation candidate

Without making another live request, the Fixer corrected only the reviewer live
test and causal config coverage. The test now calls `loadConfig` with a clone of
the real process environment whose sole override is loopback `HOST`. This isolated
test never starts HTTP; actual Ark credentials/model/base URL, SHEPHERD model
resolution, all other configuration, the production reviewer predicate and
sensitive-value filter, and fatal authentication/configuration handling remain
unchanged. The source environment and ignored `.env` are not mutated.

Observed local gates:

- causal config plus default-skipped live file: 27 passed, one live test skipped;
  the package script still has both opt-in gates, exact test path, one worker,
  `bail=1` and retry 0;
- TST-08 exact row 20/20 and paired infrastructure rows 40/40;
- MR-03 reviewer/service/config matrix 165/165 and strict Server test typecheck;
- two literal `npm run check` passes: launcher 3/3, Server 592/592 with two
  opt-in live skips, Web 13/13, strict test projects and both builds.

External reviewer/model/network calls by the Fixer remain **0**. Independent
read-only security review passed with no finding; diff, dependency, credential and
live-artifact scans also passed. Auditor integration and the one explicitly
authorized live gate remain pending; this entry makes no audited or 100% claim.

## 2026-08-30 — TST-09: MR-03 live gate blocked before egress

The Auditor independently passed the TST-08 returned row 20/20, paired
infrastructure rows 40/40, MR-03 reviewer/service/config 164/164, adjacent 100/100,
harness unit 6/6 and Chromium 8/8, and literal `npm run check` (launcher 3/3,
Server 591/591 with two opt-in skips, Web 13/13, strict types and builds). Diff,
dependency, credential and exact snapshot-removal checks passed; MR-03 remains
schema/ref bounded and advisory-only.

After every deterministic gate was green, the explicit live-review command was
invoked exactly once with retry disabled. It failed during `loadConfig`, before
reviewer construction or network egress, because the local non-loopback runtime's
`APP_AUTH_TOKEN` was a placeholder/too short. External reviewer call count was
therefore **0**. No retry was made, no live root remained, and no secret or raw
configuration value was printed. MR-01/MR-03 `L` and integration remain open.

## 2026-08-30 — TST-08 returned-evidence teardown quiescence candidate

The Fixer preserved the literal-gate RED and isolated 20/20 scheduling evidence,
then changed only the returned-infrastructure test fixture. It now coordinates both
Contract arrivals, attaches the Mission rejection observer immediately, captures
and validates the exact contained sibling `VerificationRequest.planePath`, proves
rejection precedes removal, arms an exact-basename watcher before release, and
joins the sibling, Mission and removal in `finally`. This closes the fixture's
background-work gap without changing production, MR-03, the cleanup walker,
timeouts, retry behavior or assertions. No live/model request ran.

Observed local gates:

- exact returned-infrastructure row 20/20 and paired thrown/returned rows 40/40;
- MR-03 reviewer/service/config matrix 164/164;
- service/container/API/store/recovery adjacency 82/82;
- strict Server test-source typecheck;
- two literal `npm run check` passes: launcher 3/3, Server 591/591 with two
  opt-in live skips, Web 13/13, strict test-source projects and both builds;
- diff, credential and stale trusted-snapshot cleanup scans passed. Auditor
  integration/hosted evidence and MR-03's single bounded live gate remain pending,
  so this entry makes no audited or 100% claim.

## 2026-08-30 — MR-03 integration blocked by TST-08

MR-03 merged conflict-free locally as `3c878b3` but was not pushed to `mock-main`.
The focused reviewer/service/config matrix passed 164/164, adjacent service/API/
store/F-03/recovery/container passed 100/100, and deterministic harness passed unit
6/6 plus Chromium 8/8. Literal `npm run check` then failed one of 591 executed
Server tests: returned Contract verification infrastructure evidence reached
teardown while a sibling exact trusted snapshot root was removed, producing
`makeDeletable -> realpath -> ENOENT`. The isolated row passed 1/1 and 20/20,
supporting a scheduling-dependent test coordination gap rather than an MR-03
product regression. No live/model request ran (call count zero). Ownership was
published on `audit/tst-08-mr03-cleanup`; MR-03 integration/live remains blocked.

## 2026-08-30 — MR-01/MR-02 integrated audit

The Auditor integrated the controlled MR-01 merge and truthful MR-02 capability
correction on `mock-main` at `577255e6f4980499f032451d18557f8eefcf80ef`.
Independent local gates passed: reviewer/config/service 173/173, Settings 5/5,
adjacent service/API/store/recovery/state/container 100/100, harness unit 6/6 and
Chromium 8/8 at both required viewports. Four MR-02 screenshots were inspected:
configured and unavailable states preserve the accepted theme with no document
overflow or clipping. The literal repository gate passed launcher 3/3, Server
588/588 with two opt-in live skips, Web 13/13, both strict test typechecks and both
builds. Dependency audit reported zero vulnerabilities; credential/private-output
and tracked-artifact scans were clean. Configured reviewer roles were unavailable;
independent manual security/UI review found no material issue, consistent with the
candidate's prior independent fallbacks. Hosted Node 22 Required checks run
`33268567614` passed. No live/model call ran. MR-01 remains below final scoped 100
until MR-03 and one bounded live reviewer gate; MR-02 is audited scoped 100.

## 2026-08-30 — MR-02 truthful reviewer capability candidate

The Fixer reproduced the no-reviewer mismatch before product edits: persisted
`modelReviewEnabled=true` rendered as an enabled “Run advisory” control and allowed
false/true PATCH even though production composed no reviewer. The candidate adds
one public `shepherdModelReviewConfigured` boolean, computed from the same
fail-closed startup predicate used by `index.ts`. Settings preserves the stored
preference but renders the existing native toggle disabled with explicit
**Unavailable** process-scoped copy when false; configured mode remains editable.
No credential, model, endpoint or failed-predicate reason is exposed, and no live
request ran.

Observed local gates:

- causal Server 12/12 and Settings component 5/5;
- reviewer/config/API adjacency 71/71 and harness unit 6/6;
- dedicated Chromium 2/2 at 1280x800 and 1440x900, proving zero PATCH while
  unavailable, exactly two successful mouse/keyboard PATCHes while configured,
  persisted state, disabled/status semantics, no overflow and no fixture secret in
  persistence, DOM or logs;
- full deterministic Chromium 8/8; four screenshots under ignored `.tmp` were
  visually inspected without theme/layout drift;
- strict Server/Web test typechecks, two literal `npm run check` passes, clean diff
  and credential/root scans, and `npm audit` with zero vulnerabilities;
- independent read-only security review passed with no findings. The configured
  UI reviewer role was unavailable; a read-only fallback UI review passed with no
  Critical/High/Medium finding and only the non-blocking absence of stored-off
  browser screenshots (covered by component tests). Auditor integration/hosted
  evidence remains pending, so this entry makes no audited or 100% claim.

## 2026-08-30 — MR-01 local audit and MR-02 reproduced blocker

The Auditor published ownership branch `audit/mr-01-integration`, then merged
current `main` `403fc095b07d60e17de1cb3f82b4e16b6a778919` locally into
`mock-main` as `1422fd6` without pushing `mock-main`. The resulting tree exactly
matched the precomputed conflict-free merge tree `804aa74c`. It preserves the
audited F-03/TST/service work, strict Server/Web tests, E2E harness and both CI
workflows while adding MR-01's 14-file bounded reviewer composition.

Line review confirmed that only verified Contracts contribute bounded trusted
objectives, ingested manifest summaries, valid corroborated claims, non-protected
changed files and committed diff summaries. Closed runtime validation restricts
result keys, enums, contract pairs and evidence references. The service consumes
no finding value: it records only sparse bounded advisory metadata, returns void,
then runs unchanged deterministic collision/candidate/winner/promotion logic.
Deadline and durable cancellation win over an abort-ignoring reviewer; configured
sensitive values are excluded/rejected. The independent security fallback found no
High/Medium issue and returned READY for this provider-free scope. Configured
`security-reviewer` was unavailable. MR-03 partial-finding behavior and the single
final live reviewer gate remain deliberately pending; no network/model call ran.

Observed local gates:

- model-reviewer adapter/schema/evidence/redaction, MR service 14-case matrix and
  readiness config: 3 files, 161/161;
- Settings rendering: 1/1; API/store: 31/31;
- F-03/service/container-verifier/recovery/state-machine adjacency: 69/69;
- deterministic harness: Node 6/6 and Chromium 6/6;
- literal `npm run check`: launcher 3/3, Server 587/587 with two opt-in live files
  skipped, Web 9/9, both strict test-source projects and both builds.

The dedicated real-browser audit passed 2/2 at 1280x800 and 1440x900 for real
Tab/Enter/Space focus semantics, true→false→true PATCH persistence, advisory
degradation event visibility, exact viewport/document/body overflow, screenshots,
and absence of auth/private/raw-prompt text. It also reproduced MR-02 causally:
the real no-Ark process reports `arkConfigured=false` while persisted
`modelReviewEnabled=true`; Settings presents an enabled checked “Run advisory”
toggle with no unavailable/not-configured state, and both PATCHes succeed even
though production deliberately composes no reviewer. Therefore the preference
cannot cause a call or outcome and silence can look like “no findings.”

MR-02 owns the minimal fix: preserve preference, expose only bounded server-derived
reviewer capability/operational truth, and reuse current Settings/event visuals.
Never expose/probe credentials, model IDs, endpoints, prompts or provider state in
the browser. MR-01 remains a passing provider-free local candidate, but is blocked
from `mock-main` integration and cannot claim `I` or `L` until MR-02 is corrected;
MR-03 should integrate before exactly one final sparse live review.

## 2026-08-30 — deviations hard-ledger reconciliation

The Auditor reconciled every section of `docs/DEVIATIONS.md` against the PRD,
current `mock-main`, exact tested evidence and the canonical task/defect ledgers.
Each item is now classified as a clarification, actual deviation, environment
limitation or permanent PRD scope statement, with explicit OPEN/PARTIAL/RESOLVED
status and existing task IDs. No new task ID was required. The correction prevents
backend-only or hosted-only evidence from closing browser/live/second-machine
requirements, identifies completed-Plane cleanup as an allowed future policy rather
than a shipped automatic cleaner, and makes every actual deviation completion-
blocking until its named gates pass.

A fresh GitHub/ref audit also found PR #16 (`MR-01`) merged to current `main` as
`403fc095b07d60e17de1cb3f82b4e16b6a778919`; it is therefore no longer externally
held, but it is not yet an ancestor of `mock-main` and remains unaudited integration
work. Draft PR #25 (`MR-03`) remains the sole external hold. This was a read-only
ownership check; no product branch was merged and no live/model request was made.

## 2026-08-30 — GC-01 and TST-07 integrated audit

The Auditor merged current `main` `662a7e7` into the previously audited
`mock-main` line as merge `c834c39`, preserved every prior audited mock commit,
then integrated the test-ownership correction as `de3e631`. The effective product
change is the bounded GC-01 parser-safe mention helper and Project Group buttons;
TST-07 only moves the complete eight-case regression to Web ownership and adds
explicit Web Vitest/strict-test configuration plus root scripts and the matching
lockfile entries. Server JSX/rootDir, product authority, Shepherd lifecycle, CSS
and schemas are unchanged. Both CI workflows are retained: `required-checks.yml`
remains the stable push/PR/merge-queue Docker gate, while the main-sourced
`pull-request-checks.yml` is a narrower PR/merge-queue duplicate that should be
consolidated only as a separately owned CI task.

Independent focused evidence passed: Web GC 8/8, full Web 9/9, Server group
routing 10/10, strict Server and Web test typechecks, `npm ci`, and `npm audit`
with zero vulnerabilities. The real browser protocol passed 2/2 at 1280x800 and
1440x900 for mouse and real Tab/Enter/Space activation, focus-visible and composer
refocus/caret, multiline preservation, safe/spaced/escaped/Unicode/NFKC/ID-fallback
mentions, exact 2,000 acceptance/2,001 unchanged rejection, in-flight native
disable/no duplicate submission, parser-exact Agent ID, zero document/body X/Y
overflow, and absence of the auth token/private run root in rendered text. The
top-of-page frame places the composer partly below the visible area when the
runtime banner is present; the accepted internal main-content scroll brings the
entire composer/helper/send control into both viewports with no overlap. This is
recorded honestly as a Low UI-GATE framing item, together with the mention button's
subtle disabled visual distinction; it is not a document-overflow or GC-01 blocker.
The configured `ui-reviewer` role was unavailable, so an independent read-only
fallback inspected both frames and the source.

The full deterministic harness passed Node 6/6 and Chromium 6/6. Literal
`npm run check` passed launcher 3/3, Server 563/563 with one unchanged opt-in live
skip, Web 9/9, both strict test-source projects and both production builds. No
live/model call was made. Hosted Node 22 Required checks run
`33266624301` passed on `de3e631`. GC-01 and TST-07 are therefore independently
audited at scoped 100%; this does not claim GC-03/04 targeted lifecycle completion.

## TST-07 correct Web test ownership candidate

**Date:** 2026-08-30 (Asia/Singapore)
**Branch/base:** `fix/mock-main` from canonical blocker head `6e4e230`

The Fixer reproduced the required strict RED exactly: Server test typecheck exited
2 with TS6142 for the imported Web TSX component and TS6059 for the Web formatter
outside Server `rootDir`. The cause was test packaging, not formatter/parser/UI
behavior. The complete eight-case GC-01 regression moved from Server to Web. Web
gained explicit Vitest and strict test-source configuration/scripts, while root
`test` and `typecheck` now execute both workspaces. The production component,
formatter, parser, Server JSX/rootDir and every assertion remain unchanged.

Observed candidate evidence:

- relocated Web regression 8/8 and adjacent Server group-routing 10/10 passed;
- strict Web and Server test-source checks passed; Web production typecheck/build
  passed;
- literal `npm run check` passed twice: launcher 3/3, Server 563/563 plus one
  unchanged opt-in live skip, Web 9/9, strict/production typechecks and both builds;
- `npm ci --ignore-scripts --dry-run` completed from the lockfile and `npm audit`
  reported zero vulnerabilities; `git diff --check` passed;
- diff is limited to test relocation, Web/root test configuration and scripts,
  lockfile, and TST-07/GC-01 evidence docs. Default tests remain model/network-free
  with Web Vitest temp output under repo-local `.tmp/web-tests`.

This is a candidate, not an audit/100% claim. GC-01 still requires independent
two-viewport browser interaction plus integrated/hosted gates; TST-07 `I` is pending.

## TST-07 blocks current-main / GC-01 integration before push

**Date:** 2026-08-30 (Asia/Singapore)
**Ownership branch:** `test/tst-07-gc-01-strict-typecheck`
**Local merge:** `c834c3907abe84fb0bd79250ac93c2bbf78c87c0`
**Source main:** `662a7e7d2f54cd7eb6e6f33aa761a1d06901f609`

The Auditor real-merged current `origin/main` into audited `mock-main` head
`5469c1f` only on the dedicated ownership branch. All prior audited mock commits
remain ancestors and the effective main delta is GC-01, its evidence docs and the
second CI workflow. Nothing was pushed to `mock-main`.

The first required gate produced a deterministic RED:

```text
npm run typecheck:tests -w @launchpad/server
src/project-group-mention.test.ts(5,43): TS6142: Web ProjectGroupPage.tsx was
resolved, but --jsx is not set
src/project-group-mention.test.ts(11,8): TS6059: Web project-group-mention.ts is
outside apps/server/src rootDir
exit 2
```

The new Server test imports both Web TSX and a Web helper. That packaging made the
test discoverable by the default Server Vitest suite on main, but violates the
strict test-source ownership gate already audited on `mock-main`. Literal
`npm run check` is therefore known red and was not misreported or rerun broadly.
No browser/full/hosted GC-01 acceptance claim is made from this branch.

`TST-07` owns the minimal test-only correction: place formatter/component and
production parser round-trip coverage under correctly discovered, strictly typed
workspace ownership without broadening Server JSX/rootDir, suppressing/excluding
tests, weakening the multiline/disabled/exact-boundary/ID assertions, or changing
product code. GC-01 remains integration-blocked until Fixer correction and the full
Auditor gates pass.

## TST-05/TST-06 and E2E-01 independent integration closeout

**Date:** 2026-08-30 (Asia/Singapore)
**Candidate:** `e1d9c349226913a1192702fab3fa21c36514055e`
**Integrated implementation:** `f6df2d9503a3a482da2cb2882eb913ca2285501c`
**Committed review evidence:** `284994d`

The candidate was exactly one commit above canonical docs head `3b9137b`. Its diff
contains only harness fixtures/support, Playwright configuration/scripts/tests and
canonical evidence docs: no production React, CSS, server, service, schema,
dependency or debug-route change. The prior E2E candidate and stale screenshot set
were not integrated.

Independent gates passed:

- harness unit 6/6 and Chromium 6/6 at exact `1280x800` and `1440x900`, repeated
  three times (unit 18/18 and browser 18/18 total); every run left no `run-*` root;
- all 16 E2E stages and four adjacent harness/UI-03 ephemeral images were visually
  inspected. Create is reachable at 1280 through the existing inner scroll and has
  the established purple focus outline; empty, active, completed, stopped and
  restarted states preserve the accepted Launchpad theme without document X/Y
  overflow, clipping or overlap;
- actual Tab traversal, focus-visible treatment and Enter activation passed for
  Create, Stop and Start. The journey also proved 401/auth, disabled active composer,
  exact two-turn fake thread continuity, exact hello files and independent Node
  artifact tests 2/2, outside canary and symlink confinement, port closure, same-root
  restart, durable Agent/messages/runs/files, and bounded public/store/DOM/log scans;
- strict server test-source typecheck and literal `npm run check` passed with
  launcher 3/3, server 563/563 plus one unchanged opt-in live skip, all typechecks
  and both builds;
- default screenshots went only to ignored `.tmp`. Hash sets for all tracked review
  images were identical before and after each ordinary run. The explicit evidence
  command passed 2/2 and wrote exactly 16 intended `docs/ui-review/e2e-01` PNGs,
  with no blank down-state or unrelated evidence; a subsequent ordinary full
  harness again left those files byte-identical;
- secret values reach only boolean comparisons, not matcher formatting; live trace,
  screenshots and video are disabled; retries remain zero; live entry requires the
  exact opt-in and preserves the two-turn cap, loopback binding, bearer auth, child
  environment allowlist and empty live `SHEPHERD_MODEL`. Repository, `.tmp`, harness
  and run-root identities are lstat/realpath checked before allocation/removal.
  Causal tests cover ancestor symlink rejection, retained-root cleanup after restart
  failure, fresh setup-failure cleanup and reusable-root rejection. No credential,
  private path, live artifact or retained root was found.

Configured `ui-reviewer` and `security-reviewer` roles were unavailable. An
independent rendered fallback re-reviewed the exact 20 ephemeral PNGs and returned
READY with no severity finding; the Auditor's independent security review found no
High/Medium issue. Low residuals remain for hostile same-user mutation between
identity check and recursive removal and exceptional spawn/concurrent-mkdir timing;
these are bounded local-test-harness conditions and not production authority.

The previously authorized live legacy evidence was accepted without another call:
exactly two successful ARK turns, no retry, one real Codex thread, generated artifact
test 2/2, restart persistence, bounded/redacted evidence and cleanup, with no
Shepherd Mission/model-review invocation. This closes only the PRD 11.6.1 baseline;
`LIVE-01` remains open for its separately scoped Shepherd/model-review smoke.

Hosted Required checks run
[`33265640400`](https://github.com/kyashp/shepherd/actions/runs/33265640400)
passed Node 22, Docker, locked install and literal repository gate in 1m42s.

**Verdict:** `TST-05` and `TST-06` are **AUDITED at scoped 100%** with 5/5 gates;
`E2E-01` is **AUDITED at scoped 100%** with `C,B,L,S,U,I` 6/6.

## TST-05/TST-06 deterministic E2E harness correction candidate

**Date:** 2026-08-30 (Asia/Singapore)
**Branch:** `fix/mock-main` (pending commit/Auditor integration)

The Fixer imported the unintegrated E2E-01 harness candidate without its stale
ledger or screenshots, then changed only test/harness/configuration files. Ordinary
screenshots now go to ignored `.tmp/playwright-evidence`; only the explicit
`npm run test:e2e:starter-kit:evidence` mode writes review images. The empty
server-down canvas was removed: the test records only the observed closed port and
reserves reconnect UI for E2E-08. At both viewports the existing Create form is
scrolled until its primary action is visible, and Create, Stop and Start are reached
with actual Tab focus, checked for the existing focus-visible outline, and activated
with Enter. No production or UI/theme file changed.

Harness assertions no longer pass credentials or sensitive bodies to matcher
formatting. Live Playwright trace, screenshot and video are off. Exact live opt-in,
two-turn/no-retry limit, loopback binding, bearer auth, child environment allowlist
and empty live `SHEPHERD_MODEL` remain. The repository, `.tmp`, harness and selected
run-root identities are lstat/realpath checked before allocation/removal. Added fault
tests reject a repo-contained symlinked harness ancestor without following it and
prove a previously retained stopped root can be removed after a restart failure.

Observed evidence, with no live/model call:

- harness unit: 6/6 passed, including ancestor-symlink, retained-root restart and
  fresh-allocation setup-failure cleanup tests;
- deterministic Chromium: 6/6 passed in 17.5 seconds at exact `1280x800` and
  `1440x900`; all 16 E2E-01 stage captures were visually inspected under ignored
  output and the four adjacent harness/UI-03 captures were produced there too;
- tracked `docs/ui-review` SHA-256 sets were identical before/after the ordinary
  run; `git diff -- docs/ui-review` was empty and no server-down image was produced;
- strict server test-source typecheck passed; literal `npm run check` passed twice,
  each with launcher 3/3, server 563/563 plus one unchanged opt-in live skip, all
  typechecks and both builds;
- `git diff --check` passed; stale roots created by the initial controlled failing
  iteration were explicitly confined and removed, and the final harness root had
  no `run-*` child.

The earlier independently bounded live legacy evidence remains exactly two
successful turns with no retry. It was not invoked again. `TST-05`, `TST-06` and
`E2E-01` remain candidates pending independent UI/security/integrated/hosted audit;
no `U` or `I` gate is claimed here.

An independent read-only security review found the initial candidate could retain a
freshly allocated root when setup failed before child spawn. The transaction was
extended over every post-allocation pre-spawn setup step and the new missing-Codex
fault regression proves the harness root returns to the exact prior `run-*` set.
Independent re-review closed the Medium finding and found no remaining High/Medium
issue. Low local residuals remain for same-user mutation between identity validation
and recursive removal, an exceptional synchronous `spawn()` throw, and theoretical
concurrent sibling mkdir completion after a `Promise.all` rejection. These require
adversarial or exceptional concurrent conditions outside this local harness threat
model; no broad filesystem refactor was attempted.

## E2E-01 independent audit rejection: visual evidence and failure-path safety

**Date:** 2026-08-30 (Asia/Singapore)
**Candidate:** `592699d140145165c5ca0d9511478171e5051271` (parent `949cec1`)

The Auditor reviewed the exact candidate in an isolated worktree. It remains
**unintegrated**. No candidate product, test, screenshot, or documentation file was
cherry-picked to `mock-main`.

Passing evidence was substantial but insufficient for integration: harness unit
tests passed 3/3; Chromium passed 6/6 across exact `1280x800` and `1440x900` projects;
strict server test-source typecheck passed; and literal `npm run check` passed with
launcher 3/3, server 563/563 plus one unchanged opt-in live skip, all typechecks and
both builds. All 18 regenerated E2E captures were manually inspected. The previously
bounded live evidence remains exactly two successful legacy ARK turns, no retry,
one real Codex thread, generated artifact/test 2/2, restart persistence, redacted
evidence and cleanup; the Auditor did not consume another live call.

Two blocking gates failed. First, the successful routine harness run modified 16 of
18 tracked E2E-01 PNGs and the unrelated tracked UI-03 1280 PNG. Only the two
server-down files stayed byte-identical. Both were blank white canvases: the test
asserts the port closed, catches reload failure, then screenshots without any DOM or
visible-state assertion. Calling that a visually inspected application down state
overclaims the evidence. The 1280 Create Agent image also does not demonstrate that
the primary action is reachable, and actual Tab/focus-visible/lifecycle keyboard
coverage is incomplete. This is recorded as `TST-05`; production UI and the accepted
design must remain unchanged.

Second, source audit found failure-path safety gaps recorded as `TST-06`: a secret is
passed directly to Playwright matcher output; a retained run root cannot be cleaned
by a later idempotent stop after restart failure; managed harness ancestor symlinks
are not canonically rejected before temporary-root creation/removal; and opt-in live
failure traces/screenshots may retain prompts or output. These require causal fault
tests and the narrow redaction/confinement/cleanup changes in `FIXES.md`, without
broadening environment or filesystem authority.

**Verdict:** E2E-01 remains blocked and unintegrated. `TST-05` and `TST-06` must pass
their targeted, browser/security-review, full, integrated and hosted gates before
the journey can be marked audited.

## TST-04 independent integration audit and hosted closeout

**Date:** 2026-08-30 (Asia/Singapore)

Auditor inspected the exact candidate and integrated it as
`00c81ae067961d43ee63acb777bf070ca808c113`. The diff changes only
`service.test.ts` and evidence docs. It leaves `makeDeletable`, product/service/
verifier/UI code, timeouts, retries, sleeps, behavioral assertions, sentinel checks,
path confinement and symlink rejection unchanged.

The captured backend `planePath` is resolved beneath the sentinel-owned case root,
with exact `.trusted-verification` parent and `verify-*` basename assertions. The
two-arrival barrier ensures capture before the selected frontend failure; the test
then observes typed Mission rejection while that root still exists. The watcher is
armed on the exact parent before sibling release, filters the exact basename, and
accepts quiescence only after `lstat` returns `ENOENT`. `finally` idempotently
releases all gates and joins the Mission, sibling return and conditional removal
promise without replacing the primary assertion failure.

Independent evidence: exact row 20/20 in 28 seconds; service/container-verifier
slice 43/43; strict test-source typecheck; literal `npm run check` twice in 38/40
seconds with launcher 3/3, server 563/563 plus one opt-in live skip and both builds;
integrated focused row 1/1; and `git diff --check`. Hosted Node 22 run
[`33263688794`](https://github.com/kyashp/shepherd/actions/runs/33263688794)
passed the locked install, Docker and literal repository gate in 1m42s.

**Verdict:** TST-04 is **AUDITED at scoped 100%**, `T,A,C,I` 4/4. E2E-01 is
unblocked. No live/model/browser request occurred.

## TST-04 exact verification-snapshot quiescence candidate

**Date:** 2026-08-30 (Asia/Singapore)
**Branch/base:** `fix/mock-main` / `4f7da60a4b45415fb6283eaa3a60360102875856`

The preserved RED is the full-suite `afterEach` failure recorded below: after all
typechecks, `makeDeletable -> readdir` received `ENOENT` beneath a sibling
`.trusted-verification/verify-*/src`, while the exact isolated behavioral row passed.
The disappearing owned path and order dependence implicated teardown beginning
before a sibling `withVerificationSnapshot` finalizer finished.

The correction is test-only. `SnapshotTrackingContractThrowingVerifier` records the
blocked backend request's real `planePath` and uses the existing two-arrival barrier,
so the selected frontend infrastructure failure is not released before the backend
snapshot is observable. The Mission promise gets an immediate success/rejection
observer. After the typed rejection, the test asserts the captured absolute root is
inside the sentinel-owned case root, its parent is exactly `.trusted-verification`,
its basename matches `verify-<uuid>`, and that exact directory still exists. This is
the controlled proof that fail-fast rejection precedes sibling snapshot cleanup.

Before releasing the backend, the test arms `fs.promises.watch` on the exact root's
parent. Its quiescence signal requires an event for the captured basename followed
by `lstat(capturedRoot)` returning `ENOENT`, bounded by the existing five-second
`settleWithin` helper. A `finally` block idempotently releases the Contract pair and
sibling and joins the Mission, sibling return, and removal outcome. The test cannot
finish into `afterEach` while that background snapshot cleanup remains active.
Existing typed terminalization, bounded diagnostics, ownership release,
no-collision/candidate/promotion and public/store assertions remain unchanged.

Observed GREEN evidence:

- focused causal row: 1/1 passed initially, 560ms test time;
- 20 independent exact-row invocations: 20/20 passed in 28s;
- service/container-verifier slice: 43/43 passed in 33.22s;
- strict server test-source typecheck: passed;
- literal `npm run check` passed twice under normal contention, 39s/39s each:
  production and strict test typechecks, launcher 3/3, server 563/563 with one
  opt-in live skip, and both production builds passed;
- `git diff --check`: passed.

No `ENOENT` was swallowed in `makeDeletable`; no sleep, retry, timeout increase,
cleanup-sentinel/path/symlink weakening, product/service/verifier/UI edit, or
live/model call occurred. `TST-04` is a **100% scoped candidate** with `T,A,C`
passed; integrated Auditor/hosted `I` remains pending. E2E-01 stays paused only on
that deterministic baseline audit.

## ST-02 main-to-mock integration audit

**Date:** 2026-08-30 (Asia/Singapore)

PR #13 merged to `main` as `d27dea670108e5a06eac20de7df88f756b68e404`.
The Auditor merged that mainline into `mock-main` as
`d5df930923503cf337f865f8c0361fa1b3bd8530`, retaining both histories in the sole
`BUILD_LOG.md` conflict. The effective product delta is only
`SettingsPage.tsx` plus its focused test: public Settings schemas/persistence and
all kernel, harness, strict-type, CI, UI-03 and TST-03 implementation remain intact.
No notification delivery, external integration, model request, or credential path
was added.

Observed independent evidence:

- focused static-render regression: 1/1 passed;
- web production typecheck and 40-module build: passed;
- real Chromium Settings audit at exact `1280x800` and `1440x900`: three disabled
  accessible notification controls, three **Reserved** labels, one **Unavailable**
  label, disabled controls skipped in Tab order, forced interaction sent zero
  Settings `PATCH` requests, and document/body X/Y scroll sizes equalled client
  sizes at both viewports;
- screenshots `docs/ui-review/st-02-settings/{1280x800,1440x900}.png` were inspected
  and preserve the accepted Launchpad theme with no clipping or overlap;
- deterministic harness unit 2/2 and Chromium 4/4 passed;
- literal `npm run check` passed in 39 seconds: launcher 3/3, server 563/563 with
  one opt-in live skip, strict test-source and production typechecks, and both
  production builds;
- `git diff --check` and the bounded diff/artifact review passed.

The configured `ui-reviewer` role was unavailable. An independent read-only rendered
fallback returned **READY with no scoped findings**. It confirmed truthful copy,
native disabled semantics, persisted checked-state visibility, non-color-only labels,
responsive layout and design fidelity. It noted only pre-existing non-blocking
Settings tablist ARIA/arrow-key and small secondary-type debt; ST-02 does not broaden
into those shared concerns.

**Verdict:** ST-02 is **AUDITED at scoped 100%**, `T,C,B,U,I` 5/5. This is one
observed green repository run, not a claim that separately reproduced TST-04
background-cleanup instability is resolved.

Final hosted Node 22 run
[`33262928516`](https://github.com/kyashp/shepherd/actions/runs/33262928516)
passed the locked install, Docker availability and literal repository gate on audit
head `7f5a719` in 1m42s.
## TST-04 F-03 snapshot-cleanup teardown race

**Date:** 2026-08-30 (Asia/Singapore)
**Branch/base:** `work/mock-main` / `e88dbef27b0a7f55acbdab3a7f89b67c9e6900c1`

The literal repository gate passed both production typechecks and the strict server
test-source typecheck, then failed one F-03 service test during `afterEach` cleanup.
The behavioral assertions did not fail. The cleanup walker attempted to read a
sibling trusted-verification snapshot subtree while its owning
`withVerificationSnapshot` finalizer was removing it:

```text
service.test.ts > Shepherd deterministic walking skeleton >
terminalizes Contract verification infrastructure failures without promotion or sensitive diagnostics

afterEach -> removeServiceCaseRoot -> makeDeletable -> readdir
ENOENT: .tmp/shepherd-tests/service-*/managed/planes/auth-demo/
        .trusted-verification/verify-*/src
```

```sh
npm run check
# RED after typechecks: server 562 passed, 1 failed, 1 opt-in skipped
# build phase did not run

npm run test -w @launchpad/server -- --run src/shepherd/service.test.ts \
  -t 'terminalizes Contract verification infrastructure failures without promotion or sensitive diagnostics'
# isolated GREEN: 1 passed, 33 skipped
```

The full-suite-only RED, immediate isolated GREEN, fail-fast concurrent Contract
verification path, and disappearing snapshot path strongly support an ordering race.
The required next discriminating check is to record the sibling
`VerificationRequest.planePath` and prove teardown starts before that exact snapshot
cleanup/Contract batch is quiescent. No product, UI, test, timeout, or cleanup
behavior was changed during this diagnosis. The paused E2E-01 deterministic work is
preserved separately; no live/model call was made.

Auditor source inspection confirmed that the failing `makeDeletable` recursion does
not suppress a directory disappearing between its entry `chmod` and `readdir`, while
each concurrent Contract verifier owns a `withVerificationSnapshot(...finally)`
cleanup. The unmodified current-tree literal gate passed 563/563 plus one opt-in skip,
which is consistent with an intermittent ordering defect and does not close the
preserved RED. The Fixer must still prove the exact sibling-path ordering causally
before changing the fixture.

## TST-03 independent integration audit and hosted closeout

**Date:** 2026-08-30 (Asia/Singapore)

**Integrated implementation:** `0b1c4017f01d37823b13c5da7360f00a8d8e7814`

Auditor inspected the exact candidate diff and confirmed it changes only the test
fixture and evidence docs: no product, service, verifier, API, persistence, UI,
workflow, dependency, timeout, sleep, retry, rejection suppression, or weakened
assertion. Both parameter rows passed 40/40 across 20 independent invocations; the
service/container-verifier slice passed 43/43; strict test-source typecheck passed;
the literal repository gate passed locally in 39 seconds with launcher 3/3, server
563/563 plus one opt-in live skip, and both production builds; integrated focused
rows passed 2/2. `git diff --check` passed.

Required hosted Node 22 run
[`33262227553`](https://github.com/kyashp/shepherd/actions/runs/33262227553)
passed on `0b1c401` in 1m38s, including locked install, Docker availability and the
literal repository gate. TST-03 is **AUDITED at scoped 100%**, `T,C,I` 3/3. This
restores UI-03 to **AUDITED at scoped 100%**, `T,C,B,U,I` 5/5, and unblocks E2E-01.
No live/model call occurred.

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
## TST-02 recovery fixture clock candidate

**Date:** 2026-08-29 (Asia/Singapore)
**Branch:** `fix/33-recovery-fixture-clock`
**Issue:** [#33](https://github.com/kyashp/shepherd/issues/33)
**Draft PR:** [#34](https://github.com/kyashp/shepherd/pull/34)

The exact post-CAS recovery test created its Plane through a `PlaneManager` using
the real wall clock, then reconciled it with fixed `recoveredAt`
`2026-08-29T12:05:00.000Z`. Once real time passed 12:05Z, recovery assigned an
`updatedAt` earlier than the Plane's real `createdAt`, and database validation
correctly rejected the state. The unmodified targeted test reproduced the causal
RED with `Refusing to persist invalid database state` after 12:05Z.

The candidate injects the test's existing `2026-08-29T12:00:00.000Z` timestamp
through `PlaneManager`'s existing `now` option. It changes no production code,
schema, validator, assertion, launcher, dependency, UI file, or ST-02/PR #13 file.

Observed against code commit
`1dc3133c332b9fd31ec27d2ed5e8d620a0dae08f`:

- the exact targeted test passed 1/1 at the real post-rollover time 15:08Z;
- the complete `recovery.test.ts` file passed 17/17 at the real post-rollover time;
- literal `npm run check` in a clean Node 24 Linux workspace, with only the process
  wall clock held at the shared 12:00Z fixture baseline, passed: launcher 3/3,
  server 25 files passed and 2 opt-in files skipped, 551 tests passed and 5 skipped,
  and both production builds completed;
- unconstrained real-clock full-suite attempts still exposed unrelated current-main
  cross-suite instability in unchanged service/recovery-process cases, while the
  changed recovery file remained 17/17; the full unchanged `service.test.ts` and
  `recovery.process.test.ts` files then passed 28/28 and 5/5 in isolation;
- `npm audit --json` reported 0 vulnerabilities across 251 dependencies;
- `git diff --check` passed.

An independent read-only review of the exact code range
`349897d3d9167fe711bf720f7c3fadd213938d11...1dc3133c332b9fd31ec27d2ed5e8d620a0dae08f`
reported no Critical, Important, or Minor finding and returned **Ready to merge:
Yes**. It confirmed the injected clock owns the persisted Plane lifecycle
timestamps, produces a fresh fixed `Date` on each call, precedes recovery by five
minutes, and leaves every fail-closed, cleanup, event, and idempotency assertion
unchanged.

The clock-controlled full check is recorded as controlled evidence, not as an
unconstrained real-clock pass. The real-clock targeted and full-file results are the
post-rollover proof for this narrowly scoped correction.

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
  this adapter or emit its `model_review_degraded` event. **Superseded by the
  Phase 4 composition recorded below (`MR-01`).**

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

## 2026-08-29 — GC-01 draft correction

[Draft PR #9](https://github.com/kyashp/shepherd/pull/9) implements the bounded
`GC-01` correction discovered while verifying Project Group mentions:

- Project Group mention buttons generate the parser's JSON-quoted syntax for Agent
  names containing whitespace or unsafe token characters. The pure prepend contract
  preserves existing multiline composer content; the page retains its existing
  request-animation-frame focus/caret restoration.

Strict TDD evidence:

- Mention formatting RED received `@Frontend Agent` instead of
  `@"Frontend Agent"`; focused GREEN passed 2/2.
- Draft preservation RED reported a missing prepend contract; focused GREEN passed
  3/3 after the helper and page integration.

The final pre-merge `npm run check` passed with 25 test files passed and 2 skipped,
544 tests passed and 2 skipped, and successful web/server typechecks and production
builds.

Browser interaction and screenshots are not claimed: the browser runtime exposed no
attachable browser. `docs/HANDOVER.md` records the remaining `GC-01` keyboard,
focus/caret, and `1280x800`/`1440x900` gates plus separate `GC-02..07` work.

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

## Phase 4 — Mission-composed advisory model review (`MR-01`, `MR-02`)

Assessed on branch `feat/12-mr-01-compose-model-reviewer` at `4a46f72`, stacked on
`fix/7-rst-01-idempotent-reset`. This entry supersedes the Phase 3 statement that the
bounded reviewer is not connected to Mission orchestration.

### What is now composed

`ShepherdServiceOptions` gained an optional `reviewer?: ModelReviewer`, injected as an
interface instance in the same style as `verifier` and `executor` and defaulting to
`null`. `apps/server/src/index.ts` constructs an `ArkModelReviewer` only when the new
`isShepherdModelReviewConfigured(config)` predicate holds, which gives
`config.shepherdModel` — fed by the documented `SHEPHERD_MODEL` — its first and only
consumer. An unconfigured server composes no reviewer and emits no advisory event,
rather than degrading every Mission with a false `configuration_error`.

`runAdvisoryModelReview()` runs between `integrateContracts()` and
`detectAndPersistCollision()`, gated at call time on `settings().modelReviewEnabled`
so the persisted setting is genuinely causal.

### Why the advisory result cannot reach authority

`runAdvisoryModelReview` returns `Promise<void>`, and `detectAndPersistCollision` has
**zero diff** in this change: its only nearby hunk appends two new private methods
after its closing brace. There is therefore no parameter, field, or closure through
which a finding can reach the deterministic detector, the winner policy, or the
promotion gate. The independence claim is structural rather than conventional.

### Containment and bounds

A reviewer that throws is converted into a durable `provider_error` degradation rather
than being swallowed, so a failure can never present as a fake "safe". A service-side
deadline bounds any injected reviewer that does not bound itself; the composed
`ArkModelReviewer` bounds itself at 20 seconds. A 250 ms poller aborts an in-flight
review once durable cancellation is visible, so `cancelMission` cannot block on it.
The outer catch is total, and cancellation is re-derived from durable state by
`detectAndPersistCollision`'s own `ensureMissionRunnable` on the very next statement.

`model_review_completed` was added additively to `ShepherdEventType`
(`shepherd/domain.ts`), the persisted `z.enum` (`database-schema.ts`), and the browser
mirror (`apps/web/src/types.ts`). No store version bump and no migration were
required: `databaseV2Schema` remains `version: z.literal(2)` and the change only
widens what parses. Persisted advisory details are closed enums, counts, and claim
keys Shepherd itself supplied. Free model prose (`finding.reason`) is deliberately
never persisted or rendered.

### Observed evidence

```sh
npx vitest run --config apps/server/vitest.config.ts \
  apps/server/src/shepherd/service.model-review.test.ts
# repository default config, no flags
# Test Files  1 passed (1)
#      Tests  9 passed (9)
#   Duration  110.54s

npm run typecheck
# PASS: server and web TypeScript checks

npm run build
# PASS: web production build, 40 modules transformed
# PASS: server production build

git diff --check
# clean
```

Each test declares the budget it needs, because every one drives a full Mission with
real Git worktrees and real trusted fixture checks. The file therefore passes under
the repository default configuration rather than depending on a `--testTimeout` flag.

The composition predicate was checked against a configured environment, reporting
booleans only and printing no secret:

```text
arkConfigured: true
shepherdModelReviewConfigured: true
shepherdModel is distinct from arkModel: true
shepherdExecutionMode: deterministic
```

This confirms two design choices. Reusing `isArkConfigured` would have been wrong,
because it validates `arkModel` while the reviewer consumes the genuinely distinct
`shepherdModel`. Gating the reviewer on `shepherdExecutionMode` would have left the
feature unreachable in exactly the configuration the deterministic demo runs in,
since `auto` resolves to `deterministic` without a container engine.

RED was observed before implementation on the same file: `3 failed | 1 passed`, each
failure on `expect(reviewer.inputs).toHaveLength(1)`. `MR-T05` — the PRD 8.6 mandate
that collision detection succeeds with the reviewer disabled — passed both before and
after, because it is the baseline invariant rather than a new capability. Every
independence assertion carries the call-count expectation; without it those tests
would pass vacuously against an uncomposed service.

`MR-T14` injects a finding naming a non-existent claim key and arguing for the losing
transport, then asserts the persisted collision, the selected candidate, and the
promoted SHA are unchanged, that `attentionReason` stays null, and that the hostile
prose appears in neither the collision nor the event trail. `MR-T16` drives a real
`ArkModelReviewer` through an injected `fetchImpl`, proving both that the
service-built input satisfies `reviewInputSchema` end to end and that a configured
secret never reaches the outbound request body.

### Recorded limitations

- `npm run check` was **not** observed passing unmodified on this host, and that is
  pre-existing. On the unmodified stack parent the server suite reports
  `24 failed | 518 passed`, every failure at ~5000 ms with no assertion failures,
  because `apps/server/vitest.config.ts` leaves Vitest's 5 s default `testTimeout`
  against tests that perform real Git work. Raising the flag takes
  `git-plane-promotion.integration.test.ts` from `13 failed` to `19/19 passed`.
- This change causes no functional regression, established by isolation rather than
  by assertion. Under `--testTimeout=60000` the parent reports
  `8 failed | 534 passed | 547` and this branch reports `12 failed | 543 passed | 556`
  — nine tests added, nine passing. `service.test.ts` shows 3 failures on the parent
  and 6 on this branch in a full run, but **1 failed / 20 passed when run in
  isolation** on this branch. Five of those six therefore exist only under full-suite
  parallelism, and the remaining one fails on the parent too. With no reviewer
  injected `runAdvisoryModelReview` returns on its first line, so it cannot slow a
  Mission; what the new file adds is roughly 110 s of parallel Mission load, which
  pushes an already-marginal suite further past its timing budget.
### Opt-in live `SHEPHERD_MODEL` gate

HANDOVER pending-ledger item 5 was executed after item 4 passed, via the new
`npm run test:shepherd:model-review:live` script and
`apps/server/src/shepherd/live-model-review.integration.test.ts`. The suite is behind
a double gate (`SHEPHERD_LIVE_TEST` **and** `SHEPHERD_LIVE_MODEL_REVIEW`) so the
existing `test:shepherd:live` script cannot trigger it; both the default run and a
`SHEPHERD_LIVE_TEST=true`-only run were confirmed to skip it. The Mission itself stays
deterministic and container-free, so the gate costs exactly one provider request.

```sh
npm run test:shepherd:model-review:live
# Test Files  1 passed (1)
#      Tests  1 passed (1)
#   Duration  14.55s
# observed outcome: degraded reason=invalid_response retryable=false
```

The composition is proven against the real provider: one request was sent, a response
was received, the degradation was recorded durably, and the deterministic collision,
winner, and promoted head were unchanged. **The review itself did not succeed**, and
that is reported as a defect rather than as a pass.

Bounded diagnosis using the adapter's own schema and instructions with a two-contract
payload: HTTP 200, `object: "response"`, `status: "completed"`, `store: false`,
`error: null`, `incomplete_details: null`, one `reasoning` item followed by one
assistant `output_text` message whose text parses as schema-valid JSON. The envelope
contract in `extractOutputText` is therefore satisfied, and the model produced a
genuinely correct review naming the real `auth.transport` conflict with high
confidence.

The rejection happens later. `evidenceReferenceExists` requires
`source: "manifest"` refs to equal the literal sentinel `manifest_summary`, while the
model supplied the manifest summary text; and `validateAndNormalizeFindings` returns
`null` when any single finding fails, so one ambiguous reference discards the entire
review including its valid findings. Tracked as `MR-03`. `ArkModelReviewer` is
deliberately unmodified by this change.

### Composition defect found by adversarial review

An adversarial review of the branch diff found a high-severity defect in the
composition itself. `apps/server/src/index.ts` passed `[arkApiKey, authToken]`
unfiltered into `ArkModelReviewer`. `validateConfiguration` rejects the entire
configuration when any supplied sensitive value is shorter than eight characters, and
`config.authToken` is legitimately `""` on the documented loopback default, where
`APP_AUTH_TOKEN` is required only for non-loopback listeners. The reviewer was
therefore permanently inert: every qualifying Mission emitted
`model_review_degraded / configuration_error` **without ever attempting a request**,
behind a reason that reads as a credential problem.

Reproduced with the compiled adapter and an empty auth token:

```text
as shipped      -> degraded/configuration_error | fetch attempted: false
with >= 8 filter -> completed                   | fetch attempted: true
```

Fixed by filtering at the construction site. `MR-T17` pins the exact composition
`index.ts` performs and was confirmed to fail without the filter
(`expected 'degraded' to be 'completed'`).

Nothing caught this earlier because every service test used a scripted fake with
`sensitiveValues: []`, `MR-T16` supplied a single long key, and the live gate
pre-filtered at `>= 4`, which dropped the empty token and exercised a composition the
server never uses. The live gate now filters at `>= 8` to match production exactly.

The remaining adapter-side weakness is deliberately out of this branch's scope:
`validateConfiguration` rejects a whole configuration for one unusable sensitive
value rather than dropping it or naming a caller-side mistake.

### Recorded limitations

- The live gate has never observed a `completed` review; only the degradation path is
  live-proven. Until `MR-03` is fixed, the advisory reviewer is safe but silent.
- Mid-review cancellation is covered by `MR-T13`, which blocks a reviewer until its
  caller signal aborts, cancels the Mission in flight, and asserts the signal was
  aborted, that no advisory event was recorded, and that no collision, candidate, or
  protected-head change survived. The test pins `deadlineMs` far out of reach so only
  the cancellation poller can settle the review: an earlier version passed with the
  poller disabled because the service deadline aborted instead, which mutation
  testing caught.
- Both UI changes (the Verification stream filter and the `degraded` tone) are
  untested: the web workspace has no test runner, so there is nowhere to put one.
- `apps/server/src/index.ts` is a top-level-`await` entrypoint with no export, so its
  composition is build-verified rather than test-verified.
- No container runtime was available, so the two container-gated suites skipped as
  designed. The new tests require none; they drive full Missions through an
  in-process trusted fixture verifier.
- During final integration, the two presentation-only regex changes (`model_review`
  joining the Verification stream filter and `degraded` mapping to the existing
  amber tone) were removed with user approval because this GPT CLI device has no
  connected browser runtime. The event contract typing remains, but the final diff
  adds no rendered UI behavior and therefore has no UI-specific browser gate.

### Integrated current-main verification

**Date:** 2026-08-30 (Asia/Singapore)
**Branch:** `feat/12-mr-01-compose-model-reviewer`
**Final integrated base:** `origin/main` at `fae0852`
**Integration commits:** `fbf3038` (base `d27dea6`), then `5972aa8` (base `fae0852`)
**Verified implementation checkpoint before the final base refresh:** `a2afbf3`

The initial `d27dea6` `origin/main` base was merged without rebasing or
force-pushing. All code merged automatically; the only conflict was this build log,
where the complete MR-01 and current-main evidence blocks were both preserved.

Immediately before final review, refreshed refs showed that PRs #9 and #37 had
advanced `origin/main` to `fae0852`. That base was merged at `5972aa8`. Source and
workflow changes merged automatically; the HANDOVER conflict was resolved by
preserving both the newly merged Group Chat/required-check evidence and PR #16's
model-review status. A new exact-head Node 24 gate is required after the final
evidence commit; the earlier result is not presented as covering the refreshed base.

The first focused baseline exposed an environmental timing failure rather than a
reviewer defect: `JsonStore.persist()` rejected lifecycle state after Docker Desktop
stepped its wall clock backwards. Path-only diagnostics isolated
`updatedAt < createdAt` across Project, Contract, and Plane records. A standalone
Node 24 probe then measured two backward steps in 40 seconds, with a largest step of
`-35,921 ms`, while the monotonic timer advanced normally. The new Mission test
fixture now uses the service's existing `now` seam with a strictly monotonic
per-service test clock; production timestamp and reviewer behavior are unchanged.

RED was observed repeatedly before that test-only correction. Fresh GREEN evidence:

```text
npx vitest run --config apps/server/vitest.config.ts \
  apps/server/src/shepherd/service.model-review.test.ts
# host isolation: 1 file passed; 13/13 tests; 100.10s

# Node 24, focused model-review + config gate
# 2 files passed; 33/33 tests; 219.95s
```

The first bind-mounted literal check was not reported green: it stopped in the
launcher suite because Windows checkout conversion produced a `bash\r` shebang.
The committed head was therefore cloned into a fresh Linux Docker volume so Git
materialized LF files, and the same unmodified command passed:

```text
npm run check
# launcher: 3/3 passed
# server: 26 files passed, 3 skipped; 568 tests passed, 6 skipped
# web and server typechecks passed
# web production build: 40 modules transformed
# server production build passed

npm audit --json
# 0 vulnerabilities across 251 dependencies
```

After the presentation-only deltas were removed, the same literal Node 24 gate was
rerun against exact commit `a2afbf3` in a fresh LF-native Linux volume. It passed
with the same totals: launcher 3/3, server 568 passed/6 skipped, both typechecks,
both production builds, and a zero-vulnerability audit across 251 dependencies.

The local Vite UI was started for the two-regex rendered gate, but the required
browser runtime reported no connected in-app or extension browser. The server was
stopped and no screenshot, viewport, or visual claim is made. With user approval,
both presentation-only regex deltas were then removed; the final diff adds no
rendered UI behavior. The final security/correctness review, push/required checks,
merge, and post-merge verification remain separate gates and are not implied by
this entry.

### Final-review correctness corrections

The independent final review of integrated checkpoint `aa76ebf` found three
important service-boundary gaps. All three were reproduced with causal tests before
production changes:

- the readiness predicate accepted six configurations that `ArkModelReviewer`
  rejects (short/control-character keys, an invalid model identifier, and insecure,
  credential-bearing, or query-bearing endpoints);
- malformed injected reviewer results could bypass an explicit durable degradation;
- durable Mission cancellation only aborted the injected reviewer signal, so a
  reviewer that ignored aborts held `cancelMission()` until the 1.5-second test
  deadline.

The combined RED run observed 32 passing and 8 failing assertions across the two
affected files. The correction keeps `model-reviewer.ts` unchanged because active
stacked PR #25 owns that adapter. Instead, `config.ts` mirrors the adapter's exact
credential/model/HTTPS endpoint acceptance rules, while `ShepherdService` validates
the closed, bounded result shape from any injected reviewer and converts invalid
values to `invalid_response`. A service-owned cancellation settlement now races both
the reviewer and deadline, so cancellation remains bounded even when the injected
implementation never settles. The result validator accepts the bounded optional
`droppedFindingCount` field planned by the stacked `MR-03` change without persisting
it or giving it authority.

Fresh Node 24 follow-up evidence:

```text
apps/server/src/config.test.ts
# 1 file passed; 26/26 tests

service.model-review.test.ts -t MR-T10b
# 1/1 passed; 13 skipped

service.model-review.test.ts -t MR-T13
# 1/1 passed; 13 skipped

npm run typecheck --workspace @launchpad/server
# passed
```

One aggregate affected-file run reached 39/40 before a Git-fixture `worktree` command
exited 128 in `MR-T12`; that case then passed 1/1 immediately in isolation. This is
recorded as an infrastructure interruption, not presented as a clean aggregate pass.
The literal exact-head Node 24 check, final independent follow-up, push/required
checks, merge, and post-merge verification remain lifecycle gates.

## ST-02 — Truthful unavailable notification preferences

**Date:** 2026-08-29 (Asia/Singapore)
**Branch:** `fix/6-st-02-notification-truth`
**Pull request:** [#13](https://github.com/kyashp/shepherd/pull/13)

### Root cause and bounded correction

The notification booleans were persisted and round-tripped by the settings API, but
no delivery or in-app behavior read them. `SettingsPage` nevertheless bound all three
values to enabled toggles with functional descriptions, so the browser presented
stored-only values as active product controls.

The Notifications tab now identifies the capability as **Reserved for a future
release** and **Unavailable**. It continues to render each stored value through a
native disabled toggle paired with a `Reserved` label. The settings schema,
persistence, model-review control, other tabs, and notification delivery remain
unchanged.

### Original RED/GREEN and branch evidence

The focused server-rendered React regression was added before the section component.
Its first valid run failed because `NotificationSettingsSection` was undefined; after
the minimal implementation, the same test passed and proved all three controls were
disabled while two supplied checked values remained visible.

Before current-main integration, fresh branch-local evidence passed:

```sh
npx vitest run apps/web/src/pages/SettingsPage.test.tsx
# 1 file / 1 test passed

npm run typecheck -w @launchpad/web
# passed

npm run build -w @launchpad/web
# passed; Vite transformed 40 modules

git diff --check
# passed
```

A disposable terminal Playwright/Chromium proof rendered the real Vite application
with deterministic API responses at `1280x800` and `1440x900`. At both viewports it
observed stored states `[true, false, true]`, three natively disabled controls,
rejected programmatic and sequential focus, unchanged mouse/keyboard activation
attempts, disabled Save, zero settings `PATCH` requests, zero horizontal overflow,
zero clipping/overlap, and no console, page, or request errors. Temporary screenshots
were visually inspected against `docs/UI.jpeg` and were not committed.

### Current-main integration

OPS-05 merged through PR #32 at `8110aa3ed49bd0586cbb275d7c4067552cd9a144`,
then priority PR #10 merged at `349897d3d9167fe711bf720f7c3fadd213938d11`.
Only that latest `origin/main` was merged into this branch. Source and regression
files merged automatically; conflicts were limited to this file and `HANDOVER.md`.
Resolution restored current-main documentation and reapplied only ST-02-specific
evidence. Fresh integrated verification and independent-review results are recorded
in a follow-up entry only after they are observed.

### Integrated current-main verification

On merge commit `066009b6eda658eee9a66135224d69b3a4dae515`, the effective
diff against `origin/main` contained exactly the notification page section, its
focused regression, and these two ST-02 evidence files. Observed results:

```sh
npx vitest run apps/web/src/pages/SettingsPage.test.tsx
# 1 file / 1 test passed

npm run typecheck -w @launchpad/web
# passed

npm run build -w @launchpad/web
# passed; Vite transformed 40 modules

npm run check
# launcher 3/3 passed
# server: 25 files passed, 2 skipped; 554 tests passed, 2 skipped
# web and server production builds passed

npm audit --json
# 0 vulnerabilities across 251 dependencies

git diff --check origin/main...HEAD
# passed
```

Terminal Playwright/Chromium then repeated the real Vite-page proof at `1280x800`
and `1440x900`. Both viewports preserved `[true, false, true]`, exposed all three
checkboxes as natively disabled, rejected direct and sequential focus, and remained
unchanged after forced label clicks and keyboard activation attempts. Save stayed
disabled, no settings `PATCH` occurred, and automated geometry checks found no
horizontal overflow, clipping, or overlap. Console, page, and request error lists
were empty. The final temporary screenshots were visually inspected against
`docs/UI.jpeg`; current-main's cream canvas, dark sidebar, updated Shepherd icon,
purple accent, restrained borders, typography, spacing, and locked-control language
were preserved. No screenshot binary was added to the effective branch diff.

### Independent final review

An independent read-only quality audit reviewed the exact
`349897d3d9167fe711bf720f7c3fadd213938d11..87b4b12e894233e2a2d852db90bfde2fe1714386`
diff plus both final screenshots. It confirmed the exact four-file scope, native
disabled semantics, stored-value preservation, absence of a notification interaction
path to the unchanged `PATCH` submit handler, regression coverage, current-main UI
preservation, and honest documentation of unimplemented delivery and broader UI
gaps. It reported no Critical, Important, or Minor finding and returned **Ready to
merge: Yes**. This review-status entry is documentation-only; the same auditor must
confirm the final follow-up diff before push.

### Final dependency-gated current-main refresh

TST-02 merged through PR #34 at
`8149a7cf3b52c4f0c7d20b31f14c4d2ddbc52b12`. The latest `origin/main` was
then merged conflict-free into ST-02 at
`f1ad0b9811e9b77dddc933c11df6a6e3fd17cf61`; no source, test, or
documentation conflict required manual resolution. The effective diff against
that updated base remained exactly `SettingsPage.tsx`, its focused regression,
and the two ST-02 evidence files.

Fresh evidence on the integrated merge passed the focused ST-02 test (1/1), the
formerly blocked recovery target with its canonical temporary path (1/1, 16
skipped), web typecheck, and the web production build (40 transformed modules).
The required literal `npm run check` then passed without an environment override:
launcher 3/3, server 25 files passed with 2 skipped and 554 tests passed with 2
skipped, plus web and server production builds. `npm audit --json` reported zero
vulnerabilities across 251 dependencies, and `git diff --check
origin/main...HEAD` passed.

Terminal Playwright/Chromium repeated the proof against the integrated Vite page.
At both `1280x800` and `1440x900`, stored values remained
`[true, false, true]`; all controls were natively disabled, rejected direct and
sequential focus, and ignored mouse/keyboard activation. Save remained disabled,
zero settings `PATCH` requests occurred, geometry checks reported no horizontal
overflow, clipping, or overlap, and console/page/request error lists were empty.
The visually inspected temporary screenshots remained faithful to `docs/UI.jpeg`
and were not added to the branch diff:

- `st-02-1280x800.png` — SHA-256
  `8dc439b849eac9aeb84f3353145ff106ff4518f0b007a8fd7c61f5038a2ab22c`
- `st-02-1440x900.png` — SHA-256
  `c6d5c9e0831f9c7cc187827e574f1ca1c98b2fbd322738b96b19e6b45a33d95b`

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

## 2026-08-29 — GC-01 post-#19 current-main browser gate

[Draft PR #9](https://github.com/kyashp/shepherd/pull/9) was integrated on the
merged [PR #19](https://github.com/kyashp/shepherd/pull/19) `main` commit
`120fff066d962f4f30ed6cd62bc367cc869e02db` in a detached evidence worktree.
The overlay contained exactly the three GC web files, and each blob matched the
PR #9 head:

```text
apps/web/src/pages/ProjectGroupPage.tsx
apps/web/src/pages/project-group-mention.test.ts
apps/web/src/pages/project-group-mention.ts
```

Observed verification on that exact integration:

```sh
npx vitest run apps/web/src/pages/project-group-mention.test.ts \
  --environment node --no-file-parallelism --maxWorkers=1
# 1 file passed; 3 tests passed

npm run check
# exit 0: both workspace typechecks passed
# 25 test files passed, 2 opt-in files skipped
# 550 tests passed, 2 opt-in tests skipped
# web and server production builds passed

git diff --check
# passed
```

A terminal Playwright run exercised the real Vite page with deterministic API
interception in installed headless Chromium. At both exact `1280x800` and
`1440x900` viewports, mouse click, keyboard Enter, and keyboard Space activation
produced `@"Frontend Agent" Keep this draft\nincluding its second line`. After
every activation, `#group-message` was the active element and its collapsed
selection was `59..59` for a 59-character value. Keyboard focus matched
`:focus-visible` with a solid 2 px outline. Both pages reported exact requested
viewport dimensions, no horizontal overflow, no console/page error, and no
unexpected API request.

The two screenshots were visually inspected against `docs/UI.jpeg`. The dark
sidebar, restrained purple accents, bordered conversation panel, spacing hierarchy,
and bottom composer remained consistent; mention chips and the focused composer had
no clipping or overlap. Screenshots and the one-off Playwright harness remained
temporary and were not committed.

This evidence closes the scoped `GC-01` interaction uncertainty only. `GC-02..07`,
polling/reconnect and populated-history browser coverage, accessibility, a committed
deterministic E2E harness/screenshot corpus, independent UI review, and post-merge
verification after PR #9 itself lands remain separate.

### GC-01 final parser-round-trip hardening

A final review found that a quoted display name could still fail routing when the
server's whole-message normalization changed the decoded lookup target. For example,
`Frontend  Agent` was formatted as `@"Frontend  Agent"`, then collapsed to one
space before lookup even though the stored Agent name retained two spaces.

The focused RED failed 2/5 tests: normalization-changing spacing did not fall back
to the Agent ID, and full-width quote characters were not normalized before JSON
escaping. The minimal web-only fix now normalizes safe display-name mentions before
escaping and falls back to the Agent UUID when a parser-valid name cannot survive
the whole-message transformation and the shared ID/name namespace is unambiguous.
The focused GREEN passed 5/5 and
round-tripped those generated mentions through the production
`parseProjectGroupMessage()` implementation.

A second review found that U+037A gains leading spacing under NFKC and the parser
directory trims after normalization. RED failed 1/6 because the formatter retained
that introduced spacing; the minimal post-NFKC trim is GREEN at 6/6 through the
production parser. No server files, stored records, or public schemas changed.

The reviews also found two out-of-scope server directory mismatches, now tracked as
`GC-07`: create/update accepts source-short Agent names whose NFKC+trim form exceeds
the parser's 128-character directory-key limit, and names canonically equal to a
different Agent's ID even though IDs/names share one parser lookup namespace. The
parser rejects the first entire directory before resolving an ID and correctly
rejects the second route as ambiguous, so no web fallback can correct either case.
A separate server/schema task must align canonical length and namespace validation
and plan non-destructive repair for existing invalid or colliding stored names.

On the actual merge-resolved branch:

```sh
npx vitest run apps/web/src/pages/project-group-mention.test.ts
# 1 file passed; 6 tests passed

npm run check
# exit 0: both workspace typechecks passed
# 25 test files passed, 2 opt-in files skipped
# 550 tests passed, 2 opt-in tests skipped
# web and server production builds passed
```

Terminal Playwright was rerun at exact `1280x800` and `1440x900`. Mouse, Enter,
and Space still inserted the readable `@"Frontend Agent"` form, preserved the
multiline draft, restored focus, and left the collapsed caret at `59..59`.
Keyboard focus remained visibly outlined; both viewports had no overflow,
console/page errors, unexpected API requests, clipping, or overlap. The refreshed
screenshots were visually inspected against `docs/UI.jpeg` and remained temporary.

## 2026-08-30 — GC-01 current-main integration and default-gate packaging

PR #9 was merged locally with current `origin/main` at
`d27dea670108e5a06eac20de7df88f756b68e404`, the merge of PR #13. The only
textual conflicts were this build log and `docs/HANDOVER.md`; the product diff
remains limited to the Project Group mention helper and its use in
`ProjectGroupPage.tsx`.

Review correctly found that the original web-workspace test was not discovered by
the repository's root test command. The pure regression moved to
`apps/server/src/project-group-mention.test.ts`, whose existing Vitest workspace can
import both the web helper and production server parser without new dependencies.
The packaging RED command reported no matching test file before the move.

Independent review then found an in-flight submission race: the textarea was
disabled during the POST, but a mention button could mutate the retained draft
before the successful request cleared it. The review also found that programmatic
mention insertion could exceed the textarea's 2,000-character limit. The causal RED
failed 2/8 because the submission-locked button and bounded prepend helper did not
exist. The minimal correction gives the mention button native disabled semantics
while sending plus a defensive callback guard, and rejects an over-limit insertion
without changing the draft while showing a composer-scoped status message. GREEN
passes all 8 formatter, parser-round-trip, draft-preservation, submission-lock, and
exact-boundary cases:

```sh
npm run test -w @launchpad/server -- src/project-group-mention.test.ts
# 1 file passed; 8 tests passed
```

The Node 24 Linux verification copy normalized only the checkout's CRLF shell
launcher; repository blobs were not changed. The current-head `npm run check`
completed both workspace typechecks, the 3/3 launcher suite, and all 8 GC-01 tests,
but did **not** complete green. Two unchanged server cases failed under the complete
suite: `recovery.process.test.ts` after `update-ref`, and `service.test.ts` while
rejecting a second Mission after an external protected-head move (24 files passed,
2 failed, 2 skipped; 557 tests passed, 2 failed, 5 skipped). The latter passes 1/1
alone. The recovery-process file had passed 5/5 in an earlier isolation, then failed
a different `promotion_ready_for_cas` case in a later 4/5 isolation. PR #9 has no
diff in either server path. These rotating failures are recorded as existing
shared-clock/process instability, not as a passing required gate and not as GC-01
scope.

Independent production builds passed for web and server, `git diff --check` passed,
and `npm audit --audit-level=high` found 0 vulnerabilities.

The current integrated browser run used terminal Playwright because the in-app
browser exposed no attachable backend. At exact `1280x800` and `1440x900`, mouse,
Enter, and Space each produced
`@"Frontend Agent" Keep this draft\nincluding its second line`; focus returned to
the composer, the collapsed caret was `59..59`, and keyboard focus had a solid
2 px visible outline. During a deliberately deferred POST, both the mention button
and composer were disabled, programmatic button activation left the submitted draft
unchanged, and the successful response cleared only that submitted content. An
exact 2,000-character mention insertion succeeded; one character over remained at
2,000 and displayed the explicit limit error. Both viewports had no horizontal
overflow, clipping, console or page errors, failed requests, unexpected API writes,
or layout overlap. The temporary screenshots were visually checked against
`docs/UI.jpeg`:

```text
1280x800  sha256 4d4e35b065f3c530dbb02b5d92e35830490799759b4bac85c855a4a5dd5a0039
1440x900  sha256 7e09440db22781b45f4c11173580fecfc01d5ef7dcf8792ddaecc255e6c709a1
```

The independent reviewer reported no Critical issue. Its one Important race and
one Minor length-boundary issue are corrected above. The read-only follow-up
reviewed the final staged five-file effective diff, reported no Critical, Important,
or Minor finding, and returned **Ready to merge: Yes**, subject to normal required
checks and integrator disposition of the unrelated suite instability.

PR #9 remains the bounded `GC-01` correction. The requested no-project composer
behavior is `GC-05`, which issue #5 and this handover explicitly exclude; it needs
its own issue, owner, branch, regression, and review.

## 2026-08-30 — GC-01 post-merge verification

PR #9 merged into `main` as `fae0852e284619c2912eeeb8ac3ebe156f45b026`.
GitHub closed issue #5 through the linked merge, and the remote
`fix/5-gc-01-quoted-mentions` branch was removed.

Fresh Node 24 Linux checks ran against that exact merged-main tree:

```sh
npm run test -w @launchpad/server -- src/project-group-mention.test.ts
# 1 file passed; 8 tests passed

npm run typecheck
# web and server workspace typechecks passed

npm run build
# web Vite production build and server TypeScript build passed
```

The in-app browser reported no available backend, so the exact merged-main Vite
page was exercised with the documented terminal Chromium fallback. At both
`1280x800` and `1440x900`, mouse, Enter, and Space produced
`@"Frontend Agent" Keep this draft\nincluding its second line`; focus returned
to the composer with the collapsed caret at `59..59`, and keyboard focus retained
a solid 2 px visible outline. During a deferred POST, both the mention control and
composer were disabled and programmatic activation did not mutate the submitted
draft. Exact 2,000-character insertion succeeded; the over-boundary attempt stayed
at 2,000 and displayed the explicit limit error. Each run issued exactly one
expected group-message POST and had no horizontal overflow, clipping, layout
overlap, console errors, page errors, or failed requests.

The temporary screenshots were visually inspected and were not committed:

```text
1280x800  sha256 980854CC1C489C91BE5EBAFD42B940044AEF167FABFE8FF13E2E65D546D7CEC6
1440x900  sha256 507CC82FE4F8C43E23A72BD022FF7987EAA2EF4518C20AD9007D3C05159363E6
```

The full `npm run check` was not rerun post-merge. Its latest pre-merge attempt
remains the explicitly non-green result recorded above: 557 tests passed, 2
unchanged server tests failed under suite load, and 5 were skipped. This scoped
post-merge gate does not reclassify that unrelated process/shared-state
instability, and it does not close the separately owned `GC-02..07` work.

## 2026-08-30 — CI-01 required pull-request checks and merge evidence

Issue [#36](https://github.com/kyashp/shepherd/issues/36) was implemented from
current `main` on `test/36-ci-01-required-checks`. The branch was published before
edits and owned only `.github/workflows/pull-request-checks.yml`; product code,
assertions, timeouts, dependencies, shared evidence documents, credentials, and
repository rules were excluded from the implementation PR.

### Workflow contract and local evidence

The pre-implementation contract probe observed the expected RED because
`.github/workflows/pull-request-checks.yml` did not exist. Commit
`9501b95f952b5ba02d1c5413960999adcde362a3` added the smallest workflow:

- `pull_request` for `main` plus `merge_group: checks_requested`;
- one deterministic job named `Required checks` on `ubuntu-latest` and Node 22;
- literal `npm ci` followed by literal `npm run check`;
- top-level `contents: read`, superseded-run cancellation, a 30-minute job bound,
  no persisted checkout credentials, no package-manager cache, and no secret or
  `.env` access;
- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`
  (`v7.0.1`) and
  `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020`
  (`v7.0.0`) pinned to immutable release commits.

Observed local evidence at the reviewed workflow bytes:

```text
PowerShell workflow contract
PASS: trigger, permissions, concurrency, runner, timeout, immutable actions,
Node 22, npm ci, npm run check, and forbidden secret/env patterns

actionlint v1.7.12 .github/workflows/pull-request-checks.yml
PASS; release checksum matched
6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9

npm audit --json
PASS: 0 vulnerabilities across 251 dependencies

git diff --check
PASS

independent CI/repository-administration review
PASS: no Critical, Important, or Minor finding
```

A clean Node 22 Docker execution on both unmodified `main` and the candidate
exposed the same existing Linux absolute-path redaction assertion in
`service.test.ts`; an additional baseline-only timeout did not recur. No test or
timeout was weakened. GitHub's hosted Ubuntu runner subsequently passed the literal
repository command, so the local discrepancy remains recorded rather than treated
as workflow evidence.

### Hosted positive, controlled-negative, and restored-positive proof

Draft [PR #37](https://github.com/kyashp/shepherd/pull/37) produced the stable
workflow/job context `Pull request checks / Required checks`:

1. Representative commit `9501b95` passed hosted run
   [33262643612](https://github.com/kyashp/shepherd/actions/runs/33262643612) in
   1m24s, including literal `npm run check`.
2. Temporary workflow-only commit `d9dcea9` appended `exit 1` after the unchanged
   repository command. Hosted run
   [33262766467](https://github.com/kyashp/shepherd/actions/runs/33262766467)
   concluded failure in 1m34s, proving a controlled red candidate cannot satisfy
   the same context.
3. Commit `edc240f42ab7398bb710a524859ecdfc816927c5` removed the temporary step and
   restored the independently reviewed workflow byte-for-byte. Hosted run
   [33262875107](https://github.com/kyashp/shepherd/actions/runs/33262875107)
   passed in 1m29s.

PR #37 merged into `main` as
`1f1fda7782b27e2077a505be5e5be8b413c7f446`. Its closing keyword automatically
closed issue #36; the issue was reopened because repository administration and
post-activation evidence remain. The remote implementation branch was removed.

The next merged product change, [PR #16](https://github.com/kyashp/shepherd/pull/16),
passed the merged workflow's `Required checks` run
[33266134939](https://github.com/kyashp/shepherd/actions/runs/33266134939) before
merging as `403fc095b07d60e17de1cb3f82b4e16b6a778919`. This is post-workflow proof
that a real product PR can satisfy the context.

Active draft [PR #25](https://github.com/kyashp/shepherd/pull/25) was briefly
closed and reopened solely to emit the supported `pull_request.reopened` event.
Its draft state, branch, and head `570982dc2766e57f38bb0327f3b906c53b2ed5f2`
were unchanged. The resulting `Required checks` run
[33267807007](https://github.com/kyashp/shepherd/actions/runs/33267807007)
passed in 1m43s, so activating the stable context will not strand that owner.

### Deliberately pending repository administration

The repository ruleset query still returns `[]`. After PR #25 passed, an activation
attempt using the narrow default-branch payload reproduced HTTP 404. Read-back of
the effective repository permission identified the cause: authenticated identity
`sanjey99` has `WRITE` but not `ADMIN`, while GitHub requires repository
Administration (write) for ruleset creation. CI-01 therefore remains open for:

1. a repository admin to activate the default-branch rule requiring exact context
   `Required checks` from GitHub Actions integration `15368`, with no bypass actors
   and loose freshness;
2. ruleset read-back and a post-activation PR proof that a red required context
   cannot merge; and
3. merge-group execution proof only if a merge queue is enabled.

No repository rule was created or changed by the workflow or this evidence update.

## 2026-08-30 — E2E-02 Worker candidate

The Worker added a model/network-free real-browser hero journey on the audited
deterministic verifier fixture. It exercised 13 material stages at `1280x800` and
`1440x900`, from active Contracts through protected promotion and Project Group
summaries, with backend API, Git, persisted-store and bounded verifier-ledger
oracles. Focused Chromium passed twice (4/4 total), the full Chromium suite passed
12/12, and harness unit coverage passed 7/7. All 26 ignored screenshots were
visually inspected; document/body overflow, clipping and theme drift were absent.

The journey also passed bearer-auth 401, keyboard/focus and evidence-tab controls,
same-base/distinct-branch candidate identity, 11/11/11 verifier
create/complete/remove operations, no-network/read-only verifier constraints,
public DTO/DOM/store/log canary scans, canonical protected output, outside-write
canary, reset restoration and exact port/process/container/root cleanup. It made
zero live/model calls and did not change production code, UI or CSS. E2E-02 remains
at 95% until independent Auditor review and hosted integration evidence; `GC-06`
remains open because lifecycle summaries are truthfully Shepherd-authored.

## 2026-08-30 — F-01/02 Worker candidate

The original two-case RED proved that typed Agent Runtime timeout and execution
failures both reached the Mission as `unknown`. The candidate introduces one
bounded typed Runtime error across the container and executor redaction boundary.
A timeout now persists Contract `execution_timed_out` with `agent_timeout`; a
non-timeout execution failure persists `execution_failed` with
`agent_runtime_error`. Both produce the same causal failure on the failed Plane,
logical Agent and failed Mission, release active project/Contract ownership, emit
bounded durable event details, survive store reload and public DTO conversion, and
leave collision/candidate/promotion state empty. Untyped exceptions remain
`unknown`; cancellation, verifier infrastructure and candidate behavior are
unchanged and no message regex was added.

The RED 2/2 became GREEN 3/3 including the untyped control. Runner/executor/service
focused coverage passed 11/11, adjacent runner/executor/service/API/store coverage
passed 102/102, strict test typecheck passed, and two literal
`npm run check` runs passed server 606/606 with two opt-in skips, Web 17/17, launcher
3/3 and both builds. No live/model call, UI/theme change or schema migration ran.
F-01/02 remains at 95% pending independent Auditor and hosted integration evidence.
## 2026-08-30 — TST-13 bounded Agent Runtime failure candidate

- **Branch/base:** `fix/f-01-02-runtime-redaction` from Auditor evidence
  `b03b17f` (F-01/02 parent `685e4ff`); pushed before implementation.
- **RED:** non-zero Agent Runtime output selected parsed error/raw stderr as
  `RuntimeExecutionError.message`. Executor secret/path redaction retained opaque
  diagnostics, and Contract/candidate failure paths persisted that message through
  Mission, Contract, Plane, Agent, events, state/reload and public DTO.
- **Correction:** `RuntimeExecutionError` constructs fixed bounded text from a
  runtime-normalized closed kind and optional positive safe-integer timeout; its
  public kind/deadline fields are non-writable. `ContainerCodexRunner.run`
  reconstructs cancellation/typed errors and maps every other create/start/child/
  cleanup operational failure to fixed execution text. Executor and service
  Contract/candidate boundaries reconstruct again before durable/public use. No raw
  stdout/stderr, parsed failure, model output, path, command or cause is retained.
- **Causal evidence:** planted parsed-output, stderr, create-exit, synchronous spawn,
  opaque benign, secret, private-path, hostile-kind and invalid-timeout canaries are
  absent from Error message/string/stack/inspection/cause and Contract, Plane,
  Mission, Agent `lastError`, events, raw store, reload and public mission DTO.
  Candidate Runtime failure exhausts in `attention_required`, starts no promotion,
  creates no promoted candidate and leaves the protected head at Mission base.
- **Observed checks:** runner 22/22; focused runner/executor/service 75/75; adjacent
  service/verifier/model/config 226/226; strict Server test typecheck green; first
  literal `npm run check` green (launcher 3/3, Server 607 passed + two explicit
  skips, Web 17/17, production builds green). No live/model/network call ran.
- **Security review:** first read-only pass found create/spawn diagnostics and the
  candidate path; second found hostile `kind` mutation. Both were corrected with
  causal tests. Final read-only follow-up reports no remaining High/Medium finding
  and a scoped PASS. Second literal `npm run check` is green (launcher 3/3,
  Server 609 passed + two explicit skips, Web 17/17, production builds green).
  Auditor U/I remain required.
## 2026-08-30 — TST-14 execution-home cleanup precedence candidate

- **Branch/base:** `fix/f-01-02-private-home-cleanup` from Auditor evidence
  `61b3ced` atop bounded Runtime chain `c7b5175`; pushed before edits.
- **RED:** execution-private-home `rm()` threw its raw opaque/path/OS diagnostic
  from `finally`, overriding success, cancellation, typed timeout and typed execution
  in all four controlled rows.
- **Correction:** executor records only whether a primary outcome failed, clears its
  active/cancellation ownership, and always attempts exact scoped home removal. A
  cleanup-only failure becomes fresh fixed typed execution failure; any primary
  cancellation/timeout/execution remains authoritative. Raw cleanup error is neither
  attached as cause nor persisted. Failed `0700` owner-scoped homes remain eligible
  for bounded reconciliation rather than being followed outside their root.
- **Causal evidence:** 4/4 outcome rows exclude opaque, configured-secret, Mac path
  and OS-code canaries from Error/string/stack/inspection/cause; inactive cancel
  returns false; reconciliation removes exactly the retained home; a later distinct
  execution succeeds and cleans. Contract state proves Mission/Contract/Plane/Agent,
  event, raw store, reload, public DTO, real `GET /api/shepherd/missions/:id` response
  and console error/warn capture are canary-free. Candidate cleanup failure exhausts
  to attention, never starts promotion and leaves protected head at Mission base.
- **Observed checks:** executor including OPS-06/preflight 21/21; focused/adjacent
  108/108; strict Server test typecheck; first literal `npm run check` green with
  launcher 3/3, Server 615 passed + two explicit skips, Web 17/17 and both builds.
  No live/model/UI/network call ran.
- **Security review:** initial read-only review found no High/Medium and requested
  explicit inactive-cancel, log-capture, HTTP and OPS-06 evidence; all are now covered.
  Final follow-up reports no High/Medium or material evidence gap. A full-suite run
  exposed and corrected one test-only overclaim: under contention, an unrelated
  candidate can fail before executor cleanup, so the assertion now requires all
  candidates terminal/no-promotion, at least one causal fixed cleanup failure and
  universal canary absence. No timeout/product change was made. Two post-correction
  literal checks pass identically (launcher 3/3, Server 615 + two explicit skips,
  Web 17/17, strict types and builds). Auditor U/I remain required.
## 2026-08-30 — TST-15 bounded sentinel/reconciliation filesystem policy

- **Branch/base:** `fix/f-01-02-sentinel-cleanup` from Auditor evidence `6eb20d0`
  atop TST-14 `3afc452`; pushed before edits.
- **RED:** sentinel adoption open attached raw cause; validation/adoption close could
  override bounded primary errors; failed unlink was swallowed; interrupted private-
  home and preflight-workspace rm escaped raw errno/path/OS diagnostics. Independent
  review then identified the adjacent pre-open lstat/chmod/readdir family.
- **Correction:** one internal `BoundedFilesystemError` policy emits only closed
  stage/reason text for sentinel validation/adoption and private-home/preflight-
  workspace reconciliation. It never retains raw cause/detail. Primary failure wins
  over close/unlink double faults, cleanup-only fails closed, and all exact cleanup
  attempts still run. Same-process failed sentinel unlink is remembered for exact
  retry; rm failures retain the exact contained target. No broad delete, fallback,
  symlink relaxation or public error code was added.
- **Causal evidence:** faults cover adoption open; existing-sentinel lstat/chmod;
  pre-adoption readdir/chmod; validation close and read+close; adoption close-only and
  write+close+unlink; a second failed pending unlink then success; interrupted home
  and preflight-workspace rm. Opaque/secret/Mac/Linux/errno/path canaries are absent
  from Error/string/stack/inspection/cause and service initialization Error/cause,
  store and console logs. Every retained target is observed, retried and removed.
- **Residual:** pending sentinel ownership is process-local. After restart, an
  invalid retained sentinel fails closed and may require operator cleanup. This is
  intentionally not described as automatic cross-process recovery.
- **Observed checks:** executor 33/33 (also independently rerun); focused/adjacent
  120/120; strict Server test types; two literal `npm run check` passes, each with
  launcher 3/3, Server 627 passed + two explicit skips, Web 17/17 and both builds.
  No live/model/UI/network call ran.
- **Security review:** first pass found one Medium pre-open family and four evidence
  gaps. After correction, final read-only re-review reports PASS with no High,
  Medium or material gap; containment and symlink protections remain unchanged.
  Auditor U/I remain pending.

## 2026-08-30 — F-05 Worker candidate

- **RED/correction:** a real add/add Git conflict was detected and aborted by the
  Git boundary, but the service persisted generic `unknown/background_demo` and
  left the integration Plane inspecting. The narrow correction maps the existing
  typed conflict to fixed `git_conflict/integration_merge`, marks only the
  integration Plane failed, and records bounded event evidence.
- **Boundaries:** ten validated repo-relative conflicts prove an exact total count,
  an eight-path preview capped at 48 characters, and rejection of absolute,
  traversal and control paths (backslashes normalize to `/`). No raw Git output,
  host path or cause is persisted or exposed through the public Mission DTO.
- **State/cleanup:** source Contracts remain verified and inspectable; Agents are
  released; candidates/collisions remain empty; protected HEAD does not move. Git
  merge abort leaves the retained integration worktree clean. Deterministic reset
  removes all retained Plane worktrees and branches while preserving repository
  HEAD and an outside canary.
- **Observed checks so far:** causal 2/2; adjacent service, Git promotion, recovery,
  store and API 110/110; strict production/test types; first literal `npm run check`
  passed launcher 3/3, Server 666 passed + two opt-in skips, Web 17/17 and both
  builds. After adding explicit reset and unsafe-path boundary proof, the second
  literal gate passed launcher 3/3, Server 667 passed + two opt-in skips, Web 17/17
  and both builds. Independent Auditor `I` remains pending; no live, model, network
  or UI-design call ran.

## 2026-08-30 — F-04 Worker candidate

The causal RED used the existing internal fault checkpoint to place a partial
managed destination immediately before initial Contract Plane creation. Plane
Manager correctly rolled it back, but the owning Contract remained queued and the
Mission persisted generic `unknown/background_demo`. The candidate recognizes the
existing `PlaneCreationError` without exposing its cause, persists fixed bounded
`worktree_creation_failure/plane_creation` evidence on the owning Contract and
Mission, releases the logical Agent/project, and records no Plane for a resource
that never completed creation. Executor and verifier calls remain zero; no
integration, collision, candidate or promotion state exists.

The original RED became GREEN 1/1. A separate real-Git integration fault after
worktree attachment proves rollback of the partial worktree and `shepherd/`
branch, unchanged protected HEAD/file canary, and a fixed public error message.
Focused coverage passed 2/2; adjacent service/Git/recovery/API/store coverage
passed 107/107; strict test types and two literal `npm run check` runs passed
launcher 3/3, Server 663/663 with two opt-in skips, Web 17/17 and both builds. No
live/model/network/UI/schema change ran. F-04 remains 95% pending independent
Auditor, security and hosted integration evidence.

## 2026-08-30 — F-06 Worker candidate

- **Scope:** the representative Mission `running -> verifying` write after two
  verified Contracts and before integration now uses `mutateRecoverably`. The
  generic store primitive is not claimed as entity-aware recovery for arbitrary
  mutations.
- **Journal contract:** the adjacent version-1 sidecar contains only an allowlisted
  operation, Mission/two Contract/two Plane IDs, fixed stage, timestamp and SHA-256
  of the exact canonical sanitized bytes written by the shared serializer. It is
  capped at 8 KiB, mode/owner checked where supported, opened no-follow, and uses
  temp/write/file-sync/close/rename/parent-directory-sync. Unix/macOS directory
  sync errors fail bounded; Windows retains file sync, atomic rename and digest
  reconciliation but cannot claim the same sudden-power-loss directory guarantee.
- **Recovery:** old digest means the transition did not commit and startup records
  exactly one bounded `persistence_error` attention event; changed digest must
  match the committed `verifying` state or a prior exact reconciliation. Pending
  recovery blocks ordinary mutations and event allocation. Agents are released,
  Contracts/Planes remain verified, project attention remains active, and no
  integration/candidate/promotion/protected-head mutation occurs. Reset after
  cancellation removes the journal and retained Planes.
- **Fault evidence:** all six journal stages, six primary stages and two journal
  removal stages are injected. Rename/directory-sync ambiguity, immediate recovery,
  two restarts/no duplicate, concurrent mutation denial, corrupt/oversize/symlink,
  unknown IDs, stale precondition and digest mismatch pass with bounded errors and
  no secret/path/errno canary on public/store/Error/stack surfaces.
- **Observed checks:** store 34/34; focused persistence/recovery 23/23; adjacent
  store/service/recovery/API 116/116; first literal `npm run check` passed launcher
  3/3, Server 700 passed + two opt-in skips, Web 17/17, strict types and both builds.
  A second literal gate passed with the same counts. Independent
  Auditor/security/hosted evidence remains. No live/model/network/UI-design call
  ran.
