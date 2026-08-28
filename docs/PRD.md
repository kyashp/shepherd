# Shepherd: Multi-Agent Kernel — Full End-to-End Implementation PRD (No-Compromise Edition)

**Target executor:** Autonomous coding agent (GPT-5.6 Ultra / Codex or equivalent)
**Hackathon:** TikTok TechJam 2026 — Track 1: Agent Launchpad — Design and Build Lightweight Agent Middleware
**Starter repository:** https://github.com/RrankPyramid/CodeJam
**Document status:** Source of truth. Supersedes all prior Shepherd PRDs.
**Scope directive:** Every capability in this document is required. There is no P1/P2 tiering and no cut line. If a capability cannot be delivered as specified, the executor must stop, document the exact blocker with reproduction evidence, and surface it — never silently narrow scope, never fake behavior, never weaken an assertion to make a test pass.

---

# 0. The Verification Doctrine (READ FIRST — governs every task in this document)

This PRD imposes a mandatory working discipline on the executing agent. It applies to **every** feature, bug fix, refactor, UI change, and test.

## 0.1 The Build–Verify–Test–Evidence (BVTE) loop

No task is "done" when the code compiles or when the agent believes it works. Every task completes only through this loop:

1. **Build** — implement the smallest coherent change for the task.
2. **Verify** — actually run the system and observe the expected output with your own tool calls:
   - Start the real server, hit the real API with `curl` or a script, and inspect the real JSON response.
   - For runtime behavior, execute the real container path and inspect real files, real Git state, real persisted JSON.
   - For UI behavior, load the real page in a browser automation session (Playwright) and assert on the rendered DOM, and capture a screenshot.
   - "It should work" is prohibited. Only "I ran X, observed Y, Y matches the specified expectation Z" is acceptable.
3. **Test** — encode the verified behavior as an automated test at the correct layer (unit, integration, container, or E2E) so it can never silently regress.
4. **Evidence** — append an entry to `docs/BUILD_LOG.md` containing: task, commands run, observed output (bounded/redacted), test file(s) added, and pass status.

## 0.2 The Problem-Resolution Protocol

When **any** problem is encountered — a failing command, an unexpected output, a flaky behavior, a UI misrender, a confusing Starter Kit behavior — the agent must:

1. **Reproduce it deterministically** before attempting a fix. Record the exact reproduction command.
2. **Diagnose the root cause** by reading the actual code path, not by guessing. State the root cause in one sentence in the build log.
3. **Fix the root cause**, not the symptom. Weakening a test, adding a sleep, swallowing an error, or special-casing the demo input are all prohibited fixes unless the root cause genuinely is timing/config, in which case the log must justify it.
4. **Re-run the original reproduction** and confirm the expected output now occurs. Paste the before/after into the build log.
5. **Run the affected test suites** and confirm no regression.
6. **Add a regression test** if one did not already catch the problem.

## 0.3 Verification asymmetry rule

The more critical the invariant, the more hostile the verification must be. For the five kernel invariants below, the agent must write **negative tests that actively try to break them**, and those tests must fail if the protection is removed (mutation-check each one at least once by temporarily disabling the guard, observing the test fail, then restoring it — record this in the build log):

1. An Agent can never self-certify a contract as verified.
2. Changes outside delegated writable scope can never be integrated or promoted.
3. The protected branch can never be updated except through the trusted promotion gate.
4. A resolution winner can never be hard-coded; swapping the fixture's invariant must flip the winner.
5. No secret (Ark key, tokens, `.env` contents) can appear in persisted state, events, prompts to verifiers, or the browser.

## 0.4 UI/UX verification standard

UI work is not exempt from verification. Every screen and component in Section 11 must be verified by:

- **Functional E2E assertions** (Playwright): the specified elements exist, display real backend data, and update on polling.
- **Visual QA screenshots**: capture at 1440×900 and 1280×800, review each against the Visual Acceptance Checklist (11.7), and store screenshots in `docs/ui-review/`.
- **Interaction walkthroughs**: for each user journey in 11.6, drive it end to end in the browser and confirm every intermediate state renders (not just the final state).
- **Empty/loading/error states**: every list, stream, tree, and timeline must be verified in its empty state, loading state, and at least one error state — with screenshots.

## 0.5 Honesty constraints

- No hard-coded outcomes anywhere in the product path.
- No static UI standing in for real middleware behavior.
- No fabricated test reports; if something is untestable, it is documented as untested with the reason.
- Every claim in the README must be backed by a named test or a build-log evidence entry.

---

# 1. Executive Summary

Build **Shepherd: Multi-Agent Kernel** as middleware on top of the supplied Agent Launchpad Starter Kit.

Shepherd solves one specific multi-agent infrastructure failure:

> Two coding Agents can independently complete their tasks, pass their own local checks, and produce no Git textual merge conflict, while still making mutually incompatible assumptions about the same system.

Shepherd delivers three hero primitives, in a causal chain the demo must make undeniable:

1. **Agent Execution Contracts** — delegation becomes a typed, machine-verifiable contract (objective, dependencies, authority, expected evidence, acceptance criteria). An Agent cannot certify its own success.
2. **Semantic Collision Detection** — Shepherd detects incompatible behavioral/architectural claims between independently successful contracts, including conflicts Git textual merging cannot see.
3. **Speculative Conflict Resolution** — Shepherd forks competing reconciliation strategies into isolated execution Planes, executes and independently verifies each, and promotes only the objectively verified winner.

Supporting primitives: Task Graph with Live Execution Timeline, Scoped Authority, Planes (Git-worktree-backed isolated worlds run through the existing container runtime), Shepherd Chat, Project Group Chat, and the Plane Tree.

**The chain: Contract → Execute → Verify → Detect Collision → Fork Futures → Verify Futures → Promote Winner.** All of it real, all of it tested, all of it visible.

---

# 2. Competition Alignment

The Track 1 brief requires middleware that executes in a backend/Runtime/data/infrastructure path; a defined boundary with failure behavior; demonstrated normal and failure/denial/recovery cases; automated tests; reproducibility; no secrets; and preservation of the Starter Kit baseline (Agent CRUD, lifecycle, Playground, persistence, real model execution).

| Criterion | Weight | Shepherd delivery |
|---|---:|---|
| End-to-end middleware behavior | 40% | Browser request → real contracts → real isolated Plane execution → real independent verification → real semantic collision evidence → real speculative resolution → protected promotion. Every link verified live and by automated test. |
| Technical design and integration | 25% | Inserted at existing Fastify / AgentService / AgentRunner / JSON-store seams; baseline untouched in behavior; typed domain; explicit trust boundaries. |
| Verification and robustness | 20% | Five mutation-checked kernel invariants; 19-category failure matrix implemented and tested; fail-closed everywhere; redaction verified. |
| Demo and reproducibility | 15% | One-command startup preserved; deterministic fixture; safe reset command; rehearsed 3-minute flow; complete README, architecture doc, and honest test report. |

---

# 3. Product Positioning

- **Name:** Shepherd: Multi-Agent Kernel
- **Pitch:** Shepherd converts Agent delegation into verifiable execution contracts, detects semantic conflicts between concurrently successful Agents, and resolves those conflicts by executing competing futures before promoting the verified winner.
- **Mental model for judges:** a transactional execution kernel for teams of coding Agents. The UI is mission control for the kernel — never pitch it as a dashboard.
- **Novelty claim:** not worktrees, task graphs, or chat individually — the causal composition **Execution Contract → Semantic Collision → Speculative Reconciliation → Verified Promotion**, integrated into this platform's real lifecycle.

---

# 4. Goals and Non-Goals

## 4.1 Goals (all required — no tiering)

Shepherd must:

1. Let one human coordinate multiple Agent instances through a single Shepherd control surface.
2. Turn assignments into durable typed Execution Contracts.
3. Run contract work in isolated Planes; Agents never directly mutate the protected project.
4. Enforce bounded Agent authority at the trusted control-plane boundary using actual diffs.
5. Independently verify contract outputs; Agent self-reports are informational only.
6. Represent each contract as a node in a live dependency graph with a scheduler.
7. Detect a real semantic conflict requiring no Git textual conflict.
8. Fork at least two distinct reconciliation strategies from the same immutable integration state.
9. Execute and independently evaluate the candidates concurrently.
10. Promote only when deterministic verification and safety checks pass; prefer no promotion over unjustified promotion.
11. Preserve failure evidence and stop safely (`attention_required`) when no candidate is objectively acceptable.
12. Support explicit `@Agent` routing in Project Group chat.
13. Provide a bounded model-assisted semantic reviewer **in addition to** the deterministic detector (never demo-critical; degrades explicitly on failure).
14. Support human selection when candidates are objectively tied.
15. Support Mission cancellation and bounded candidate retry.
16. Show estimated durations in the timeline, clearly labeled as estimates.
17. Expose everything through the UI specified in Section 11.
18. Preserve every Starter Kit baseline behavior.

## 4.2 Non-Goals

Production OAuth; multi-tenant identity; Kubernetes; distributed schedulers; multi-region; microVMs; general policy languages; rollback of external side effects; generic semantic-equivalence proofs; workflow editors; vector memory; marketplaces; Git hosting; general CI/CD; production RBAC; autonomous subagent hierarchies; agent social loops; cloud deployment for presentation value. Local Docker/Colima/Podman is the judging path.

---

# 5. Executor Operating Directive

Before changing code: clone/inspect the repository; read README and `docs/ARCHITECTURE.md`; run the baseline (`npm run poc`) and the full baseline acceptance test from the challenge brief (create agent → hello-world CLI task → follow-up → stop/restart → workspace persists); run `npm run check`; record any pre-existing failures in `docs/BUILD_LOG.md`.

**Do not begin Shepherd work on a broken baseline.** If the baseline fails, apply the Problem-Resolution Protocol (0.2) to the environment first.

During implementation: preserve baseline behavior; prefer focused changes; typed TypeScript throughout; validate all untrusted structured input with schemas; enforcement lives in backend/runtime/data paths; deterministic mechanisms preferred; document any material deviation from this PRD in `docs/DEVIATIONS.md` with rationale.

Continuously: keep `docs/BUILD_LOG.md` current per the BVTE loop; commit in small, coherent, described commits; keep `npm run check` green at the end of every phase.

---

# 6. Architecture Requirements

## 6.1 Layers

- **Experience Layer** — existing React app remains the shell; add Shepherd page, Project Group, event stream, timeline, Plane Tree, role/authority config (Section 11). Preserve Agent list, Create/Edit, lifecycle controls, legacy Playground, and existing visual design.
- **Existing Agent Control Plane** — `AgentService` keeps owning Agent CRUD, lifecycle, legacy Playground messages, legacy Runs. Do not turn it into Shepherd.
- **Shepherd Control Plane** — a dedicated `ShepherdService` (or equivalently factored modules) owning Missions, Contracts, the DAG, scheduling, Planes, authority, verification orchestration, claims, collisions, resolutions, winner policy, promotion, events, and interruption state.
- **Agent Runtime Boundary** — reuse `AgentRunner`/container runtime. Shepherd executes a logical Agent against a specific Plane workspace via a distinct **execution identity** (independent session, cancellation, and container per contract/candidate; candidates never resume a shared Codex thread).
- **Verification Boundary** — a separate verification runner: disposable container, candidate Plane mounted, **no Ark key, no Codex session directory, no network**, bounded CPU/memory/PID/time/output, destroyed after use.
- **Git / Plane Boundary** — the protected repository is controlled solely by Shepherd's Git manager. Agents work in worktrees. Only the trusted promotion path updates the protected branch. All Git operations are argv-based `execFile` with sanitized refs, bounded output, and timeouts.

## 6.2 Trust boundaries

Untrusted: browser input, model output, Agent-written files, result manifests, semantic-claim content, candidate code, code executed during verification, model-assisted analysis output.

Trusted: schema validation, contract lifecycle transitions, authority intersection, Git/Plane control, actual changed-file inspection, verification interpretation, deterministic collision rule, deterministic winner policy, promotion, persistence transitions.

Every trusted decision must be implemented server-side and covered by a test that attempts to subvert it from the untrusted side.

---

# 7. Core Domain Model

Type names may adapt to repository conventions; semantics are mandatory. All entities persist in the extended JSON store with a versioned migration; existing Agent/message/Run data must survive (verified by a migration test on a captured pre-migration fixture store).

## 7.1 ShepherdProject
ID, display name, repository location, protected branch, current protected head commit, timestamps, active mutating Mission (nullable). One active project is sufficient; one **mutating Mission at a time** is enforced and tested.

## 7.2 Mission
ID, project ID, original user intent, base commit, contract IDs, dependency edges, collision IDs, resolution IDs, state, timestamps, attention/failure reason. States: `planning, queued, running, verifying, collision, resolving, completed, failed, cancelled, attention_required`. Every transition emits an event; illegal transitions are rejected and tested.

## 7.3 AgentRole
Optional persistent Agent metadata: `Frontend | Backend | Verification | Generalist`. Editable via Create/Edit Agent.

## 7.4 ScopedAuthority
Durable per-Agent envelope over project filesystem scope: readable, writable, forbidden path patterns. Contract authority is intersected: **ContractAuthority ⊆ AgentAuthority** (tested with adversarial patterns). A resolution candidate may receive broader — but still explicit and bounded — authority spanning both original scopes.

Path engine requirements (all negative-tested): normalization; rejection of traversal (`..`), absolute host paths, and null bytes; forbidden overrides writable; `.shepherd/**`, `.git/**`, and secret paths always protected; matching is deterministic and documented.

## 7.5 ExecutionContract
contract ID, mission ID, Agent ID, title, objective, contextual inputs, dependency IDs, semantic scopes, authority scope, expected artifacts, acceptance specification (mandatory + optional checks), Plane ID, result-manifest location, lifecycle state, timestamps, error info.

Lifecycle: `created → queued/blocked → running → agent_completed → authority_validation → verifying → verified` with explicit failure states at each step. **No path exists from `agent_completed` to `verified` that skips authority validation and independent verification** — enforced structurally and mutation-tested (0.3 invariant 1).

## 7.6 ContractResultManifest (`.shepherd/result.json` inside the Plane)
schema version, contract ID, summary, changed/produced artifacts, semantic claims, evidence references, Agent-declared test outcomes (informational), notes. Schema-validated on ingestion; malformed/missing manifests are explicit failure states with preserved evidence.

## 7.7 SemanticClaim
canonical key, value, scope, mode (at minimum `exclusive`), evidence references into real project artifacts.

**Robustness requirement (demo-critical):** claim keys and values pass through a server-side normalization table (trim, lowercase, canonical aliases — e.g., `jwt`/`bearer`/`bearer-jwt` → `bearer-jwt`) so trivially different spellings of the same claim still collide. The contract prompt envelope additionally pre-declares the expected canonical claim key(s) for the contract, and Shepherd cross-checks manifest claims against the declared keys; a contract whose manifest omits its declared key enters `attention_required` rather than silently passing. Both behaviors are tested.

Evidence validation before a claim may participate in a collision: referenced files exist inside the Plane; paths remain inside the project boundary; no secret/control-plane paths; bounded description length; where practical, confirmation that referenced files were changed by or are materially relevant to the contract. Invalid evidence → explicit rejected-claim state, never silent acceptance.

## 7.8 Plane
Git branch + worktree + base commit + purpose + execution identity + authority envelope + persisted state + verification evidence. Kinds: `contract`, `integration`, `resolution`. Worktree lifecycle (create/inspect/diff/destroy) is wrapped in a tested `PlaneManager`; leaked worktrees are detected and cleaned by reset.

## 7.9 SemanticCollision
collision ID, mission ID, semantic key/scope, left/right contract IDs, left/right claims, per-side evidence, human-readable reason, detection mechanism (`deterministic` | `model_assisted`), resolution strategy IDs, state, timestamps.

## 7.10 ResolutionCandidate
candidate ID, collision ID, strategy description (exact canonical value it makes true), Plane ID, state, independent verification evidence, changed-file/diff summary, result, selection/rejection status, retry count.

## 7.11 ShepherdEvent
timestamp, type, summary, actor, correlation IDs (mission/contract/agent/plane/collision/candidate), bounded safe details. Event types cover at minimum: mission created; contract created/blocked/started; agent completed; authority accepted/denied; verification started/passed/failed; claims loaded; claim rejected; collision detected; resolution started; candidate created/passed/failed/retried; candidate selected; tie escalated; promotion started/completed; mission completed/failed/cancelled; execution interrupted; model-review degraded. Events never contain secrets, raw prompts, or unbounded output (redaction tested).

---

# 8. Kernel Behavior Requirements

## 8.1 Contract creation
Contracts originate from: Shepherd chat Mission decomposition (constrained, reliable parser — if free-form planning proves unreliable during verification, the structured assignment path is the primary path and the planner degrades to suggesting a structured plan the user confirms); explicit `@Agent` assignment in Project Group; and the deterministic demo Mission definition. All three paths are implemented and E2E-tested.

## 8.2 Contract prompt envelope
The runtime prompt for a Shepherd-managed execution contains: logical Agent identity and role; contract ID; exact objective; supplied context and dependency outputs; readable/writable/forbidden scope; expected outputs; the declared semantic claim key(s); the result-manifest schema and requirement to write it; instructions to make the smallest coherent change, not to claim unverified success, and not to modify `.shepherd/**` or other protected metadata. Never include Ark keys or control-plane secrets (asserted by a test that scans generated prompts against known secret values).

## 8.3 Scheduler and Task Graph
Contracts form a DAG. A contract runs only when: mission active; dependencies satisfied; the Agent's execution identity is free; the project mutation lock permits; Plane concurrency limit not exceeded. Failed required dependencies block downstream contracts with a visible, evidenced `blocked` reason. Cycle detection rejects cyclic dependency definitions at creation. All scheduler rules unit-tested; concurrency verified with a real two-contract parallel run.

## 8.4 Integration stage
When a compatible verified group exists: create an integration Plane from the Mission base; merge verified contract branches with argv Git; record textual conflicts if any (explicit `git_conflict` state — implemented and tested even though the demo avoids it); load manifests; run collision detection; freeze the integration commit as the immutable base for resolution.

## 8.5 Deterministic collision rule (demo-critical)
A collision exists iff: same Mission; both contracts independently `verified`; both contain a claim with the same canonical (normalized) key; both marked `exclusive`; normalized values differ; both claims carry valid evidence; dependency semantics do not establish supersession. Exhaustively unit-tested including near-miss cases (same values, non-exclusive mode, invalid evidence, superseding dependency).

## 8.6 Model-assisted semantic reviewer (required, never demo-critical)
A bounded structured model review compares objectives, manifests, claims, changed files, and diff summaries to flag equivalent keys with different naming or likely incompatibilities. Output is schema-validated; on any failure it produces an explicit `degraded_analysis` event — never a fake "safe". The deterministic detector alone must carry the live demo; a test verifies collision detection succeeds with the model reviewer disabled.

## 8.7 Speculative resolution
On a validated collision: generate two explicit strategies (reconcile to left value; reconcile to right value — each states the exact canonical value it makes true); fork two resolution Planes from the same immutable integration commit (verified: identical base SHA, no shared mutable state, independent sessions); execute both through the real runtime, concurrently; independently verify each against the project acceptance criteria plus all relevant original contract criteria.

## 8.8 Winner policy (deterministic, mutation-tested)
- Exactly one candidate passes all mandatory checks → select it.
- Both fail → select none; `attention_required`; evidence preserved.
- Both pass → apply predeclared objective tie-breakers only; if still tied → human selection UI (Goal 14); an LLM opinion is never the sole tie-breaker.
- Prefer no promotion over unjustified promotion.

**No hard-coded winner:** a dedicated test modifies the fixture invariant so the opposite candidate passes and asserts the selection flips (0.3 invariant 4).

## 8.9 Final promotion gate
Immediately before promotion: re-check candidate authority against actual diff; re-run mandatory acceptance checks; confirm protected branch head equals expected head (if moved → stop, preserve evidence, `attention_required`); confirm the selected candidate matches the persisted decision; promote via the trusted Git path only; persist the promotion event. The losing Plane remains inspectable. Every sub-check has a negative test.

## 8.10 Independent verification runner
Disposable container; candidate Plane mounted; no Ark key; no Codex session dir; no network for the deterministic fixture; bounded CPU/memory/PID/time/stdout; clear exit code/duration; destroyed after use. A test asserts the verifier environment contains no secret variables and no network reachability (attempt an outbound request from inside; expect failure). All mandatory checks must pass for `verified`; optional checks add evidence only.

## 8.11 Cancellation and retry
Mission cancellation stops scheduled/running work safely, cancels only the targeted execution identities, preserves evidence, and lands in `cancelled`. A failed candidate may retry once (bounded) with a fresh Plane from the same integration commit; retries are evidenced. Both are E2E-tested.

---

# 9. Persistence, Events, and API

## 9.1 Persistence
Extend the JSON store with a versioned migration; pre-existing data survives (fixture-based migration test). Mutations remain serialized/atomic at store level. Interrupted in-flight work never becomes `completed` after restart: startup reconciliation marks it `interrupted/attention_required` (tested by killing the server mid-Mission at multiple points and restarting). No secrets persisted (scanning test over the store after a full demo run).

## 9.2 API (adapt names to Fastify conventions; all schema-validated; all covered by API tests)
Read: Shepherd state, Mission detail, event polling (since-cursor), Project Group messages, Plane/collision/candidate detail. Write: send Shepherd message / create Mission, send Project Group message, cancel Mission, human tie-break selection, demo reset (explicit dev/demo mode only). The browser can never submit arbitrary server filesystem paths (negative-tested). Reuse the starter's existing auth/demo-token boundary. Polling (~1s) preferred over WebSockets.

---

# 10. Demo Fixture (deterministic, network-free)

A tiny dependency-light authentication project using Node built-ins:

- Frontend contract → bearer-JWT client auth; claim `auth.transport = bearer-jwt`.
- Backend contract → HttpOnly session-cookie auth; claim `auth.transport = http-only-session-cookie`.
- The contracts modify **different files**, so Git merges without textual conflict (asserted by a test).
- Each side passes its own local acceptance checks (asserted).
- A project-level security invariant (e.g., token/credential must not be readable by client script) objectively distinguishes the two reconciliation candidates. The verification result — not a strategy name — determines the winner; flipping the invariant flips the winner (8.8 test).
- No package installation or network during the fixture run; runtime image pre-built.

**Demo reset command:** resets only Shepherd demo state; recreates the fixture repo at its known initial commit; removes stale demo worktrees/branches safely; never deletes arbitrary user paths (guard-tested with a hostile path config); leaves unrelated Launchpad data alone.

---

# 11. UI/UX Specification (every item verified per 0.4)

## 11.1 Sidebar
Retain the dark sidebar and `Create Agent` button. Above `YOUR AGENTS`, add in order: **SHEPHERD** → Shepherd; **GROUP CHAT** → Project Group; then existing Agent cards.

## 11.2 Shepherd page — Left column: Execution Contract Stream
Real polled events with contract IDs, Agent names, timestamps, state pills, collision alerts, candidate results, promotion events, compact evidence expanders. Filters: All / Contracts / Verification / Collisions / Resolution. Shepherd message composer at the bottom. New events visible within ~1–1.5s of persistence (measured in an E2E test).

## 11.3 Shepherd page — Right column top: Live Execution Timeline
Minimal Gantt: rows per Agent/contract; dependency order; queued/blocked/running/verifying segments; collision marker; candidate resolution segments; completed/failed states; actual start/end times; estimates clearly labeled "est.". Driven by real Mission/contract state only.

## 11.4 Shepherd page — Right column bottom: Plane Tree
Renders real persisted Plane/Git lineage (main → contract Planes → collision → integration → Resolution A/B with verified/failed/selected/promoted badges). Hover/click details: purpose, branch, short base/head SHA, assigned Agent or strategy, changed-file count, diff summary, verification result, status. A test asserts the tree matches `git worktree list` / branch reality.

## 11.5 Project Group, Agent page, Create/Edit
Project Group: human + Shepherd + Agents; unmentioned messages route to Shepherd; `@AgentName` creates/targets a contract; Shepherd posts lifecycle summaries; Agents post concise real completion summaries from their manifests. No uncontrolled agent chatter. Agent page: preserve legacy Playground; add current-contract badge, Plane link, role display. Create/Edit: role selector + authority presets with an advanced section; the demo never requires typing glob rules live.

## 11.6 User journeys (each driven end-to-end in Playwright with screenshots at every stage)
1. Baseline journey: create Agent → Playground task → follow-up → stop/restart (regression).
2. Mission journey: submit Mission → contracts appear → Planes appear → both verify → integration → collision → resolution planes → winner → promotion → final state.
3. `@Agent` journey: targeted contract from Project Group.
4. Failure journey: contract with unauthorized change → authority denial visible with evidence.
5. Attention journey: both candidates fail → `attention_required` with preserved evidence.
6. Tie journey: objective tie → human selection UI → promotion of chosen candidate.
7. Cancellation journey: cancel mid-Mission → safe durable `cancelled` state.
8. Restart journey: kill server mid-Mission → restart → interrupted state visible, nothing falsely green.

## 11.7 Visual Acceptance Checklist (applied to every screenshot in `docs/ui-review/`)
Cream/off-white surface, dark sidebar, purple primary accent, green success, red failure/collision; restrained borders/shadows; starter typography; consistent spacing rhythm; no neon/gradients/particles/3D/excess animation; no truncated or overlapping text at 1280×800; loading, empty, and error states styled (never raw/unstyled); state pills readable; long IDs truncated with full value on hover; the judge should recognize the starter kit immediately. Any checklist failure is a defect and enters the Problem-Resolution Protocol.

---

# 12. Failure and Recovery Matrix (all implemented, all tested)

Each category must produce a durable, visible, evidenced state — never a generic error, never a falsely green UI:

Agent timeout; Agent runtime error; missing result manifest; malformed manifest; invalid semantic evidence; omitted declared claim key; unauthorized file change; failed independent acceptance; worktree creation failure; Git textual merge conflict; semantic collision; candidate timeout; single-candidate failure; all-candidate failure; objective tie; final re-verification failure; protected branch moved unexpectedly; verification infrastructure error; server restart mid-Mission; persistence error; UI polling interruption (UI reconnects and reconciles); model-reviewer failure (degraded state).

For each: an automated test triggers the condition (fault injection where needed) and asserts the resulting state, event, and UI representation. `attention_required` is preferred over unsafe automatic recovery.

---

# 13. Security Requirements

- Never expose/persist: Ark API key, AK/SK, bearer tokens, Codex credentials, `.env` contents, unrelated host env values. A repository-wide and store-wide secret scan runs in CI/check and after the full demo run.
- Redact sensitive verification/log output before storing/displaying (tested with planted canary secrets that must not survive into events, store, or DOM).
- Semantic evidence may not reference secret/control-plane paths (negative-tested).
- No model-generated host shell execution; Git via argv `execFile`; acceptance commands run only inside the bounded disposable verifier.
- Sanitize branch names/IDs; bound all subprocess output and time.

---

# 14. Performance and Demo-Time Targets (measured, not assumed)

- Event persistence → UI visibility ≤ 1.5s (measured in E2E).
- Plane creation near-instant for the fixture (measured; log the number).
- Fixture verification completes in seconds (measured).
- Candidates execute concurrently (verified by overlapping timestamps).
- Zero network/package downloads during the fixture run (verified by the no-network verifier and a run log check).
- Collision → resolution → promotion well under two minutes; the full judge narrative fits comfortably in three (rehearsed and timed at least three times; timings recorded in the test report).

---

# 15. Judge-Facing Demo Flow (the system must support this exact story)

1. **Mission** — human asks Shepherd to implement the demo auth flow; two contracts appear, assigned to different Agents; Mission/contracts/Planes/timeline visible immediately.
2. **Independent work** — both Agents run in different Planes, make real changes, write manifests, pass local acceptance; both show locally verified.
3. **No Git conflict** — branches integrate textually clean; visibly explainable.
4. **Semantic collision** — `bearer-jwt` vs `http-only-session-cookie`; high-salience stream event; Plane Tree shows the integration point.
5. **Speculation** — two resolution Planes fork from the same commit; both visibly execute.
6. **Objective verification** — one candidate passes all mandatory checks; the other fails a real security/integration condition; evidence shown.
7. **Promotion** — deterministic selection, re-verification, head-consistency check, promotion; loser remains inspectable.
8. **Proof** — final protected state, green verification, event trail, and the legacy Agent page still works.

Closing line: “Shepherd turns multi-Agent concurrency from a group chat into a controlled execution kernel: contract, detect, speculate, verify, promote.”

Timing plan: 0:00–0:25 problem; 0:25–0:55 Mission + contracts; 0:55–1:20 independent verification; 1:20–1:40 no-Git-conflict → collision; 1:40–2:25 speculative candidates; 2:25–2:45 winner + promotion; 2:45–3:00 proof + summary.

---

# 16. Implementation Plan (dependency order, with mandatory verification gates)

Every phase ends with a **Gate**: the listed verifications performed and logged, phase tests green, `npm run check` green, and a build-log entry. Do not proceed through a failed gate.

## Phase 0 — Baseline Lock
Run baseline + full acceptance flow + `npm run check`; record environment and pre-existing issues.
**Gate:** baseline evidence in build log; zero product changes.

## Phase 1 — Walking Skeleton of the Hero Chain (fake agents, real kernel)
Before any live-model work, implement the entire kernel chain driven by deterministic fake agent executors that write real files/manifests into real worktrees: contracts → real Planes → real diff/authority checks → real verification containers → real collision detection → real candidate forking → real verification → real winner policy → real promotion into a real protected branch.
**Purpose:** the hero property is proven end to end with zero model variance before model integration multiplies risk.
**Gate:** an automated end-to-end kernel test passes using fake executors; the 8.8 winner-flip test passes; all five kernel invariants have their mutation checks recorded.

## Phase 2 — Domain + Persistence Hardening
Full domain model, versioned migration, restart reconciliation, event stream.
**Gate:** migration test on captured fixture store; kill-and-restart tests at ≥3 mid-Mission points; secret-scan of store.

## Phase 3 — Live Agent Runtime Integration
Replace fake executors with real Codex-in-container execution per Plane with distinct execution identities; prompt envelope; manifest ingestion; claim normalization + declared-key cross-check.
**Gate:** a real two-Agent Mission produces a real collision from real model executions at least twice consecutively; prompt secret-scan test; independent-session verification (candidates provably do not share threads).

## Phase 4 — Scheduler, Integration Stage, Failure Matrix
DAG, concurrency, blocking, integration Plane, and every Section 12 category with fault-injection tests.
**Gate:** full failure-matrix suite green; parallel execution demonstrated with overlapping timestamps.

## Phase 5 — Resolution Live + Cancellation/Retry/Tie
Live speculative resolution, concurrent candidates, retry, tie → human selection, cancellation.
**Gate:** journeys 5–7 (Section 11.6) pass headlessly; winner-flip test re-run against live path.

## Phase 6 — API + UI Complete
All Section 11 surfaces on real data; polling; filters; Plane Tree from real Git state.
**Gate:** all eight Playwright journeys green with screenshots; Visual Acceptance Checklist applied to every screenshot; empty/loading/error states captured.

## Phase 7 — Model-Assisted Reviewer + Group Chat polish
Bounded structured reviewer with degraded-state handling; `@Agent` routing; Agent summaries.
**Gate:** reviewer-disabled collision test still green; degraded-state test green.

## Phase 8 — Demo Hardening
Reset command with hostile-path guard tests; pre-built image; timing measurements; three full timed rehearsals from a clean reset, including one on a machine/state other than the primary dev environment if available.
**Gate:** three consecutive clean full-demo runs logged with timings; reset-safety tests green.

## Phase 9 — Feature Freeze + Post-Build Deliverables
No feature work past this point. Then, from the as-built system:

- **A. `docs/SHEPHERD_ARCHITECTURE.md`** — Mermaid diagrams generated from real code: system/component view; Launchpad integration; labeled trust boundaries; browser→runtime flow; Mission/Contract lifecycle; Plane lifecycle; scheduling; collision path; resolution sequence; verification boundary; winner+promotion; persistence relationships; failure handling. One diagram explicitly optimized as the hackathon one-page diagram. Mermaid syntax validated with local tooling; regenerate if code changes later.
- **B. Final generated test suite** — after a testing-gap analysis of the as-built system, covering: starter regression; domain/state; persistence/migration; authority; path safety; task graph; Plane isolation; protected-branch invariants; contract execution; manifest validation; independent verification; claim validation; deterministic collision; candidate independence; winner policy; promotion; no-winner; interruption/restart; API; UI; fault injection; secret/redaction; reset safety; complete E2E demo flow. Run → inspect every failure → fix product defects (never weaken assertions) → rerun until stable → run the complete suite ≥5 consecutive times to detect flakiness → remove/fix flaky tests by root cause. Default suite requires no live Ark calls; a separate live-runtime smoke path covers what inherently needs it.
- **C. `docs/SHEPHERD_TEST_REPORT.md`** — exact commands, environment, categories, pass/fail, failure modes exercised, container/browser coverage, repeated-run results, known untested limitations with reasons, credential-requiring checks, final `npm run check` status, demo rehearsal timings. Nothing fabricated.
- **D. README update** — name, track, problem/rationale, one-sentence design, three primitives, architecture summary, setup, run commands, demo reset, exact demo steps, validation/test commands, links to A and C, security notes, honest limitations, future work. Preserve starter setup instructions.
- **E. Final audit** — no hard-coded winner; no static/fake evidence; no secrets in source/store/browser; no large stray artifacts; no broken starter behavior; no dead debug endpoints; no duplicate abandoned implementations; no stale docs; no failing tests; no reset hazards; no promotion bypass; no code change after reports without revalidation.

**Gate:** all five deliverables exist, are consistent with the code, and the full suite + `npm run check` + one final clean demo run are green on the final commit.

---

# 17. Definition of Done

Complete only when **all** are true:

**Baseline** — starter launches; Agent CRUD, legacy Playground, real execution, session continuity, workspace persistence all work; `npm run check` passes.

**Kernel** — real Mission/contracts/Planes; real Agents execute in Planes; manifests required; authority checked against actual diffs; independent verification decides success; two locally-verified Agents expose a semantic collision with no textual Git conflict; evidence references real artifacts; two strategies fork from one immutable base; candidates execute and verify independently; no hard-coded winner (flip-test proven); failed/ambiguous resolution never promotes; winner re-verifies; head consistency checked; only the verified selected candidate reaches protected state.

**UI** — all Section 11 surfaces exist on real data; collision, speculation, and promotion are visually obvious; all eight journeys pass; visual checklist clean.

**Robustness** — every Section 12 category tested; interruption durable; unsafe scope cannot promote; secrets clean; reset safe; no falsely green UI; five kernel invariants mutation-checked.

**Discipline** — `docs/BUILD_LOG.md` reflects the BVTE loop throughout; `docs/DEVIATIONS.md` lists any deviations with rationale; all Phase 9 deliverables complete and truthful.

**Honest limitations to document** — one project / one mutating Mission; single-process JSON store; ordinary containers are not hardened multi-tenant isolation; semantic detection guarantees the implemented structured-claim protocol (normalized keys + declared-key cross-check), not universal program-semantic conflict detection; model-assisted analysis is best-effort; scoped authority guarantees unauthorized changes cannot be promoted, not that an Agent cannot physically write inside its disposable Plane; external side effects are outside the transaction model; candidate verification depends on declared acceptance-criteria quality; local PoC is the judging path.

---

# 18. Final Executor Instruction

Implement the complete chain — **Contract → Execute → Verify → Detect Collision → Fork Futures → Verify Futures → Promote Winner** — with the walking skeleton first, live integration second, and verification woven through every step per Section 0. Never mark anything done that you have not personally run and observed producing the specified output. Never fake, never weaken, never skip a gate. When blocked, reproduce, diagnose, fix the root cause, prove the fix, and log it. The finished system must be demonstrable from a clean reset, three times in a row, inside three minutes.
