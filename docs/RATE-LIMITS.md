# Rate limits & quality (S16)

Документация лимитов Hub API (private beta). Коды ответа: `429` + `error: rate_limited`.

## Глобально

| Лимит | Значение | Где |
|-------|----------|-----|
| IP requests / минута | **120** | `IPRateLimit` middleware |
| Каналы / сутки | 5 | channels |
| Channel joins burst | да | channels |
| Channel posts burst | да | channels |

## Подписки (follow)

| Лимит | Значение |
|-------|----------|
| Follows / час | **60** |
| Новые аккаунты (&lt;24ч): follows / 24ч | **20** |

## Личные сообщения

| Лимит | Значение |
|-------|----------|
| Новые 1:1 чаты / час | **30** |
| Новые аккаунты (&lt;24ч): новые DM / 24ч | **10** |

## Посты

| Лимит | Значение |
|-------|----------|
| Posts / час | **30** |

## Invite-only

- Регистрация требует `invite_code`, когда `HUB_REQUIRE_INVITE=1` / `RequireInvite`.
- `POST /v1/invite/validate` — проверка без расхода.
- Consume uses атомарно на register.
- Публичный waitlist: `POST /v1/waitlist` (без Bearer).

## Примечания

- Лимиты soft / in-memory для IP (сброс при рестарте API).
- Follow/DM/post — Postgres counters по `created_at`.
- Demo user `филипп` не освобождён от caps (кроме invite).
