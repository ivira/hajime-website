#!/usr/bin/env bash
#
# Verify DNS-AID records + DNSSEC for hajimekyokushin.com.
# Queries a validating public resolver (Cloudflare 1.1.1.1) the same way the
# isitagentready.com checker does (DNS-over-HTTPS to a public resolver).
#
set -uo pipefail

ZONE="hajimekyokushin.com"
RESOLVER="@1.1.1.1"
fail=0

echo "== DNS-AID ServiceMode SVCB records under _agents.${ZONE} =="
for label in _index _a2a _mcp; do
  name="${label}._agents.${ZONE}"
  out=$(dig +short ${RESOLVER} SVCB "$name" 2>/dev/null)
  if [ -n "$out" ]; then
    echo "  [ok]   ${name}  ->  ${out}"
  else
    [ "$label" = "_index" ] && { echo "  [MISS] ${name}  (no SVCB record)"; fail=1; } \
                            || echo "  [--]   ${name}  (not published; optional)"
  fi
done

echo
echo "== DNSSEC (authenticated data) =="
# AD flag set by the validating resolver means the answer is DNSSEC-authenticated.
ad=$(dig ${RESOLVER} +dnssec SVCB "_index._agents.${ZONE}" 2>/dev/null | grep -q "flags:.* ad" && echo yes || echo no)
ds=$(dig +short DS "${ZONE}" 2>/dev/null)
echo "  DS at registry: ${ds:-<none — DNSSEC not activated at registrar>}"
echo "  AD flag (validated answer): ${ad}"
[ -z "$ds" ] && fail=1

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS: _index entrypoint resolves and zone is DNSSEC-signed."
else
  echo "INCOMPLETE: see [MISS]/<none> above. DNS changes can take up to the TTL (1h) to propagate."
fi
exit $fail
