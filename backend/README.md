# Hub API (P0 skeleton)

Go modular monolith for Hub — Russia 2026 launch cut.  
Aligned with `docs/ARCHITECTURE-PARTS-1-4.md` and `docs/ARCHITECTURE-PARTS-5-11.md`.

## Stack

- Go 1.22+
- chi v5 + cors
- pgx/v5 (Postgres 16)
- JWT (golang-jwt/v5) + bcrypt
- Optional **embedded Postgres** (`fergusstrange/embedded-postgres`) — no Docker/apt
- Redis 7 in compose (reserved for sessions/rate-limit; not required for P0 handlers)

## Quick start (no Docker)

```bash
cd /workspace/hub/backend
go mod tidy
make run-embedded
# equivalent:
#   go build -o bin/api ./cmd/api
#   HUB_EMBEDDED_PG=1 SEED_DEMO=1 ./bin/api
# (also starts when DATABASE_URL is empty)
```

First run downloads Postgres binaries into `.data/pg/` (cache + data persist).  
Listens on **`:8080`**. Demo user seeded: **филипп / demo**.

```bash
curl -s localhost:8080/healthz
curl -s -X POST localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"филипп","password":"demo"}'
```

## Quick start (Docker Postgres)

```bash
cd /workspace/hub/backend
docker compose up -d
export DATABASE_URL='postgres://hub:hub@localhost:5432/hub?sslmode=disable'
export JWT_SECRET='hub-dev-jwt-secret-change-me-32chars'
export HTTP_ADDR=':8080'
export CORS_ORIGINS='http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174'
make run
# seed:
SEED_DEMO=1 ./bin/api -seed-only
```

## Verify

```bash
go mod tidy
go build -o bin/api ./cmd/api
go test ./...
curl -s localhost:8080/healthz
```

## Endpoints (P0)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/healthz` | — | liveness; reports db status |
| POST | `/v1/auth/register` | — | username + password + email\|phone |
| POST | `/v1/auth/login` | — | login = username\|email\|phone |
| POST | `/v1/auth/refresh` | — | body `{ refresh_token }` |
| POST | `/v1/auth/logout` | — | revokes refresh; `204` |
| GET | `/v1/users/me` | Bearer | current profile |
| GET | `/v1/users/{username}` | — | public profile |
| POST | `/v1/posts` | Bearer | create post (body ≤500) |
| GET | `/v1/posts/{id}` | — | get post |
| GET | `/v1/feed?cursor&limit` | Bearer | following chronological |
| POST | `/v1/posts/{id}/like` | Bearer | idempotent |
| DELETE | `/v1/posts/{id}/like` | Bearer | unlike |
| POST | `/v1/posts/{id}/comments` | Bearer | add comment |
| GET | `/v1/posts/{id}/comments` | — | list (oldest first) |
| POST | `/v1/media/upload` | Bearer | Multipart `file` → disk under `.data/media/` |
| GET | `/v1/media/{id}` | — | Serve uploaded image (jpeg/png/webp/gif) |
| POST | `/v1/media/presign` | Bearer | **stub** URLs (legacy; prefer upload) |

OpenAPI: [`docs/openapi.yaml`](./docs/openapi.yaml)

## Env

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | _(empty → embedded)_ | Postgres DSN; empty starts embedded PG |
| `HUB_EMBEDDED_PG` | — | `1` forces embedded Postgres under `.data/pg` |
| `HUB_EMBEDDED_PG_PORT` | `54329` | Embedded listen port |
| `JWT_SECRET` | dev secret (≥16) | HS256 signing key |
| `HTTP_ADDR` | `:8080` | Listen address |
| `CORS_ORIGINS` | Vite 5173/5174 | Comma-separated; `*` reflects Origin (dev) |
| `SEED_DEMO` | — | `1` seeds филипп/demo (auto with embedded) |

## Makefile

| Target | Action |
|--------|--------|
| `make run-embedded` | Build + embedded PG + migrate + seed + serve |
| `make run` | Build + serve with `DATABASE_URL` |
| `make seed` | Seed demo user only |
| `make compose-up` | Docker Postgres/Redis |

## Layout

```
backend/
  cmd/api/main.go
  internal/config
  internal/embedpg       # optional embedded Postgres
  internal/apiutil
  internal/http
  internal/auth
  internal/users
  internal/posts
  internal/feed
  internal/db
  migrations/001_init.sql
  .data/pg/              # embedded binaries + data (gitignored)
  docker-compose.yml
  Makefile
```

## Frontend

Wire the Vite SPA with `VITE_USE_API=true` and `VITE_API_URL=http://127.0.0.1:8080`  
(or set `localStorage.hub_use_api = 'true'` at runtime). Music is out of scope.
