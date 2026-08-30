# Shepherd Deviations, Clarifications, and Environment Limits

This is the hard completion ledger for material interpretations of
[`PRD.md`](PRD.md). It does not narrow the PRD and it does not convert missing
evidence into accepted behavior. Exact implementation status and ownership remain
canonical in [`TASKS.md`](TASKS.md); reproduced defects remain canonical in
[`FIXES.md`](FIXES.md).

## Status contract

- **Clarification** resolves an ambiguity without reducing required behavior.
- **Actual deviation** means required behavior or required acceptance evidence is
  absent. Every actual deviation must name an open TASKS/FIXES row.
- **Environment limitation** identifies evidence that cannot honestly be claimed in
  the current environment. It remains open when the PRD requires that evidence.
- **Permanent scope statement** restates an explicit PRD exclusion and is not work
  to “fix.”
- **Resolved** requires implementation and the tests named by the owning task. A
  backend-only or hosted-only gate cannot close a browser, live, or second-machine
  requirement.

The project is not complete while any row below is **OPEN** or **PARTIAL**.

## Product-contract interpretations

| Topic | Classification | Current status and evidence | Owning task(s) |
|---|---|---|---|
| Manifest ingestion exception | Clarification | **PARTIAL.** The PRD both protects `.shepherd/**` and requires the exact per-Plane `.shepherd/result.json` ingestion channel. Trusted code schema-validates and removes that file before staging; no `.shepherd/**` content may integrate or promote. Valid-path parser/service tests exist, but the required durable missing/malformed/omitted-key failure states and browser evidence remain incomplete. | `FM-01`, `E2E-04/05`, `SEC-REVIEW` |
| Interrupted work | Clarification | **PARTIAL.** The Mission enum remains authoritative. Startup reconciliation maps active work to `attention_required` with `execution_interrupted`; Contracts/candidates may use explicit terminal `interrupted` states. Backend recovery coverage exists, but the required kill/restart-mid-Mission browser journey and full failure-matrix evidence are open. | `E2E-08`, `FM-01`, `SEC-REVIEW` |
| Managed project boundary | Clarification | **PARTIAL.** The demo uses a separately managed Git repository beneath configured application data, never this source repository. Public browser/model input does not accept filesystem paths or shell commands. `E2E-02` now proves its audited hero-path Git/store/API/DOM correlation, but final mutation checks, complete scans across remaining flows, and independent final review remain open. | `SEC-REVIEW`, `DEMO-REHEARSAL` |
| Supported isolation profile | Clarification plus environment limitation | **PARTIAL.** Shepherd's Plane/verifier/no-network guarantees apply only to the local Docker/Colima/Podman path; host-process and ECS starter paths must report unsupported isolation rather than imply parity. Linux Docker gates and bounded stage/reason diagnostics are audited. A passing rerun on the affected collaborator/macOS environment remains open; no compatibility claim is made without it. | `OPS-06`, `LIVE-01`, `SEC-REVIEW` |
| Completed Plane cleanup | Clarification | **RESOLVED AS POLICY, NOT AS AN IMPLEMENTED CLEANER.** Cleanup is permitted only after evidence capture and must retain persisted Plane metadata, Git lineage, bounded diff/verification evidence, and branch inspection. The current product does not ship automatic completed-Plane cleanup, and this document must not imply it does. The PRD does not require an automatic cleaner; `retainCompletedPlanes` remains the truthful current behavior. | No implementation task unless scope changes; recheck in `SEC-REVIEW`/final docs |
| Visual fidelity | Clarification plus actual evidence deviation | **OPEN.** `UI.jpeg` is a six-surface product reference rather than one literal composite viewport. Human-visible hierarchy, palette, typography, density, spacing and interactions still require the full six-surface/state review. Audited E2E-01, E2E-02, GC-01, and focused UI evidence at 1280x800/1440x900 cover important subsets, not full visual acceptance or “all laptop aspect ratios.” | `UI-GATE`, `E2E-03`–`E2E-08`, `DEMO-REHEARSAL` |

## Sequencing interpretations

| Topic | Classification | Current status and evidence | Owning task(s) |
|---|---|---|---|
| Failure matrix sequencing | Clarification | **OPEN.** F-01/02, F-04–06 and TST-13–24 are audited, closing typed Agent runtime/timeout, executor filesystem/config, initial Plane creation, Git-conflict and representative persistence-recovery boundaries. The complete matrix remains open for manifest, candidate timeout/retry, tie, polling, model-degradation and required browser rows. | `F-07`–`F-09`, `FM-01`, `UI-01`, `E2E-04`–`E2E-08`, `SEC-REVIEW` |
| Browser-journey sequencing | Clarification | **OPEN.** Backend paths can precede UI implementation, but no PRD journey is complete without its real browser assertions and screenshots. `E2E-01` and `E2E-02` are audited; harness/shell tests and source inspection do not close `E2E-03`–`E2E-08`. | `E2E-03`–`E2E-08`, `UI-GATE` |

## Environment and assurance limitations

| Limitation | Classification | Current status and honest reporting rule | Owning task(s) |
|---|---|---|---|
| Second environment / machine | Environment limitation | **OPEN.** Hosted GitHub Node 22/Docker runs are valid cross-environment evidence only for the exact `npm run check` workflow executed there. They are not a second-machine full demo rehearsal. Claim the latter only after a real second machine/state runs the judge flow. | `DEMO-REHEARSAL`, `DEL-02` |
| Ordinary-container tenancy | Permanent scope statement | **ACCEPTED.** Ordinary containers are not hardened hostile multi-tenant isolation; production OAuth/RBAC/multi-tenancy are explicitly out of scope in PRD 2.2 and 13. Do not market the local PoC as a multi-tenant security boundary. | Final `SEC-REVIEW` wording only |
| Live-model network egress | Clarification plus environment limitation | **PARTIAL.** The bounded reviewer smoke made exactly one external request and passed with `completed findings=2`; deterministic authority, secret scans and cleanup remained green. Current live Shepherd Mission/legacy continuity remain open. Default tests stay model/network-free. | `LIVE-01`, `SEC-REVIEW`, `DEL-02` |
| Secret-scan certainty | Clarification | **OPEN FOR FINAL ASSURANCE.** Scans can prove absence of configured secrets, planted canaries, exact known values, and recognized credential/private-path patterns—not unknowable arbitrary strings. This epistemic limit does not relax the PRD prohibition on secrets in source, store, prompts, logs, events, or DOM. | `SEC-REVIEW`, `DEMO-REHEARSAL`, `DEL-02` |
| Laptop coverage | Environment/evidence limitation and actual deviation | **OPEN.** The two required audit viewports are green only for audited rows; they do not prove all laptop aspect ratios or the full six-surface matrix. “All laptop aspect ratios” is operationalized by a documented representative matrix, which must be defined and executed before final visual claims. | `UI-GATE`, `DEMO-REHEARSAL`, `DEL-02` |

## Completion rule

Before submission, the Auditor must reconcile this file against current code,
`TASKS.md`, `FIXES.md`, final browser/live/security evidence, and the generated test
report. No OPEN/PARTIAL row may be silently relabelled as an accepted limitation.
If an actual PRD deviation remains, the project remains incomplete unless the user
explicitly revises the PRD.
