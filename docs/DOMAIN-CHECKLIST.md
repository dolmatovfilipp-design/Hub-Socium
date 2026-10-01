# Domain checklist (Hub)

**Статус (2026-10-01 MSK):** DNS/TLS **ждут Филиппа** — hostname не выдумываем.  
Пока live-демо: Tunnelmole + Vite preview `:4173` + API `:8080`.

Связано: [`PB-01-STAGING.md`](./PB-01-STAGING.md) · [`PROD-API-CHECKLIST.md`](./PROD-API-CHECKLIST.md) · [`PHASE1-PRIVATE-BETA.md`](./PHASE1-PRIVATE-BETA.md) (PB-01) · `deploy/TLS.md`

---

## Decision checklist for Филипп (Invite gate)

Короткий go/no-go список. **Не покупать домен и не менять DNS из агента** — только решения и действия владельца.

| # | Решение / действие | Repo status | Филипп | Notes |
|---|-------------------|-------------|--------|-------|
| 1 | **Выбор домена** (staging и/или prod FQDN, желательно `.ru` / RF) | — | ☐ BLOCKED | Пример: `hub.example.ru`. Без имени — стоп PB-01 Invite |
| 2 | **DNS A/AAAA** (или CNAME) → IP хоста | — | ☐ BLOCKED | Короткий TTL на cutover |
| 3 | **RF hosting** для ПДн (VPS и/или managed Postgres в РФ) | deploy skeleton ✅ | ☐ BLOCKED | 152-ФЗ locality; зафиксировать провайдера |
| 4 | **Public TLS** (`HUB_DOMAIN` + Caddy Let’s Encrypt) | `deploy/Caddyfile` ✅ | ☐ BLOCKED | Нужен публичный DNS из п.1–2 |
| 5 | **Staging URL** опубликован invite-когорте | preview/tunnel ✅ | ☐ BLOCKED | Не announce «боевой» URL без п.4 |
| 6 | **Live nightly backup cron** на хосте | `scripts/backup-pg.sh` ✅ | ☐ BLOCKED | + владелец алерта при падении job |
| 7 | **Restore drill** (минимум `users`) + sign-off | runbook ✅ | ☐ BLOCKED | Таблица Sign-off в PROD-API-CHECKLIST |
| 8 | **External uptime probe** на HTTPS `/healthz` | API healthz ✅ | ☐ BLOCKED | + алерт при N подряд fail |
| 9 | **CORS_ORIGINS** = `https://<domain>` (без `*`) | env example ✅ | ☐ after DNS | На хосте в `.env.prod` |
| 10 | **Operator PD email** (не `privacy@hub.local`) | legal draft UI ✅ | ☐ BLOCKED | См. [`LEGAL-DRAFT.md`](./LEGAL-DRAFT.md) |

**Invite-first-users gate:** **NO-GO** until 1–4, 6–7 closed (uptime probe 8 — strongly expected before widen; PD email 10 — before removing legal draft banner).

---

## До того, как есть домен

| # | Шаг | Кто | Готово |
|---|-----|-----|--------|
| 0 | Preview/tunnel demo (без публичного DNS) | Dev | ✅ |
| 0a | Invite API + `/invite` лендинг | Dev | ✅ |
| 0b | Sentry env-gated (`VITE_SENTRY_*` / `SENTRY_*`) | Dev | ✅ docs |
| 0c | Backup runbook | Dev | ✅ `runbook-backup-restore.md` |
| 0d | Prod compose + Caddy skeleton | Dev | ✅ `deploy/` |
| 0e | Legal draft pages + consent gate | Dev | ✅ draft banner kept |

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
| 10 | Uptime probe → HTTPS healthz | External |
| 11 | Smoke: login → лента → compose → DM → **Рядом** | Demo `филипп`/`demo` |

## Не делать без домена

- Публичный DNS / прод TLS на выдуманном имени
- Announce invite cohort на «боевой» URL
- Прод cron backup на хост без согласованного hostname
- Покупка домена или смена DNS агентом без явного поручения Филиппа

**Стоп-точка:** пункт 1 decision table — ждём RF hostname от Филиппа.
