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
- Versioned, bounded, secret-scanned Contract and resolution-candidate prompt envelopes assembled only by trusted code. Contracts receive exact declared canonical claim keys and semantic scopes; resolution candidates receive an exact target strategy and are forbidden from writing `.shepherd/**`.
- Canonical semantic-scope enforcement during Contract manifest ingestion. Undeclared scopes fail with invalid semantic evidence instead of bypassing collision detection.
- Trusted resolution target corroboration: independently observed acceptance facts must equal a candidate's persisted canonical target as well as pass the mandatory suite. A substituted target cannot tie, win, or promote.
- Configurable deterministic/live execution selection. `auto` resolves to live only with a usable Ark Agent configuration and the container Runtime; explicit `live` fails closed without those prerequisites or the required `workspace-write` sandbox.
- Fresh per-Plane Codex turns using Git-free exports, unique execution identities, private per-run `CODEX_HOME` directories, stdin-only prompts, no resumed thread, create-before-attach container identity, and exact-owner cleanup.
- Hardened live Runtime containers: non-root, read-only root, dedicated tmpfs, dropped capabilities, no-new-privileges, bounded CPU/memory/PIDs/time/output, and only the execution export plus its private home mounted.
- Startup live-Runtime preflight for the pinned Codex CLI, positive workspace-write proof, negative private-home-write proof, and sandboxed TCP listen/connect denial. The generated model-shell environment does not inherit the Ark credential.
- Raw Codex thread IDs remain transient. Only unique SHA-256 session fingerprints are persisted; public DTOs expose a boolean session-established fact and never the fingerprint, raw ID, or prompt.
- Two fresh live-model Missions completed end to end with eight unique isolated sessions, the expected semantic collision and evidence-derived winner, promoted Git state, no persisted secret/prompt/raw-session material, and no remaining Runtime or verifier container.

### Implemented modules awaiting orchestration

The following modules are implemented and focused-test-backed, but current
`ShepherdService`, HTTP routes, and UI do not yet invoke or expose them:

- The deterministic DAG validator/scheduler detects malformed graphs and selects a
  stable safe batch subject to dependency state, per-Agent exclusion, the mutation
  lock, and global Plane capacity.
- The bounded Project Group parser routes plain messages to Shepherd and one leading
  name/ID mention to an Agent while rejecting malformed, unknown, ambiguous, or
  multiple targets. It interprets no commands or paths.
- The bounded Ark Responses reviewer canonicalizes structured Contract facts, makes
  at most one non-persistent strict-schema request, validates/cross-references every
  returned finding, and degrades explicitly on any unsafe or unavailable result. Its
  output is advisory only and cannot alter deterministic collision, verification,
  selection, or promotion.

### Not yet implemented

Remaining work includes generic structured/free-form Mission planning, wiring the DAG
scheduler into orchestration, connecting the advisory reviewer and its degraded event,
Project Group persistence/API dispatch, Mission cancellation, bounded candidate retry,
human tie resolution, demo reset, the remaining named failure-matrix journeys, all six
UI surfaces, and full browser/rehearsal evidence. Standalone modules above are not
described as product-functional until those integration gates pass.

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
- `SHEPHERD_MODEL` is reserved for bounded structured planning and best-effort semantic review. The bounded review adapter exists, but Mission orchestration does not call it yet.
- Model output is always untrusted. It cannot certify verification, choose a winner by opinion, submit shell commands, mutate the protected branch, or bypass authority.
- Deterministic collision detection carries the demo-critical guarantee. Model-assisted review may raise advisory findings and emits an explicit degraded event on failure.

The deterministic executor remains available as an explicit, labelled mode and proves
the kernel independently of model variance. In live mode, each Contract and resolution
candidate uses a fresh `ARK_MODEL` Codex turn. Two live Missions, each containing two
Contract and two candidate turns, have passed the opt-in gate. The `SHEPHERD_MODEL`
reviewer remains standalone at this boundary, so no Mission currently calls it and no
live reviewer call is claimed.

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
| `SHEPHERD_MODEL` | Reserved planning/advisory-review model; defaults to `ARK_MODEL` when empty. The bounded adapter exists but is not yet connected to Mission orchestration. |
| `ARK_BASE_URL` | Responses-compatible API root. |
| `APP_AUTH_TOKEN` | Shared local-demo bearer boundary; mandatory and non-placeholder whenever the server binds beyond loopback. |
| `RUNTIME_PROVIDER` | Starter Agent runtime (`local-process` or `container`); Shepherd verification always uses its independent container boundary. |
| `SHEPHERD_ROOT` | Sentinel-guarded managed fixture repositories and Plane worktrees; defaults below `APP_DATA_DIR`. |
| `SHEPHERD_CODEX_HOME_ROOT` | Sentinel-guarded parent for one private, ephemeral live-Plane `CODEX_HOME` per execution; must be inside `APP_DATA_DIR` and separate from shared Agent and managed Shepherd roots. |
| `SHEPHERD_EXECUTION_MODE` | `auto`, `live`, or `deterministic`. `auto` selects live only with usable Ark configuration plus the container Runtime; explicit live fails closed otherwise. |
| `SHEPHERD_DEMO_MODE` | Enables the fixed, path-free demo Mission start control. Demo reset is not yet implemented. |
| `SHEPHERD_AUTO_RESOLUTION` | Parsed future control setting. The fixed demo currently performs evidence-derived automatic selection; HTTP control wiring is pending. |
| `SHEPHERD_DELETE_COMPLETED_PLANES` | Parsed future retention setting; service cleanup wiring is pending and completed Planes remain inspectable. |
| `SHEPHERD_MAX_PARALLEL_PLANES` | Parsed 1–16 Plane-capacity setting used by the standalone scheduler module; Mission-service wiring is pending. |
| `SHEPHERD_CONTRACT_TIMEOUT_MS` | Maximum contract execution duration. |
| `SHEPHERD_CANDIDATE_TIMEOUT_MS` | Maximum candidate execution duration. |
| `SHEPHERD_VERIFICATION_TIMEOUT_MS` | Maximum duration accepted by the independent verifier. |
| `SHEPHERD_VERIFIER_IMAGE` | Pre-built no-network verification image; defaults to `CONTAINER_RUNTIME_IMAGE`. |
| `CODEX_SANDBOX_MODE` | Must resolve to `workspace-write` for live Shepherd execution; startup preflight proves its filesystem and socket restrictions. |

No configured secret value is documented, persisted into Shepherd state, sent to the verifier, or rendered in the browser.

## Evidence and further documentation

- `docs/BUILD_LOG.md` — executed commands and bounded observations.
- `docs/DEVIATIONS.md` — accepted clarifications and material deviations.
- `docs/ui-review/` — inspected UI evidence by viewport and journey.
- `docs/SHEPHERD_ARCHITECTURE.md` — generated after the implementation freezes.
- `docs/SHEPHERD_TEST_REPORT.md` — generated from final executed suites.
- `HANDOFF.md` — final continuation guide.
