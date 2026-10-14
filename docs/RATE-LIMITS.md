# Rate limits & quality (S16)

Документация лимитов Hub API (private beta). Коды ответа: `429` + `error: rate_limited`.

## Глобально

| Лимит | Значение | Где |
|-------|----------|-----|
| Анонимные запросы / минута (по IP) | **120** | `RateLimit` — логин, регистрация, без токена |
| Запросы пользователя / минута (по user id из JWT) | **600** | `RateLimit` — ключ `u:{id}`, не IP |
| Дешёвые GET и пульс | не считаются | `/v1/features`, список чатов, сообщения, лента, активность, истории, входящие звонки, `/v1/ws`, `POST /v1/me/heartbeat` |
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

- Регистрация invite-only по умолчанию (`RequireInvite` / `HUB_REQUIRE_INVITE`, выкл. через `0`). Без кода или реферала — `invite_required`.
- `POST /v1/invite/validate` — проверка без расхода.
- Consume uses атомарно на register.
- Публичный waitlist: `POST /v1/waitlist` (без Bearer).

## Примечания

- Лимиты soft / in-memory для IP (сброс при рестарте API).
- Follow/DM/post — Postgres counters по `created_at`.
- Demo user `филипп` не освобождён от caps (кроме invite).
