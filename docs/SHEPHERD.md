# Shepherd: Multi-Agent Kernel

This is the as-built operating document for Shepherd. It will be updated at every implementation phase. Statements under **Implemented and verified** are backed by `docs/BUILD_LOG.md`; statements under **Accepted design contract** describe the approved target until their phase gate passes.

## Implementation status

### Implemented and verified

- Starter Agent CRUD/control-plane baseline builds and tests.
- Real Responses API access for the configured Agent and Shepherd models.
- Real disposable-container Agent execution, same-thread follow-up, and restart/workspace persistence.
- Repository-local test/browser scratch roots and tracked credential-example hygiene.
- Rendered starter UI baselines at 1440×900 and 1280×800.
- Version-2 JSON persistence with lossless version-1 migration, serialized atomic writes, monotonic Shepherd events, and whole-state sensitive-string scrubbing.
- Typed Shepherd Projects, Missions, Contracts, authorities, Planes, claims, collisions, resolution candidates, verification evidence, events, group messages, and settings.
- Structurally checked Mission/Contract transitions; only the independent verifier may certify a Contract, and mandatory evidence must match the target.
- Managed authentication fixture repository plus real Git contract, integration, and resolution worktrees.
- Executors receive authority-filtered, Git-free exports rather than trusted Plane worktrees. Trusted import derives the actual diff and rejects path escapes, symlinks, special files, protected metadata, and out-of-scope writes before changing a Plane.
- Actual-diff authority enforcement at import, commit, merge, and promotion boundaries, with always-protected `.git/**`, `.shepherd/**`, and secret paths. The exact Agent-written `.shepherd/result.json` ingestion exception is schema-validated and never staged.
- Credential-free, no-network Docker verification against a fresh, read-only snapshot of an exact trusted commit—not a mutable executor workspace—with trusted command profiles and bounded CPU, memory, PIDs, time, and output.
- Deterministic claim normalization/collision detection, concurrent speculative candidates from one integration SHA, evidence-derived winner selection, final re-verification, and compare-and-swap promotion.
- Independent claim corroboration before semantic claims become collision inputs; a forged manifest value fails closed with durable rejected-claim evidence.
- A deterministic end-to-end demo Mission that chooses the HttpOnly-cookie design under the default security policy and flips to bearer JWT when the declared invariant is reversed.
- Authenticated read APIs for state, Mission detail, and cursor events, plus a demo-mode-only asynchronous Mission start endpoint with strict input validation and public path stripping.
- Loopback-safe default binding; non-loopback binding requires a strong non-placeholder application token. Public DTO allowlists and bounded redacted errors prevent host-path and credential disclosure.
- Checked compare-and-swap rollback if protected-ref/worktree synchronization fails, with distinct failure evidence when rollback itself cannot be proven.
- Real HTTP, restart, Git, persistence, and container verification of the complete deterministic chain.
- Strict bounded V1/V2 database validation on both load and publish, including canonical paths/refs, complete references, lifecycle proofs, exact evidence-to-Plane diffs, collision-source validity, promotion proof, and false-green completion rejection.
- Bounded no-follow/non-blocking state and sentinel reads; exclusive synced temporary writes; atomic store publication; and fail-closed handling for symlinks, FIFOs, oversized state, invalid outgoing state, and persistence errors.
- Startup reconciliation at five real process-kill boundaries. In-flight work becomes evidenced `interrupted/attention_required`, private artifacts are cleaned, Agents are released, and a second restart is cursor-idempotent.
- A durable pre-CAS promotion proof containing the exact final frontend/backend/project-security verification suite. Only an exact `promoting` record with Git/worktree/ancestry corroboration can ratify a post-CAS crash; `reverifying` is never sufficient.
- Fail-closed protected branch/index/worktree reconciliation, including detached or alternate checkout, dirty state, unregistered/substituted resolution worktrees, external movement, and the update-ref/read-tree gap.
- Restart-stable installation-scoped verifier ownership, exact-label orphan cleanup, strict Agent workspace rebinding, and refusal to adopt old managed repositories after database loss.

### Not yet implemented

The deterministic walking skeleton and persistence/restart hardening are complete. Remaining phases add the general DAG scheduler and complete failure matrix, live per-Plane Codex execution, structured planning, bounded model-assisted review, cancellation/retry/tie APIs, Project Group routing, demo reset, all six UI surfaces, and full browser/rehearsal evidence. These are not described as implemented until their phase gates pass.

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
- `SHEPHERD_MODEL` performs bounded structured planning and best-effort semantic review.
- Model output is always untrusted. It cannot certify verification, choose a winner by opinion, submit shell commands, mutate the protected branch, or bypass authority.
- Deterministic collision detection carries the demo-critical guarantee. Model-assisted review may raise advisory findings and emits an explicit degraded event on failure.

At the Phase 1 boundary, the Shepherd product path deliberately uses `DeterministicFixtureExecutor`; neither configured model is called by a Mission. This proves the kernel independently of model variance. Live Agents and the advisory reviewer are connected only in later phases, without transferring any trusted decision to a model.

Phase 2 does not change that model boundary. All restart classification, evidence
validation, interruption mapping, cleanup, and trust adoption are deterministic. No
LLM is called during startup recovery, and no model opinion can turn interrupted work
green.

### Deterministic responsibilities

Trusted server code owns schemas, state transitions, scope intersection, actual Git-diff inspection, manifest ingestion, evidence validation, acceptance-profile lookup, no-network verification, collision predicates, candidate base equality, winner rules, final re-verification, protected-head comparison-and-swap, persistence, redaction, and event ordering.

### Security boundary

- Agents receive only generated execution identities and managed Plane workspaces.
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
| `SHEPHERD_MODEL` | Planning/review model; will default to `ARK_MODEL` when empty. |
| `ARK_BASE_URL` | Responses-compatible API root. |
| `APP_AUTH_TOKEN` | Shared local-demo bearer boundary; mandatory and non-placeholder whenever the server binds beyond loopback. |
| `RUNTIME_PROVIDER` | Starter Agent runtime (`local-process` or `container`); Shepherd verification always uses its independent container boundary. |
| `SHEPHERD_ROOT` | Sentinel-guarded managed fixture repositories and Plane worktrees; defaults below `APP_DATA_DIR`. |
| `SHEPHERD_DEMO_MODE` | Enables only the fixed, path-free demo Mission/reset HTTP controls. |
| `SHEPHERD_AUTO_RESOLUTION` | Enables deterministic automatic selection when evidence yields one justified winner. |
| `SHEPHERD_DELETE_COMPLETED_PLANES` | Optional post-completion cleanup; disabled by default so evidence remains inspectable. |
| `SHEPHERD_MAX_PARALLEL_PLANES` | Bounded scheduler concurrency (1–16). |
| `SHEPHERD_CONTRACT_TIMEOUT_MS` | Maximum contract execution duration. |
| `SHEPHERD_CANDIDATE_TIMEOUT_MS` | Maximum candidate execution duration. |
| `SHEPHERD_VERIFICATION_TIMEOUT_MS` | Maximum duration accepted by the independent verifier. |
| `SHEPHERD_VERIFIER_IMAGE` | Pre-built no-network verification image; defaults to `CONTAINER_RUNTIME_IMAGE`. |

No configured secret value is documented, persisted into Shepherd state, sent to the verifier, or rendered in the browser.

## Evidence and further documentation

- `docs/BUILD_LOG.md` — executed commands and bounded observations.
- `docs/DEVIATIONS.md` — accepted clarifications and material deviations.
- `docs/ui-review/` — inspected UI evidence by viewport and journey.
- `docs/SHEPHERD_ARCHITECTURE.md` — generated after the implementation freezes.
- `docs/SHEPHERD_TEST_REPORT.md` — generated from final executed suites.
- `HANDOFF.md` — final continuation guide.
