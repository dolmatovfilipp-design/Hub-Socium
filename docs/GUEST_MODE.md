# T16 Guest / family mode

**Choice:** invite link → read-only host profile + recent posts **without an account**.

- Host creates link in Settings → «Семья» (`POST /v1/me/guest-links`).
- Guest opens `/g/{token}` (API `GET /v1/guest/{token}`).
- No write actions (no likes, comments, DMs).
- Links expire in 30 days; host can revoke.

Not chosen: limited guest account with passwordless session (heavier auth surface).
