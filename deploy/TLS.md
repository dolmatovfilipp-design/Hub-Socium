# Hub TLS / Caddy (Let’s Encrypt)

HTTPS for private-beta via Caddy in [`compose.prod.yml`](./compose.prod.yml) + [`Caddyfile`](./Caddyfile).

## Prerequisites

1. **Public DNS** — `HUB_DOMAIN` A/AAAA → server public IP (inbound **80** / **443**).
2. **Do not invent a live domain** — real hostname + DNS are **blocked-on-Philip**.
3. Copy [`env.prod.example`](./env.prod.example) → `deploy/.env.prod` and fill secrets.

## How Caddy gets a cert

`Caddyfile`:

```
{$HUB_DOMAIN:localhost} {
	encode gzip
	reverse_proxy api:8080
}
```

On a **public** hostname Caddy obtains a **Let’s Encrypt** certificate automatically (HTTP-01 on :80). `localhost` stays local HTTP (no public ACME).

## Checklist

| Step | Notes |
|------|--------|
| DNS propagated | `dig +short $HUB_DOMAIN` → server IP |
| Compose up | `docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d` |
| Health | `curl -fsS https://$HUB_DOMAIN/healthz` |
| Redirect | HTTP → HTTPS (Caddy default) |
| API exposure | Only Caddy publicly; api `expose: 8080` on compose network |

## Env related to TLS / proxy

| Variable | Role |
|----------|------|
| `HUB_DOMAIN` | Public hostname for Caddy / ACME (`env.prod.example`) |
| `CORS_ORIGINS` | Include `https://$HUB_DOMAIN` (+ FE origins) |
| `JWT_SECRET` | ≥32 chars outside embedded/dev |

## Gaps / blocked-on-Philip

- Public domain + DNS + staging URL sign-off — see [`docs/PROD-API-CHECKLIST.md`](../docs/PROD-API-CHECKLIST.md) and PHASE1 PB-01.
- Placeholder in examples: `hub.example.com` only.

## Ops notes

- Renewals are automatic while Caddy runs and DNS stays valid.
- ACME failures: firewall 80/443, CAA, another process on :80.
- Managed LB / cloud cert is an alternative (terminate TLS upstream).
