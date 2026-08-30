# Shepherd: Multi-Agent Kernel

This document describes Shepherd's as-built design and trust boundaries.

For current implementation status, defects, confidence, pending tests, task IDs,
and agent workflow, use [`docs/TASKS.md`](TASKS.md). For run instructions, use
[`docs/LOCAL_POC.md`](LOCAL_POC.md). If a status statement here conflicts with the
task ledger, the task ledger wins. The product requirements remain authoritative in
[`docs/PRD.md`](PRD.md), while
[`docs/BUILD_LOG.md`](BUILD_LOG.md) is immutable historical evidence for the commit
and phase named in each entry.

## Hackathon status snapshot

The canonical delivery target is protected `main`. The latest verified product
candidate is PR #40 source `3d1a041`, integrated on the temporary campaign branch
at `005a51e`; protected-`main` promotion and post-merge evidence are pending this
integration. The deterministic kernel, strict
persistence/API boundaries, live isolated Runtime adapter, Agent roles and scoped
authority, cancellation/retry/selection/reset controls, Project Group lifecycle
storage, and all six requested UI surfaces are implemented.

This is a strong Track 1 proof of concept, not a full-PRD completion claim. Current
hackathon-submission completion is **82%**. The core middleware demonstration itself
is **90% demo-ready** because the primary deterministic journey is functional and
browser-verified; the remaining percentage is concentrated in Project Group's full
work path, one judge-visible denial, final live/stability/security gates, rehearsal,
and submission artifacts. The broader PRD intentionally retains additional work
after the hackathon cut. `TASKS.md` remains authoritative when status changes.
The 82% figure is a dependency- and rubric-weighted estimate of the required
hackathon work packages; it is not the raw ratio of audited full-PRD ledger rows.

| Hackathon completion dimension | Weight | Evidence completion | Contribution |
|---|---:|---:|---:|
| Core trusted middleware and preserved starter behavior | 50% | 96% | 48% |
| Judge-visible normal, collision, human, and denial journeys | 20% | 80% | 16% |
| Integrated live, security, stability, performance, and rehearsal gates | 20% | 65% | 13% |
| Architecture, test report, README, and final evidence reconciliation | 10% | 50% | 5% |
| **Current minimum-cut completion** | **100%** |  | **82%** |

The evidence-completion values are rounded judgments against the acceptance gates
listed in `TASKS.md`; future updates must change the underlying gate evidence, not
just the percentage.

### Implemented and demonstrable Track 1 features

| Capability | Backend behavior and evidence | Current confidence |
|---|---|---:|
| Preserved starter platform | Agent create/edit/start/stop/delete, Playground messages, Runs, workspaces, session continuity, persistence, and local container execution remain functional. | 95% |
| One-command local PoC | The launcher reads `.env`, localizes Docker-default paths, builds the Runtime and application, performs mount/startup checks, and serves the authenticated local UI. | 95% |
| User-selected specialists | A user can create Frontend and Backend Agents, then assign both identities and opposite typed auth transports to one Mission. The server revalidates role, readiness, authority, and reservation atomically. | 95% |
| Execution Contracts | Shepherd persists and displays Agent, Mission, Plane, objective, dependencies, semantic scope/claims, contextual inputs, scoped authority, artifacts, acceptance profile/checks, manifest path, and timestamps. | 96% |
| Isolated Planes | Each Contract and candidate executes in its own Git worktree from a trusted immutable base; Agents receive Git-free authority-filtered exports rather than protected repository access. | 94% |
| Independent verification | Registry-owned, credential-free, no-network checks inspect the exact committed output. Agent-authored manifests cannot self-certify acceptance. | 95% |
| Semantic collision detection | Independently valid frontend cookie and backend bearer outputs yield an `auth.transport` collision even when ordinary Git integration is clean. | 98% |
| Competing resolution futures | Cookie and bearer Resolution Planes fork from the same immutable integration commit, execute independently, and must pass the same project invariant. | 96% |
| Evidence-derived promotion | Deterministic selection uses persisted verification evidence; the winner receives final authority inspection, independent re-verification, expected-HEAD comparison, and compare-and-swap promotion. The loser remains inspectable. | 95% |
| Human escalation | Disabled/non-unique automatic resolution produces durable `attention_required` evidence and an internal human-review ticket. Only independently passing candidates can be selected manually and promoted through the same gate. | 92% |
| Durable audit and recovery | Typed lifecycle events, redaction, request idempotency, serialized schema-validated persistence, cancellation/reset, restart classification, Plane cleanup, and representative crash recovery are implemented. | 93% |
| Bounded model assistance | `SHEPHERD_MODEL` may perform one validated advisory semantic review. It cannot verify, choose, execute arbitrary commands, or promote; deterministic logic remains authoritative and degrades explicitly when review fails. | 90% |
| Middleware observability UI | Contract stream, execution timeline, Plane tree, collision/candidate evidence, Project Group lifecycle, Settings, and private Agent chat expose real backend state rather than static success screens. | 90% |
| Automated assurance | Final candidate evidence currently includes launcher 3/3, Server 739 passed plus two explicit live skips, Web 18/18, strict production/test type checks, builds, four focused browser journeys at both required viewports, and scoped independent UI/security passes. | 92% |

Confidence is scoped to the recorded deterministic/local evidence. It is not a claim
that the open exact-head live, final security, stability, and rehearsal gates passed.

### Pending but feasible before the end of today

These are the minimum remaining submission items, not every optional PRD extension.
They are feasible today with three to four non-overlapping owners, prompt review,
stable CI, and a working live provider/Runtime. Exact ownership and acceptance gates
are in the linked issues and `TASKS.md`.

| Work package | Required outcome | Estimate |
|---|---|---:|
| [Project Group journey #41](https://github.com/kyashp/shepherd/issues/41) | Bounded unmentioned Shepherd reply, click/type targeted Contract creation, verified manifest-derived Agent summary, and the full two-viewport E2E journey. | 2–4 h |
| [Failure matrix #42](https://github.com/kyashp/shepherd/issues/42) and [visible denial #43](https://github.com/kyashp/shepherd/issues/43) | Complete the demo-critical typed failure proofs, then visibly deny an unauthorized diff with retained evidence and no promotion. | 2–4 h |
| [Startup composition #44](https://github.com/kyashp/shepherd/issues/44) | Make automatic resolution and maximum Plane concurrency startup settings causally control `ShepherdService` while preserving later persisted choices. | 0.5–1 h |
| [UI gate #45](https://github.com/kyashp/shepherd/issues/45) and [performance #46](https://github.com/kyashp/shepherd/issues/46) | Verify—not redesign—all required surfaces/states at both viewports and record judge-path latency/overlap. | 2–3 h |
| [Live/host gate #47](https://github.com/kyashp/shepherd/issues/47) | One bounded exact-head live Shepherd Mission, legacy continuity, and presentation-host compatibility when applicable. | 1–2 h plus provider latency |
| [Stability #48](https://github.com/kyashp/shepherd/issues/48) and [security #49](https://github.com/kyashp/shepherd/issues/49) | Five consecutive literal gates, final trust-boundary/canary review, and causal fixes for any High/Medium finding. | 2–4 h plus fixes |
| [Demo rehearsal #50](https://github.com/kyashp/shepherd/issues/50) | Three clean reset-to-completion runs under three minutes with the normal and human/denial story. | 1–2 h |
| [Submission package #51](https://github.com/kyashp/shepherd/issues/51) | One-page architecture, exact test report, final README, reconciled docs, and dead/debug/artifact review. | 2–3 h |

Serial execution is approximately **13–23 hours**. With dependency-aware parallel
work, the realistic elapsed estimate is **6–10 hours**, with **8–12 hours** reserved
for CI, live-provider, or integration corrections. This is feasible today but not
guaranteed; feature work must freeze early enough for security, stability, and three
actual rehearsals.

Additional PRD work such as arbitrary dependency-wave scheduling, extended failure
journeys, duration estimates, mid-Mission restart UI reconciliation, and broader
retry/cancellation matrices is valuable but not required for the minimum Track 1
submission cut.

### Track 1 rubric assessment

This grading uses the weights in `TECHJAM.md`, observed repository/browser evidence,
and the no-middleware starter behavior as the baseline. It is a dated internal
assessment, not an official judge score.

| Track 1 category | Weight | Current score | Evidence and deductions |
|---|---:|---:|---|
| End-to-end middleware behavior | 40 | **34/40** | The complete deterministic Contract → Plane → verification → semantic collision → competing futures → re-verification → promotion/human-review path is real backend behavior and browser-visible. Deducted for unfinished full Project Group action/reply, judge-visible unauthorized denial, and current exact-head live Mission. |
| Technical design and integration | 25 | **23/25** | Strong trusted-kernel placement, typed contracts/state, authority intersection, Git/workspace isolation, credential-free verifier, deterministic model containment, persistence and CAS promotion. Deducted for fixed hero scheduling and startup-setting composition gap. |
| Verification and robustness | 20 | **18/20** | Large causal suite, strict types/builds, real Git/container boundaries, recovery/security tests, two-viewport journeys, independent reviews, hosted CI. Deducted until the final integrated security review and five consecutive stability runs pass. |
| Demo and reproducibility | 15 | **10/15** | One-command launcher, runbook, polished evidence UI, reset/manual selection, and verified browser hero exist. Deducted for missing three rehearsals, final live/host gate, architecture page, exact test report, and final README freeze. |
| **Weighted total** | **100** | **85/100** | Strong competitive prototype with concentrated, actionable submission gaps. |

**Current confidence of winning: 74/100.** The solution is unusually deep and
defensible for Track 1: the Agent cannot self-certify, semantic conflicts are
resolved through evidence-backed parallel futures, and protected promotion is owned
by trusted middleware. Winning confidence is below the rubric score because judging
also depends on competitor quality, clarity, timing, and live-demo reliability.

If issues #41–#51 pass exactly as written, projected rubric performance is
**92–95/100** and projected winning confidence is **84/100**. Novelty confidence is
**91/100**: the combination of typed Agent Contracts, independently verified
semantic claims, same-base competing resolution Planes, and final CAS promotion is
materially more distinctive than ordinary multi-Agent chat or task routing.

## Accepted design contract

Shepherd is a trusted execution kernel placed beside—not inside—the starter `AgentService`.

```text
Human / UI
    ↓ validated plan or trusted demo definition
Shepherd control plane
    ↓ typed Execution Contracts
isolated contract Planes
    ↓ actual-diff authority validation
credential-free independent verification
    ↓ normalized, evidence-backed claims
deterministic collision detection
    ↓ competing resolution Planes from one immutable SHA
credential-free independent candidate verification
    ↓ deterministic winner policy or human tie decision
final re-verification + expected-HEAD promotion gate
    ↓
managed protected branch
```

### Model responsibilities

- `ARK_MODEL` runs logical coding Agents in their isolated contract/candidate Plane.
- `SHEPHERD_MODEL` is reserved for bounded structured planning and best-effort semantic review. When configured, Mission orchestration calls the bounded reviewer once after verified Contract integration and before deterministic collision detection.
- Model output is always untrusted. It cannot certify verification, choose a winner by opinion, submit shell commands, mutate the protected branch, or bypass authority.
- Deterministic collision detection carries the demo-critical guarantee. Model-assisted review may raise advisory findings and emits an explicit degraded event on failure.

The deterministic executor remains available as an explicit, labelled mode and proves
the kernel independently of model variance. In live mode, each Contract and resolution
candidate uses a fresh `ARK_MODEL` Codex turn. Historical Phase 3 opt-in evidence
records two live Missions, each containing two Contract and two candidate turns; see
the exact scoped entries in `BUILD_LOG.md`. This does not replace the open exact-head
continuity gate in `LIVE-01`. The composed
`SHEPHERD_MODEL` reviewer smoke made exactly one external request, completed with two
validated findings, and preserved the deterministic outcome. Adapter normalization
and reviewer authority containment are audited. The separate current live Shepherd
Mission and legacy-continuity gate remains open as `LIVE-01`.

Recovery remains deterministic across the Phase 2 and Phase 3 boundaries. No LLM is
called during startup classification, evidence validation, interruption mapping,
cleanup, or trust adoption, and no model opinion can turn interrupted work green.

### Deterministic responsibilities

Trusted server code owns schemas, state transitions, scope intersection, actual Git-diff inspection, manifest ingestion, evidence validation, acceptance-profile lookup, no-network verification, collision predicates, candidate base equality, winner rules, final re-verification, protected-head comparison-and-swap, persistence, redaction, and event ordering.

### Security boundary

- Agents receive only generated execution identities and authority-filtered, Git-free
  exports; they never receive a trusted linked Plane worktree or protected Git
  metadata.
- A live Codex control process necessarily receives the scoped Ark credential and
  bridge access to call the configured provider. Its generated shell policy inherits
  no credential, and startup proves sandboxed spawned code cannot listen or connect.
- The verifier receives no model/API key, application token, Codex session, Docker socket, unrelated host environment, or network.
- Browser and model inputs select trusted identifiers; neither can provide host paths or executable commands.
- `.shepherd/result.json` is the sole Agent-written control artifact exception and is never promoted.
- Unsafe or ambiguous outcomes stop in an evidenced non-green state.

## Deterministic Mission flow (Phase 1)

1. Shepherd creates or reuses only its sentinel-marked managed fixture repository and records the immutable protected-branch base SHA.
2. Two Contracts receive intersected Agent/Contract authority and separate trusted Git worktrees. Each executor receives a separate authority-filtered, Git-free export with an opaque execution identity; the executors run concurrently and write project files plus a result manifest.
3. Trusted code imports the export into its Plane only after rejecting unsafe file types/metadata and proving the actual imported diff stays within authority. It then validates the manifest, removes the control artifact, and creates a trusted commit.
4. The independent verifier materializes a fresh read-only snapshot of that exact commit and runs only registry-owned commands in disposable containers. Passing mandatory evidence—not the Agent report—moves each Contract to `verified`; independently observed project facts must also corroborate semantic claim values before collision detection.
5. A clean integration worktree merges both commits. Normalized exclusive claims for `auth.transport` conflict despite no textual Git conflict.
6. Cookie and bearer reconciliation Planes fork from the same integration SHA and execute concurrently. Project-level verification objectively distinguishes them.
7. The deterministic policy selects from persisted evidence. The chosen Plane is re-checked for authority, re-verified, compared with the persisted decision and expected protected HEAD, then promoted through one trusted compare-and-swap path.
8. The loser remains inspectable, every transition is persisted as a bounded event, and any unsafe/ambiguous result stops without promotion.

The public API returns logical IDs, short Git evidence, and domain state, but strips host repository/worktree/workspace paths. The approved `.shepherd/result.json` relative control path may appear as declared evidence; it is not a host path and is absent from every promoted commit.

## Live Plane execution (Phase 3)

At startup, `auto` resolves to live only when the container Runtime and usable Ark
Agent configuration are both present. `live` is an explicit fail-closed request;
`deterministic` remains the stable no-model kernel/demo mode. The resolved mode is
reported by the application.

Before accepting live work, Shepherd reconciles only exact installation-owned
Runtime containers and private artifacts, then runs a credential-free preflight. The
preflight requires `codex-cli 0.111.0`, a non-root read-only-root container, and the
inner `workspace-write` sandbox. Inside that sandbox it proves `/workspace` is
writable, `/codex-home` is not, and TCP listen/connect operations are denied. A failed
or partially cleaned preflight prevents startup.

For each Contract or resolution candidate:

1. Trusted code creates a new authority-filtered, Git-free execution export and a
   versioned bounded prompt envelope.
2. Shepherd creates a unique private `CODEX_HOME` below its sentinel-guarded root and
   writes a minimal secret-free Codex config with a key-free shell environment.
3. A disposable container is created with only that export and private home mounted.
   The prompt is absent from argv and is sent on standard input to
   `codex exec --ephemeral --json --sandbox workspace-write
   --skip-git-repo-check -C /workspace -` after attaching by immutable container ID.
4. Exactly one fresh thread-start event is required. No prior session is resumed or
   shared. The raw thread ID is hashed, checked for reuse, discarded, and only the
   SHA-256 fingerprint is persisted privately.
5. The ordinary trusted import, actual-diff authority, independent verification,
   collision, candidate, re-verification, and protected-head CAS gates remain
   authoritative. Candidate verification must also corroborate the implemented
   semantic target against its persisted strategy.
6. The private home, execution export, and exact-owner container are removed on
   success, failure, timeout, cancellation, and restart reconciliation.

The Codex control process needs bridge networking to reach Ark. Model-authored shell
processes remain inside the preflight-proven inner sandbox. The acceptance verifier is
a different credential-free, session-free, no-network container and never relies on
the Agent's own report.

## Durable recovery model (Phase 2)

The JSON store is a single-server-per-data-root design. Within that process, mutations
are serialized and each publish is schema-validated, scrubbed, written through a
unique exclusive temporary file, synced, and atomically renamed. Running multiple
servers against one data root is unsupported and must be prevented operationally; it
is not presented as distributed durability.

On startup Shepherd first validates its installation nonce/marker, managed-root and
project sentinels, canonical Agent workspaces, Plane roots, Git registration, protected
ref, checked-out branch, index, and worktree. It never selects a repository or Plane
from persisted path text. Any ambiguity is made durable and startup aborts rather than
silently adopting state.

The only recoverable promotion gap is represented by a durable `promoting` Candidate
with passing promotion evidence linked to its verified resolution Plane. That evidence
must repeat exactly the candidate's trusted mandatory suite. The observed protected
HEAD must be that Plane's immutable HEAD and a descendant of the persisted expected
HEAD; the server-derived resolution branch/worktree must be registered, clean, and
exactly checked out. All other movement is untrusted and leaves the Project fenced for
explicit reset/recovery.

Verifier cleanup uses a persisted installation nonce plus configured Runtime identity.
The separate establishment marker makes a missing nonce after first boot a hard error,
while a first upgrade can establish both records once. These files and all Shepherd
identity metadata are bounded regular files opened with no-follow and non-blocking
semantics.

## Configuration

Real secrets belong only in ignored `.env`.

| Variable | Purpose |
| --- | --- |
| `ARK_API_KEY` | Credential for the configured OpenAI-compatible Responses API. |
| `ARK_MODEL` | Coding Agent model. |
| `SHEPHERD_MODEL` | Bounded planning/advisory-review model; defaults to `ARK_MODEL` when empty. When its configuration passes the adapter-aligned readiness gate, Mission orchestration injects one advisory review after verified Contract integration. |
| `ARK_BASE_URL` | Responses-compatible API root. |
| `APP_AUTH_TOKEN` | Shared local-demo bearer boundary; mandatory and non-placeholder whenever the server binds beyond loopback. |
| `RUNTIME_PROVIDER` | Starter Agent runtime (`local-process` or `container`); Shepherd verification always uses its independent container boundary. |
| `SHEPHERD_ROOT` | Sentinel-guarded managed fixture repositories and Plane worktrees; defaults below `APP_DATA_DIR`. |
| `SHEPHERD_CODEX_HOME_ROOT` | Sentinel-guarded parent for one private, ephemeral live-Plane `CODEX_HOME` per execution; must be inside `APP_DATA_DIR` and separate from shared Agent and managed Shepherd roots. |
| `SHEPHERD_EXECUTION_MODE` | `auto`, `live`, or `deterministic`. `auto` selects live only with usable Ark configuration plus the container Runtime; explicit live fails closed otherwise. |
| `SHEPHERD_DEMO_MODE` | Enables the fixed, path-free demo Mission and reset controls. |
| `SHEPHERD_AUTO_RESOLUTION` | Intended startup default for evidence-derived automatic selection. Current composition does not pass it into `ShepherdService`; see `ST-01`. |
| `SHEPHERD_DELETE_COMPLETED_PLANES` | Retention startup control. The current UI/service keeps completed Planes inspectable; final cleanup behavior remains subject to evidence-retention requirements. |
| `SHEPHERD_MAX_PARALLEL_PLANES` | Intended startup Plane-capacity setting. Current composition does not pass it into `ShepherdService`; persisted settings do control the service after update. See `ST-01`. |
| `SHEPHERD_CONTRACT_TIMEOUT_MS` | Maximum contract execution duration. |
| `SHEPHERD_CANDIDATE_TIMEOUT_MS` | Maximum candidate execution duration. |
| `SHEPHERD_VERIFICATION_TIMEOUT_MS` | Maximum duration accepted by the independent verifier. |
| `SHEPHERD_VERIFIER_IMAGE` | Pre-built no-network verification image; defaults to `CONTAINER_RUNTIME_IMAGE`. |
| `CODEX_SANDBOX_MODE` | Must resolve to `workspace-write` for live Shepherd execution; startup preflight proves its filesystem and socket restrictions. |

No configured secret value is documented, persisted into Shepherd state, sent to the verifier, or rendered in the browser.

## Evidence and further documentation

- `docs/BUILD_LOG.md` — executed commands and bounded observations.
- `docs/DEVIATIONS.md` — accepted clarifications and material deviations.
- `docs/TASKS.md` — authoritative current status, completion cut, tasks, and agent workflow.
- `docs/LOCAL_POC.md` — startup, troubleshooting, and exact manual demo runbook.
- `docs/TECHJAM.md` — Track 1 competition context, judging, and deliverables.
- `docs/ui-review/` — inspected UI evidence by viewport and journey.
- `docs/SHEPHERD_ARCHITECTURE.md` — generated after the implementation freezes.
- `docs/SHEPHERD_TEST_REPORT.md` — generated from final executed suites.
