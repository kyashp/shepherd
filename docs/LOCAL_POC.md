# Local POC

> This is the canonical startup, troubleshooting, and manual verification runbook.
> Current completion status and known gaps are in [`TASKS.md`](TASKS.md); do not
> convert an open task there into a pass based only on manual observation.

The local profile runs the React/Fastify control plane on macOS or Linux and
starts every Codex turn in a disposable Docker, Colima, or Podman container.
Only the Volcengine Ark model API is remote.

## Start

Requirements:

- Node.js 22+
- Docker, Colima, or Podman
- An Ark API key and Responses-capable endpoint

```bash
./scripts/start-local-poc.sh
```

The script safely reads the repository's ignored `.env`; configure
`ARK_API_KEY` and `ARK_MODEL` there before starting. It does not source `.env`
as shell code.

Open <http://localhost:3000>. Press `Ctrl+C` to stop the server and remove this
instance's remaining Runtime containers.

Force an engine by setting `CONTAINER_ENGINE=docker` or
`CONTAINER_ENGINE=podman` in `.env`. Colima uses the Docker CLI.

### When the host filesystem reaches the engine through a virtual machine

On a host where the container engine runs inside a virtual machine and shares the
host filesystem into it, that share cannot carry the Codex sandbox's per-file
access rights: directory operations succeed while every attempt to open a file
for reading or writing is denied, so an Agent could not read or write the
workspace it was given. Shepherd does not fall back to `danger-full-access`.

**You do not need to configure anything for this.** The startup probes detect it
and the script switches to the container state volume by itself:

```
[local-poc] The Codex sandbox cannot govern a workspace on /Users/you/.volc-agent-launchpad.
[local-poc] Switching to the launchpad-state container state volume and retrying.
```

The volume is a native engine filesystem on every supported host. Set
`LOCAL_POC_STATE_MODE` explicitly to pin one layout and disable the fallback:
`host-bind` to fail loudly on a host that should work, or `container-volume` to
skip the host attempt entirely.

The fallback builds and starts the control plane inside the engine using
`docker-compose.state-volume.yml`, so it also needs:

- Access to the engine socket, which the control plane joins as a supplementary
  group while remaining non-root. See [`DEVIATIONS.md`](DEVIATIONS.md).

State lives in the `launchpad-state` volume rather than a host directory, so it
is not browsable from the host file manager; use `docker volume` and
`docker cp`. Switching modes does not migrate existing state: Plane worktrees
record absolute paths, so start the volume empty.

## Preflight and deterministic demo configuration

From the repository root:

```bash
node --version                 # 22 or newer
npm --version
docker info                    # or: podman info
npm ci
npm run check
npm run test:coverage
npm run test:terraform
npm run test:shepherd:live:preflight
```

`test:coverage` enforces at least 80% statements, branches, functions, and lines for
both the Server and browser-owned Web source, and fails if a production source file
is missing from the report. `test:terraform` uses installed Terraform when available
or the pinned `hashicorp/terraform:1.9.8` image against a disposable module copy.
`test:shepherd:live:preflight` builds the exact working tree, checks the non-root
controller, named state volume, engine socket, Runtime image and live-test discovery,
then cleans up without contacting Ark.

For the reliable no-model judge flow, keep secrets only in the ignored `.env` and
set:

```dotenv
HOST=127.0.0.1
SHEPHERD_EXECUTION_MODE=deterministic
SHEPHERD_DEMO_MODE=true
```

`APP_AUTH_TOKEN` is optional and empty by default; the server starts and serves
without one. Set it only if you want the browser unlock screen and a bearer
credential on every API route.

The launcher parses `.env` as data; never source, print, screenshot, or commit it.
The deterministic Mission does not call Ark. `ARK_API_KEY` and `ARK_MODEL` are used
only by the optional live Agent/Shepherd paths.

## Manual hackathon flow

Use a fresh disposable data root for rehearsal. Start with
`./scripts/start-local-poc.sh`, and wait for the loopback URL. The unlock screen
appears only if you set an `APP_AUTH_TOKEN`; enter that same token if so.

### 1. Positive Shepherd Mission

1. Open **Settings → General → Reset demo state**. The reset preserves ordinary
   Launchpad Agents.
2. Create `Frontend Auth Agent` with role/preset **Frontend**, then create
   `Backend Auth Agent` with role/preset **Backend**. Both must be ready.
3. Open `Frontend Auth Agent`, enable **Route through Shepherd**, and send this
   private prompt once:

   ```text
   Implement the frontend authentication client using an HttpOnly session cookie.
   ```

   Confirm Shepherd says the prompt was captured as
   `http-only-session-cookie` and is waiting for the Backend Agent.
4. Open `Backend Auth Agent`, enable **Route through Shepherd**, and send this
   private prompt once:

   ```text
   Implement the backend authentication service using a bearer JWT.
   ```

   The second compatible-role prompt atomically starts one Mission. Open
   **Shepherd**; the former deterministic Agent/transport selectors must not exist.
   The small Shepherd composer remains a managed-Agent fallback and is not used in
   this primary flow.
5. Wait for `completed`. Verify the visible sequence: the two exact private prompts
   become two durable Contracts →
   isolated Contract Planes → independent verification → integration → the
   `auth.transport` semantic collision → two resolution candidates → independently
   passing cookie candidate and rejected bearer candidate → final re-verification →
   protected promotion → Mission completion.
6. In the Contract stream, open **View evidence** for both source Contracts. Confirm
   the complete bounded definitions show the chosen Agent/ID, objective and exact
   transport, Mission/Plane, dependencies, semantic scope and claim, contextual
   inputs, readable/writable/forbidden authority, expected artifact, acceptance
   check/profile, manifest path, and timestamps alongside existing evidence.
7. Exercise **All**, **Contracts**, **Verification**, **Collisions**, and
   **Resolution** filters. No view may expose a secret, absolute host path, raw model
   prompt/output, session identifier, or unbounded verifier output.
8. Inspect the timeline, expand the collision, and open each Plane Tree detail.
   Confirm short Git evidence, changed files, state, and verification evidence are
   visible and that the drawer can be closed. Explain that the source Agent Planes
   do not compete: the cookie and bearer **Resolution Planes** compete after both
   verified source outputs are combined into the same integration commit.
9. Repeat visual checks at `1280x800` and `1440x900`. The document itself must not
   scroll horizontally or vertically; only designated panes may scroll. Compare the
   hierarchy and theme with [`UI.jpeg`](UI.jpeg).

### 2. Settings and human selection

1. Open **Settings → General → Reset demo state** and confirm the result.
2. Under **Execution**, change one timeout and **Maximum parallel Planes**, save,
   refresh, and confirm the values round-trip; then restore them.
3. Disable **Automatic resolution**, save, and repeat the two private Agent prompts
   from the positive flow with the preserved user-created Agents.
4. At `attention_required`, confirm the internal human-review ticket shows the full
   durable collision/Mission reference. Only an independently passing candidate may offer
   **Select verified future**. Select it and confirm completion through the same
   promotion gate. Restore **Automatic resolution** afterward.
5. Notification controls must remain visibly **Unavailable/Reserved**, disabled,
   unfocusable, and must not send a settings mutation.

Startup composition for automatic resolution and Plane capacity is still tracked as
`ST-01`; do not claim that open task from a persisted post-start settings round-trip.

### 3. Cancellation and Project Group

1. Reset, start a Mission, and immediately choose **Cancel Mission**. Confirm the
   durable `cancelled` state, retained evidence, released Agents, and no promotion.
   The deterministic flow can finish before the click; if so, record the timing as
   inconclusive rather than passing cancellation.
2. Open **Project Group**. Mention controls must preserve the existing draft,
   keyboard behavior, focus, quoting, Unicode, and the 2,000-character boundary.
3. Treat unmentioned Shepherd action/reply, targeted Contract creation, and
   manifest-derived Agent summaries as open until `GC-02/05`, `GC-03/04`, `GC-06`,
   and `E2E-03` are audited. Record behavior that differs from those task rows.

### 4. Optional bounded live Agent check

This consumes real `ARK_MODEL` capacity and is not needed for UI inspection:

1. Create one **Generalist** Agent named `Manual QA Agent`.
2. Send exactly one small task: `Create a dependency-free hello.js that prints
   "Hello, Shepherd", add a Node test, run it, and report the exact test result.`
3. Send one follow-up: `Reply with only the exact greeting produced by hello.js.`
4. Confirm queued → running → completed, session continuity, and the expected file.
5. Stop with `Ctrl+C`, restart with the same data root, and confirm the Agent,
   messages, Runs, and workspace persist.

The live Shepherd Mission/reviewer continuity acceptance remains `LIVE-01`; one
legacy Playground run does not close it.

### 5. Exact-tree live Shepherd gate

First run the zero-spend preflight above. With the ignored environment file
configured, the bounded external gate is:

```bash
npm run test:shepherd:live
```

This command is opt-in and must remain single-worker/no-retry. It sends
repository-derived Contracts, prompts, and scoped source content to the configured
Ark endpoint, so obtain authorization for that data transfer before running it in a
managed or reviewed environment. A passing preflight proves local construction and
isolation wiring only; it is not a substitute for the provider result. Record only
bounded outcomes and never attach raw prompts, model output, credentials, session
identifiers, or private paths.

## Recording a defect

Record the TASKS/PRD ID, exact commit, viewport/runtime, reproduction, expected and
actual behavior, frequency, safety/data impact, redacted evidence, and proposed
causal test. Never attach `.env`, credentials, raw prompts, absolute private paths,
or unbounded logs.

## Data and Runtime

Persistent state defaults to:

- macOS: `~/.volc-agent-launchpad/`
- Linux: `.local/`

Set `LOCAL_POC_DATA_ROOT` to use another directory, or
`LOCAL_POC_STATE_MODE=container-volume` to force all state into the
`launchpad-state` engine volume instead of on the host.

Each turn mounts only the selected Agent workspace and Codex session directory.
Default limits are 2 CPUs, 2 GiB memory, 256 processes, dropped capabilities,
and `no-new-privileges`.

Codex requests `workspace-write`. If the Linux kernel lacks Landlock, startup
warns and disables only the inner Codex sandbox. The outer container limits
remain active, but this fallback is not tenant isolation.

## Rootless Podman on Linux

This path requires no Docker or Compose. It supports Ubuntu 22.04/24.04, Debian
12, and veLinux 2.

Install Podman:

```bash
sudo apt-get update
sudo apt-get install -y podman uidmap slirp4netns fuse-overlayfs
```

Install Node.js 22 if needed. Inspect the downloaded setup script before
running it:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x \
  -o /tmp/nodesource_setup_22.sh
less /tmp/nodesource_setup_22.sh
sudo -E bash /tmp/nodesource_setup_22.sh
sudo apt-get install -y nodejs
```

Check subordinate UID/GID ranges:

```bash
grep "^$USER:" /etc/subuid
grep "^$USER:" /etc/subgid
```

If both are missing, assign unused ranges and log in again:

```bash
sudo usermod --add-subuids 100000-165535 "$USER"
sudo usermod --add-subgids 100000-165535 "$USER"
```

Verify rootless Podman:

```bash
podman info
podman run --rm docker.io/library/alpine:3.20 echo PODMAN_OK
```

`podman info` must report `rootless: true`. Set `CONTAINER_ENGINE=podman` in
`.env`, then start the POC:

```bash
./scripts/start-local-poc.sh
```

This flow was verified on veLinux 2 with rootless Podman 4.3.1. A `vfs` storage
driver works but needs more disk space; keep at least 5 GiB free for a cold
build.

## Common options

Set optional values such as
`CONTAINER_RUNTIME_APT_PACKAGES='ca-certificates git ripgrep python3 build-essential'`
in `.env`, then run `./scripts/start-local-poc.sh`.

For restricted networks, configure:

- `CONTAINER_RUNTIME_BASE_IMAGE`
- `CONTAINER_APT_MIRROR`
- `CONTAINER_APT_SECURITY_MIRROR`

Resource limits are controlled by `CONTAINER_CPU_LIMIT`,
`CONTAINER_MEMORY_LIMIT`, and `CONTAINER_PIDS_LIMIT`.

## Troubleshooting

Check Runtime readiness:

```bash
docker info                       # Or: podman info
docker image inspect volc-agent-runtime:local
curl http://localhost:3000/api/system
```

If a bind mount is rejected, set `LOCAL_POC_DATA_ROOT` to a directory shared
with the container VM. On Linux, the startup script automatically uses the host
UID/GID and validates workspace write access.

Remove only the default Runtime image:

```bash
podman image rm volc-agent-runtime:local
```
