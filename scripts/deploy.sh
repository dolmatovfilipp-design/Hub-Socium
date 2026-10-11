#!/usr/bin/env bash
# Deploy Get Hub to the production host over SSH (frontend build + docker compose stack).
#
#   DEPLOY_HOST=31.31.192.151 ./scripts/deploy.sh
#
# Env:
#   DEPLOY_HOST   required  SSH host
#   DEPLOY_USER   root      SSH user (needs docker access)
#   DEPLOY_PORT   22
#   DEPLOY_PATH   /opt/hub  checkout dir on the host; must contain deploy/.env.prod
#   HUB_DOMAIN    gethub.online  used for the post-deploy health check
#   SKIP_BUILD=1  reuse an existing dist/ (CI builds it in a separate step)
#   DRY_RUN=1     show what rsync would change and the remote commands, change nothing
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/hub}"
HUB_DOMAIN="${HUB_DOMAIN:-gethub.online}"

cd "$(dirname "$0")/.."

target="${DEPLOY_USER}@${DEPLOY_HOST}"
ssh_cmd=(ssh -p "$DEPLOY_PORT" -o BatchMode=yes)
rsync_flags=(-az -e "ssh -p $DEPLOY_PORT -o BatchMode=yes")
[[ "${DRY_RUN:-}" == 1 ]] && rsync_flags+=(-n -i)

remote() {
  if [[ "${DRY_RUN:-}" == 1 ]]; then
    echo "[dry-run] ssh $target: $*"
  else
    "${ssh_cmd[@]}" "$target" "$@"
  fi
}

if [[ "${SKIP_BUILD:-}" != 1 ]]; then
  echo "==> Building frontend"
  npm ci --no-audit --no-fund
  VITE_USE_API=true npm run build
fi
[[ -f dist/index.html ]] || { echo "dist/index.html missing — build failed?" >&2; exit 1; }

echo "==> Checking ${target}:${DEPLOY_PATH}"
"${ssh_cmd[@]}" "$target" "test -f '$DEPLOY_PATH/deploy/.env.prod'" || {
  echo "Missing ${DEPLOY_PATH}/deploy/.env.prod on the host — copy deploy/env.prod.example there and fill in secrets." >&2
  exit 1
}

echo "==> Syncing sources"
# --delete never touches excluded paths on the host, so secrets and data survive.
rsync "${rsync_flags[@]}" --delete \
  --exclude .git/ --exclude node_modules/ --exclude dist/ \
  --exclude deploy/.env.prod --exclude backend/.env --exclude backend/.data/ --exclude backend/bin/ \
  --exclude backups/ --exclude .data/ --exclude tmp/ \
  ./ "${target}:${DEPLOY_PATH}/"

echo "==> Syncing frontend build"
# No --delete: tabs opened before the deploy still request the previous hashed chunks.
rsync "${rsync_flags[@]}" dist/ "${target}:${DEPLOY_PATH}/dist/"

echo "==> Restarting stack"
compose="docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod"
remote "cd '$DEPLOY_PATH' && $compose up -d --build --remove-orphans && $compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile && docker image prune -f >/dev/null"

[[ "${DRY_RUN:-}" == 1 ]] && { echo "==> Dry run finished"; exit 0; }

echo "==> Health check https://${HUB_DOMAIN}"
for _ in $(seq 1 20); do
  if curl -fsS -m 5 "https://${HUB_DOMAIN}/healthz" >/dev/null && curl -fsS -m 5 "https://${HUB_DOMAIN}/" | grep -q '<div id="root">'; then
    echo "==> Deployed: https://${HUB_DOMAIN}"
    exit 0
  fi
  sleep 3
done
echo "Health check failed after deploy — inspect: ssh $target 'cd $DEPLOY_PATH && $compose logs --tail=100'" >&2
exit 1
