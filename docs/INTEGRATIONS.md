# Optional integrations

Все ключи **опциональны**. Без них приложение работает на локальных/демо-путях.
Ключи кладите в `backend/.env` (сервер) и/или корневой `.env` (Vite `VITE_*`). **Не присылайте секреты в чат.**

| Сервис | Переменные | Без ключа |
|--------|------------|-----------|
| S3 media | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, опц. `S3_PUBLIC_BASE`, `S3_REGION` | Локально `.data/media` |
| Web Push | `VAPID_*` + `VITE_VAPID_PUBLIC_KEY` | Подписка в UI; доставка нужна |
| Maps | `VITE_YANDEX_MAPS_KEY` | Список «Рядом» / схема (экран скрыт из настроек) |
| Модерация | жалобы + `YANDEX_VISION_API_KEY` | Ручная очередь `/app/mod/reports` |
| Analytics | `VITE_POSTHOG_KEY` (+ `VITE_POSTHOG_HOST`) / `VITE_PLAUSIBLE_DOMAIN` | no-op |
| Sentry | `VITE_SENTRY_DSN`, `SENTRY_DSN` | no-op |
| ЮKassa demo | `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | Кнопка «задайте ключи» |
| LLM compose | `OPENAI_API_KEY` или `YANDEX_GPT_*` | «Помочь с текстом» просит ключ |

**Сейчас в окружении box:** только VAPID. Остальное — **нужны ключи** в `.env`.

LLM **не** используется для ранжирования ленты — только `POST /v1/assist/compose`.

Реферальная ссылка: `GET /v1/me/referral` → `/invite?code=R…&ref=username`.
