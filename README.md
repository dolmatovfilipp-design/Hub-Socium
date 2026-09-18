# Hub

Мобильное веб-приложение в стиле Threads — лента, маркет, сообщения и профиль.  
Тёмная graphite UI. По умолчанию демо на `localStorage`; опционально подключается Hub API.

## Стек

- Vite + React 19 + TypeScript
- React Router
- Tailwind CSS v4
- Zustand + persist (localStorage)

## Запуск

```bash
cd /workspace/hub
npm install
npm run dev
```

Сборка:

```bash
npm run build
npm run preview
```

Откройте приложение в браузере (по умолчанию `http://localhost:5173`).  
Интерфейс рассчитан на iPhone 13 Pro Max (логические **428×926**): на телефоне — fullscreen (`100dvh`/`100svh`, `viewport-fit=cover`, safe-area); на широком десктопе — центрированный превью-фрейм 428×926.

## Демо-вход

| Поле | Значение |
|------|----------|
| Логин | `филипп` (или `philip@hub.app`, или `+79001234567`) |
| Пароль | `demo` |

Также работают любые правдоподобные логин/пароль (≥4 символов) — откроется демо-сессия.

## Экраны

1. **Старт** — бренд Hub, Войти / Регистрация  
2. **Вход** — телефон/email + пароль, «Забыли пароль?»  
3. **Регистрация** — имя, username, контакт, пароль  
4. **Сброс пароля** — контакт → 6-значный код (показывается в UI) → новый пароль  
5. **Главная** — переключатель «Лента | Маркет», pull-to-refresh, посты  
6. **Маркет** — каталог, поиск, «В корзину» (тост: оплата демо, без эквайринга)  
7. **Сообщения** — список диалогов + чат (текст; кнопка голоса — заглушка)  
8. **Создать (+)** — sheet для новой ветки / ответа  
9. **Действия** — лайки, подписки, упоминания, ответы, репосты  
10. **Профиль** — аватар, био, счётчики, вкладки Ветки / Ответы, редактирование, выход  
11. **Настройки** — сохранённое, уведомления, конфиденциальность, выход  

Нижняя навигация (фиксированная): Главная · Сообщения · + · Действия · Профиль.  
**Музыки и бьюти-букинга нет.**

## Структура

```
src/
  components/   # PhoneShell, BottomNav, PostCard, ComposeSheet, Avatar, Toast
  pages/        # экраны приложения
  store/        # Zustand store + localStorage / API
  lib/          # api.ts (fetch + токены)
  data/         # сиды пользователей, постов, DM, маркета
  types/        # TypeScript-типы
  utils/        # валидация и форматирование
```

## API (бэкенд)

Без Docker — embedded Postgres:

```bash
cd /workspace/hub/backend
make run-embedded          # :8080, сид филипп/demo
```

Фронт с API:

```bash
cd /workspace/hub
VITE_USE_API=true VITE_API_URL=http://127.0.0.1:8080 npm run dev
# или в консоли браузера: localStorage.setItem('hub_use_api','true')
```

Превью/туннель часто на **5174**; API слушает **8080**.

Подробнее: [`backend/README.md`](./backend/README.md).

## API mode vs local

Включить API: `VITE_USE_API=true` при `npm run dev`, или в консоли браузера  
`localStorage.setItem('hub_use_api','true')` и перезагрузить.  
`apiBaseUrl()` по умолчанию `''` (same-origin через Vite proxy `/v1` → `:8080`).

| Экран / действие | API mode | Local (Zustand) |
|------------------|----------|-----------------|
| Auth gate | `GET /v1/users/me` при токене; 401 → welcome | `currentUserId` из localStorage |
| Login / Register | `POST /v1/auth/login`, `POST /v1/auth/register` | демо-сид / локальные юзеры |
| Logout | `POST /v1/auth/logout` + clear tokens | clear session |
| Feed | `GET /v1/feed` (+ cursor), pull-to-refresh | сиды + shuffle |
| Like / Unlike | `POST` / `DELETE` `/v1/posts/{id}/like` (optimistic) | local arrays |
| Compose post | `POST /v1/posts` | local post |
| Comments | list `GET …/comments`, create `POST …/comments` (в compose reply) | local replies |
| Profile | `GET /v1/users/me` и `GET /v1/users/{username|id}` | local users |
| Edit profile | `PATCH /v1/users/me` (имя/username/bio; data-URL фото — только превью) | local patch |
| Activity | честный empty «серверные уведомления скоро» | local seed |
| Messages / Chat | честный empty / offline label | local DM |
| Market | local demo | local demo |
| Repost / saves | toast «скоро» / local saves | local |

Демо API: логин `филипп` / пароль `demo`.

### Phone preview

1. Backend: `cd backend && make run-embedded` (:8080)  
2. Frontend: `VITE_USE_API=true VITE_API_URL= npm run dev -- --port 5174`  
3. Tunnel → phone: Cloudflare на `http://127.0.0.1:5174`  
4. В браузере телефона: `localStorage.setItem('hub_use_api','true')` если env не проставлен  
5. Войти `филипп` / `demo` → лента с сервера

## Примечание

В local-режиме данные в браузере (`hub-app-v1`). В API-режиме токены в `sessionStorage`. Музыки нет — UI Threads.
