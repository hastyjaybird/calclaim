#!/usr/bin/env bash
# Push CalClaim to Vultr and (re)start the container on dashbird's Docker network.
# Usage:
#   CLOUD_HOST=root@144.202.105.150 ./scripts/sync-to-cloud.sh
# Optional:
#   CLOUD_DIR=/opt/calclaim
#   SYNC_ENV=1   # push local .env (creates server .env from local if missing otherwise)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${CLOUD_HOST:?Set CLOUD_HOST=root@your-server-ip}"
REMOTE_DIR="${CLOUD_DIR:-/opt/calclaim}"
SYNC_ENV="${SYNC_ENV:-0}"

RSYNC=(rsync -avz --delete
  --exclude node_modules
  --exclude .git
  --exclude .cursor
  --exclude .tools
  --exclude .claude
  --exclude data
  --exclude .env
  --exclude '*.sqlite'
  --exclude '*.sqlite-*'
)

echo "[calclaim] Syncing to ${HOST}:${REMOTE_DIR}/"
ssh "$HOST" "mkdir -p '${REMOTE_DIR}/data'"
"${RSYNC[@]}" "$ROOT/" "${HOST}:${REMOTE_DIR}/"

if [[ "$SYNC_ENV" == "1" ]]; then
  echo "[calclaim] Syncing .env from local"
  if [[ -f "$ROOT/.env" ]]; then
    rsync -avz "$ROOT/.env" "${HOST}:${REMOTE_DIR}/.env"
  else
    echo "  ERROR: no local .env" >&2
    exit 1
  fi
elif ! ssh "$HOST" "test -f '${REMOTE_DIR}/.env'"; then
  echo "[calclaim] No remote .env – seeding from local (first deploy)"
  if [[ ! -f "$ROOT/.env" ]]; then
    echo "  ERROR: need local .env for first deploy" >&2
    exit 1
  fi
  rsync -avz "$ROOT/.env" "${HOST}:${REMOTE_DIR}/.env"
fi

echo "[calclaim] Ensuring production public URL + webhook mode on server .env"
ssh "$HOST" "python3 - <<'PY'
from pathlib import Path
p = Path('${REMOTE_DIR}/.env')
text = p.read_text()
lines = text.splitlines()
want = {
    'PUBLIC_BASE_URL': 'https://calclaim.jayhasty.com',
    # long_polling until Cloudflare A record exists; then switch to webhook
    'BOT_MODE': 'long_polling',
    'WEBHOOK_URL': 'https://calclaim.jayhasty.com/telegram/webhook',
    'PORT': '3000',
    'DATABASE_PATH': './data/calclaim.sqlite',
    'TZ': 'America/Los_Angeles',
}
keys = set()
out = []
for line in lines:
    if not line or line.lstrip().startswith('#') or '=' not in line:
        out.append(line)
        continue
    k, _, v = line.partition('=')
    k = k.strip()
    if k in want:
        out.append(f'{k}={want[k]}')
        keys.add(k)
    else:
        out.append(line)
for k, v in want.items():
    if k not in keys:
        out.append(f'{k}={v}')
p.write_text('\\n'.join(out) + '\\n')
print('updated', p)
PY"

echo "[calclaim] Build + up"
ssh "$HOST" "cd '${REMOTE_DIR}' && docker compose -f docker-compose.cloud.yml up -d --build"

echo "[calclaim] Health (container)"
sleep 3
ssh "$HOST" "docker inspect --format='{{.State.Health.Status}}' calclaim 2>/dev/null || docker ps --filter name=calclaim --format '{{.Status}}'"
ssh "$HOST" "docker logs calclaim --tail 30 2>&1" || true

echo "[calclaim] Done. After DNS + Caddy: https://calclaim.jayhasty.com/impact"
