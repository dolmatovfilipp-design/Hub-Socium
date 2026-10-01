# Domain checklist (Hub)

**Статус (2026-10-01 MSK):** DNS/TLS **ждут Филиппа** — hostname не выдумываем.  
Пока live-демо: Tunnelmole + Vite preview `:4173` + API `:8080`.

Связано с `PB-01-STAGING.md` и `deploy/TLS.md`.

## До того, как есть домен

| # | Шаг | Кто | Готово |
|---|-----|-----|--------|
| 0 | Preview/tunnel demo (без публичного DNS) | Dev | ✅ |
| 0a | Invite API + `/invite` лендинг | Dev | ✅ |
| 0b | Sentry env-gated (`VITE_SENTRY_*` / `SENTRY_*`) | Dev | ✅ docs |
| 0c | Backup runbook | Dev | ✅ `runbook-backup-restore.md` |

## Когда Филипп дал hostname (RF)

| # | Шаг | Notes |
|---|-----|-------|
| 1 | Получить production **и/или** staging FQDN | Например `hub.example.ru` |
| 2 | DNS A/AAAA (или CNAME) → IP хоста | TTL короткий на время cutover |
| 3 | TLS Let’s Encrypt / certbot (или Caddy auto) | См. `deploy/Caddyfile`, `deploy/TLS.md` |
| 4 | HTTPS-only redirect | HTTP → HTTPS |
| 5 | `CORS_ORIGINS=https://<domain>` | Без `*` в проде |
| 6 | FE build: `VITE_USE_API=true`, same-origin или явный API URL | |
| 7 | `HUB_REQUIRE_INVITE=1` + seed invite codes | Private beta gate |
| 8 | Sentry: `SENTRY_DSN` + `VITE_SENTRY_DSN` в secrets (не в git) | См. `docs/SENTRY.md` |
| 9 | Backup cron + restore drill | `scripts/cron-backup.example` |
| 10 | Smoke: login → лента → compose → DM → **Рядом** | Demo `филипп`/`demo` |

## Не делать без домена

- Публичный DNS / прод TLS на выдуманном имени
- Announce invite cohort на «боевой» URL
- Прод cron backup на хост без согласованного hostname

**Стоп-точка:** пункт 1 — ждём RF hostname от Филиппа.
