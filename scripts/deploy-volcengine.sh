#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ -z "${VOLCENGINE_ACCESS_KEY:-}" || -z "${VOLCENGINE_SECRET_KEY:-}" ]]; then
  echo "Export VOLCENGINE_ACCESS_KEY and VOLCENGINE_SECRET_KEY first." >&2
  exit 1
fi

if [[ ! -f .env.production ]]; then
  echo "Missing .env.production. Copy .env.example and fill the Ark values." >&2
  exit 1
fi

if [[ ! -f deploy/volcengine/terraform.tfvars ]]; then
  echo "Missing deploy/volcengine/terraform.tfvars." >&2
  echo "Copy terraform.tfvars.example and fill the region-specific values." >&2
  exit 1
fi

ssh_private_key="${VOLCENGINE_SSH_PRIVATE_KEY:-}"
if [[ -z "$ssh_private_key" || ! -f "$ssh_private_key" || ! -r "$ssh_private_key" ]]; then
  echo "VOLCENGINE_SSH_PRIVATE_KEY must name a readable ECS private-key file." >&2
  exit 1
fi

ssh_user="${VOLCENGINE_SSH_USER:-ubuntu}"
if [[ ! "$ssh_user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  echo "VOLCENGINE_SSH_USER has an invalid SSH account name." >&2
  exit 1
fi

(
  set -a
  source .env.production
  set +a
  if [[ "${ARK_API_KEY:-}" == "" || "${ARK_MODEL:-}" == "" || "${APP_AUTH_TOKEN:-}" == "" ]]; then
    echo "ARK_API_KEY, ARK_MODEL and APP_AUTH_TOKEN are required in .env.production." >&2
    exit 1
  fi
)

terraform_without_runtime_secrets=(
  env
  -u ARK_API_KEY
  -u ARK_MODEL
  -u ARK_BASE_URL
  -u APP_AUTH_TOKEN
  -u TF_VAR_ark_api_key
  -u TF_VAR_ark_model
  -u TF_VAR_ark_base_url
  -u TF_VAR_app_auth_token
  terraform
)

"${terraform_without_runtime_secrets[@]}" -chdir=deploy/volcengine init
"${terraform_without_runtime_secrets[@]}" -chdir=deploy/volcengine apply

public_ip="$("${terraform_without_runtime_secrets[@]}" -chdir=deploy/volcengine output -raw public_ip)"
if [[ ! "$public_ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "Terraform did not return a valid ECS public IPv4 address." >&2
  exit 1
fi

ssh_target="${ssh_user}@${public_ip}"
ssh_options=(
  -i "$ssh_private_key"
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
)

attempt=1
until ssh "${ssh_options[@]}" "$ssh_target" "cloud-init status --wait"; do
  if (( attempt >= 60 )); then
    echo "ECS did not become SSH/cloud-init ready after 60 attempts." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 5
done

remote_env="/tmp/agent-launchpad.env.$$"
scp "${ssh_options[@]}" -- .env.production "${ssh_target}:${remote_env}"
remote_command="set -eu; trap 'rm -f ${remote_env}' EXIT; sudo install -o root -g root -m 0600 ${remote_env} /opt/agent-launchpad/app/.env.production; cd /opt/agent-launchpad/app; sudo ./scripts/deploy-existing-ecs.sh .env.production"
ssh "${ssh_options[@]}" "$ssh_target" "$remote_command"

echo
echo "Deployment completed after cloud-init and authenticated runtime installation."
"${terraform_without_runtime_secrets[@]}" -chdir=deploy/volcengine output app_url
