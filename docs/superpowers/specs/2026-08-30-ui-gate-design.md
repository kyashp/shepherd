# UI-GATE Audit and Evidence Design

## Context

Issue #45 is the final global UI gate for PRD sections 0.4 and 11.1–11.7. It is
not a redesign. The accepted Launchpad theme and layout are frozen, and existing
journey suites already prove several narrow flows. The missing deliverable is one
auditable matrix showing that the complete PRD UI remains functional, accessible,
truthful, responsive, and visually coherent across the two required viewports and
the required non-happy-path states.

This branch is an audit-first candidate. Final completion remains blocked until
issue #44 and the remaining prerequisite E2E work are integrated. Evidence produced
before then is candidate evidence and must be regenerated on the exact integrated
head before the `I` gate can pass.

## Goals

- Verify the six PRD UI surfaces at `1280x800` and `1440x900`.
- Exercise real empty and populated product states plus loading, error, disabled,
  and reconnect behavior where those states apply.
- Prove keyboard reachability, focus visibility and restoration, accessible names,
  roles and state, required text/non-text contrast, long-identifier handling,
  designated-pane scrolling, and zero document/body X/Y overflow.
- Generate a deterministic, opt-in screenshot corpus under
  `docs/ui-review/ui-gate/` without changing evidence during ordinary test runs.
- Turn every product defect found by the audit into a causal failing assertion
  before applying the smallest coherent correction.
- Preserve the existing UI design and every security, persistence, API, and
  deterministic behavior boundary.

## Surface Inventory

The six surfaces follow PRD section 11 rather than the number of application
routes:

1. Sidebar and primary navigation.
2. Shepherd Execution Contract Stream.
3. Shepherd Live Execution Timeline.
4. Shepherd Plane Tree and its detail drawer.
5. Project Group conversation and composer.
6. The Agent experience: Agent page plus Create/Edit configuration.

Authentication, Agents-list, Settings, and not-found views are adjacent starter-kit
regression surfaces. They will be exercised where they provide a required state
(for example authentication loading/error or Settings disabled controls), but they
do not replace any of the six PRD surfaces.

## Recommended Architecture

Add one dedicated Playwright UI-gate suite and a small test-only support module.
Register the suite in the existing `playwright.config.ts`; do not add a dependency,
new production endpoint, debug route, or package script while active branches own
`package.json`.

The support module owns repeated audit mechanics only:

- exact viewport and document/body overflow checks;
- designated-scroll-owner checks;
- keyboard traversal and visible-focus checks;
- accessible name, role, state, and relationship assertions;
- computed color parsing and WCAG contrast calculations;
- safe screenshot routing and evidence naming;
- public DOM/API/log secret and private-path canary scans.

The spec owns user journeys and expected product behavior. It starts the existing
compiled application with `startTestApp()`, uses authenticated public APIs to
create genuine product state, and drives the UI with role/name locators. Real
backend state is required for all positive product claims. Request interception is
permitted only to hold or fail an actual polling/bootstrap request so that loading,
error, and reconnect UI can be observed deterministically; it must not fabricate a
successful Mission, Contract, verification, candidate, or promotion result.

## State and Evidence Matrix

The suite will divide coverage into independently reviewable journeys:

### Clean shell and Agent configuration

- Authentication connecting, required-token, invalid-token error, and successful
  unlock states.
- Empty Agents list, Create Agent, validation-disabled submit, populated Agent
  page, Edit Agent, stopped/started Agent controls, and long-name/ID behavior.
- Sidebar navigation, current-route state, keyboard activation, and focus-visible
  styling throughout.

### Shepherd surfaces

- Empty/loading/error/retry states before any Mission exists.
- A real deterministic Mission furnishing populated Contract Stream, Timeline,
  Plane Tree, collision, candidate, promotion, evidence, and retained loser state.
- Contract filters, evidence disclosure, tree-node activation, drawer focus trap or
  contained tab order, Escape close, and focus restoration.
- Internal scrolling belongs to the stream, timeline/tree region, or drawer; the
  page itself must not acquire X or Y overflow.

### Project Group and disabled/reconnect states

- Empty/uninitialized Project Group, initialized group, disabled composer or
  mention target, real bounded request lifecycle, and long content.
- A polling request is deliberately held to expose loading/reconnecting copy, then
  released to prove reconciliation without duplicate messages or stale state.
- A polling request is deliberately failed to expose a bounded user-facing error,
  followed by successful retry/recovery against the real server.

### Adjacent regression states

- Settings tabs, locked/unavailable controls, save/discard disabled states, labels,
  and visible focus.
- Not-found recovery navigation.
- Existing Agent lifecycle and denial journeys remain the causal source of truth;
  the UI gate may call them as adjacent gates but will not copy their business
  assertions into a second divergent implementation.

Every evidence stage is captured at both viewports. Ordinary runs write only below
`.tmp/playwright-evidence/ui-gate/`; setting `E2E_UPDATE_EVIDENCE=true` writes the
reviewed corpus below `docs/ui-review/ui-gate/<viewport>/`.

## Accessibility and Visual Review

The automated audit targets WCAG 2.1 AA:

- `1.3.1`, `4.1.2`: semantic headings, landmarks, labels, roles, names, values,
  selected/expanded/disabled state, and dialog/tab relationships.
- `1.4.3`: at least `4.5:1` for normal text and `3:1` for large text.
- `1.4.11`: at least `3:1` for meaningful UI component boundaries and focus
  indicators.
- `2.1.1`, `2.4.3`, `2.4.7`: keyboard operation, logical order, visible focus,
  drawer close/restoration, and no keyboard trap.
- `2.5.5`: `44x44` CSS-pixel targets where the product presents touch-oriented
  controls; compact desktop-only controls require a documented exception rather
  than a fabricated pass.
- `3.2.1`, `3.3.1`, `3.3.2`: predictable focus behavior, identified errors, and
  input instructions.

Headless semantics are not a substitute for an actual screen-reader pass. The
candidate report will state that limitation and request an independent read-only
UI/accessibility review on the final screenshots and latest reviewable commit.
No `U` claim is made by the implementation owner.

Visual review compares every committed screenshot with `docs/UI.jpeg` and the
frozen design contract: charcoal sidebar, cream surfaces, restrained purple
primary accent, green/red semantic colors, existing typography/spacing, restrained
borders and shadows, readable pills, no unstyled states, and no overlap or
truncation without a title/accessible full value.

## Test-First Correction Policy

The initial audit may fail. For each failure:

1. Reduce it to one causal Playwright or component assertion and observe the
   expected RED result.
2. Confirm the production change that would make the assertion green.
3. Apply the smallest correction in the existing component or CSS primitive.
4. Re-run the focused assertion, its adjacent journey, both viewports, and relevant
   Web tests.
5. Preserve the accepted layout and avoid unrelated cleanup.

If a required correction touches a file owned by issue #78 or another active task,
stop and coordinate; do not expand ownership. The initial excluded files are
`apps/web/src/pages/AgentPage.tsx`, `apps/web/src/types.ts`, the deterministic/live
recording specs and configs, `package.json`, issue #44 startup/settings backend,
issue #47 authentication/OPS files, and issue #81 Contract-intake files.

## Planned Files

- Create `tests/e2e/support/ui-gate.mjs` for reusable audit mechanics.
- Create `tests/e2e/ui-gate.spec.mjs` for the state/evidence journeys.
- Modify `playwright.config.ts` only to register the new spec.
- Add reviewed PNG files below `docs/ui-review/ui-gate/` only during the explicit
  evidence run.
- Modify production UI or CSS files only after a causal RED finding and only when
  no active owner holds them.
- Defer shared `docs/TASKS.md` and `docs/BUILD_LOG.md` edits until current active PR
  ownership clears or coordination is recorded.

## Verification and Completion

Candidate verification consists of:

- focused support-module unit tests;
- the dedicated Playwright suite at both exact viewports;
- relevant Web component tests and strict test typecheck;
- Web and Server production builds required by the real compiled harness;
- public DOM/API/log and screenshot safety checks;
- an explicit evidence run and screenshot-by-screenshot accessibility/design
  review;
- the literal repository `npm run check` in hosted Node 22 CI.

The Windows worktree cannot establish a literal local baseline because Node cannot
spawn the npm/shell shims used by the launcher tests (`ENOENT`/`EFTYPE`) and Docker
is currently offline. This is recorded as environment evidence, not treated as a
product pass. The exact base commit `b193e57` has a successful hosted
`Node 22 / npm run check` job. The candidate must obtain its own hosted green job.

Issue #45 can close only after its blockers integrate, the branch is updated from
current `origin/main`, all evidence is regenerated on that exact head, an
independent reviewer resolves every High/Medium finding, protected integration
passes, and the integrated SHA is rerun. Until then the branch and draft PR must
say `C/B/U/I pending` or claim only the gates actually observed.
