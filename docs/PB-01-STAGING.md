# PB-01 Staging — TLS / backup / invite

**Статус (2026-09-23 MSK):** ⏸ **NO-GO без домена от Филиппа.** Домен не выдумываем.

## Ждём домен

- [ ] Филипп сообщает production/staging hostname (RF)
- [ ] DNS A/AAAA (или CNAME) → staging IP
- [ ] TLS (Let’s Encrypt / certbot) на hostname
- [ ] HTTPS-only redirect
- [ ] CORS_ORIGINS включает `https://<domain>`
- [ ] Invite gate `HUB_REQUIRE_INVITE=1` + seed invite codes
- [ ] Backup cron + restore drill (см. `runbook-backup-restore.md`)
- [ ] Sentry DSN / env secrets вне git

## Можно готовить локально (без live domain)

- Tunnelmole / preview `:4173` + API `:8080` для demo
- Runbook backup/restore уже в `docs/runbook-backup-restore.md`
- Invite/waitlist API: `POST /v1/waitlist`, `POST /v1/invite/validate`

## Не делать без домена

- Публичный DNS / прод TLS
- Cron backup на прод-хост
- Announce invite cohort на публичный URL

**Чеклист:** «ждём домен» — стоп-точка PB-01.


---

## Update — S-package wave 3 (2026-09-23 ~22:50 MSK)

- Preview tunnelmole + Vite `:4173` / API `:8080` остаются рабочим demo-путём.
- **Домен от Филиппа не получен** → PB-01 по-прежнему **NO-GO** для публичного TLS/DNS/cron.
- Не ломаем preview: без fake TLS, без выдуманного hostname.
- Чеклист выше актуален: ждём RF hostname → DNS → Let’s Encrypt → CORS → invite gate live → backup cron.
