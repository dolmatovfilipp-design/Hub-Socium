# Optional integrations (no production domain required)

All keys are optional. Without them the app stays on local/demo paths.

| Service | Env | Behavior without key |
|--------|-----|----------------------|
| S3 media | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, optional `S3_PUBLIC_BASE`, `S3_REGION` | Local `.data/media` |
| Web Push | `VAPID_*` + `VITE_VAPID_PUBLIC_KEY` | Subscribe UI works; delivery needs keys |
| Native push | FCM/APNs — later | Not wired |
| Maps | `VITE_YANDEX_MAPS_KEY` | Nearby list + schematic map |
| Moderation | reports queue + `YANDEX_VISION_API_KEY` stub | Manual `/app/mod/reports` |
| Analytics | `VITE_POSTHOG_KEY` / `VITE_PLAUSIBLE_DOMAIN` | No-op |
| Sentry | `VITE_SENTRY_DSN`, `SENTRY_DSN` | No-op |
| YooKassa demo | `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | Button shows «задайте ключи» |
| LLM compose | `OPENAI_API_KEY` or `YANDEX_GPT_*` | «Помочь с текстом» asks to connect key |

**Never** use LLM for feed ranking — only `POST /v1/assist/compose`.
