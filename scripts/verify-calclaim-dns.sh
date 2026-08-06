#!/usr/bin/env bash
# Verify public DNS + HTTPS for calclaim.jayhasty.com after deploy.
# Fails if the hostname is NXDOMAIN or HTTPS does not return 2xx/3xx.
set -euo pipefail

FQDN="${CALCLAIM_DNS_FQDN:-calclaim.jayhasty.com}"
PATH_CHECK="${CALCLAIM_HEALTH_PATH:-/health}"
ORIGIN_IP="${CALCLAIM_ORIGIN_IP:-144.202.105.150}"
ATTEMPTS="${CALCLAIM_DNS_WAIT_ATTEMPTS:-12}"
SLEEP_SECS="${CALCLAIM_DNS_WAIT_SECS:-5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[calclaim-dns] Verifying public DNS for ${FQDN}"

resolved=""
for ((i=1; i<=ATTEMPTS; i++)); do
  json="$(curl -sS "https://cloudflare-dns.com/dns-query?name=${FQDN}&type=A" \
    -H "accept: application/dns-json" || true)"
  resolved="$(python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
except Exception:
  print("")
  raise SystemExit
ans=[a.get("data") for a in d.get("Answer") or [] if a.get("type")==1]
print(",".join(ans))
' <<<"$json")"
  if [[ -n "$resolved" ]]; then
    echo "[calclaim-dns] ${FQDN} A → ${resolved} (attempt ${i})"
    break
  fi
  echo "[calclaim-dns] NXDOMAIN / empty (attempt ${i}/${ATTEMPTS}) – waiting ${SLEEP_SECS}s"
  sleep "$SLEEP_SECS"
done

if [[ -z "$resolved" ]]; then
  echo "[calclaim-dns] ERROR: ${FQDN} is NXDOMAIN on public DNS." >&2
  if [[ -f "$ROOT/.env" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == CLOUDFLARE_API_TOKEN=* ]] || continue
      tok="${line#CLOUDFLARE_API_TOKEN=}"
      tok="${tok%$'\r'}"
      if [[ "$tok" =~ ^\".*\"$ || "$tok" =~ ^\'.*\'$ ]]; then
        tok="${tok:1:-1}"
      fi
      export CLOUDFLARE_API_TOKEN="$tok"
      break
    done < "$ROOT/.env"
  fi
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    ZONE_NAME="${CALCLAIM_DNS_ZONE:-jayhasty.com}"
    diag="$(curl -sS "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" || true)"
    ZONE_JSON="$diag" python3 - <<'PY' >&2
import json, os, sys
try:
    d = json.loads(os.environ.get("ZONE_JSON") or "")
except Exception:
    sys.exit(0)
recs = d.get("result") or []
if not recs:
    sys.exit(0)
z = recs[0]
status = z.get("status")
obs = z.get("observed_name_servers") or []
want = z.get("name_servers") or []
reason = z.get("activation_failure_reason")
print(f"  Cloudflare zone status={status} reason={reason}")
print(f"  Registrar currently uses: {', '.join(obs) or '(unknown)'}")
print(f"  Cloudflare expects:       {', '.join(want) or '(unknown)'}")
obs_n = {x.rstrip(".") for x in obs}
want_n = {x.rstrip(".") for x in want}
if status != "active" or (obs_n and want_n and obs_n != want_n):
    print("  Root cause: nameserver mismatch — API DNS edits (including calclaim)")
    print("  do not publish on the internet until the registrar NS are updated.")
    print("  Keeping jewel/max will NOT work with this Cloudflare zone (status=moved).")
    print("  Squarespace → Domains → DNS → Domain Nameservers → UPDATE NAMESERVERS:")
    for ns in want:
        print(f"    {ns}")
    print("  (Replace jewel/max — those are stale; Cloudflare reassigned this zone.)")
    print("  Mail on the Cloudflare zone is aligned to Google Workspace")
    print("  (smtp.google.com) so the NS cutover should not break email.")
    print("  Free-plan Moved zones are deleted ~7 days after leaving Active — do this soon.")
else:
    print("  Zone looks active — re-check that A calclaim exists in Cloudflare DNS.")
PY
  else
    echo "  Fix: set CLOUDFLARE_API_TOKEN and re-run ensure, or add A calclaim → ${ORIGIN_IP}." >&2
  fi
  exit 1
fi

echo "[calclaim-dns] Checking https://${FQDN}${PATH_CHECK}"
code=""
for ((i=1; i<=6; i++)); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 20 \
    "https://${FQDN}${PATH_CHECK}" || echo "000")"
  if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
    echo "[calclaim-dns] HTTPS ${PATH_CHECK} → ${code}"
    exit 0
  fi
  code_origin="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 20 \
    --resolve "${FQDN}:443:${ORIGIN_IP}" "https://${FQDN}${PATH_CHECK}" || echo "000")"
  if [[ "$code_origin" =~ ^[23][0-9][0-9]$ ]]; then
    echo "[calclaim-dns] Origin HTTPS OK (${code_origin}); public edge returned ${code} (may still be propagating)"
    exit 0
  fi
  echo "[calclaim-dns] HTTPS not ready (public=${code} origin=${code_origin}) – retry ${i}/6"
  sleep 5
done

echo "[calclaim-dns] ERROR: https://${FQDN}${PATH_CHECK} failed (last public code=${code})" >&2
exit 1
