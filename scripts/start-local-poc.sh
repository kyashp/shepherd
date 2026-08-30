#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$repo_dir/.env" && "${LOCAL_POC_DOTENV_LOADED:-}" != "1" ]]; then
  command -v node >/dev/null 2>&1 || {
    printf '[local-poc] Node.js 22+ is required to read .env and run the local control plane.\n' >&2
    exit 2
  }
  export LOCAL_POC_DOTENV_LOADED=1
  exec node --env-file="$repo_dir/.env" "$repo_dir/scripts/start-local-poc-launcher.mjs"
fi

cd "$repo_dir"

runtime_image="${CONTAINER_RUNTIME_IMAGE:-volc-agent-runtime:local}"
runtime_base_image="${CONTAINER_RUNTIME_BASE_IMAGE:-node:22-bookworm-slim}"
runtime_apt_mirror="${CONTAINER_APT_MIRROR:-}"
runtime_apt_security_mirror="${CONTAINER_APT_SECURITY_MIRROR:-}"
runtime_apt_packages="${CONTAINER_RUNTIME_APT_PACKAGES:-ca-certificates git ripgrep}"
codex_sandbox_mode="${CODEX_SANDBOX_MODE:-workspace-write}"
shepherd_execution_mode="${SHEPHERD_EXECUTION_MODE:-auto}"
# auto, the default, tries host state first and falls back to the container state
# volume when the probes show the host layout cannot support the hardened Runtime.
# host-bind keeps Agent state on the host and is correct wherever the engine sees
# a native filesystem. container-volume keeps every state root on a named volume
# and runs the control plane inside the runtime; it is required wherever the host
# filesystem reaches the runtime through a virtual machine, because such a share
# cannot carry the Codex sandbox's per-file access rights. Either explicit value
# disables the fallback, so a host that should work fails loudly instead.
state_mode="${LOCAL_POC_STATE_MODE:-auto}"
state_volume="${CONTAINER_STATE_VOLUME:-launchpad-state}"
container_state_root="/app/state"

log() {
  printf '[local-poc] %s\n' "$*" >&2
}

engine_works() {
  "$1" info >/dev/null 2>&1
}

detect_engine() {
  if [[ -n "${CONTAINER_ENGINE:-}" ]]; then
    command -v "$CONTAINER_ENGINE" >/dev/null 2>&1 || {
      log "CONTAINER_ENGINE=$CONTAINER_ENGINE was not found."
      return 1
    }
    engine_works "$CONTAINER_ENGINE" || {
      log "$CONTAINER_ENGINE is installed but its service is not running."
      return 1
    }
    printf '%s' "$CONTAINER_ENGINE"
    return
  fi

  if command -v docker >/dev/null 2>&1 && engine_works docker; then
    printf 'docker'
    return
  fi

  if command -v colima >/dev/null 2>&1 && command -v docker >/dev/null 2>&1; then
    log "Docker is not reachable; starting Colima."
    colima start >&2
    if engine_works docker; then
      printf 'docker'
      return
    fi
  fi

  if command -v podman >/dev/null 2>&1; then
    if ! engine_works podman && [[ "$(uname -s)" == "Darwin" ]]; then
      log "Podman is not reachable; starting its macOS machine."
      podman machine start >&2 || true
    fi
    if engine_works podman; then
      printf 'podman'
      return
    fi
  fi

  log "No running Docker, Colima, or Podman engine was found."
  log "Install one of them, start it, and rerun this command."
  return 1
}

if [[ -z "${ARK_API_KEY:-}" || -z "${ARK_MODEL:-}" ]]; then
  log "ARK_API_KEY and ARK_MODEL are required."
  log "Example: ARK_API_KEY=key ARK_MODEL=ep-id ./scripts/start-local-poc.sh"
  exit 2
fi

command -v node >/dev/null 2>&1 || {
  log "Node.js 22+ is required to run the local control plane."
  exit 2
}

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  log "Node.js 22+ is required; found $(node --version)."
  exit 2
fi

engine="$(detect_engine)"
log "Using $engine as the Agent Runtime engine."

if [[ ! -d node_modules ]]; then
  log "Installing application dependencies."
  npm ci
fi

case "$state_mode" in
  auto | host-bind | container-volume) ;;
  *)
    log "LOCAL_POC_STATE_MODE must be auto, host-bind, or container-volume."
    exit 2
    ;;
esac
requested_state_mode="$state_mode"

export RUNTIME_INSTANCE_ID="${RUNTIME_INSTANCE_ID:-local-$(id -u)-$(printf '%s' "$repo_dir" | cksum | awk '{print $1}')}"

# Agent state on the host. Correct wherever the engine sees a native filesystem,
# which is every Linux host running the engine directly.
apply_host_bind_state() {
  if [[ -n "${LOCAL_POC_DATA_ROOT:-}" ]]; then
    local_state_root="$LOCAL_POC_DATA_ROOT"
    export APP_DATA_DIR="$local_state_root/data"
    export AGENT_WORKSPACE_ROOT="$local_state_root/workspaces"
    export CODEX_HOME="$local_state_root/codex-home"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    local_state_root="${HOME}/.volc-agent-launchpad"
    export APP_DATA_DIR="${APP_DATA_DIR:-$local_state_root/data}"
    export AGENT_WORKSPACE_ROOT="${AGENT_WORKSPACE_ROOT:-$local_state_root/workspaces}"
    export CODEX_HOME="${CODEX_HOME:-$local_state_root/codex-home}"
  else
    local_state_root="$repo_dir/.local"
    export APP_DATA_DIR="${APP_DATA_DIR:-$local_state_root/data}"
    export AGENT_WORKSPACE_ROOT="${AGENT_WORKSPACE_ROOT:-$local_state_root/workspaces}"
    export CODEX_HOME="${CODEX_HOME:-$local_state_root/codex-home}"
  fi

  # `.env.example` uses container paths. A host PoC maps only those exact defaults
  # into its local state root; explicit custom host paths remain unchanged.
  [[ "$APP_DATA_DIR" == "/app/data" ]] && export APP_DATA_DIR="$local_state_root/data"
  [[ "$AGENT_WORKSPACE_ROOT" == "/app/workspaces" ]] \
    && export AGENT_WORKSPACE_ROOT="$local_state_root/workspaces"
  [[ "$CODEX_HOME" == "/app/codex-home" ]] && export CODEX_HOME="$local_state_root/codex-home"
  if [[ -z "${SHEPHERD_ROOT:-}" || "$SHEPHERD_ROOT" == "/app/data/shepherd" ]]; then
    export SHEPHERD_ROOT="$APP_DATA_DIR/shepherd"
  fi
  if [[ -z "${SHEPHERD_CODEX_HOME_ROOT:-}" \
    || "$SHEPHERD_CODEX_HOME_ROOT" == "/app/data/shepherd-codex-homes" ]]; then
    export SHEPHERD_CODEX_HOME_ROOT="$APP_DATA_DIR/shepherd-codex-homes"
  fi

  mkdir -p "$APP_DATA_DIR" "$AGENT_WORKSPACE_ROOT" "$CODEX_HOME"
  export CONTAINER_USER="${CONTAINER_USER:-$(id -u):$(id -g)}"
  state_mode="host-bind"
}

# Agent state on a named volume, which is a native engine filesystem on every
# supported host. Required wherever the host filesystem reaches the engine
# through a virtual machine, because such a share cannot carry the Codex
# sandbox's per-file access rights.
apply_container_volume_state() {
  if [[ ! "$state_volume" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$ ]]; then
    log "CONTAINER_STATE_VOLUME must be a valid container volume name."
    exit 2
  fi
  # APP_AUTH_TOKEN is optional. Handed to the control plane explicitly so the
  # value seen here is the value the server receives, rather than a different one
  # re-read from the env file. Empty means no bearer check, which is the default.
  export APP_AUTH_TOKEN="${APP_AUTH_TOKEN:-}"
  if [[ -z "$APP_AUTH_TOKEN" ]]; then
    log "No APP_AUTH_TOKEN is set, so the control plane will not require one."
  fi

  log "Preparing the $state_volume state volume for the Agent Runtime."
  "$engine" volume create "$state_volume" >/dev/null
  # The control-plane image runs as uid 1000, and the disposable Runtime runs as
  # the same identity so the control plane can still reconcile what it wrote.
  "$engine" run --rm --user 0:0 \
    --mount "type=volume,src=$state_volume,dst=/state" \
    "$runtime_image" sh -c \
      'mkdir -p /state/data/shepherd /state/data/shepherd-codex-homes \
         /state/workspaces /state/codex-home \
       && chown -R 1000:1000 /state && chmod 700 /state/workspaces /state/codex-home'
  export CONTAINER_STATE_ROOT="$container_state_root"
  export CONTAINER_STATE_VOLUME="$state_volume"
  export APP_DATA_DIR="$container_state_root/data"
  export AGENT_WORKSPACE_ROOT="$container_state_root/workspaces"
  export CODEX_HOME="$container_state_root/codex-home"
  export SHEPHERD_ROOT="$container_state_root/data/shepherd"
  export SHEPHERD_CODEX_HOME_ROOT="$container_state_root/data/shepherd-codex-homes"
  export CONTAINER_USER="1000:1000"
  local_state_root="$state_volume (container volume)"
  state_mode="container-volume"
}

set_mount_specs() {
  preflight_user_args=(--user "$CONTAINER_USER")
  if [[ "$(basename "$engine")" == "podman" ]]; then
    preflight_user_args+=(--userns keep-id)
  fi
  if [[ "$state_mode" == "container-volume" ]]; then
    # volume-nocopy keeps the seeded ownership: without it the engine copies the
    # image's own directory metadata over an empty subpath and the non-root
    # Runtime silently loses write access before the sandbox is ever applied.
    workspace_mount="type=volume,source=$state_volume,target=/workspace,volume-subpath=workspaces,volume-nocopy=true"
    codex_home_mount="type=volume,source=$state_volume,target=/codex-home,volume-subpath=codex-home,volume-nocopy=true"
  else
    workspace_mount="type=bind,src=$AGENT_WORKSPACE_ROOT,dst=/workspace"
    codex_home_mount="type=bind,src=$CODEX_HOME,dst=/codex-home"
  fi
}

# Bytes are written and read back, not merely created. `touch` is not a write
# test: where the sandbox denies opening a file it still permits creating one,
# and coreutils then reports success after falling back to a timestamp update.
probe_state_write() {
  "$engine" run --rm \
    "${preflight_user_args[@]}" \
    --mount "$workspace_mount" \
    --mount "$codex_home_mount" \
    "$runtime_image" sh -lc \
      'set -e
       for dir in /workspace /codex-home; do
         printf launchpad > "$dir/.launchpad-write-test"
         test "$(cat "$dir/.launchpad-write-test")" = launchpad
         : > "$dir/.launchpad-write-test"
         rm "$dir/.launchpad-write-test"
       done'
}

probe_landlock() {
  "$engine" run --rm \
    "${preflight_user_args[@]}" \
    --read-only \
    --network none \
    --security-opt no-new-privileges \
    --cap-drop ALL \
    --cpus 1 \
    --memory 512m \
    --pids-limit 64 \
    --mount "$workspace_mount" \
    --mount "$codex_home_mount" \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=64m \
    --workdir /workspace \
    --env HOME=/tmp \
    --env TMPDIR=/tmp \
    --env CODEX_HOME=/codex-home \
    "$runtime_image" \
    codex sandbox linux --full-auto -- sh -c \
      'set -e
       printf launchpad > .launchpad-landlock-write-test
       test "$(cat .launchpad-landlock-write-test)" = launchpad
       rm .launchpad-landlock-write-test
       if printf escape > /etc/.launchpad-landlock-escape-test 2>/dev/null; then
         rm -f /etc/.launchpad-landlock-escape-test
         exit 1
       fi' \
      >/dev/null 2>&1
}

# 0 usable, 1 the engine cannot mount and write the state, 2 the Codex sandbox
# cannot govern the workspace.
run_state_probes() {
  set_mount_specs
  log "Checking that the Runtime can mount and write the configured state directories."
  probe_state_write || return 1
  [[ "$codex_sandbox_mode" == "workspace-write" ]] || return 0
  log "Checking that the Codex sandbox can govern the configured workspace."
  probe_landlock || return 2
  return 0
}

if [[ "$state_mode" == "container-volume" ]]; then
  apply_container_volume_state
else
  apply_host_bind_state
fi
log "Persistent state: $local_state_root"

log "Building $runtime_image from Dockerfile.runtime (base: $runtime_base_image)."
"$engine" build \
  --file Dockerfile.runtime \
  --build-arg "NODE_IMAGE=$runtime_base_image" \
  --build-arg "DEBIAN_MIRROR=$runtime_apt_mirror" \
  --build-arg "DEBIAN_SECURITY_MIRROR=$runtime_apt_security_mirror" \
  --build-arg "RUNTIME_APT_PACKAGES=$runtime_apt_packages" \
  --tag "$runtime_image" \
  .

if [[ "$shepherd_execution_mode" != "deterministic" && "$codex_sandbox_mode" != "workspace-write" ]]; then
  log "Live/auto Shepherd execution requires CODEX_SANDBOX_MODE=workspace-write."
  exit 2
fi

probe_status=0
run_state_probes || probe_status=$?

# The probe, not the operating system, decides which layout works here: what
# matters is whether the engine sees a native filesystem, and a host can fail
# that test on any platform.
if (( probe_status != 0 )) && [[ "$requested_state_mode" == "auto" ]]; then
  if (( probe_status == 1 )); then
    log "The engine cannot mount and write $local_state_root."
  else
    log "The Codex sandbox cannot govern a workspace on $local_state_root."
  fi
  log "Switching to the $state_volume container state volume and retrying."
  apply_container_volume_state
  log "Persistent state: $local_state_root"
  probe_status=0
  run_state_probes || probe_status=$?
fi

if (( probe_status == 1 )); then
  log "The container engine cannot mount and write $local_state_root."
  if [[ "$state_mode" == "container-volume" ]]; then
    log "Remove the $state_volume volume and rerun to reseed it."
  else
    log "Set LOCAL_POC_DATA_ROOT to a directory shared with Docker/Colima/Podman,"
    log "or rerun with LOCAL_POC_STATE_MODE=container-volume."
  fi
  exit 2
fi

if (( probe_status == 2 )); then
  log "Codex workspace-write Landlock cannot govern the configured workspace in the"
  log "hardened non-root Runtime. Shepherd will not fall back to danger-full-access."
  if [[ "$state_mode" == "host-bind" ]]; then
    log "If the host filesystem reaches the engine through a virtual machine, rerun"
    log "with LOCAL_POC_STATE_MODE=auto or container-volume."
  fi
  exit 2
fi
export NODE_ENV=production
if [[ -z "${HOST:-}" || "$HOST" == "0.0.0.0" || "$HOST" == "::" ]]; then
  export HOST=127.0.0.1
fi
export PORT="${PORT:-3000}"
export CODEX_SANDBOX_MODE="$codex_sandbox_mode"
export RUNTIME_PROVIDER=container
export CONTAINER_ENGINE="$engine"
export CONTAINER_RUNTIME_IMAGE="$runtime_image"

cleanup() {
  local container_ids
  if [[ "$state_mode" == "container-volume" ]]; then
    "$engine" compose --file docker-compose.state-volume.yml down \
      --remove-orphans >/dev/null 2>&1 || true
  fi
  container_ids="$($engine ps --all --quiet \
    --filter label=io.codejam.launchpad=agent-runtime \
    --filter "label=io.codejam.instance-id=$RUNTIME_INSTANCE_ID" 2>/dev/null || true)"
  if [[ -n "$container_ids" ]]; then
    log "Removing remaining Agent Runtime containers for $RUNTIME_INSTANCE_ID."
    while IFS= read -r container_id; do
      [[ -n "$container_id" ]] && "$engine" rm --force "$container_id" >/dev/null 2>&1 || true
    done <<<"$container_ids"
  fi
}
trap cleanup EXIT INT TERM

# Recover cleanly after a terminal or server crash from a previous local run.
cleanup

if [[ "$state_mode" == "container-volume" ]]; then
  # The engine socket is root-owned and group-writable. The control plane stays
  # non-root and joins only that group; it never runs as root.
  socket_path="${CONTAINER_ENGINE_SOCKET:-/var/run/docker.sock}"
  socket_gid="$("$engine" run --rm --user 0:0 \
    --mount "type=bind,src=$socket_path,dst=/engine.sock" \
    "$runtime_image" stat -c %g /engine.sock 2>/dev/null | tr -d '\r')"
  if [[ ! "$socket_gid" =~ ^[0-9]+$ ]]; then
    log "Could not read the group of $socket_path."
    log "Set CONTAINER_ENGINE_SOCKET to the engine socket this user can reach."
    exit 2
  fi
  export CONTAINER_ENGINE_SOCKET="$socket_path"
  export CONTAINER_ENGINE_SOCKET_GID="$socket_gid"
  export PUBLIC_PORT="$PORT"
  log "Building and starting the containerized control plane."
  log "Open http://localhost:$PORT"
  "$engine" compose --file docker-compose.state-volume.yml up --build
else
  log "Building the local Web and API."
  npm run build

  log "Open http://localhost:$PORT"
  npm start
fi
