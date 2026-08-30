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

## Preflight and deterministic demo configuration

From the repository root:

```bash
node --version                 # 22 or newer
npm --version
docker info                    # or: podman info
npm ci
npm run check
```

For the reliable no-model judge flow, keep secrets only in the ignored `.env` and
set:

```dotenv
HOST=127.0.0.1
APP_AUTH_TOKEN=replace-with-at-least-24-random-characters
SHEPHERD_EXECUTION_MODE=deterministic
SHEPHERD_DEMO_MODE=true
```

The launcher parses `.env` as data; never source, print, screenshot, or commit it.
The deterministic Mission does not call Ark. `ARK_API_KEY` and `ARK_MODEL` are used
only by the optional live Agent/Shepherd paths.

## Manual hackathon flow

Use a fresh disposable data root for rehearsal. Start with
`./scripts/start-local-poc.sh`, wait for the loopback URL, and enter your own
`APP_AUTH_TOKEN` if the browser displays the unlock screen.

### 1. Positive Shepherd Mission

1. Open **Settings → General → Reset demo state**. The reset preserves ordinary
   Launchpad Agents.
2. Create `Frontend Auth Agent` with role/preset **Frontend**, then create
   `Backend Auth Agent` with role/preset **Backend**. Both must be ready.
3. Open **Shepherd**. Select those two Agents, choose **HttpOnly session cookie**
   for the frontend and **Bearer JWT** for the backend, and confirm the composer
   warns that the two exclusive claims are incompatible.
4. Submit this intent once:

   ```text
   Implement the authentication demo and resolve any incompatible frontend and backend assumptions using independently verified evidence.
   ```

5. Wait for `completed`. Verify the visible sequence: Mission and two Contracts →
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
3. Disable **Automatic resolution**, save, and start the same Mission again with
   the two preserved user-created Agents.
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

## Recording a defect

Record the TASKS/PRD ID, exact commit, viewport/runtime, reproduction, expected and
actual behavior, frequency, safety/data impact, redacted evidence, and proposed
causal test. Never attach `.env`, credentials, raw prompts, absolute private paths,
or unbounded logs.

## Data and Runtime

Persistent state defaults to:

- macOS: `~/.volc-agent-launchpad/`
- Linux: `.local/`

Set `LOCAL_POC_DATA_ROOT` to use another directory.

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
