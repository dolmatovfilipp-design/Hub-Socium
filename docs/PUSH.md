# Push notifications — Phase 1 echelon 2 (PB-07)

**Decision (2026-09-23 MSK):** **Web Push first**, native secondary (scaffold only).

Связано: [`PHASE1-PRIVATE-BETA.md`](./PHASE1-PRIVATE-BETA.md) (PB-07) · [`NATIVE-SCAFFOLD.md`](./NATIVE-SCAFFOLD.md) · ARCHITECTURE Parts 1–4 / 5–11 (Expo Notifications → FCM/APNs)

---

## Gate

**Do not implement** until PB-01 invite-first-users gate clears (domain + DNS + RF hosting + restore drill sign-off), **or** explicit waive from Филипп / Release.

PB-02…05 should be ✅ (or waived) before coding; widen cohort prefers PB-04 + PB-06 as well.

---

## Primary path: Web Push (private beta web)

| | |
|--|--|
| **Why** | Faster for Vite PWA users; no App Store / Google Play; fits invite-first web cohort |
| **Stack** | Vite PWA / service worker + Web Push API + VAPID |
| **Audience** | Private beta web (desktop + mobile browser) first |

### Data model sketch

```text
push_subscriptions (
  id, user_id,
  endpoint TEXT UNIQUE,
  p256dh TEXT, auth TEXT,   -- Web Push keys
  user_agent, created_at, last_seen_at, revoked_at
)

-- optional prefs (or columns on users / notification_prefs)
notification_prefs (
  user_id,
  push_enabled BOOLEAN DEFAULT true,
  likes, follows, replies, dms  -- per-category bools
  -- quiet_hours later: start/end Europe/Moscow
)
```

### API sketch

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/v1/push/subscribe` | Body: `{ endpoint, keys: { p256dh, auth } }`; upsert by endpoint |
| `DELETE` | `/v1/push/subscribe` | Unsubscribe (body endpoint or id) |
| `GET`/`PATCH` | `/v1/users/me/notification-prefs` | Toggle categories + master `push_enabled` |

Auth required. Reject oversized payloads; rate-limit subscribe.

### Fanout events (MVP)

| Event | Push? | Notes |
|-------|-------|--------|
| Like on your post | yes | Collapse / digest later OK |
| New follower | yes | |
| Reply / comment on your post | yes | |
| DM | yes | Highest priority |
| Quiet hours | **later** | Default off in MVP; ARCHITECTURE: 23:00–08:00 MSK |

Respect blocks: no push from blocked users. Respect `push_enabled` + category prefs.

### Secrets / ops

- **VAPID** public + private keys in env / secret manager — **never git**
- Example env names: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` operator contact)
- Rotate = new keys → clients must re-subscribe

### 152-ФЗ

Push endpoints / subscription keys and device tokens are **ПД-adjacent** (device identifiers tied to user). Process/store in **RF**; DPA with any push relay if used; do not log raw tokens in Sentry breadcrumbs.

---

## Secondary path: native (scaffold only)

Expo Notifications → FCM / APNs, aligned with ARCHITECTURE. **No store submit in Phase 1.**

See [`NATIVE-SCAFFOLD.md`](./NATIVE-SCAFFOLD.md) for store readiness checklist and ownership (Филипп / Apple / Google accounts).

Native table sketch (when scaffolded):

```text
device_tokens (
  id, user_id,
  platform ENUM('ios','android'),
  token TEXT UNIQUE,          -- Expo / FCM / APNs
  expo_push_token TEXT,
  created_at, last_seen_at, revoked_at
)
```

Same fanout worker can branch: Web Push vs Expo push by channel.

---

## Definition of Done — Web Push MVP

**In scope**

- [ ] SW registers; user grants permission; `POST /v1/push/subscribe` stores subscription
- [ ] At least like + follow + reply + DM fanout to active subscriptions
- [ ] Prefs: master off + per-category (or documented subset)
- [ ] VAPID from env; no secrets in repo
- [ ] Basic invalid-endpoint cleanup (410 → revoke row)

**Out of scope (Phase 1)**

- Quiet hours, smart ranking, digest batching
- Native store submit / production FCM/APNs in TestFlight/Play
- Rich media / actionable notification buttons
- Cross-border push SaaS without 152-ФЗ review

---

## Status

| Item | Status |
|------|--------|
| Spec (this doc) | ✅ 2026-09-23 |
| Native scaffold notes | ✅ [`NATIVE-SCAFFOLD.md`](./NATIVE-SCAFFOLD.md) |
| Implementation | ☐ gated on PB-01 invite gate |

## Scaffold status (2026-09-23)

Landed in repo:

- Migration `009_push_subscriptions.sql`
- `POST /v1/me/push` / `DELETE /v1/me/push` (auth)
- Settings → Push toggle (requests Notification permission; requires `VITE_VAPID_PUBLIC_KEY`)
- `public/sw.js` install/activate + push event stub
- Server send: DM + follow via `push.NotifyUser` (skips with log «нужен VAPID» if keys empty)

Env:

| Var | Side | Notes |
|-----|------|--------|
| `VITE_VAPID_PUBLIC_KEY` | FE | Application server key (URL-safe base64). Empty → UI shows «нужен VAPID». |
| | `VAPID_PRIVATE_KEY` | API | Required with public for send; never commit. |
| `VAPID_SUBJECT` | API | e.g. `mailto:ops@example.com` | |


## VAPID keygen (local)

```bash
# using webpush-go helper or openssl+python — example with npx web-push:
npx --yes web-push generate-vapid-keys
# put public in FE VITE_VAPID_PUBLIC_KEY and API VAPID_PUBLIC_KEY
# put private in API VAPID_PRIVATE_KEY only
```

Without keys: API logs `push skip: нужен VAPID` and does not crash.
