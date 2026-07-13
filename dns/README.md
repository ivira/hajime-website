# DNS for AI Discovery (DNS-AID)

Publishes well-known agent-discovery entrypoint records for
`hajimekyokushin.com` so AI agents can discover this site's public agent
surface via DNS.

- Spec: [draft-mozleywilliams-dnsop-dnsaid](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/)
- Transport: SVCB ServiceMode records, [RFC 9460](https://www.rfc-editor.org/rfc/rfc9460)

> DNS records are **not** part of the deployed site — they live in the
> authoritative zone (Cloudflare, nameservers `aragorn`/`sasha.ns.cloudflare.com`).
> This folder documents the intended zone state and scripts the change.

## What gets published

```
_index._agents.hajimekyokushin.com. 3600 IN SVCB 1 hajimekyokushin.com. alpn="h2,h3" port=443
```

`_index._agents` is the **organizational index** entrypoint. Its TargetName
(`hajimekyokushin.com`, no underscores — x.509 is used with the index) points
validating agents at the website over HTTPS (h2/h3, port 443), which already
serves agent-readable Markdown via content negotiation (`../src/worker.js`).

This site does **not** run an A2A or MCP agent server, so `_a2a._agents` /
`_mcp._agents` records are intentionally omitted — publishing them would
advertise endpoints that don't exist. Add them (see the commented lines in
`records.dnsaid.zone` / `publish-dns-aid.sh`) only when a real endpoint exists.

## Apply

### Option A — dashboard (no extra token needed)
1. Cloudflare dashboard → `hajimekyokushin.com` → **DNS → Records → Add record**.
2. Type **SVCB**, Name `_index._agents`, then set:
   - Priority `1`  ·  Target `hajimekyokushin.com`  ·  Value `alpn="h2,h3" port=443`
   - TTL `1 hour` (Auto is fine).
3. Save.

### Option B — API script
Needs a Cloudflare API token with **Zone:DNS:Edit** (the wrangler OAuth token
is workers-only and won't work). Create one at
<https://dash.cloudflare.com/profile/api-tokens> → "Edit zone DNS" template.

```sh
export CLOUDFLARE_API_TOKEN=xxxx
DRY_RUN=1 ./dns/publish-dns-aid.sh   # preview
./dns/publish-dns-aid.sh             # apply
```

## Enable DNSSEC (required by the spec)

So validating resolvers return authenticated data:
1. Cloudflare dashboard → `hajimekyokushin.com` → **DNS → Settings → DNSSEC → Enable**.
2. Cloudflare shows a **DS record** (key tag, algorithm, digest).
3. Add that DS record at the **registrar** (where the domain is registered).
4. Wait for the registry to publish it (`dig +short DS hajimekyokushin.com`
   returns data once live).

## Verify

```sh
./dns/verify-dns-aid.sh
```

Checks the `_index` SVCB record resolves via a validating public resolver
(1.1.1.1) and that the zone is DNSSEC-signed (DS present + AD flag). Allow up
to the TTL (1h) for propagation. Then re-run the isitagentready.com check;
`checks.discoverability.dnsAid.status` should flip to `"pass"`.
