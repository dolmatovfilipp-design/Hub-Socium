# T16 Guest / family mode

**Choice:** invite link → read-only host profile + recent posts **without an account**.

- Host: Settings → «Семья» → «Создать ссылку» (`POST /v1/me/guest-links`).
- Guest opens `/g/{token}` (API `GET /v1/guest/{token}`) — black Threads UI, no white blank.
- Read-only: no likes, comments, DMs.
- Links expire in 30 days; host can revoke.
- Empty posts: honest empty state, not a crash.

Not chosen: limited guest account with passwordless session (heavier auth surface).
