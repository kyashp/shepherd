# Claude Code Instructions

Follow [`AGENTS.md`](AGENTS.md) and use [`docs/HANDOVER.md`](docs/HANDOVER.md) as
the required project entry point. Read the relevant [`docs/PRD.md`](docs/PRD.md)
requirements before changing behavior.

Before editing, fetch/prune and inspect GitHub issues, open PRs, and remote branches
for an existing owner. Claim one task, create a narrowly named feature/fix/test
branch from current `main` (or its documented stack parent), and **push that branch
to `origin` immediately before implementation edits** so every other agent can see
that the work is claimed. Open a linked draft PR as soon as the branch has a
comparable commit, and record its HANDOVER ID, scope, base, acceptance criteria,
and test plan. Never push directly to `main`; merge dependent PRs bottom-up.

Use the smallest coherent change, preserve existing contracts and the Launchpad UI,
add regression tests, and run only the applicable repository gates—including
`npm run check` before completion. Do not claim unobserved results or expose secrets.
Update handover/build evidence when status changes, verify after merge on `main`,
and delete the merged branch.
