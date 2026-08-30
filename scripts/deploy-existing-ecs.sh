#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

env_file="${1:-.env.production}"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file. Copy .env.example and fill ARK_API_KEY / ARK_MODEL." >&2
  exit 1
fi

# This profile publishes on every interface: docker-compose.yml binds 0.0.0.0 and
# maps the port with no address prefix, and the API it exposes performs
# prompt-triggered command and file execution. The server treats the token as
# optional so a loopback demo needs no credential, which makes this deploy path the
# only place left to enforce it. Checked before any engine work so a missing
# credential cannot start a container first.
configured_auth_token="$(sed -n 's/^APP_AUTH_TOKEN=//p' "$env_file" | tail -n 1)"
# Strip CR and surrounding whitespace exactly as the server's schema does before it
# validates. Without this a CRLF file or a spaces-only value is non-empty to bash
# yet empty to the server, which would pass the gate and then disable the bearer
# boundary on a published interface.
configured_auth_token="${configured_auth_token%%[$'\r']*}"
configured_auth_token="${configured_auth_token#"${configured_auth_token%%[![:space:]]*}"}"
configured_auth_token="${configured_auth_token%"${configured_auth_token##*[![:space:]]}"}"
if [[ -z "$configured_auth_token" ]]; then
  echo "APP_AUTH_TOKEN must be set in $env_file." >&2
  echo "This profile publishes the Agent execution API on every interface." >&2
  exit 1
fi
# Same floor as apps/server/src/config.ts and deploy/volcengine/variables.tf, so a
# deploy cannot be green-lit here and then rejected at container start.
if (( ${#configured_auth_token} < 24 )) || [[ "$configured_auth_token" == [Rr][Ee][Pp][Ll][Aa][Cc][Ee]-* ]]; then
  echo "APP_AUTH_TOKEN in $env_file must be 24+ non-placeholder characters." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Engine 24 or newer is required. Follow the Linux install section in README.md." >&2
  exit 1
fi

docker_server_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
docker_server_major="${docker_server_version%%.*}"
if [[ ! "$docker_server_major" =~ ^[0-9]+$ ]] || (( docker_server_major < 24 )); then
  echo "Docker Engine 24 or newer is required; found '${docker_server_version:-unavailable}'." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "The Docker Compose plugin is required (the command must be 'docker compose')." >&2
  exit 1
fi

mkdir -p data workspaces codex-home
if [[ "$(stat -c '%u:%g' data)" != "1000:1000" ]] \
  || [[ "$(stat -c '%u:%g' workspaces)" != "1000:1000" ]] \
  || [[ "$(stat -c '%u:%g' codex-home)" != "1000:1000" ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R 1000:1000 data workspaces codex-home
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo chown -R 1000:1000 data workspaces codex-home
  else
    echo "data, workspaces and codex-home must be owned by UID:GID 1000:1000." >&2
    echo "Run: sudo chown -R 1000:1000 data workspaces codex-home" >&2
    exit 1
  fi
fi
export LAUNCHPAD_ENV_FILE="$env_file"

docker compose --env-file "$env_file" up -d --build

requested_sandbox_mode="$(sed -n 's/^CODEX_SANDBOX_MODE=//p' "$env_file" | tail -n 1)"
requested_sandbox_mode="${requested_sandbox_mode:-workspace-write}"
if [[ "$requested_sandbox_mode" == "workspace-write" ]] \
  && ! docker compose --env-file "$env_file" exec -T launchpad \
    codex sandbox linux --full-auto -- true >/dev/null 2>&1; then
  echo "Codex Landlock is unavailable on this Linux kernel/container runtime." >&2
  echo "Falling back to danger-full-access inside the outer Docker boundary." >&2
  echo "This POC does not provide per-Agent isolation; do not store unrelated secrets in it." >&2
  export CODEX_SANDBOX_MODE=danger-full-access
  docker compose --env-file "$env_file" up -d --no-build --force-recreate
fi
docker compose --env-file "$env_file" ps

public_port="$(sed -n 's/^PUBLIC_PORT=//p' "$env_file" | tail -n 1)"
echo "Agent Launchpad is starting on port ${public_port:-3000}."
