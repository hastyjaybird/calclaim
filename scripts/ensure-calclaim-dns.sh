#!/usr/bin/env bash
# Upsert the Cloudflare DNS A record for calclaim.jayhasty.com.
#
# Why this exists: the hostname repeatedly goes NXDOMAIN after manual
# grey/orange proxy fights in the Cloudflare UI. Deploy itself never
# touched DNS — the record just wasn't in the deploy path. This script
# makes every deploy re-assert the record.
#
# Requires (in env or repo .env):
#   CLOUDFLARE_API_TOKEN  – Zone.DNS Edit on jayhasty.com
# Optional:
#   CLOUDFLARE_ZONE_ID    – skip zone lookup
#   CALCLAIM_DNS_NAME     – default calclaim
#   CALCLAIM_DNS_ZONE     – default jayhasty.com
#   CALCLAIM_ORIGIN_IP    – default 144.202.105.150
#   CALCLAIM_CF_PROXIED   – default 0 (DNS only / grey). Matches apex/dashbird;
#                           avoids CF 530 while the zone is settling after NS changes.
#
# Exit 0 when the record exists with the expected IP (and proxy mode).
# Exit 1 on API / config failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load local .env without clobbering already-exported vars.
if [[ -f "$ROOT/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    case "$key" in
      CLOUDFLARE_API_TOKEN|CLOUDFLARE_ZONE_ID|CALCLAIM_DNS_NAME|CALCLAIM_DNS_ZONE|CALCLAIM_ORIGIN_IP|CALCLAIM_CF_PROXIED)
        if [[ -z "${!key:-}" ]]; then
          val="${line#*=}"
          val="${val%$'\r'}"
          # strip optional surrounding quotes
          if [[ "$val" =~ ^\".*\"$ || "$val" =~ ^\'.*\'$ ]]; then
            val="${val:1:-1}"
          fi
          export "$key=$val"
        fi
        ;;
    esac
  done < "$ROOT/.env"
fi

TOKEN="${CLOUDFLARE_API_TOKEN:-}"
ZONE_NAME="${CALCLAIM_DNS_ZONE:-jayhasty.com}"
REC_NAME="${CALCLAIM_DNS_NAME:-calclaim}"
FQDN="${REC_NAME}.${ZONE_NAME}"
ORIGIN_IP="${CALCLAIM_ORIGIN_IP:-144.202.105.150}"
PROXIED_RAW="${CALCLAIM_CF_PROXIED:-0}"
case "$PROXIED_RAW" in
  1|true|TRUE|yes|YES|on|ON) PROXIED=true ;;
  *) PROXIED=false ;;
esac

if [[ -z "$TOKEN" ]]; then
  echo "[calclaim-dns] ERROR: CLOUDFLARE_API_TOKEN not set." >&2
  echo "  Create a token at https://dash.cloudflare.com/profile/api-tokens" >&2
  echo "  Permission: Zone → DNS → Edit (include zone ${ZONE_NAME})." >&2
  echo "  Add to ${ROOT}/.env:" >&2
  echo "    CLOUDFLARE_API_TOKEN=..." >&2
  exit 1
fi

cf() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "$method" "https://api.cloudflare.com/client/v4${path}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

echo "[calclaim-dns] Ensuring ${FQDN} → ${ORIGIN_IP} (proxied=${PROXIED})"

ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
if [[ -z "$ZONE_ID" ]]; then
  # Prefer active, but accept any match (zones can be "moved" / pending while
  # registrar NS still point at Cloudflare — filtering status=active caused
  # empty lookups and left calclaim NXDOMAIN).
  zone_json="$(cf GET "/zones?name=${ZONE_NAME}")"
  ZONE_ID="$(ZONE_JSON="$zone_json" python3 - <<'PY'
import json, os, sys
d = json.loads(os.environ["ZONE_JSON"])
recs = d.get("result") or []
if not d.get("success") or not recs:
    sys.exit(0)
active = [z for z in recs if z.get("status") == "active"]
z = (active or recs)[0]
print(
    f"[calclaim-dns] zone {z.get('name')} id={z['id']} "
    f"status={z.get('status')} observed_ns={z.get('observed_name_servers')} "
    f"assigned_ns={z.get('name_servers')}",
    file=sys.stderr,
)
if z.get("status") != "active":
    print(
        "[calclaim-dns] WARNING: zone is not active "
        f"(status={z.get('status')}, reason={z.get('activation_failure_reason')}). "
        "DNS edits may not publish until registrar NS match Cloudflare.",
        file=sys.stderr,
    )
print(z["id"])
PY
)"
  if [[ -z "$ZONE_ID" ]]; then
    echo "[calclaim-dns] ERROR: could not resolve zone id for ${ZONE_NAME}" >&2
    echo "$zone_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("errors") or d)' >&2
    exit 1
  fi
fi

list_json="$(cf GET "/zones/${ZONE_ID}/dns_records?type=A&name=${FQDN}")"
read -r REC_ID CUR_IP CUR_PROX <<<"$(python3 -c '
import json,sys
d=json.load(sys.stdin)
if not d.get("success"):
  print("ERR","","")
  raise SystemExit
recs=d.get("result") or []
if not recs:
  print("NONE","","")
else:
  r=recs[0]
  print(r["id"], r.get("content",""), "1" if r.get("proxied") else "0")
' <<<"$list_json")"

if [[ "$REC_ID" == "ERR" ]]; then
  echo "[calclaim-dns] ERROR listing DNS records:" >&2
  echo "$list_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("errors") or d)' >&2
  exit 1
fi

WANT_PROX="$([ "$PROXIED" = true ] && echo 1 || echo 0)"
export REC_NAME ORIGIN_IP PROXIED
BODY="$(python3 -c 'import json,os; print(json.dumps({
  "type":"A",
  "name":os.environ["REC_NAME"],
  "content":os.environ["ORIGIN_IP"],
  "ttl":1,
  "proxied": os.environ["PROXIED"]=="true",
  "comment":"Managed by calclaim scripts/ensure-calclaim-dns.sh",
}))')"

if [[ "$REC_ID" == "NONE" ]]; then
  echo "[calclaim-dns] Creating A record"
  resp="$(cf POST "/zones/${ZONE_ID}/dns_records" --data "$BODY")"
else
  if [[ "$CUR_IP" == "$ORIGIN_IP" && "$CUR_PROX" == "$WANT_PROX" ]]; then
    echo "[calclaim-dns] Already correct (id=${REC_ID})"
    exit 0
  fi
  echo "[calclaim-dns] Updating A record id=${REC_ID} (was ${CUR_IP} proxied=${CUR_PROX})"
  resp="$(cf PUT "/zones/${ZONE_ID}/dns_records/${REC_ID}" --data "$BODY")"
fi

ok="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if d.get("success") else "0")' <<<"$resp")"
if [[ "$ok" != "1" ]]; then
  echo "[calclaim-dns] ERROR upsert failed:" >&2
  echo "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("errors") or d)' >&2
  exit 1
fi

echo "[calclaim-dns] Upserted ${FQDN} → ${ORIGIN_IP}"
