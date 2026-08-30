# Shepherd Agent Instructions

## Entry point and codebase navigation

`docs/HANDOVER.md` was intentionally removed. Do not recreate or reference it.

Read in this order before editing:

1. [`docs/TASKS.md`](docs/TASKS.md) — current hackathon cut, remaining work,
   dependencies, acceptance gates, and evidence status.
2. The GitHub issue for the selected TASKS ID — current owner and branch/PR status.
3. The linked sections of [`docs/PRD.md`](docs/PRD.md) — required behavior.
4. [`docs/SHEPHERD.md`](docs/SHEPHERD.md) — as-built architecture, trust
   boundaries, implemented features, limitations, and rubric snapshot.
5. [`docs/LOCAL_POC.md`](docs/LOCAL_POC.md) — startup and manual demo runbook.
6. [`docs/TECHJAM.md`](docs/TECHJAM.md) — Track 1 rules and judging rubric.
7. [`docs/FIXES.md`](docs/FIXES.md) and [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md)
   when diagnosing a defect or updating verified evidence.

Primary code areas are indexed in `docs/TASKS.md` under **Requirement and code
navigation**. The PRD defines required behavior; TASKS records the current state.

## Claim work before editing

1. Fetch and prune remote refs. Inspect the issue, open PRs, remote branches, and
   worktrees; choose different work if an active owner already exists.
2. **Claim the GitHub issue immediately.** Assign it to yourself when permitted and
   leave a visible ownership comment naming the intended branch and primary files.
   Do not wait until implementation is complete.
3. Branch from current `origin/main`, or from the explicitly documented parent for
   a true dependency stack. Use `feat/`, `fix/`, `test/`, `audit/`, `refactor/`, or
   `docs/` plus the issue/TASKS ID.
4. **Push the new branch to `origin` before implementation edits.** This is the
   second ownership signal other agents must check.
5. Open a linked draft PR after the first comparable commit. State the issue/TASKS
   ID, PRD references, owned files, exclusions, base/parent, acceptance criteria,
   and test plan. Keep the issue and PR current.

Never push directly to protected `main`. Keep each branch narrow. Agents do not
merge their own PRs; the integrator reviews overlap, combined gates, stack order,
and protected-branch integration.

## Concurrent-agent isolation

- Use one GitHub issue, branch, and isolated Git worktree per implementation owner.
- Work only in the assigned worktree. Do not check out, commit to, rebase, merge,
  reset, delete, or force-push another agent's branch or worktree.
- Parallel branches normally target current `main`. Create a stack only for a real
  code dependency documented in both issues/PRs with an explicit merge order.
- Record primary owned files/modules and excluded adjacent work before editing.
  Shared central modules have one active owner at a time. Stop and coordinate if an
  unexpected required edit overlaps active ownership.

## UI freeze and minimal-change contract

- **The accepted UI design is frozen.** Do not redesign, restyle, re-theme, change
  layout, or perform visual cleanup. Functionalities, backend features, tests,
  reviews, evidence, and documentation are the active work.
- Touch UI code only when indispensable to expose required functional data, restore
  broken interaction, accessibility, or truthful state. Reuse existing components,
  spacing, typography, colors, and interaction patterns from `docs/UI.jpeg`.
- A minimal fix means the smallest coherent change that fully preserves intended
  behavior. It must not remove, disable, hide, stub, weaken, or narrow existing or
  required functionality merely to reduce the diff or make tests pass.
- Any unavoidable material UI correction requires browser verification at
  `1280x800` and `1440x900`, no document-level X/Y overflow, and read-only UI review.

## Change and evidence rules

- Preserve security boundaries, public contracts, deterministic behavior, baseline
  Agent CRUD/lifecycle/Playground behavior, and existing test assertions.
- Avoid unrelated refactors, formatting, renames, dependency churn, sleeps, retry
  inflation, suppression, or weakened assertions.
- Add causal regression coverage. Run targeted/adjacent checks and `npm run check`;
  run browser, live, security, stability, or post-merge gates when the issue requires
  them.
- Report only checks actually observed. Update `docs/BUILD_LOG.md` and the relevant
  `docs/TASKS.md` evidence when behavior or status changes.
- Never print or commit `.env`, credentials, private paths, raw model prompts or
  output, session identifiers, or unbounded logs. Default tests remain network- and
  model-free.
- After integration, the integrator verifies the scoped flow on updated `main`,
  updates the issue/ledger, and deletes only the merged feature branch when safe.
