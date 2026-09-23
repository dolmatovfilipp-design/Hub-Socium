# Runbook: Postgres backup / restore (PB-01)

Связано: [`PROD-API-CHECKLIST.md`](./PROD-API-CHECKLIST.md), скрипты `scripts/backup-pg.sh`, `scripts/restore-pg.sh`.

Секреты и DSN **не** коммитить. Для drill использовать staging / пустую инстанцию.

---

## Nightly dump

1. На хосте (или в cron / systemd timer) задать `DATABASE_URL` (или `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`).
2. Опционально: `BACKUP_DIR=/var/backups/hub` (по умолчанию `./backups`).
3. Запуск:

```bash
cd /path/to/hub
DATABASE_URL='postgres://…' ./scripts/backup-pg.sh
```

4. Результат: `backups/hub-YYYYMMDD-HHMMSS.dump` (формат `pg_dump -Fc`).
5. Cron пример (MSK 03:15):

```cron
15 3 * * * cd /opt/hub && . /etc/hub/env && ./scripts/backup-pg.sh >> /var/log/hub-backup.log 2>&1
```

6. При падении job — алерт владельцу (см. чеклист PROD-API).

---

## Restore drill (пустая инстанция)

Цель: убедиться, что dump поднимается и таблица `users` читается.

1. Поднять пустой Postgres 16 (docker / managed), **не** прод.
2. Применить схему при необходимости: миграции Hub (`backend/migrations`) или полный restore с `--clean`.
3. Восстановить:

```bash
CONFIRM=1 DATABASE_URL='postgres://hub:hub@localhost:5432/hub_restore?sslmode=disable' \
  ./scripts/restore-pg.sh backups/hub-YYYYMMDD-HHMMSS.dump
```

4. Проверка:

```bash
psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM users;'
psql "$DATABASE_URL" -c '\dt'
```

Ожидание: `users` существует, COUNT ≥ 0 (на сиде — демо-пользователи).

5. Зафиксировать дату drill и кто выполнял в таблице Sign-off в [`PROD-API-CHECKLIST.md`](./PROD-API-CHECKLIST.md).

---

## Retention

- Хранить ≥ **7 дней** локально или в object storage.
- Ротация: удалять dump старше retention (например `find backups -name 'hub-*.dump' -mtime +7 -delete`).
- Перед удалением последнего успешного dump — не ротировать.

---

## Замечания

- `restore-pg.sh` требует `CONFIRM=1` или интерактивный ответ `yes`.
- Custom dump (`.dump`) → `pg_restore`; plain `.sql` → `psql`.
- Прод-restore только по change-window + бэкап текущего состояния перед overwrite.


## PB-01 note

Live domain/DNS/cron для staging — **NO-GO** без hostname от Филиппа. См. `PB-01-STAGING.md`.
