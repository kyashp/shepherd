# Shepherd Deviations and Accepted Clarifications

This file records material interpretations of `docs/PRD.md`. A clarification is not evidence that its implementation is complete.

## Accepted product clarifications

### Manifest ingestion exception

The PRD simultaneously protects `.shepherd/**` and requires an Agent to write `.shepherd/result.json`. The accepted contract permits only that exact per-Plane file as an ingestion channel. Trusted code validates and removes it before staging. No `.shepherd/**` content may be integrated or promoted.

### Interrupted work

The documented Mission enum is retained. Startup reconciliation maps interrupted active Missions to `attention_required` with an `execution_interrupted` reason and event. Contracts and candidates may use explicit `interrupted` terminal execution states.

### Managed project boundary

The hackathon fixture uses a separately managed Git repository under the configured application data root, never this source repository. Browser/model input can select trusted project or check identifiers but can never submit filesystem paths or shell commands.

### Supported isolation profile

Shepherd's Plane, verifier, and no-network guarantees apply to the local Docker/Colima/Podman container path. Existing host-process and ECS starter behavior remains available, but Shepherd must report unsupported isolation rather than imply equivalent guarantees there.

### Completed Plane cleanup

Completed-Plane cleanup may remove validated worktree directories only after evidence capture. Persisted Plane metadata, Git lineage, safe diff summary, verification evidence, and branch inspection remain available.

### Visual fidelity

`docs/UI.jpeg` is treated as a six-surface visual/product reference, not a literal composite viewport. Fidelity is evaluated by human-visible hierarchy, colors, typography, density, spacing, and interactions at the required desktop viewports plus representative laptop and responsive sizes.

## Sequencing interpretations

### Failure matrix

PRD Phase 4 requests the complete failure matrix before later UI polling and model-reviewer work exists. Backend-available failure cases are gated in the kernel phase; the complete named 22-condition backend-and-UI matrix is gated after those surfaces exist.

### Browser journeys

The PRD requests some Playwright journeys before UI completion. Their backend state paths are tested first; browser journey gates run when the required UI is implemented. No journey is considered complete until its real browser assertions and screenshots pass.

## Environment limitations to retain in final reporting

- Only one local machine/environment is presently available; a second-machine rehearsal cannot be claimed without another environment.
- Ordinary containers are not hardened multi-tenant isolation.
- Live model execution necessarily uses network egress to the configured Responses API; deterministic fixture verification remains network-free.
- Secret scans can prove absence of configured secrets, planted canaries, and recognized patterns, not unknowable arbitrary strings.
- “All laptop aspect ratios” is operationalized as a documented representative viewport matrix.

