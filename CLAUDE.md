# Claude Code Instructions

Follow [`AGENTS.md`](AGENTS.md); it is authoritative for ownership, branches,
verification, UI freeze, and minimal-change requirements.

`docs/HANDOVER.md` was removed. Navigate the repository in this order:

1. [`docs/TASKS.md`](docs/TASKS.md) for the hackathon cut and work queue.
2. The selected GitHub issue and its linked [`docs/PRD.md`](docs/PRD.md) sections.
3. [`docs/SHEPHERD.md`](docs/SHEPHERD.md) for architecture and current capabilities.
4. [`docs/LOCAL_POC.md`](docs/LOCAL_POC.md) for startup and demo verification.
5. [`docs/TECHJAM.md`](docs/TECHJAM.md) for Track 1 judging requirements.
6. [`docs/FIXES.md`](docs/FIXES.md) and [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md)
   for defects and observed evidence.

Before editing, fetch/prune and inspect issues, PRs, remote branches, and worktrees.
**Claim one issue immediately** by assigning yourself when permitted and posting an
ownership comment with branch and primary files. Create a narrow branch from current
`origin/main` (or its explicitly documented stack parent), then **push it to origin
before implementation edits**. Open a linked draft PR after the first comparable
commit. Never push directly to or self-merge protected `main`.

The UI design is frozen. Work on functionality, backend features, tests, reviews,
evidence, and documentation. Touch UI code only when required for truthful data,
broken interaction, or accessibility, and preserve the existing theme and layout.
“Minimal fix” means the smallest complete correction; it never permits removing,
hiding, disabling, stubbing, weakening, or narrowing intended functionality.

Add causal tests, run applicable repository gates including `npm run check`, and do
not claim unobserved results. Never expose secrets, raw prompts, private paths, or
unbounded logs. Update TASKS/build evidence only from observed results.
