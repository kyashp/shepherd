# TikTok TechJam 2026 — Complete Hackathon Brief and Track Guide

> Source: [TikTok TechJam 2026 Tracks & Problem Statements](https://bytedance.larkoffice.com/wiki/DNtSwxgeciCS2nkiUefc5qqtnkf)  
> Source page title: `[Early Bird Access] TikTok TechJam 2026 Tracks & Problem Statements`  
> Source page last updated: 25 August 2026  
> Retrieved: 25 August 2026, Singapore time  
> Security note: The page password is intentionally not stored in this file.

## 1. Hackathon Overview

TikTok TechJam 2026 offers five technical tracks. The organizers recommend attending the relevant technical workshops before choosing a track. The workshop day is Friday, 28 August 2026, from 1:00 p.m. to 6:00 p.m. Singapore time (GMT+8). Each track receives a 45-minute workshop and Q&A slot. The shared webinar room is [Lark Meeting 484622806](https://vc-my.larkoffice.com/j/484622806).

| Time on 28 August 2026 | Track |
|---|---|
| 1:00–1:45 p.m. | Track 1 — Agent Launchpad: Design and Build Lightweight Agent Middleware |
| 2:00–2:45 p.m. | Track 2 — Autonomous Machine Learning Research Agent for Recommender Systems |
| 3:00–3:45 p.m. | Track 3 — Implement a GPU Kernel for a Transformer Layer |
| 4:00–4:45 p.m. | Track 4 — Shopping Copilot: AI Conversational Search and Recommendations |
| 5:00–5:45 p.m. | Track 5 — Robust Detection of AI-Generated Images Under Real-World Transformations |

## 2. Five-Track Comparison

| Track | Central task | Main artifact | Primary technical emphasis | Critical constraint or metric |
|---|---|---|---|---|
| 1. Agent Middleware | Add a coherent, functional middleware capability to an existing agent platform. | Working platform extension, three-minute live demo, architecture diagram, tests, and repository. | Backend and runtime architecture, security, observability, reliability, policy, lifecycle, or multi-agent coordination. | The middleware must execute in a trusted backend, runtime, data, or infrastructure path; a UI-only mock does not qualify. |
| 2. Autonomous ML Research Agent | Build an agent that repeatedly writes and modifies ML code to improve a recommender-system benchmark. | Autonomous research loop, final checkpoint/output, iteration logs, results, resource report, and repository. | Agentic experimentation, recommender systems, feature engineering, training, evaluation, recovery, and research automation. | KuaiRand-Pure is required; final ranking uses NDCG@10 and Recall@50 on a hidden test set. |
| 3. Transformer GPU Kernel | Implement and optimize one or more kernels for a fixed Transformer layer. | Correct high-performance kernel implementation, technical report, repository, and demo video. | CUDA/Triton/PyTorch/TensorFlow, profiling, kernel fusion, memory movement, precision, and hardware utilization. | Relative error must be below 0.02 and absolute error below 0.002 across disclosed input-shape combinations. |
| 4. Shopping Copilot | Build a text-only conversational shopping agent that routes buying and browsing intents and retrieves the correct product efficiently. | Headless agent/API pipeline, repository, evaluator results, and demo video. | Intent routing, hybrid retrieval, reranking, conversational state, memory, and dynamic orchestration. | Sessions have a hard limit of 10 turns; exceeding it forces termination and a zero score for that session. |
| 5. AI-Image Detection | Detect AI-generated images even after realistic transformations. | Image-directory inference script, JSON predictions, robustness comparison, error analysis, repository, and demo video. | Computer vision, image forensics, robustness, augmentation, generalization, calibration, and explainability. | Models must contain fewer than 2 billion parameters; the supplied validation subset must not be used for training. |

---

# Track 1 — Agent Launchpad: Design and Build Lightweight Agent Middleware

## 3.1 Plain-Language Goal

The organizers already give you a functioning platform in which users can create, run, stop, edit, test, and delete AI agents. Your task is not to rebuild this product. Your task is to add one meaningful infrastructure capability between its existing components. Examples include deciding what an agent is allowed to do, recording exactly what it did, recovering when it fails, controlling cost, coordinating several agents, or improving isolation and safety.

## 3.2 Challenge Definition

An AI agent can reason, invoke tools, execute code, manipulate files, and continue work across turns. Therefore, a useful agent platform needs operational control, authorization, observability, and containment in addition to chat. Every team begins with the same working starter platform and should spend the hackathon solving one coherent agent-infrastructure problem.

The submission must improve the platform functionally and testably without breaking agent CRUD, lifecycle controls, Playground chat, persistence, or model execution. Reviewers reward depth, architecture, integration, and evidence rather than the number of features.

## 3.3 Starter Kit

The starter repository is [RrankPyramid/CodeJam](https://github.com/RrankPyramid/CodeJam).

| Area | Already provided | Team responsibility |
|---|---|---|
| Product experience | React UI, agent list, create/edit forms, lifecycle controls, Playground, and run status. | Preserve the baseline and add only enough UI to reveal the middleware. |
| Control plane | Fastify API, validation, asynchronous runs, `AgentService`, and JSON persistence. | Integrate genuine middleware behavior into the backend path. |
| Agent runtime | Codex CLI, persistent sessions, per-agent workspaces, and disposable local containers. | Insert the middleware at the most appropriate execution boundary. |
| Infrastructure | Docker, Colima, Podman, Docker Compose, ECS scripts, and Terraform. | Use the smallest execution path that proves the idea; cloud deployment is optional. |
| Middleware | User identity, trace timelines, audit models, and hardened sandbox policy are intentionally absent. | Select, combine, adapt, or invent a coherent set of capabilities. |

The baseline can create, inspect, edit, start, stop, and delete agents; send multi-turn Playground tasks; poll asynchronous run status; let Codex write files and execute commands inside an agent workspace; resume Codex sessions; persist agents, messages, and runs in JSON; run turns in disposable Docker, Colima, or Podman containers; connect to BytePlus ModelArk through a Responses-compatible endpoint; and optionally deploy to BytePlus ECS manually or through Terraform.

Valid extension seams include the Fastify request boundary, `AgentService`, the `AgentRunner` interface, and the execution data model. Teams may add events, principals, policies, lifecycle behavior, provider adapters, memory controls, reliability mechanisms, or other capabilities at the boundary that best owns the decision.

| Runtime profile | Execution model | Intended use |
|---|---|---|
| Local proof of concept | One disposable local container per turn. | Recommended development and judging path; supports Docker, Colima, and rootless Podman. |
| BytePlus ECS | Codex runs inside the application container. | Optional cloud demonstration path. |
| Local development | Codex runs as a host process. | Useful for hot reload when the host Codex CLI is installed and configured. |

The repository is deliberately a single-user proof of concept. Its optional bearer token protects a remote demo but is neither user identity nor an authorization system. The JSON store supports one process. Ordinary containers are not hardened multi-tenant isolation. These are extension points, not a requirement to repair everything.

## 3.4 Running the Baseline

The local requirements are macOS or Linux, Node.js 22 or newer, npm 10 or newer, one of Docker/Colima/Podman, a BytePlus ModelArk API key, and a Responses-compatible endpoint ID.

```bash
git clone https://github.com/RrankPyramid/CodeJam.git
cd CodeJam
ARK_API_KEY=your-ark-api-key ARK_MODEL=ep-your-endpoint-id npm run poc
```

The first run installs dependencies and builds the runtime image. Open `http://localhost:3000` after startup. `ARK_API_KEY` must be an Ark model API key rather than a BytePlus account AK/SK. `ARK_MODEL` is normally an endpoint ID beginning with `ep-`. Incorrect credentials produce an HTTP 401 response from the Ark Responses API.

Rootless Podman can be forced with the following command. Colima uses the ordinary command after `colima start`.

```bash
CONTAINER_ENGINE=podman ARK_API_KEY=your-ark-api-key ARK_MODEL=ep-your-endpoint-id npm run poc
```

The baseline acceptance flow is to create an agent with a name, description, and workspace instructions; submit a real TypeScript hello-world CLI task through the Playground; verify a completed assistant response; send a follow-up and verify session continuity; then stop and restart the agent and verify workspace persistence. The source’s example task is: “Create a TypeScript hello-world CLI, add a test, run it, and summarize the files you created.” If this fails, inspect the container engine, `/api/system`, and the Ark credentials before adding middleware.

The required repository validation command is:

```bash
npm run check
```

This runs TypeScript checks, server tests, and production builds. Relevant project documentation includes the [README](https://github.com/RrankPyramid/CodeJam/blob/main/README.md), [local POC guide](https://github.com/RrankPyramid/CodeJam/blob/main/docs/LOCAL_POC.md), [architecture guide](https://github.com/RrankPyramid/CodeJam/blob/main/docs/ARCHITECTURE.md), and [optional ECS deployment guide](https://github.com/RrankPyramid/CodeJam/blob/main/docs/DEPLOYMENT.md).

## 3.5 Middleware Design Requirements

| Requirement | Meaning |
|---|---|
| Preserve the baseline | Agent CRUD, lifecycle actions, Playground chat, persistence, and model execution must remain functional. |
| Implement real behavior | The middleware must execute in the backend, runtime, data layer, or infrastructure. Static screens and hard-coded success responses do not qualify. |
| Define ownership and boundaries | Explain which component owns each decision or event, what data crosses the boundary, and what happens on failure. |
| Demonstrate evidence | Show normal behavior and one relevant failure, denial, degradation, abuse, or recovery case. |
| Add automated verification | Test the middleware behavior itself, not only the UI. |
| Protect secrets | Never commit or display API keys, AK/SK values, passwords, bearer tokens, or unredacted sensitive payloads. |
| Minimize infrastructure | Local execution is the default judging path; ECS is optional and does not improve the score by itself. |

In scope are a focused middleware story, related backend capabilities, minimal UI, tests, schema changes, protected fixtures, mock users, controlled failures, policy decisions, reliability mechanisms, and refactors needed for clean contracts. Out of scope are rebuilding the entire product, building a commercial cloud platform, or implementing production OAuth, a general policy engine, a microVM runtime, a scheduler, or multi-region infrastructure unless that component is genuinely central to the chosen idea.

## 3.6 Lifecycle Extensions

The starter already supports finding an agent, inspecting its configuration and state, starting or stopping it, using the Playground, reviewing runs and messages, continuing a session, and deleting the agent under an explicit workspace archival policy. A team may extend only the lifecycle actions necessary to prove its middleware. Candidate actions include invoking an agent with a test input, opening run-specific middleware evidence, distinguishing human and agent actions, adding approval, versioning configuration, rotating or revoking access, pausing or reconciling runs, retrying or recovering, and enforcing a cleanup or retention policy.

## 3.7 Suggested Three-Day Plan

| Day | Engineering goal | Exit evidence |
|---|---|---|
| 1 | Run and understand the baseline, choose one agent-specific problem, define its contract, and implement the first backend path. | The baseline passes and an API or test can trigger one real middleware event, control, or decision. |
| 2 | Finish the core path, persist evidence, add minimal UI, and implement success and failure cases. | The browser-to-backend/runtime/data/infrastructure scenario works end to end. |
| 3 | Add tests, cleanup and error handling, architecture diagram, README, and demo rehearsal. | `npm run check` passes and the complete demo fits within three minutes. |

## 3.8 Recommended Middleware Directions

The listed directions are examples rather than a compulsory checklist.

| Direction | Technically meaningful implementation evidence |
|---|---|
| Identity and authorization | Separate human and agent principals; scoped and revocable delegation; trusted server-side enforcement; optional approvals; attribution of initiator, agent, target, decision, and result; secure secret handling and revocation. A mock identity model is acceptable, but a login screen without backend authorization is not. |
| Trace, audit, and observability | Correlated agent, version, run, session, trace, span, and actor identifiers; timing and status; model/tool/memory/sandbox/policy events; retry and cancellation links; redacted inputs and outputs; model and infrastructure metadata; token, cost, or resource signals; and a trace tree or timeline that identifies the failing step. |
| Layered agent architecture | A clear separation among experience, control plane, identity/policy, runtime, execution/data, observability, and cloud resources, with explicit APIs or event contracts and an explanation of how another provider or runtime could be substituted. |
| Threat modeling and safety | Explicit assets, actors, trust boundaries, abuse cases, controls, and residual risks. Relevant controls include least privilege, short-lived credentials, redaction, tool allowlists, typed schemas, target scoping, non-privileged containers, filesystem/network limits, ownership-aware authorization, quotas, timeouts, concurrency and step limits, cost budgets, trace access controls, and retention limits. Existing CPU/memory/PID/no-new-privileges defaults alone are not a new safety capability. |
| Multi-agent coordination | Several agents share a session/topic/queue, preserve shared state, obey a routing or turn rule, expose an attributable event history, and recover or stop when one agent times out. The suggested demonstration is a duplicate-free, gap-free countdown from 10 to 1 across multiple agents. |
| Team-designed middleware | Lifecycle reconciliation, failure recovery, memory governance, human approval, budget control, provider abstraction, versioning and rollback, routing, credential exchange, automated diagnosis, or another coherent agent-specific capability. |

## 3.9 Demo, Deliverables, Acceptance, and Scoring

The live demonstration must create or select a runnable agent, execute a real task, show at least one real model/file/tool/sandbox/data/infrastructure action, expose the middleware behavior and its evidence, demonstrate a relevant failure or recovery case, and show that the platform remains understandable and controllable. Mock external services are acceptable; static UI is not.

| Required deliverable | Requirement |
|---|---|
| Three-minute live demo | One real agent run plus normal middleware behavior and one failure, denial, degradation, abuse, or recovery case. |
| One-page architecture diagram | Middleware, data flow, trust boundary, and the enforcement, instrumentation, or recovery point. |
| Code repository | Setup, problem and rationale, design, automated tests, demo steps, limitations, and no secrets. |

The core acceptance conditions are reproducible startup; working agent creation/testing; meaningful middleware; execution outside the UI; sufficient documentation; a passing `npm run check`; and absence of secrets from source, Git history, logs, traces, screenshots, browser storage, and demos. Optional evidence may prove revocable delegation, correlated tracing, containment of a defined threat, or another lifecycle/reliability/memory/budget/provider/coordination capability.

| Track 1 judging category | Weight |
|---|---:|
| End-to-end middleware behavior | 40% |
| Technical design and integration | 25% |
| Verification and robustness | 20% |
| Demo and reproducibility | 15% |

The scope guidance states that depth and coherence matter more than breadth. Local Docker/Colima/Podman is sufficient; ECS is unnecessary. Mock users and resources are allowed. Teams may combine or invent directions. Polished UI does not count as middleware. When Ark returns HTTP 401, the common causes are using account AK/SK credentials instead of an Ark model API key or selecting the wrong endpoint. Recommended code-entry points are `apps/server/src/types.ts`, `apps/server/src/app.ts`, `apps/server/src/agent-service.ts`, the two `AgentRunner` implementations, and `apps/web/src/App.tsx`.

---

# Track 2 — Autonomous Machine Learning Research Agent for Recommender Systems

## 4.1 Plain-Language Goal

You must build an AI software engineer that conducts recommender-system experiments on its own. It reads the dataset and metric, writes the training code, runs an experiment, measures the result, diagnoses what worked or failed, edits the code, and repeats. Its goal is to beat an official baseline with as little human intervention and wasted compute as possible.

The Track 2 statement was updated on 25 August 2026 at 9:10 p.m.

## 4.2 Research Loop and Prior Work

The intended loop is: understand the problem, inspect the data, engineer features, train and tune, evaluate, then reflect and revise. The loop is suitable for an LLM agent because feature engineering, model definition, training, and evaluation are expressed through code that the agent can repeatedly modify.

The document cites [MLE-Bench](https://doi.org/10.48550/arXiv.2410.07095), [AIDE](https://doi.org/10.48550/arXiv.2502.13138), and [AI Scientist-v2](https://doi.org/10.48550/arXiv.2504.08066) as representative autonomous ML/research-agent systems.

## 4.3 Required Autonomous Task

| Stage | Requirement |
|---|---|
| Reproduce the official baseline | Build a working pipeline and reach the organizer-provided validation baseline. A team-created starting point is not the reference baseline. |
| Iterate on the entire pipeline | Use established industry or academic methods to improve data inspection, features, architecture, training, tuning, and evaluation. The hidden test set is unavailable during development. |
| Improve and converge | Sustain improvement relative to the baseline, designate a final validation-best checkpoint at convergence, and accept that intermediate scores may fluctuate. |
| Operate autonomously | The agent should propose and execute changes based on its own evaluations across the full stack. Fewer manual interventions score better. |
| Recover robustly | Errors, timeouts, and unexpected inputs should trigger retry, recovery, or rerouting rather than a crash, stall, or divergence. |

KuaiRand-Pure is compulsory. KuaiRand-1k and KuaiRand-27k are optional bonus benchmarks. Falling below the baseline is scored continuously rather than causing disqualification. The compute budget was still marked “TBD” in the retrieved statement.

## 4.4 Data, Splits, Baseline, and Resources

The KuaiRand date splits may be formed as follows: use the standard logs from 8–21 April for training; use the first half of the 22 April–8 May standard logs for validation; and use the second half for testing. Development may use only training and validation feedback.

The fixed baseline and evaluation script refer to [CWM](https://github.com/hyz20/CWM). The organizer supplies the official baseline scores, NDCG/Recall scoring code, convergence rule, submission schema, and output example. Each iteration must log its hypothesis, code diff, metrics, and error/recovery events. Any coding agent may be used; the brief mentions [Trae](https://www.trae.ai/pricing) and its new-user seven-day trial.

| Dataset | Status | Approximate scale | Task and metrics |
|---|---|---:|---|
| KuaiRand-Pure | Required; determines 100% of the primary score. | 1.4 million interactions, 27,000 users, 7,600 items. | Click is the fixed positive relevance signal; NDCG@10 and Recall@50. |
| KuaiRand-1k | Optional bonus. | 11.7 million interactions. | Same task and metrics. |
| KuaiRand-27k | Optional bonus. | 322 million interactions. | Same task and metrics. |

The [KuaiRand dataset](https://kuairand.com/) contains 12 feedback signals, including click, like, follow, comment, forwarding, long view, and play time, plus randomized exposure data that enables counterfactual or off-policy evaluation. The exact label definition and K values are pinned in the starter kit.

Open-source libraries, papers, public solutions, and pretrained weights are allowed. External training data is forbidden, including augmenting or joining another dataset or using weights trained on the benchmark’s hidden test labels.

## 4.5 Scoring Mathematics

A run converges when the validation score has failed to improve by more than an organizer-specified threshold \(\varepsilon\) for \(N\) consecutive iterations, or when the fixed compute/wall-clock budget is exhausted. The validation-best checkpoint at convergence is evaluated once on the hidden test set.

For each metric \(m\):

\[
\Delta(m)=\operatorname{score}_{agent}(m)-\operatorname{score}_{baseline}(m)
\]

For a dataset, the score is the mean absolute improvement across its metrics:

\[
\operatorname{score}_{dataset}=\frac{1}{|M|}\sum_{m\in M}\Delta(m)
\]

For KuaiRand, \(M=\{\text{NDCG@10},\text{Recall@50}\}\). KuaiRand-Pure supplies the complete primary score, while strong results on the other variants add bonus points.

| Track 2 judging category | Weight and interpretation |
|---|---|
| Technical execution | 35%. Hidden-test delta over the official baseline plus robust error recovery. |
| Innovation and problem insight | 20%. What the agent chooses to improve, why it chooses it, and whether it draws meaningfully from published methods rather than naive tuning. |
| Impact and relevance | 20%. Autonomy, measured mainly by how few manual interventions are required to converge. |
| Feasibility and practicality | 15%. Total LLM input/output tokens and total GPU-hours required to converge. |
| Presentation and communication | 10% at the final event. |

## 4.6 Deliverables

| Deliverable | Required content |
|---|---|
| Devpost project description | Problem fit, development tools, APIs, libraries/frameworks, datasets, and assets. |
| Public repository | Structured and commented code; setup and reproduction instructions; limitations; intended improvements; and team-member contributions. |
| Run and iteration logs | Per-iteration hypothesis, code diff, NDCG@10 and Recall@50, error/recovery events, and a manual-intervention count. |
| Final submission and results | KuaiRand-Pure output/checkpoint in the required schema; optional bonus outputs; validation-best scores and deltas over baseline; LLM token usage; and GPU-hours. |

## 4.7 Recommender-System Primer

An industrial recommender narrows candidates through recall/retrieval, pre-ranking, ranking, and re-ranking. This challenge primarily targets ranking rather than the entire production funnel.

CTR is \(P(\text{click}\mid\text{impression})\). CVR is \(P(\text{conversion}\mid\text{click})\), but KuaiRand has no purchase label and CVR is not scored. The same sample-selection-bias and sparsity problems appear in deeper signals such as long view, like, and follow, so ESMM-style multi-task learning remains relevant.

KuaiRand exposes 12 feedback signals. Multi-task models can share representations across them even when only clicks are scored, but they must balance transferable shared parameters against task-specific parameters to avoid negative transfer or the “seesaw” problem.

| Metric | Meaning | Role here |
|---|---|---|
| AUC | Probability that a random positive is ranked above a random negative. | Common for CTR/CVR, but not scored in this track. |
| NDCG | Rewards relevant results more strongly when they appear near the top. | Scored for KuaiRand. |
| Recall | Fraction of all relevant items captured in the returned top-K list. | Scored for KuaiRand. |

Relevant feature foundations include user/item/category IDs, learned embeddings for high-cardinality discrete values, and feature crosses such as user × category. Factorization machines and DeepFM automate interaction learning. Recommended introductory sources are Google’s [Recommendation Systems overview](https://developers.google.com/machine-learning/recommendation) and Wang Shusen’s [Recommender Systems notes](https://github.com/wangshusen/RecommenderSystem).

---

# Track 3 — Implement a GPU Kernel for a Transformer Layer

## 5.1 Plain-Language Goal

PyTorch or TensorFlow already knows how to calculate a Transformer layer, but its general implementation may not be the fastest possible implementation for one GPU and a known collection of tensor shapes. You must produce one or more specialized GPU kernels that return almost the same numbers while completing the computation faster.

## 5.2 Technical Background

For an input \(X\in\mathbb{R}^{N\times d}\), the Transformer forms:

\[
Q=XW_Q,\qquad K=XW_K,\qquad V=XW_V
\]

Scaled dot-product attention is:

\[
\operatorname{Attention}(Q,K,V)=\operatorname{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V
\]

The workload contains matrix multiplication, attention-score calculation, softmax, normalization, and feed-forward computation. Performance may be limited by arithmetic throughput, memory bandwidth, cache behavior, kernel-launch overhead, or Tensor Core utilization. Candidate methods include operator fusion, layout changes, lower precision, Tensor Cores, specialized softmax, and custom CUDA, Triton, PyTorch, or TensorFlow code.

## 5.3 Task, Constraints, and Resources

The fixed Transformer formula is tested through organizer-provided PyTorch or TensorFlow benchmarks. Teams need only choose one framework. They may rewrite the layer and decide which operations to fuse. The implementation may select different kernels by inspecting the disclosed input shape. Test cases cover large and small batches, sequence lengths, and hidden dimensions.

Correctness requires relative error below 0.02 and absolute error below 0.002 against the reference. Teams optimize and test on their own GPU and must document CPU, GPU, disk, optimizations, AI tools, and final performance. AI-assisted generation and profiling are in scope; production deployment is out of scope.

The Lark page exposes two downloadable benchmark attachments named `torch_transformer_benchmark.py` and `tensorflow_transformer_benchmark.py`.

## 5.4 Deliverables and Judging

The required submission consists of a Devpost description, a public and reproducible repository, and a short public YouTube video linked from Devpost. The repository README must cover the project, setup, reproduction, limitations, improvements, and team contributions. For a backend track, a walkthrough of API usage, performance tests, and result analysis is acceptable instead of a front-end demonstration.

| Judging category | Weight |
|---|---:|
| Technical execution | 35% |
| Innovation and problem insight | 20% |
| Impact and relevance | 20% |
| Feasibility and practicality | 15% |
| Presentation and communication at the final event | 10% |

---

# Track 4 — Shopping Copilot: AI Conversational Search and Recommendations

## 6.1 Plain-Language Goal

Build a text-based shopping assistant that can tell whether a person knows what they want or is still exploring. When the user has exact constraints, it should filter precisely. When the user describes a situation or vague desire, it should search semantically across the catalog, ask useful questions, remember evolving preferences, and reach the correct product in very few turns.

## 6.2 Four Technical Pillars

| Pillar | Requirement |
|---|---|
| Intent routing and hybrid retrieval | Separate high-intent buying from open-ended browsing. Buying locks hard constraints; browsing uses diverse dense retrieval. Combine keyword, category, and vector retrieval before LLM semantic reranking. |
| Multi-turn dialog strategy | Track incrementally accumulated slots and handle abrupt intent overrides by erasing or rewriting stale slots. When a query is too general and the candidate pool is excessive, stop retrieval and ask a structured clarification question. |
| Dynamic context programming | Distill dialog history into short-term session state and a longer-term user profile, then adapt the workflow and guidance strategy at runtime. |
| Product and efficiency evaluation | Measure retrieval coverage, exact-product ranking precision, and the number of dialog turns required to reach conversion. |

The metrics are Hit Rate@K for retrieval coverage, MRR and Top-K Hit Rate for ranking precision, and MTTC (mean turns to conversion) for conversational efficiency. The purchased product in the labeled session is the target.

## 6.3 Scope and Hard Rules

| Category | Rule |
|---|---|
| In scope | Intent detection, buying/browsing routing, heterogeneous retrieval, weighting and truncation, slot decay, adaptive memory, context distillation, prompt strategy, and local LLM-ranking logic. |
| Out of scope | UI/UX, full base-model training, heavy external vector-database clusters, and multimodal inputs. Evaluation is through backend APIs and headless pipelines. |
| Turn limit | A session may contain at most 10 turns. Exceeding the limit causes forced termination and a zero score. |
| Catalog integrity | The frozen Amazon product catalog is read-only; teams may not alter it or inject mock ASINs. |
| Simplifying assumptions | Inputs are clean text, catalog/pricing/categories remain static, and sessions are isolated single-user simulations without concurrency stress. |

## 6.4 Data and Starter Resources

The frozen competition kit derives from Amazon Reviews 2023 and contains 50,000 products from `Clothing_Shoes_and_Jewelry`, 200 public development sessions, and 800 private evaluation sessions. Public and private sessions use different users and target products.

The kit includes a weak Python BM25 starter agent, a deterministic evaluator for Hit Rate@10, MRR, MTTC, Efficiency, and the combined `TechnicalScore`, a Python agent interface, a machine-readable API contract, configuration, baseline results, data documentation, submission rules, and a SHA256 catalog checksum. Teams may keep or replace the starter and may use keyword, rule-based, dense, hybrid, reranking, local-model, or external-API methods.

The organizer provides no hosted model, key, tokens, or API credit. Paid LLM access is unnecessary. Any external-service cost and secret management belongs to the team.

| Resource | Link |
|---|---|
| Participant repository | [TechJam2026/techjam-conversational-search](https://github.com/TechJam2026/techjam-conversational-search) |
| Frozen participant kit | [Participant-kit release](https://github.com/TechJam2026/techjam-conversational-search/releases/tag/participant-kit) |
| Original upstream documentation | [Amazon Reviews 2023](https://amazon-reviews-2023.github.io/) |

Participants do not need to download or reconstruct the entire upstream Amazon dataset.

## 6.5 Deliverables and Judging

The required outputs are a Devpost description, a public repository with reproducible instructions and team contributions, and a short public YouTube demo linked from Devpost. A backend/API/result-analysis walkthrough is acceptable without a UI.

| Judging category | Weight |
|---|---:|
| Technical execution | 35% |
| Innovation and problem insight | 20% |
| Impact and relevance | 20% |
| Feasibility and practicality | 15% |
| Presentation and communication at the final event | 10% |

---

# Track 5 — Robust Detection of AI-Generated Images Under Real-World Transformations

## 7.1 Plain-Language Goal

Train a system that says whether an image was made by generative AI. The difficult part is that it must still work after someone reposts, compresses, blurs, crops, resizes, recolors, or adds noise to the image. You must compare clean and transformed performance and explain the mistakes your detector makes.

## 7.2 Technical Task and Transformation Suite

The prototype should distinguish synthetic from authentic images, generalize beyond clean training conditions, evaluate realistic post-processing, and discuss false positives, robustness, generalization, and explainability.

| Transformation | Parameters | Real-world analogue |
|---|---|---|
| JPEG compression | Quality 90, 70, 50, and 30. | Social-media or messaging re-encoding. |
| Gaussian blur | \(\sigma=0.5,1.0,2.0\). | Out-of-focus capture. |
| Resize | Downscale to 0.5× or 0.25× and upscale again. | Thumbnail generation. |
| Gaussian noise | \(\sigma=0.02,0.05,0.10\). | Low-light sensor noise. |
| Color jitter | Brightness, contrast, and saturation adjusted by ±20%. | Filters and auto-enhancement. |
| Center crop | Retain 80%. | Profile-picture cropping or reframing. |

## 7.3 Scope, Data, and Validation

Image-level detection, feature engineering, model design, robustness evaluation, error analysis, and explainability are in scope. Full deployment, platform-wide moderation, video, and audio are excluded. The prototype should assume limited compute, and every model must contain fewer than 2 billion parameters.

Teams may use public or properly licensed datasets and generate their own transformed samples. Suggested datasets are [SID Set](https://huggingface.co/datasets/saberzl/SID_Set), [CIFAKE](https://www.kaggle.com/datasets/birdy654/cifake-real-and-ai-generated-synthetic-images), and [WildFake](https://modelscope.cn/datasets/hy2628982280/WildFake/summary).

The demonstration-only validation subset contains 4,998 real COCO `val2017` images and 8,843 DALL·E Advanced synthetic images from WildFake. It is a reference benchmark for tracking improvement and does not contribute to the final score. It must not be used for training.

## 7.4 Deliverables and Judging

| Deliverable | Requirement |
|---|---|
| Devpost description | Problem fit, tools, models/APIs, frameworks, datasets, and assets. |
| Public repository | Structured code plus a script that accepts an image directory and writes JSON predictions containing `image_path` and `pred`, where `pred` is the AIGC confidence. The README must cover setup, reproduction, limitations, future improvements, and team contributions. |
| Demo video | Short public YouTube demonstration linked from Devpost. |
| Robustness summary | Compact table or visual comparing clean and transformed performance. |
| Error analysis | Representative false positives, false negatives, and identified trade-offs. |

| Judging category | Weight |
|---|---:|
| Technical execution | 35% |
| Innovation and problem insight | 20% |
| Impact and relevance | 20% |
| Feasibility and practicality | 15% |
| Presentation and communication at the final event | 10% |

---

# 8. Simple-to-Technical Understanding Bridge

## 8.1 Track 1 Bridge

In simple terms, Track 1 asks you to add the missing “rules and control system” around an AI agent. Technically, this means intercepting requests or execution events at a trusted boundary, applying a policy or operational mechanism, persisting correlated evidence, exposing minimal APIs and UI, and testing both an allowed path and a denial/failure/recovery path. The core engineering question is not “what page can we add?” but “which component must own this decision so that an agent cannot bypass it?”

## 8.2 Track 2 Bridge

In simple terms, Track 2 asks you to automate the job of an ML engineer who keeps experimenting until a recommender improves. Technically, the agent needs an experiment-state machine that generates hypotheses, edits a reproducible pipeline, schedules training, parses validation metrics, compares checkpoints, manages an experiment budget, recovers from failure, and chooses the validation-best checkpoint at convergence without observing the hidden test set.

## 8.3 Track 3 Bridge

In simple terms, Track 3 asks you to perform the same math faster on a GPU. Technically, the task is constrained numerical program optimization: preserve the tensor function within fixed error tolerances while minimizing execution time over a disclosed shape distribution. Performance comes from reducing global-memory traffic and intermediate tensors, fusing operations to reduce kernel launches, mapping computation to Tensor Cores, selecting precision carefully, and specializing kernels for shape regimes.

## 8.4 Track 4 Bridge

In simple terms, Track 4 asks you to make product search behave like a capable salesperson rather than a keyword box. Technically, it is a partially observed sequential decision system: infer latent intent, maintain and revise slot state, choose between filtering and semantic retrieval, rerank candidates, decide when information is insufficient, ask a clarification question, distill memory, and minimize turns while maximizing the rank of the labeled target product.

## 8.5 Track 5 Bridge

In simple terms, Track 5 asks you to recognize AI images even after they have been “washed” through real apps. Technically, this is distributionally robust binary classification under a family of transformation operators. A strong solution needs controlled augmentation, generator and dataset diversity, calibrated confidence, stratified evaluation by transformation and severity, and an error analysis that distinguishes detector failure from dataset shortcuts or domain shift.

# 9. Track Selection by Engineering Profile

| If you most want to practice… | Most direct track |
|---|---|
| Backend architecture, security, observability, reliability, and product-integrated systems engineering | Track 1 |
| Agentic coding, experiment automation, recommender systems, and applied ML research | Track 2 |
| GPU programming, numerical computing, profiling, and low-level performance engineering | Track 3 |
| Information retrieval, recommendation, NLP agents, state machines, and evaluation-driven backend design | Track 4 |
| Computer vision, robustness, forensic detection, calibration, and model evaluation | Track 5 |

# 10. Source Links

| Purpose | Link |
|---|---|
| Official problem-statement page | [Lark document](https://bytedance.larkoffice.com/wiki/DNtSwxgeciCS2nkiUefc5qqtnkf) |
| Webinar room | [Lark Meeting](https://vc-my.larkoffice.com/j/484622806) |
| Track 1 starter repository | [RrankPyramid/CodeJam](https://github.com/RrankPyramid/CodeJam) |
| Track 2 official-baseline reference | [CWM](https://github.com/hyz20/CWM) |
| Track 2 dataset | [KuaiRand](https://kuairand.com/) |
| Track 4 participant repository | [TechJam2026/techjam-conversational-search](https://github.com/TechJam2026/techjam-conversational-search) |
| Track 4 participant-kit release | [GitHub release](https://github.com/TechJam2026/techjam-conversational-search/releases/tag/participant-kit) |
| Track 4 upstream dataset documentation | [Amazon Reviews 2023](https://amazon-reviews-2023.github.io/) |
| Track 5 SID Set | [Hugging Face](https://huggingface.co/datasets/saberzl/SID_Set) |
| Track 5 CIFAKE | [Kaggle](https://www.kaggle.com/datasets/birdy654/cifake-real-and-ai-generated-synthetic-images) |
| Track 5 WildFake | [ModelScope](https://modelscope.cn/datasets/hy2628982280/WildFake/summary) |

# 11. Known Open or Provisional Items

The retrieved Track 2 statement still marked the compute budget as “TBD” and stated that the organizer would fix and publish the convergence parameters \(\varepsilon\) and \(N\) in the starter kit. Track 3 benchmark scripts appeared as Lark attachments rather than ordinary public URLs. These items should be rechecked after the public release or workshop.
