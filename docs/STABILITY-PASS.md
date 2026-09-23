# Hub stability pass — 2026-09-19 (MSK)

Environment: API `HUB_EMBEDDED_PG=1 SEED_DEMO=1` on `:8080`; Vite `:5174` with `VITE_USE_API=true` and `/v1` proxy; demo `филипп` / `demo`.

## Summary: **PASS**

No code changes required. Smoke (API curl + headless Chrome) and builds all green.

## Checklist

| # | Item | Result | Notes |
|---|------|--------|-------|
| 1 | login / refresh / logout | PASS | `/v1/auth/login`, `/refresh`, `/logout` (204); Vite proxy login OK |
| 2 | feed loads posts | PASS | API feed + FE ~15 articles after login |
| 3 | compose open/close | PASS | No `Maximum update depth`; no black screen; Отмена → `/app` |
| 4 | create text + media post | PASS | Text via API+UI; media via `POST /v1/media/upload` + `image_url` on create |
| 5 | like / unlike + comment | PASS | API 204; UI like count updates; comments create+list |
| 6 | conversations + send + read | PASS | List/send/mark-read API; UI list + DM send |
| 7 | activity list + mark read | PASS | `GET /v1/activity`, `POST /v1/activity/read` (all); FE list loads |
| 8 | PATCH profile + avatar | PASS | `PATCH /v1/users/me`; avatar via `/v1/media/upload` then `avatar_url` |
| 9 | `npm run build` + `go test ./...` | PASS | FE build OK; Go tests OK (`config`, `http` cached) |

## FE review notes

- `ComposeSheet` already selects stable store slices (`users` / `posts`) and derives with `useMemo` — no inline `[]` / `.filter` in `useStore` selectors.
- Messages / Chat / Activity use API helpers directly in API mode (`apiListConversations`, `apiSendMessage`, `apiListActivity`, etc.).
- Music control remains disabled stub only (no new feature).

## Files changed

- `docs/STABILITY-PASS.md` (this file only)

## Services left running

- API pid on `:8080` (embedded PG) — not restarted (already healthy)
- Vite on `:5174` with `VITE_USE_API=true`
