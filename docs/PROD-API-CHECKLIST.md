# Prod API / backups checklist

Чеклист перед выводом Hub API в staging/production (Phase 1, PB-01). Секреты и DSN **никогда** не коммитить в git.

Связано: [`PHASE1-PRIVATE-BETA.md`](./PHASE1-PRIVATE-BETA.md) (PB-01) · [`runbook-backup-restore.md`](./runbook-backup-restore.md) · [`deploy/README.md`](../deploy/README.md)

---

## Go / no-go summary (2026-09-23 MSK)

| | |
|--|--|
| **Repo-ready** | **Yes** — backup/restore scripts, runbook, `deploy/` compose + Caddy + env example, JWT fail-fast ≥32 outside embedded/dev, API `GET /healthz` |
| **Invite-first-users gate (PB-01)** | **NO-GO** until Филипп closes: real domain + DNS A/AAAA → host, public TLS via `HUB_DOMAIN`, RF hosting choice (VPS / managed PG in Russia for 152-ФЗ), at least one restore drill sign-off on real/staging instance |
| **Docs** | Runbook: [`runbook-backup-restore.md`](./runbook-backup-restore.md) · Deploy: [`deploy/README.md`](../deploy/README.md) |

**Status markers:** `✅ scripts` = closed in repo by Code · `[ ]` **BLOCKED: Филипп — domain/DNS/RF** = Release cannot close without Филипп.

---

## Postgres backup

- [x] ✅ scripts — Nightly `pg_dump` script + retention note documented (`scripts/backup-pg.sh`, runbook)
- [x] ✅ scripts — Retention ≥ 7 дней описан в runbook (ротация / object storage)
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — Live cron/systemd timer for nightly backup on real host
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — Restore drill на реальной/staging инстанции (минимум таблица `users`) + sign-off ниже
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — Владелец алерта при падении backup job назначен

## HTTPS / domain / reverse proxy

- [x] ✅ scripts — Caddy reverse proxy skeleton (`deploy/Caddyfile`, `deploy/compose.prod.yml`)
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — Реальный домен; DNS A/AAAA → host
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — Public TLS (Let’s Encrypt) через `HUB_DOMAIN` (нужен публичный DNS)
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — Staging URL опубликован
- [x] ✅ scripts — API за Caddy в compose (внутренний порт не publish наружу в skeleton)
- [ ] CORS allowlist ограничен известными origin (Vite FE / landing) — задать в `.env.prod` на хосте после DNS

## Env secrets

- [x] ✅ scripts — `JWT_SECRET` ≥ 32 символа; fail-fast вне embedded/dev
- [x] ✅ scripts — `DATABASE_URL` / credentials только env (`deploy/env.prod.example`; не в git)
- [x] ✅ scripts — CORS / Redis / Sentry DSN — только env; шаблон в deploy example
- [ ] Ротация секретов описана (кто, как, при компрометации) — note на хосте / ops
- [x] ✅ scripts — `.env*` / secrets в `.gitignore`

## Health checks

- [x] ✅ scripts — `GET /healthz` отвечает 200 без auth (API)
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — External uptime probe на HTTPS healthz
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — Алерт при N подряд неуспешных probe

## Rollback

- [x] ✅ scripts — Compose / image tags позволяют предыдущий бинарь (skeleton в `deploy/`)
- [ ] Политика migrate: forward-only **или** явный down-скрипт; undocumented down запрещён — skeleton only
- [ ] Rollback note: как откатить binary без потери данных; когда migrate down допустим — skeleton only
- [ ] Smoke после rollback (login → feed) — после staging URL

## 152-ФЗ hosting notes (RF)

- [ ] **BLOCKED: Филипп — domain/DNS/RF** — ПД на инфраструктуре в РФ (VPS / managed PG в RF) — выбор хостинга подтверждён
- [x] ✅ scripts — Версии согласия / оферты / политики в продукте (FE gate + legal pages; юр. текст — черновик)
- [ ] **BLOCKED: Филипп — domain/DNS/RF** — Контакт оператора ПД в политике (сейчас placeholder `privacy@hub.local`)
- [ ] Трансграничная передача ПД без правовых оснований не выполняется (Sentry/CDN/провайдеры — проверить регион и договоры)
- [ ] Gap-list оставшихся требований 152-ФЗ ведётся (не всё блокер private beta)

---

## Sign-off

| Дата (MSK) | Кто | Staging URL | Notes |
|------------|-----|-------------|-------|
|            |     |             | **Restore drill pending** — scripts + runbook ready; live drill + sign-off blocked on Филипп (host/DNS/RF) |
