# Deploy skeleton (PB-01)

Минимальный prod-like стек: **api** (Go) + **postgres:16** + **Caddy** (TLS / reverse proxy).

Секреты только через env-файл / secret manager — **не** в git.

## Env template

Скопируйте [`env.prod.example`](./env.prod.example) → `deploy/.env.prod` и заполните:

| Variable | Notes |
|----------|--------|
| `HUB_DOMAIN` | Публичный DNS на этот хост |
| `HUB_ENV` | `production` (вне dev fail-fast для JWT) |
| `POSTGRES_*` | Учётка контейнера Postgres |
| `DATABASE_URL` | DSN для api (обычно на сервис `postgres`) |
| `JWT_SECRET` | **≥ 32 символов** обязательно вне embedded/dev |
| `CORS_ORIGINS` | Allowlist FE / landing origins |

Также см. `backend/.env.example` для локальной разработки (embedded PG / короткий secret допустим при `HUB_EMBEDDED_PG=1` или `HUB_ENV=dev` / `APP_ENV=development`).

### JWT fail-fast

Вне режима embedded/dev API **завершается при старте**, если `JWT_SECRET` отсутствует или короче 32 символов. Короткий / дефолтный secret разрешён только когда:

- `HUB_EMBEDDED_PG=1`, или
- `DATABASE_URL` пустой (поднимется embedded PG), или
- `HUB_ENV=dev` / `APP_ENV=development`

## Dockerfile note

`compose.prod.yml` ожидает `backend/Dockerfile`. Если файла ещё нет — соберите бинарь на хосте и подставьте свой image, либо добавьте multi-stage Dockerfile:

```dockerfile
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /api /api
COPY migrations /migrations
WORKDIR /
EXPOSE 8080
CMD ["/api"]
```

(Пути миграций должны совпадать с `findMigrations` в `cmd/api`.)

## Bring up

```bash
cp deploy/env.prod.example deploy/.env.prod
# edit secrets…
npm ci && VITE_USE_API=true npm run build   # фронт → dist/, Caddy раздаёт его из /srv/www
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d --build
curl -fsS https://$HUB_DOMAIN/healthz
```

## Автодеплой (gethub.online)

[`scripts/deploy.sh`](../scripts/deploy.sh) собирает фронт, по rsync заливает код в `DEPLOY_PATH` на сервере (не трогая `deploy/.env.prod`, `backend/.data`, `backups/`), выкладывает `dist/` без удаления старых чанков, делает `docker compose up -d --build`, `caddy reload` и проверяет `https://$HUB_DOMAIN/healthz`.

С машины с SSH-доступом:

```bash
DEPLOY_HOST=31.31.192.151 DRY_RUN=1 ./scripts/deploy.sh   # что изменится, без изменений
DEPLOY_HOST=31.31.192.151 ./scripts/deploy.sh
```

Через GitHub Actions ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)): на каждый PR — lint + сборка фронта и бэкенда; на push в `main` (или вручную, *Run workflow*) — деплой. Секреты в *Settings → Secrets and variables → Actions*:

| Secret | Обязателен | По умолчанию |
|--------|-----------|--------------|
| `DEPLOY_HOST` | да | — (`31.31.192.151`) |
| `DEPLOY_SSH_KEY` | да | приватный ключ, чей `.pub` лежит в `~/.ssh/authorized_keys` на сервере |
| `DEPLOY_USER` | нет | `root` (нужен доступ к docker) |
| `DEPLOY_PORT` | нет | `22` |
| `DEPLOY_PATH` | нет | `/opt/hub` |
| `DEPLOY_KNOWN_HOSTS` | нет | иначе `ssh-keyscan` при каждом запуске |

Первый запуск на сервере: в `DEPLOY_PATH/deploy/.env.prod` должны быть реальные секреты (`HUB_DOMAIN=gethub.online`, `CORS_ORIGINS=https://gethub.online`), а порты 80/443 — свободны для Caddy из compose (если сайт сейчас обслуживает Caddy/nginx вне compose — остановите его перед первым деплоем).

## DNS + TLS

1. A/AAAA запись `HUB_DOMAIN` → IP сервера (порты 80/443 открыты).
2. Caddy (`deploy/Caddyfile`) получает Let’s Encrypt сертификат автоматически для публичного имени.
3. API слушает только внутри сети compose (`expose: 8080`); снаружи — HTTPS через Caddy.

## Backup

С хоста / sidecar с доступом к Postgres:

```bash
DATABASE_URL='…' ./scripts/backup-pg.sh
```

Runbook: [`docs/runbook-backup-restore.md`](../docs/runbook-backup-restore.md).
