# Hub — Phase 1 Private Beta (живой roadmap)

**Статус:** стартовала (Филипп подтвердил)  
**Окно:** 2–4 недели (рабочие дни, Europe/Moscow)  
**Старт:** 2026-09-19  
**Целевое закрытие:** ≈ 2026-10-03 … 2026-10-17  
**Предшественник:** [`SPRINT-P0.md`](./SPRINT-P0.md) (API cut + Vite flag) — P0 стабильность: [`STABILITY-PASS.md`](./STABILITY-PASS.md)  
**Стек:** Go/chi + Postgres 16 + Redis 7 + Vite/React; RF **152-ФЗ**

---

## Цель фазы

Закрытый private beta: прод-API с бэкапами, observability, минимальный compliance (согласие + оферта/политика), серверный follow/block/report, критичный путь без «Скоро», лендинг. Пуши — второй эшелон.

**Не в фазе:** Music, market-payments, For You ML, OAuth-полнота, native store submit (только готовность к пушам позже).

---

## Роли (владельцы)

| Код | Агент | Фокус |
|-----|--------|--------|
| **Code** | Hub Code | Реализация API/FE, миграции, деплой-скрипты |
| **Review** | Hub Review | Регрессии, black screens, API/UI mismatch, smoke |
| **Release** | Hub Release | Roadmap, go/no-go, 152-ФЗ gaps, store readiness, приоритеты |

---

## Master checklist

| # | Эшелон | Тема | Owner lead | Со-владельцы | Цель (DoD кратко) | Статус |
|---|--------|------|------------|--------------|-------------------|--------|
| 1 | P0 | Прод API + бэкапы Postgres | Code | Release (runbook), Review (smoke) | Staging/prod compose или managed PG; nightly backup + restore drill documented — чеклист [`PROD-API-CHECKLIST.md`](./PROD-API-CHECKLIST.md) | 🔄 partial — **scripts ✅** (backup/restore, deploy, JWT, healthz); **BLOCKED Филипп:** domain · DNS · RF hosting · live cron · restore drill sign-off · uptime probe |
| 2 | P0 | Sentry | Code | Review (sample events) | FE + API errors в одном org/project; release tags; PII scrub | ✅ |
| 3 | P0 | Согласие 152-ФЗ + оферта/политика | Release | Code (UI/API hooks), Review | Чекбокс согласия при регистрации; страницы оферты/политики; запись consent version в БД | ✅ FE gate + API `consent_152_at` (юридический текст — черновик) |
| 4 | P0 | Follow / block / report на сервере | Code | Review | API + wire FE; block скрывает контент; report пишет в moderation queue | ✅ API + FE wire (moderation queue = reports table) |
| 5 | P0 | Убрать «Скоро» с критичного пути | Code | Review | Нет toast/CTA «скоро» на login→feed→compose→like→comment→profile→DM; stubs только вне P0 | ✅ |
| 6 | P1 | Лендинг | Code | Release (copy/legal links) | Публичная страница waitlist/invite + ссылки на политику | ✅ API-backed waitlist/invite (seed `HUB-BETA`); FE `src/pages/Landing.tsx` |
| 7 | P2 | Пуши web/native | Code | Release | Web Push MVP **или** native FCM/APNs scaffold — **после** P0 пунктов 1–5 | 🔄 scaffold ✅ — `POST/DELETE /v1/me/push`, Settings toggle, `sw.js`, [`PUSH.md`](./PUSH.md); send pipeline ☐ |

---

## Календарь по неделям

### Неделя 1 (2026-09-22 … 09-26) — foundation prod + safety

| День | Code | Review | Release |
|------|------|--------|---------|
| **D1 Пн** | Инвентарь деплоя: env matrix (`DATABASE_URL`, `JWT_SECRET`, CORS, TLS); черновик `deploy/` или compose.prod | Smoke baseline на текущем API-mode (login/feed/compose) | Зафиксировать invite-list private beta; критерии go/no-go v0 |
| **D2 Вт** | Postgres: managed или VPS + **nightly `pg_dump`**, retention ≥7d; скрипт restore | Проверить restore на пустую инстанцию (1 таблица users) | Runbook бэкапов в docs; риск-лог 152-ФЗ |
| **D3 Ср** | Sentry SDK API (Go) + Vite; source maps; scrub email/phone | Нарочно бросить 500 / FE error → event виден | DSN/org secrets вне git; политика PII в Sentry |
| **D4 Чт** | Follow API wire если дыры: `POST/DELETE /v1/users/{id}/follow`; counters | Регресс профиля/ленты после follow | Черновик текстов оферты/политики (юридический placeholder ОК |
| **D5 Пт** | Block + report: таблицы + endpoints; FE убрать local-only | Сценарии block → пост исчез; report → 201 | Чеклист «Скоро» audit; приоритет вычищения на W2 |

**Exit недели 1:** бэкап+restore drill ✅, Sentry events ✅, follow API usable, block/report schema landed или PR ready, список «Скоро» на критичном пути.

### Неделя 2 (2026-09-29 … 10-03) — compliance + critical path clean

| День | Code | Review | Release |
|------|------|--------|---------|
| **D6–D7** | Consent: миграция `user_consents`; регистрация требует `terms_version`; страницы `/legal/terms`, `/legal/privacy` | Регресс Register/Login | Финализировать версии документов; changelog consent |
| **D8** | Вычистить «Скоро» на критичном пути (DM уже в API — убрать ложные toast; репосты/группы — скрыть или disable без «скоро») | Полный smoke STABILITY-PASS + regression | Go/no-go mid-phase |
| **D9–D10** | Лендинг MVP (статический или Vite route): CTA invite/waitlist | Визуал + mobile width | Copy + ссылки legal; invite flow |

**Exit недели 2:** пункты 1–5 закрыты или с явным defer; лендинг в работе/готов; private beta invite возможен.

### Недели 3–4 (опционально до 2026-10-17) — polish + pushes

| Фокус | Code | Review | Release |
|-------|------|--------|---------|
| Harden prod (rate limit Redis, TLS, secrets rotation note) | ✅ | load smoke | go/no-go |
| Лендинг + analytics stub | ✅ | a11y/basic | |
| **Пуши (п.7):** Web Push subscription API **или** native scaffold — только если 1–6 зелёные | ✅ | | Store readiness notes (не submit) |

---

## Тикеты (кратко)

### PB-01 — Prod API + Postgres backups
- **Owners:** Code (lead), Release, Review  
- **Status:** 🔄 partial  
- **Go/no-go: NO-GO** for Invite first users until Филипп closes domain/DNS/RF + restore drill sign-off  
- **Runbook:** [`PROD-API-CHECKLIST.md`](./PROD-API-CHECKLIST.md), [`runbook-backup-restore.md`](./runbook-backup-restore.md); deploy skeleton `deploy/compose.prod.yml` · [`deploy/README.md`](../deploy/README.md)  
- **Artifacts:** `scripts/backup-pg.sh`, `scripts/restore-pg.sh`, `deploy/`  

**Closed by Code (scripts / repo)**  
- `scripts/backup-pg.sh`, `scripts/restore-pg.sh`  
- [`runbook-backup-restore.md`](./runbook-backup-restore.md)  
- `deploy/compose.prod.yml`, `deploy/Caddyfile`, `deploy/env.prod.example`, `deploy/README.md`  
- JWT fail-fast ≥32 outside embedded/dev  
- API `GET /healthz`  

**Blocked on Филипп (Release cannot close)**  
- Real domain + DNS A/AAAA → host  
- Public TLS via real `HUB_DOMAIN` (Caddy Let’s Encrypt needs public DNS)  
- RF hosting choice confirmed (VPS / managed PG in Russia) for 152-ФЗ PD locality  
- Staging URL to publish  
- Live cron for nightly backup on real host + restore drill sign-off on real/staging instance  
- External uptime probe on HTTPS healthz  
- Operator PD contact beyond placeholder `privacy@hub.local`  

- **AC:**
  - [x] ✅ scripts — Nightly backup/restore scripts + retention note in runbook
  - [x] ✅ scripts — `JWT_SECRET` ≥32; fail-fast вне embedded/dev (`HUB_ENV=dev` / `APP_ENV=development` / embedded)
  - [x] ✅ scripts — Deploy skeleton (compose + Caddy + env example); healthz on API
  - [ ] **BLOCKED: Филипп — domain/DNS/RF** — Staging URL documented; healthz через публичный TLS / reverse proxy
  - [ ] **BLOCKED: Филипп — domain/DNS/RF** — Live nightly cron + restore drill sign-off (see PROD checklist Sign-off)
  - [ ] Rollback note (previous binary / migrate down policy) — skeleton only

### PB-02 — Sentry
- **Owners:** Code, Review  
- **AC:**
  - [x] `@sentry/react` (или аналог) + Go SDK
  - [x] Environment `staging`/`production`; release = git sha
  - [x] Before-send scrub PII; no tokens in breadcrumbs

### PB-03 — 152-ФЗ consent + legal pages
- **Owners:** Release (lead), Code  
- **AC:**
  - [ ] Register: обязательный checkbox + link to terms/privacy
  - [ ] DB stores `policy_version`, `accepted_at`, `ip`/`user_agent` (минимум)
  - [ ] Страницы оферты и политики доступны без auth
  - [ ] Gap-list оставшихся 152-ФЗ требований (не блокер private beta, но tracked)

### PB-04 — Follow / block / report (server)
- **Owners:** Code, Review  
- **AC:**
  - [ ] Follow/unfollow idempotent; feed уважает follows (уже есть таблица `follows`)
  - [ ] `POST /v1/users/{id}/block`, `DELETE` unblock; feed/profile скрывают blocked
  - [ ] `POST /v1/reports` `{ target_type, target_id, reason }`; admin/moderation list later OK
  - [ ] FE: `blockAuthor` / `reportPost` вызывают API в API-mode (не только localStorage)

### PB-05 — Remove «Скоро» from critical path
- **Owners:** Code, Review  
- **AC:**
  - [x] Audit: toast/кнопки с «скоро» / «Скоро»
  - [x] Критичный путь: auth, лента, compose, like, comment, profile edit, messages/DM — без ложных «скоро»
  - [x] Вне пути (репосты, групповые чаты, Music): скрыть UI или disabled **без** обещания «скоро»

### PB-06 — Landing
- **Owners:** Code, Release  
- **Status:** ✅ confirmed — API-backed waitlist/invite (seed invite `HUB-BETA`, max_uses 1000); FE `src/pages/Landing.tsx`  
- **AC:**
  - [x] Публичный URL: value prop + CTA (invite code или waitlist email) — `POST /v1/waitlist`, `POST /v1/invite/validate` (validate-only, не consume); `Landing.tsx`
  - [x] Ссылки на оферту/политику
  - [x] Не тащит Music/Market payments

### PB-07 — Pushes (second echelon)
- **Owners:** Code, Release  
- **Decision:** Web Push primary (Vite PWA); native Expo → FCM/APNs secondary (scaffold only, **no store submit**)  
- **Docs:** [`PUSH.md`](./PUSH.md) · [`NATIVE-SCAFFOLD.md`](./NATIVE-SCAFFOLD.md)  
- **AC:**
  - [x] Спека: web-first + native scaffold notes (docs landed 2026-09-23)
  - [ ] Не стартовать impl, пока PB-01 invite gate не cleared / явно waived
  - [x] Settings toggle Push + VAPID stub (`нужен VAPID` без ключа)
  - [x] API subscription upsert/delete + SW scaffold
  - [ ] Send pipeline (out of scope this sprint)
  - [ ] Web Push MVP implementation ☐
  - [ ] Native scaffold beyond docs ☐

---

## Go / no-go (Release)

| Gate | Must | Now (2026-09-23) |
|------|------|------------------|
| **Invite first users** | PB-01 backup drill ✅, PB-02 Sentry ✅, PB-03 consent ✅, PB-05 critical path clean ✅ | **NO-GO** — **PB-01 still blocking** (scripts ✅; domain/DNS/RF + restore drill sign-off on Филипп). PB-02 ✅, PB-05 ✅; PB-03 FE/API consent ✅ (юр. текст черновик) |
| **Widen cohort** | + PB-04 block/report ✅, PB-06 landing ✅ | PB-06 ✅ already (`Landing.tsx` + waitlist/invite); PB-04 ✅ in master — widen still waits on Invite gate first |
| **Pushes work** | Только после widen; PB-07 | Spec ✅ web-first ([`PUSH.md`](./PUSH.md)); impl ☐ |

**Hard no:** Music, market checkout, прод без бэкапа, регистрация без согласия.

---

## Связь с SPRINT-P0

P0 дал working API + feature-flagged Vite. Phase 1 **не** переписывает P0 DoD — наращивает prod/compliance/moderation. Устаревшие out-of-scope пометки в SPRINT-P0 про «152-ФЗ next sprint» и «stories/push P1» снимаются этим документом: 152-ФЗ и push теперь в Phase 1 (push — эшелон 2).

---

## Changelog

| Дата (MSK) | Изменение |
|------------|-----------|
| 2026-09-19 | Создан документ; фаза стартовала по подтверждению Филиппа / CoS |
| 2026-09-23 | PB-02 Sentry + PB-05 убрано «Скоро» с критичного пути |
| 2026-09-23 | Добавлен указатель на [`PROD-API-CHECKLIST.md`](./PROD-API-CHECKLIST.md) (PB-01 / master checklist #1) |
| 2026-09-23 | PB-01 artifacts: backup/restore scripts, deploy skeleton, JWT fail-fast; PB-06 landing API waitlist/invite (`HUB-BETA`) |
| 2026-09-23 (~17:20 MSK) | PB-01 go/no-go split: repo scripts ✅ vs **BLOCKED Филипп** domain·DNS·RF; Invite gate **NO-GO**; PROD checklist restructured |
| 2026-09-23 (~17:20 MSK) | PB-07: Web Push–first spec [`PUSH.md`](./PUSH.md) + store readiness [`NATIVE-SCAFFOLD.md`](./NATIVE-SCAFFOLD.md) (no submit); impl still ☐ |
| 2026-09-23 (~17:20 MSK) | Confirm PB-06 ✅ (`src/pages/Landing.tsx` + API waitlist/invite `HUB-BETA`) |
| 2026-09-23 (~17:30 MSK) | Sprint items: invite consume on register (atomic uses++); GET /v1/mod/reports + is_admin; Web Push scaffold; PWA manifest/icons; PB-01 cron/TLS/Philip-blocked already in checklist |


## Implementation notes (Phase 1 start)

### 152-ФЗ consent gate
- Full-screen Settings-style gate before `/app` (`RequireConsent` in `App.tsx`).
- UI: `src/pages/Consent.tsx` — title «Ваши данные», two checkboxes (privacy + terms), Continue.
- Legal drafts: `/legal/privacy`, `/legal/terms` (`src/pages/Legal.tsx`) — marked as lawyer drafts.
- Persist: `localStorage['hub-consent-v1']` (+ legacy keys migrated); API `POST /v1/users/me/consent` → `users.consent_152_at`.

### Social graph
- Migrations: `005_social_graph.sql`, `006_consent_152_reports.sql` (blocks, reports, consent columns).
- Routes (auth): `POST|DELETE /v1/users/{id}/follow`, `POST|DELETE /v1/users/{id}/block`, `POST /v1/posts/{id}/report`, `GET /v1/users/me/following`, `GET /v1/users/me/blocks`, `POST /v1/users/me/consent`.
- FE: Profile follow/unfollow; PostMoreSheet block/report → API + store; bootstrap loads following + blocks; feed filters blocked authors (client + server).

### How to test
1. Clear `localStorage` key `hub-consent-v1` (and legacy `hub_consent_152`).
2. Log in (API mode) → redirected to `/consent` → check both boxes → Продолжить → `/app`.
3. Open another profile → Подписаться / Вы подписаны.
4. Post ⋯ → Заблокировать / Пожаловаться; blocked authors disappear from feed.


### PB-02 Sentry (2026-09-23)
- См. [`SENTRY.md`](./SENTRY.md). FE: `@sentry/react` + `src/lib/sentry.ts`. API: `internal/sentryx`. Без DSN — no-op.

### PB-05 «Скоро» inventory (2026-09-23)

| Item | Action |
|------|--------|
| Settings → Сообщения (privacy) | Wired → `/app/messages` |
| Settings → Заблокированные | Subview list + unblock (`GET/DELETE` blocks) / «Пока пусто» |
| Settings → Подписки | Subview list / «Пока пусто» |
| Settings → legal rows | Kept → `/legal/*` |
| Settings → invite / push categories / mentions / status / restricted / recommended / private likes / help stubs / third-party | Hidden or honest «недоступны в beta» (no «Скоро» toast) |
| Feed drawer custom feeds (music, …) | Close drawer, no toast (Music untouched as product) |
| Profile Репосты tab | Tab stays; empty «Нет репостов»; toast removed |
| PostCard репост (API mode) | Disabled muted «Недоступно в beta» |
| NewMessage групповые чаты | Hidden |
| Chat вложения / меню | Hidden |
| Store `toggleRepost` / dead `sendMessage`/`ensureConversation` API stubs | Silent no-op (Chat/NewMessage use real API) |

**Left non-critical (intentionally):** custom feeds, group chats, chat attachments/menu, server reposts, invite friends, push category prefs, help center.


### PB-01 artifacts (2026-09-23)
- Scripts: `scripts/backup-pg.sh`, `scripts/restore-pg.sh` (CONFIRM=1); runbook [`runbook-backup-restore.md`](./runbook-backup-restore.md).
- Deploy: `deploy/compose.prod.yml` (api + postgres:16 + caddy), `deploy/README.md`, `deploy/env.prod.example`.
- JWT fail-fast outside embedded/dev (≥32 / required); API healthz.
- **Go/no-go:** repo-ready yes; Invite gate **NO-GO** until Филипп domain/DNS/RF + restore drill sign-off ([`PROD-API-CHECKLIST.md`](./PROD-API-CHECKLIST.md)).

### PB-06 Landing API (2026-09-23)
- Migration `007_waitlist_invite.sql`; seed invite **`HUB-BETA`** (max_uses 1000).
- `POST /v1/waitlist`, `POST /v1/invite/validate` (public, validate-only — uses not incremented).
- FE: `Landing.tsx` → API when `isApiMode()`; success invite → `/register`.
