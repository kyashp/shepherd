# Shepherd: Multi-Agent Kernel

This document describes Shepherd's as-built design and trust boundaries.

For current implementation status, defects, confidence, pending tests, task IDs,
run instructions, and agent workflow, use [`docs/HANDOVER.md`](HANDOVER.md). If a
status statement here conflicts with the handover, the handover wins. The product
requirements remain authoritative in [`docs/PRD.md`](PRD.md), while
[`docs/BUILD_LOG.md`](BUILD_LOG.md) is immutable historical evidence for the commit
and phase named in each entry.

## Implementation status

The current `main` contains the deterministic kernel, strict persistence and API
boundaries, live isolated Agent runtime adapter, cancellation/retry/selection/reset
controls, Project Group storage/routing foundations, Agent roles/authority, and the
six requested UI surfaces. The deterministic backend demo path was rerun at the
snapshot recorded in the handover.

This is not a full-PRD completion claim. The current blocking areas are specifically
the Project Group end-to-end behavior, advisory-review live finding normalization
(`MR-03`), general service DAG waves, several typed failure/recovery paths, full
browser/visual/accessibility evidence, repeated stability and demo timing, and Phase
9 deliverables. Use the requirement matrix and task ledger in the handover rather
than deriving status from this summary.

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
candidate uses a fresh `ARK_MODEL` Codex turn. Two live Missions, each containing two
Contract and two candidate turns, have passed the opt-in gate. The composed
`SHEPHERD_MODEL` live smoke made one request and preserved the deterministic outcome,
but it reported an explicit `invalid_response` degradation. No live completed finding
is claimed; `MR-03` tracks that separate adapter-normalization correction.

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
| `SHEPHERD_DEMO_MODE` | Enables the fixed, path-free demo Mission and reset controls. Clean-start reset currently has a known defect recorded in `HANDOVER.md`. |
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
- `docs/HANDOVER.md` — authoritative current status, tasks, runbook, and agent workflow.
- `docs/ui-review/` — inspected UI evidence by viewport and journey.
- `docs/SHEPHERD_ARCHITECTURE.md` — generated after the implementation freezes.
- `docs/SHEPHERD_TEST_REPORT.md` — generated from final executed suites.
