# Sentry (Hub)

Observability для private beta: фронт (`@sentry/react`) и API (`sentry-go`).  
**Без DSN приложение и API работают как обычно** — SDK просто не инициализируется.

## Важно

- DSN и ключи **не коммитить** в git (см. `backend/.env`, локальные `.env` / CI secrets).
- PII scrub: Authorization / Cookie / password / token / email / phone / JWT вычищаются в `beforeSend`.
- Тела запросов с паролями на бэкенде **не** прикрепляются к событиям.

## Frontend (Vite)

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `VITE_SENTRY_DSN` | да (для включения) | DSN проекта Sentry |
| `VITE_SENTRY_ENV` | нет | `development` / `staging` / `production` (default: `development`) |
| `VITE_SENTRY_RELEASE` | нет | Тег релиза (например git sha); если пусто — не передаётся |

Код: `src/lib/sentry.ts` → `initSentry()` из `src/main.tsx`.  
Также используется `Sentry.ErrorBoundary` вокруг `App`.

Пример (локально, не в git):

```bash
export VITE_SENTRY_DSN='https://...@o....ingest.sentry.io/...'
export VITE_SENTRY_ENV=staging
export VITE_SENTRY_RELEASE="$(git rev-parse --short HEAD)"
npm run build && npm run preview
```

Проверка: бросить ошибку в UI → событие в Sentry; без `VITE_SENTRY_DSN` — тишина, билд зелёный.

## Backend (Go)

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `SENTRY_DSN` | да (для включения) | DSN (можно тот же org/project или отдельный) |
| `SENTRY_ENV` | нет | default `development` |
| `SENTRY_RELEASE` | нет | тег релиза |

Код: `backend/internal/sentryx` — `Init()` в `cmd/api/main.go`, middleware + recover panics → Sentry + HTTP 500.  
Опционально: Logger шлёт `http_5xx` для ответов ≥500 (не для каждого 4xx; panic не дублируется).

Пример:

```bash
export SENTRY_DSN='https://...@o....ingest.sentry.io/...'
export SENTRY_ENV=staging
export SENTRY_RELEASE="$(git rev-parse --short HEAD)"
cd backend && make run-embedded   # или ваш обычный запуск :8080
```

Проверка: временный `panic("sentry-test")` в хендлере → event; без `SENTRY_DSN` — API стартует нормально.

## Связанные файлы

- FE: `src/lib/sentry.ts`, `src/main.tsx`, `src/vite-env.d.ts`
- API: `backend/internal/sentryx/sentryx.go`, `backend/internal/http/middleware.go`, `backend/internal/http/router.go`, `backend/cmd/api/main.go`
