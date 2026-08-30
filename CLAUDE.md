# Claude Code Instructions

Follow [`AGENTS.md`](AGENTS.md) and use [`docs/TASKS.md`](docs/TASKS.md) as the
required project entry point. Read the relevant [`docs/PRD.md`](docs/PRD.md)
requirements before changing behavior, and use
[`docs/LOCAL_POC.md`](docs/LOCAL_POC.md) for the runbook.

Before editing, fetch/prune and inspect GitHub issues, open PRs, and remote branches
for an existing owner. Claim one task, create a narrowly named feature/fix/test
branch from current `origin/mock-main` (or its documented stack parent), and **push that branch
to `origin` immediately before implementation edits** so every other agent can see
that the work is claimed. Open a linked draft PR as soon as the branch has a
comparable commit, and record its TASKS ID, scope, base, acceptance criteria,
and test plan. Never push directly to `main` or `mock-main`; merge reviewed dependent
PRs bottom-up into `mock-main`. Only the integrator promotes the completed campaign
to protected `main`.

Use the smallest coherent change, preserve existing contracts and the Launchpad UI,
add regression tests, and run only the applicable repository gates—including
`npm run check` before completion. Do not claim unobserved results or expose secrets.
Update task/build evidence when status changes, verify after merge on `mock-main`,
and delete the merged branch.
