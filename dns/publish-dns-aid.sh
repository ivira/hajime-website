#!/usr/bin/env bash
#
# Publish DNS-AID (DNS for AI Discovery) ServiceMode SVCB records to the
# hajimekyokushin.com Cloudflare zone. Idempotent: creates records that are
# missing, updates them if the value drifted, leaves everything else alone.
#
# Requires a Cloudflare API token with **Zone:DNS:Edit** on this zone. The
# wrangler OAuth token used for `wrangler deploy` is workers-scoped only and
# will NOT work here.
#
#   export CLOUDFLARE_API_TOKEN=xxxxxxxx
#   ./dns/publish-dns-aid.sh          # apply
#   DRY_RUN=1 ./dns/publish-dns-aid.sh  # show what would change
#
# Create the token at:
#   https://dash.cloudflare.com/profile/api-tokens
#   -> Create Token -> "Edit zone DNS" template -> Zone: hajimekyokushin.com
#
set -euo pipefail

ZONE="hajimekyokushin.com"
API="https://api.cloudflare.com/client/v4"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (Zone:DNS:Edit scope)}"
DRY_RUN="${DRY_RUN:-}"

auth=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")

# Each record: name | priority | target | svcparams-value
# Add _a2a / _mcp lines here only when a real endpoint for that protocol exists.
RECORDS=(
  "_index._agents.${ZONE}|1|${ZONE}|alpn=\"h2,h3\" port=443"
)

api() { curl -fsS "${auth[@]}" "$@"; }

echo "Resolving zone id for ${ZONE}..."
zone_id=$(api "${API}/zones?name=${ZONE}" | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r[0]["id"] if r else "")')
[ -n "$zone_id" ] || { echo "Zone ${ZONE} not found for this token"; exit 1; }
echo "Zone id: ${zone_id}"

for rec in "${RECORDS[@]}"; do
  IFS='|' read -r name priority target value <<<"$rec"
  desired=$(python3 -c 'import json,sys; n,p,t,v=sys.argv[1:5]; print(json.dumps({"type":"SVCB","name":n,"ttl":3600,"data":{"priority":int(p),"target":t,"value":v}}))' "$name" "$priority" "$target" "$value")

  existing=$(api "${API}/zones/${zone_id}/dns_records?type=SVCB&name=${name}")
  rec_id=$(echo "$existing" | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r[0]["id"] if r else "")')

  if [ -n "$DRY_RUN" ]; then
    echo "[dry-run] ${name} SVCB ${priority} ${target} ${value}  (${rec_id:+update ${rec_id}}${rec_id:-create})"
    continue
  fi

  if [ -n "$rec_id" ]; then
    echo "Updating ${name} (${rec_id})..."
    api -X PUT "${API}/zones/${zone_id}/dns_records/${rec_id}" --data "$desired" >/dev/null
  else
    echo "Creating ${name}..."
    api -X POST "${API}/zones/${zone_id}/dns_records" --data "$desired" >/dev/null
  fi
  echo "  ok: ${name} SVCB ${priority} ${target} ${value}"
done

echo "Done. Verify with: ./dns/verify-dns-aid.sh"
