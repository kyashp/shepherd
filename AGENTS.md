# Shepherd Agent Instructions

Start with [`docs/TASKS.md`](docs/TASKS.md), then read the linked PRD sections and
affected code/tests. The PRD defines required behavior; `TASKS.md` defines current
status, ownership, evidence, defects, and the hackathon completion cut. Use
[`docs/LOCAL_POC.md`](docs/LOCAL_POC.md) for the runbook.

## Claim work before editing

1. Fetch and prune remote refs. Check the task's GitHub issue, open PRs, and remote
   branches; choose different work if it already has an active owner.
2. Assign the issue and move it to `In Progress` when project access is available.
3. During the completion campaign, branch from current `origin/mock-main`, or from
   the documented parent for a true stack. Use
   `feat/`, `fix/`, `test/`, `audit/`, `refactor/`, or `docs/` plus the issue/task ID.
4. **Push the new branch to `origin` immediately, before implementation edits.**
   This is the early ownership signal other agents must check.
5. Open a linked draft PR as soon as the branch has a comparable commit. State the
   TASKS ID, PRD references, owned files, parent/base, acceptance criteria, and
   test plan. Keep the issue and PR current.

Never push directly to `main` or `mock-main`. Keep each branch narrowly scoped, do
not edit files owned by another active task, and merge stacks bottom-up through
reviewed PRs into `mock-main`. Only the repository integrator promotes the completed
campaign from `mock-main` to protected `main`.

## Concurrent agent isolation

- Use one GitHub issue, branch, and isolated Git worktree per implementation owner.
  An agent must work only from its assigned worktree and must not check out, commit
  to, rebase, merge, reset, or delete another agent's branch or worktree.
- Parallel branches target current `mock-main` independently unless a real code
  dependency is recorded in both issues and PRs. Do not create a stack merely to
  coordinate agents; the integrator explicitly assigns every stack parent and merge
  order.
- Record primary owned files/modules and excluded adjacent work before editing.
  Shared central modules have one active owner at a time. If an unexpected required
  edit overlaps another active task, stop and coordinate instead of expanding scope.
- At the start of every work session, fetch/prune remote metadata and verify the
  current worktree path, branch, issue assignment, open PRs, and clean status. Push
  commits only to the branch assigned to that worktree.
- Agents do not merge their own PRs or integrate sibling branches. The integrator
  reviews overlap, runs combined gates, controls rebases/retargeting, and merges
  through the protected workflow.

## Change and evidence rules

- Make the smallest coherent fix; avoid unrelated refactors, formatting, renames,
  dependency churn, or weakened assertions.
- Preserve security boundaries, public contracts, deterministic behavior, and the
  existing Launchpad UI. UI changes must remain faithful to `docs/UI.jpeg` and be
  browser-checked at `1280x800` and `1440x900`.
- Add causal regression coverage. Run targeted/adjacent checks and `npm run check`;
  run the task's browser, live, security, or post-merge gates when applicable.
- Report only checks actually observed. Update `docs/BUILD_LOG.md` and the relevant
  `docs/TASKS.md` evidence when behavior or status changes.
- Never print or commit `.env`, credentials, private paths, raw model prompts, or
  unbounded logs. Default tests should remain network/model-free.
- After merge, verify the scoped flow on updated `mock-main`, update the issue/ledger,
  and delete the merged remote and local branch.
