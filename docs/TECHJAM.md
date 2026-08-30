# TikTok TechJam 2026 — Track 1 Brief

> Source: [TikTok TechJam 2026 Tracks & Problem Statements](https://bytedance.larkoffice.com/wiki/DNtSwxgeciCS2nkiUefc5qqtnkf)
> Source page last updated: 25 August 2026; retrieved 25 August 2026,
> Singapore time. The source password is intentionally not stored here.

This repository targets **Track 1 — Agent Launchpad: Design and Build Lightweight
Agent Middleware**. [`PRD.md`](PRD.md) is Shepherd's implementation contract;
[`TASKS.md`](TASKS.md) is the current completion ledger.

## Workshop

The Track 1 workshop and Q&A was scheduled for Friday, 28 August 2026,
1:00–1:45 p.m. Singapore time (GMT+8), in
[Lark Meeting 484622806](https://vc-my.larkoffice.com/j/484622806).

## Goal

Teams receive a functioning platform where users can create, run, stop, edit, test,
and delete AI agents. The challenge is to add one meaningful infrastructure
capability between its existing components—not rebuild the product.

Useful middleware can control what an Agent may do, record what it did, recover from
failure, manage cost, coordinate multiple Agents, or strengthen isolation and
safety. Depth, architecture, integration, and evidence matter more than feature
count.

The extension must remain functional and testable without breaking Agent CRUD,
lifecycle controls, Playground chat, persistence, or model execution.

## Starter Kit and extension boundary

The starter repository is [RrankPyramid/CodeJam](https://github.com/RrankPyramid/CodeJam).

| Area | Provided | Team responsibility |
|---|---|---|
| Product | React UI, Agent list/forms, lifecycle controls, Playground, run status | Preserve the baseline; add only enough UI to reveal middleware behavior. |
| Control plane | Fastify API, validation, asynchronous Runs, `AgentService`, JSON persistence | Integrate the real middleware decision into a trusted backend path. |
| Runtime | Codex CLI, persistent sessions/workspaces, disposable local containers | Insert middleware at the execution boundary that owns the decision. |
| Infrastructure | Docker, Colima, Podman, Compose, optional ECS/Terraform | Use the smallest path that proves the idea; cloud is optional. |

Valid seams include the Fastify boundary, `AgentService`, `AgentRunner`, execution
data model, persistence layer, and Runtime. Teams may add events, principals,
policies, lifecycle behavior, provider adapters, memory controls, reliability
mechanisms, or coherent coordination behavior.

The starter remains a single-user proof of concept. Its optional bearer token is
not user identity or authorization, its JSON store is single-process, and ordinary
containers are not hardened multi-tenant isolation.

## Required engineering qualities

- Preserve Agent CRUD, lifecycle actions, Playground chat, persistence, and model
  execution.
- Execute the middleware in a trusted backend, Runtime, data, or infrastructure
  path. Static screens and hard-coded success responses do not qualify.
- Explain which component owns each decision or event, what crosses each boundary,
  and how failures are handled.
- Demonstrate normal behavior and one relevant failure, denial, degradation, abuse,
  or recovery case.
- Add automated tests for the middleware itself, not only its UI.
- Never commit or display API keys, Volcengine AK/SK values, passwords, bearer
  tokens, or unredacted sensitive payloads.
- Prefer the local Docker/Colima/Podman judging path. ECS is optional and does not
  increase the score by itself.

In scope are a focused middleware story, its supporting backend capabilities,
minimal UI, schemas, protected fixtures, controlled failures, policy decisions,
reliability mechanisms, and contract-focused refactors. Rebuilding the whole
product, production OAuth, a commercial cloud platform, a general policy engine,
microVM infrastructure, or multi-region deployment is unnecessary unless central
to the selected idea.

## Representative middleware directions

- Identity, scoped delegation, authorization, approvals, and attributable policy
  decisions enforced by the server.
- Correlated traces, audit history, timing/status, failure diagnosis, redaction,
  resource signals, and visual timelines or trees.
- Explicit layered architecture with replaceable provider/runtime contracts.
- Threat modeling, least privilege, redaction, allowlists, typed schemas, target
  scoping, timeouts, limits, containment, and residual-risk reporting.
- Multi-Agent coordination with shared state, routing or turn rules, attributable
  history, and timeout/recovery behavior.
- Lifecycle reconciliation, failure recovery, human approval, budget control,
  provider abstraction, versioning, rollback, or another coherent middleware story.

Shepherd selects the multi-Agent coordination and reliability direction: trusted
Execution Contracts, isolated Git Planes, credential-free independent verification,
deterministic semantic collision detection, parallel resolution futures, and a
protected evidence-derived promotion gate.

## Baseline and validation

The supported local baseline requires macOS or Linux, Node.js 22+, npm 10+, one of
Docker/Colima/Podman, an Ark model API key, and a Responses-capable endpoint.
Shepherd's current command is documented in [`LOCAL_POC.md`](LOCAL_POC.md).

The baseline acceptance flow is: create an Agent; submit a real small coding task;
verify its completed response and artifacts; send a follow-up and verify session
continuity; stop/restart; and verify workspace persistence.

The required repository validation command is:

```bash
npm run check
```

## Demo and deliverables

The live demonstration must create or select a runnable Agent, execute a real task,
show at least one real model/file/tool/sandbox/data/infrastructure action, expose the
middleware behavior and evidence, demonstrate a relevant failure or recovery, and
leave the platform understandable and controllable. Mock external services are
acceptable; a static UI is not.

| Deliverable | Requirement |
|---|---|
| Three-minute live demo | One real Agent run, normal middleware behavior, and one failure, denial, degradation, abuse, or recovery case. |
| One-page architecture diagram | Middleware, data flow, trust boundary, and enforcement/instrumentation/recovery point. |
| Code repository | Setup, problem/rationale, design, automated tests, demo steps, limitations, and no secrets. |

## Judging

| Track 1 category | Weight |
|---|---:|
| End-to-end middleware behavior | 40% |
| Technical design and integration | 25% |
| Verification and robustness | 20% |
| Demo and reproducibility | 15% |

## Submission checklist

- A reviewer can start the repository from the documented command.
- Agent creation, a real task, follow-up continuity, and restart persistence work.
- Middleware executes outside the UI and exposes evidence through the product.
- The demo includes a normal path and a relevant failure/recovery path.
- `npm run check` passes and core middleware behavior has automated evidence.
- The architecture diagram identifies the trusted decision and promotion boundary.
- The demo completes within three minutes and has been rehearsed from clean state.
- No secret appears in source, Git history, logs, traces, screenshots, browser
  storage, or the presentation.

## Simple-to-technical bridge

Track 1 asks for the missing rules and control system around an AI Agent. In
technical terms, the solution intercepts requests or execution events at a trusted
boundary, applies an operational mechanism, persists correlated evidence, exposes
minimal APIs/UI, and tests an allowed path plus a denial, failure, or recovery path.
The central architecture question is: **which trusted component must own this
decision so that an Agent cannot bypass it?**

## Track 1 links

- [Official problem statement](https://bytedance.larkoffice.com/wiki/DNtSwxgeciCS2nkiUefc5qqtnkf)
- [Workshop meeting](https://vc-my.larkoffice.com/j/484622806)
- [Starter repository](https://github.com/RrankPyramid/CodeJam)
