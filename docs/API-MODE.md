# Hub — API mode wiring

See root README section **API mode vs local**.

Backend additions:
- `PATCH /v1/users/me` — update display_name, username, bio, avatar_url
- Feed items include `liked_by_me`
- `GET /v1/users/{username}` also accepts UUID
- **Messaging:** `GET/POST /v1/conversations`, `GET/POST /v1/conversations/{id}/messages`, `POST /v1/conversations/{id}/read`
- **Activity (Действия):** `GET /v1/activity?filter=all|follows|replies|mentions`, `POST /v1/activity/read`
- Like / comment insert activity for the post author (not self)

Frontend entry: `src/lib/api.ts`, pages Messages / Chat / Activity (API mode), store `bootstrapAuth` / `refreshFeed` / `loadComments` / `loadProfile` / `updateProfile`.
