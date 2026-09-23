# T15 Contacts match

- Save own phone: Settings → Контакты → «Мой номер» → `PUT /v1/me/phone` (stores E.164 + `phone_hash`).
- Match: paste numbers → «Найти в Hub» → `POST /v1/contacts/match` (hashes only server-side).
- **No SMS / no invites.** Only users who already saved a phone in Hub.
- Demo: `+79001234567` = demo user «филипп» (password `demo`).
