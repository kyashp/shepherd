# Contributing

Start with [docs/TASKS.md](docs/TASKS.md). It is the current implementation,
defect, test-gap, ownership, and verification entry point. `docs/PRD.md` remains
the product-requirement authority; historical build logs are evidence, not the
live task board. Use [docs/LOCAL_POC.md](docs/LOCAL_POC.md) for the runbook.

Keep changes focused, reproducible, and suitable for a hackathon delivery.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

For container-based Agent execution, follow
[docs/LOCAL_POC.md](docs/LOCAL_POC.md).

## Validate

```bash
npm run check
terraform fmt -check -recursive deploy/volcengine
docker compose config
```

## Pull requests

- Claim one TASKS item through a GitHub issue **immediately**: assign yourself when
  permitted and comment with the intended branch and primary owned files. If that
  issue already has an active owner, branch, or draft PR, choose another task.
- Create a branch from current `origin/main`, push it immediately, and open a
  linked draft PR. Dependent work targets the branch below it in a short true stack.
- Keep one concern per PR and include its tests in the same PR. Do not create a
  separate "tests later" layer for behavior introduced by the PR.
- Explain the behavior, root cause where applicable, acceptance criteria,
  dependency/stack position, and reason for the change.
- Add causal tests for API, lifecycle, persistence, Runtime, or UI changes.
- Record exact commands and observed results; planned results are not evidence.
- Every PR requires independent review. A confidence below 100 remains marked
  for review; scoped 100 still requires the normal reviewer gate.
- Material trust-boundary/security changes require independent security review.
- The accepted UI is frozen. Do not redesign or restyle it. Touch UI only when a
  required functional state, broken interaction, or accessibility defect cannot be
  fixed elsewhere; preserve the existing system and run both viewport/UI gates.
- A minimal correction must still preserve the complete intended functionality. Do
  not remove, hide, disable, stub, or weaken behavior merely to reduce the diff.
- Merge only through reviewed PRs into protected `main` after relevant checks pass,
  then let the integrator run the scoped post-merge smoke there.
- Update English documentation and `.env.example` when configuration changes.
- Use GitHub Flavored Markdown and relative repository links.
- Never commit credentials, local state, workspaces, build output, or Terraform
  state.
- Report security issues according to [SECURITY.md](SECURITY.md).

The repository PR template is the evidence checklist. See the workflow and
completion rules in [docs/TASKS.md](docs/TASKS.md#working-contract).
