# Shepherd Agent Instructions

Start with [`docs/HANDOVER.md`](docs/HANDOVER.md), then read the linked PRD sections
and affected code/tests. The PRD defines required behavior; the handover defines
current evidence, defects, task IDs, and the runbook.

## Claim work before editing

1. Fetch and prune remote refs. Check the task's GitHub issue, open PRs, and remote
   branches; choose different work if it already has an active owner.
2. Assign the issue and move it to `In Progress` when project access is available.
3. Branch from current `main`, or from the documented parent for a true stack. Use
   `feat/`, `fix/`, `test/`, `audit/`, `refactor/`, or `docs/` plus the issue/task ID.
4. **Push the new branch to `origin` immediately, before implementation edits.**
   This is the early ownership signal other agents must check.
5. Open a linked draft PR as soon as the branch has a comparable commit. State the
   HANDOVER ID, PRD references, owned files, parent/base, acceptance criteria, and
   test plan. Keep the issue and PR current.

Never push directly to `main`. Keep each branch narrowly scoped, do not edit files
owned by another active task, and merge stacks bottom-up through protected PRs.

## Change and evidence rules

- Make the smallest coherent fix; avoid unrelated refactors, formatting, renames,
  dependency churn, or weakened assertions.
- Preserve security boundaries, public contracts, deterministic behavior, and the
  existing Launchpad UI. UI changes must remain faithful to `docs/UI.jpeg` and be
  browser-checked at `1280x800` and `1440x900`.
- Add causal regression coverage. Run targeted/adjacent checks and `npm run check`;
  run the handover's browser, live, security, or post-merge gates when applicable.
- Report only checks actually observed. Update `docs/BUILD_LOG.md` and relevant
  HANDOVER evidence when behavior or status changes.
- Never print or commit `.env`, credentials, private paths, raw model prompts, or
  unbounded logs. Default tests should remain network/model-free.
- After merge, verify the scoped flow on updated `main`, update the issue/ledger,
  and delete the merged remote and local branch.
