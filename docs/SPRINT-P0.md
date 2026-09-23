# Hub P0 — Sprint plan (2 weeks / 10 working days)

**Product:** Hub — Threads-style social network  
**Region:** Russia, 2026 launch cut  
**Aligned with:** [`ARCHITECTURE-PARTS-1-4.md`](./ARCHITECTURE-PARTS-1-4.md), [`ARCHITECTURE-PARTS-5-11.md`](./ARCHITECTURE-PARTS-5-11.md)  
**Dates:** Sprint window = 10 working days (Mon–Fri × 2)  
**Stack cut:** Go/chi modular monolith + Postgres 16 + Redis 7 + existing Vite React SPA (feature-flagged API)
**Next phase:** [`PHASE1-PRIVATE-BETA.md`](./PHASE1-PRIVATE-BETA.md) — Private Beta (prod, 152-ФЗ, moderation, landing)


---

## Goal

Ship a **working P0 launch cut API** and wire the existing Vite client behind a feature flag so demo users can:

1. Register / login / refresh / logout (JWT access + refresh sessions)
2. Read/update own profile; view public profile by username
3. Create posts, read post by id, chronological **Following** feed (cursor pagination)
4. Like / unlike posts; create and list comments
5. Media **presign stub** (no real S3 yet)
6. OpenAPI skeleton + CI lint/test for `backend/`
7. Keep Vite demo (`localStorage`) intact when flag is off — **do not break frontend**

Success = `go build`/`go test` green, `docker compose up -d` + `make run` serves `/healthz` and `/v1/*`, Vite still builds with `VITE_USE_API=false` (default).

---

## Out of scope (explicit)

| Area | Why |
|------|-----|
| **Music** | Architecture: never on launch |
| **Market checkout / payments** | P2; Market stays demo toast |
| **For You ML ranking** | P2; only chronological Following feed |
| OAuth (VK/Yandex/Apple/Google/Telegram) | P0+ next sprint |
| 2FA SMS/TOTP, password reset email | Stub only if time; not DoD |
| Messenger realtime / WebSocket / NATS | P1 |
| Stories, push notifications, search FTS | P1 |
| Next.js marketing, Expo native app | P1 (Mobile optional tickets only) |
| Real S3 upload pipeline / CDN | Presign stub only |
| 152-ФЗ legal pages, hard purge jobs | Track as risk; not sprint DoD |
| Celebrity fanout / home_timeline table | Pull-at-read following merge is enough |

---

## Roles

| Role | Focus |
|------|--------|
| **Backend** | Go API, migrations, JWT, feed/posts/comments, OpenAPI, CI |
| **Frontend** | API client + feature flag, wire auth/feed/profile without removing local demo |
| **Mobile (optional)** | OpenAPI → TS types review; no Expo app this sprint |

---

## Day-by-day plan

### Days 1–2 — Foundation

| Owner | Work |
|-------|------|
| Backend | Repo `backend/` module, chi router, middleware (requestID, logger, recoverer), config env, `GET /healthz`, docker-compose Postgres+Redis, migration `001_init.sql`, Makefile |
| Backend | CI job: `go vet`, `go test`, `go build` |
| Frontend | Add `VITE_USE_API` / `VITE_API_BASE_URL` env; thin `src/api/client.ts` stub (no call sites yet) |

**Exit:** API boots with compose; healthz 200; frontend unchanged at runtime.

### Days 3–4 — Auth + users

| Owner | Work |
|-------|------|
| Backend | `POST /v1/auth/register|login|refresh|logout`; bcrypt; JWT access 15m; refresh tokens in DB; `GET /v1/users/me`; `GET /v1/users/{username}` |
| Backend | Seed demo user `филипп` / `demo` (optional `make seed`) |
| Frontend | When flag on: login/register call API; store access token; keep persist fallback when flag off |

**Exit:** Register → login → me round-trip works via curl and flagged UI.

### Days 5–6 — Posts + feed + social graph

| Owner | Work |
|-------|------|
| Backend | `POST /v1/posts`, `GET /v1/posts/{id}`, follows table used by `GET /v1/feed?cursor&limit` (chronological following + own posts) |
| Backend | Soft-delete fields respected (`deleted_at IS NULL`) |
| Frontend | Feed page: fetch `/v1/feed` when flag on; compose → `POST /v1/posts` |

**Exit:** Two users follow → feed shows posts in created_at desc order with cursor.

### Days 7–8 — Likes, comments, media stub

| Owner | Work |
|-------|------|
| Backend | `POST/DELETE /v1/posts/{id}/like`; `POST/GET /v1/posts/{id}/comments`; `POST /v1/media/presign` stub (fake URL + key) |
| Frontend | Like/unlike + comments list when flag on; ignore real upload |
| Mobile (opt.) | Validate OpenAPI paths for future Expo client |

**Exit:** Like toggles idempotent; comments paginate or list; presign returns JSON stub.

### Days 9–10 — OpenAPI, CI polish, wire + freeze

| Owner | Work |
|-------|------|
| Backend | `api/openapi.yaml` (or `docs/openapi.yaml`) covering P0 routes; README runbook |
| Backend | Harden errors (401/403/404/422 shape); rate-limit note in README (Redis optional later) |
| Frontend | Feature-flag E2E smoke checklist; default flag **off** so Vite demo never regresses |
| Both | Definition of Done review, risk log update, handoff notes |

**Exit:** Sprint DoD checklist all green; no Music/Market payment code landed.

---

## Ticket-style backlog

### AUTH-01 — JWT register / login / refresh / logout

- **Title:** Auth endpoints with access JWT + refresh sessions  
- **Owner:** Backend  
- **Acceptance criteria:**
  - [ ] `POST /v1/auth/register` creates user (email **or** phone + username + password); returns `201` + `{ user, access_token, expires_in }` (+ refresh token body and/or Set-Cookie)
  - [ ] Password stored as bcrypt cost ≥10; never returned in JSON
  - [ ] `POST /v1/auth/login` accepts login = email | phone | username; `200` same shape
  - [ ] Access JWT HS256, TTL 15m, claims include `sub` (user id), `username`
  - [ ] `POST /v1/auth/refresh` rotates/validates refresh; invalid/revoked → `401`
  - [ ] `POST /v1/auth/logout` revokes refresh session → `204`
  - [ ] Duplicate username/email → `409`

### USER-01 — Profile me + public by username

- **Title:** Users profile read  
- **Owner:** Backend (+ Frontend wire)  
- **Acceptance criteria:**
  - [ ] `GET /v1/users/me` requires `Authorization: Bearer`; returns id, username, display_name, bio, avatar_url, counters stub
  - [ ] Missing/invalid token → `401`
  - [ ] `GET /v1/users/{username}` public; soft-deleted → `404`
  - [ ] Username uniqueness enforced at DB

### POST-01 — Posts CRUD (create + get)

- **Title:** Create and fetch posts  
- **Owner:** Backend  
- **Acceptance criteria:**
  - [ ] `POST /v1/posts` auth required; body text ≤500 chars; `201` with id, author, created_at
  - [ ] Empty body → `422`
  - [ ] `GET /v1/posts/{id}` returns post; deleted → `404`
  - [ ] Author_id from JWT, not client body

### FEED-01 — Following chronological feed

- **Title:** Cursor feed of following + self  
- **Owner:** Backend  
- **Acceptance criteria:**
  - [ ] `GET /v1/feed?limit=&cursor=` auth required; default tab = following chronology
  - [ ] Items = posts from users I follow ∪ my posts; `deleted_at IS NULL`; order `created_at DESC, id DESC`
  - [ ] `limit` default 20, max 50
  - [ ] Opaque/simple cursor works for next page; empty `next_cursor` when done
  - [ ] For You / ML **not** implemented

### CMNT-01 — Comments on posts

- **Title:** Create and list comments  
- **Owner:** Backend  
- **Acceptance criteria:**
  - [ ] `POST /v1/posts/{id}/comments` auth; body required; `201`
  - [ ] `GET /v1/posts/{id}/comments` lists newest or oldest consistently (document choice); excludes soft-deleted
  - [ ] Missing post → `404`

### LIKE-01 — Like / unlike

- **Title:** Post likes  
- **Owner:** Backend  
- **Acceptance criteria:**
  - [ ] `POST /v1/posts/{id}/like` idempotent `204`/`200`
  - [ ] `DELETE /v1/posts/{id}/like` idempotent unlike
  - [ ] Unique `(post_id, user_id)` constraint

### MEDIA-01 — Presign stub

- **Title:** Media presign stub (no S3)  
- **Owner:** Backend  
- **Acceptance criteria:**
  - [ ] `POST /v1/media/presign` auth; accepts `{ content_type, byte_size }`
  - [ ] Returns stub `{ upload_url, public_url, object_key, expires_in }` (may be placeholder URLs)
  - [ ] No real Object Storage dependency this sprint

### SPEC-01 — OpenAPI

- **Title:** OpenAPI 3.x for P0 routes  
- **Owner:** Backend  
- **Acceptance criteria:**
  - [ ] Spec file in repo covers health + all `/v1` P0 paths and error shapes
  - [ ] Paths match running chi router
  - [ ] README links to spec

### CI-01 — Lint / test

- **Title:** CI for backend  
- **Owner:** Backend  
- **Acceptance criteria:**
  - [ ] Pipeline (or documented Make targets) runs `go test ./...`, `go vet ./...`, `go build ./cmd/api`
  - [ ] At least config unit test + health handler test pass without Postgres
  - [ ] Failures block merge (when CI wired)

### FE-01 — Wire Vite client to API (feature flag)

- **Title:** Feature-flagged API client in existing Vite app  
- **Owner:** Frontend  
- **Acceptance criteria:**
  - [ ] Env `VITE_USE_API=true|false` (default **false**); `VITE_API_BASE_URL` default `http://localhost:8080`
  - [ ] With flag off: current localStorage demo unchanged (Welcome/Login/Feed/Market)
  - [ ] With flag on: login/register, feed, compose, like, comments use `/v1/*`
  - [ ] CORS allows Vite origin (`http://localhost:5173`)
  - [ ] `npm run build` still succeeds; **no Music** screens added

---

## Definition of Done (sprint)

- [ ] All backlog tickets above meet their acceptance criteria **or** explicitly deferred in Risks with owner
- [ ] `cd backend && go mod tidy && go build -o bin/api ./cmd/api && go test ./...` passes
- [ ] `docker compose up -d` brings Postgres 16 + Redis 7; `make run` serves API
- [ ] Documented endpoint list in `backend/README.md`
- [ ] OpenAPI file exists for P0
- [ ] Vite frontend builds; default mode remains local demo (flag off)
- [ ] No Music feature; no Market checkout; no For You ML
- [ ] Demo seed user available (`филипп` / `demo`) when seeded
- [ ] Sprint demo: register → post → follow → feed → like → comment (curl or flagged UI)

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Postgres unavailable in CI/dev | Blocks integration tests | Unit tests without DB; document compose; optional testcontainers later |
| Cyrillic username `филипп` edge cases | Auth/login mismatch | Normalize login lookup; UTF-8 column collation; seed + test |
| CORS / cookie vs Bearer on web | Refresh broken in browser | P0: Bearer + refresh in JSON body; httpOnly cookie optional follow-up |
| Scope creep (OAuth, DM, Stories) | Miss launch cut | Strict out-of-scope list; reject non-P0 PRs |
| Frontend dual-path bugs (flag on/off) | Demo regression | Default flag off; smoke checklist day 10 |
| Soft-delete vs hard FK | Orphan likes/comments | ON DELETE CASCADE on junctions; posts/users soft-delete filters in queries |
| JWT secret weak in env | Security | Require `JWT_SECRET` ≥32 chars in prod; fail fast if empty in non-dev |
| 152-ФЗ consent not in sprint | Compliance debt | Track for next sprint; no prod user PII beyond staging |
| Redis unused day 1 | Wasted compose service | Keep for rate-limit/session denylist next; health optional |

---

## Quick reference — P0 API surface

```
GET  /healthz
POST /v1/auth/register
POST /v1/auth/login
POST /v1/auth/refresh
POST /v1/auth/logout
GET  /v1/users/me
GET  /v1/users/{username}
POST /v1/posts
GET  /v1/posts/{id}
GET  /v1/feed?cursor&limit
POST /v1/posts/{id}/like
DELETE /v1/posts/{id}/like
POST /v1/posts/{id}/comments
GET  /v1/posts/{id}/comments
POST /v1/media/presign   # stub
```

**Env:** `DATABASE_URL`, `JWT_SECRET`, `HTTP_ADDR=:8080`, `CORS_ORIGINS`
