# Shepherd: Multi-Agent Kernel

This is the as-built operating document for Shepherd. It will be updated at every implementation phase. Statements under **Implemented and verified** are backed by `docs/BUILD_LOG.md`; statements under **Accepted design contract** describe the approved target until their phase gate passes.

## Implementation status

### Implemented and verified

- Starter Agent CRUD/control-plane baseline builds and tests.
- Real Responses API access for the configured Agent and Shepherd models.
- Real disposable-container Agent execution, same-thread follow-up, and restart/workspace persistence.
- Repository-local test/browser scratch roots and tracked credential-example hygiene.
- Rendered starter UI baselines at 1440×900 and 1280×800.

### Not yet implemented

The Shepherd domain, Planes, authority enforcement, independent verifier, scheduler, semantic collision detector, speculative candidates, winner policy, promotion gate, Shepherd API, Project Group, settings, and Shepherd UI are not present at the Phase 0 baseline.

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

### Deterministic responsibilities

Trusted server code owns schemas, state transitions, scope intersection, actual Git-diff inspection, manifest ingestion, evidence validation, acceptance-profile lookup, no-network verification, collision predicates, candidate base equality, winner rules, final re-verification, protected-head comparison-and-swap, persistence, redaction, and event ordering.

### Security boundary

- Agents receive only generated execution identities and managed Plane workspaces.
- The verifier receives no model/API key, application token, Codex session, Docker socket, unrelated host environment, or network.
- Browser and model inputs select trusted identifiers; neither can provide host paths or executable commands.
- `.shepherd/result.json` is the sole Agent-written control artifact exception and is never promoted.
- Unsafe or ambiguous outcomes stop in an evidenced non-green state.

## Configuration

Real secrets belong only in ignored `.env`.

| Variable | Purpose |
| --- | --- |
| `ARK_API_KEY` | Credential for the configured OpenAI-compatible Responses API. |
| `ARK_MODEL` | Coding Agent model. |
| `SHEPHERD_MODEL` | Planning/review model; will default to `ARK_MODEL` when empty. |
| `ARK_BASE_URL` | Responses-compatible API root. |
| `APP_AUTH_TOKEN` | Optional shared local-demo bearer boundary. |
| `RUNTIME_PROVIDER` | Shepherd isolation requires the local `container` path. |

No configured secret value is documented, persisted into Shepherd state, sent to the verifier, or rendered in the browser.

## Evidence and further documentation

- `docs/BUILD_LOG.md` — executed commands and bounded observations.
- `docs/DEVIATIONS.md` — accepted clarifications and material deviations.
- `docs/ui-review/` — inspected UI evidence by viewport and journey.
- `docs/SHEPHERD_ARCHITECTURE.md` — generated after the implementation freezes.
- `docs/SHEPHERD_TEST_REPORT.md` — generated from final executed suites.
- `HANDOFF.md` — final continuation guide.

