# Hub — Production Architecture (Parts 5–11)

**Продукт:** Hub — социальная сеть в стиле Threads  
**Регион запуска:** Россия (сентябрь 2026)  
**Клиенты:** Web + iOS + Android  
**AI:** гибридный (on-device лёгкие задачи + серверный inference)  
**Версия документа:** 1.0 · сентябрь 2026  
**Охват:** части 5–11 (core product, ML, DB, perf, testing, monetization, release)  
**Предшественник:** [`ARCHITECTURE-PARTS-1-4.md`](./ARCHITECTURE-PARTS-1-4.md) — Go/chi modular monolith, Postgres+Redis+S3+NATS, Expo, Next+React, JWT hybrid, Music **out of scope**

---

## Gap-анализ (продолжение): MVP → Parts 5–11

| Область | Есть сейчас (MVP) | Нужно для production | Приоритет |
|--------|-------------------|----------------------|-----------|
| **Profile** | EditProfile локально (name/bio/avatar URL string) | Server profile, username uniqueness, avatar S3, privacy flags, follow graph | P0 |
| **Feed / posts** | Seed posts, like/repost/reply в Zustand | Cursor feed, fanout, media, soft-delete, visibility, rate limits | P0 |
| **Comments** | `replyToId` + `replies[]` в памяти | Nested threads depth≤3, pagination, mention parse | P0 |
| **Messenger** | Seed DM, local read flag | Conversations, WS realtime, receipts, media, block/mute | P1 |
| **Stories** | Нет | 24h ephemeral media, viewers, highlight optional phase 2 | P1 |
| **Notifications** | Activity seed (like/follow/mention/reply/repost) | Push APNs/FCM, in-app inbox, prefs, digest | P1 |
| **Search** | Нет | Users + posts FTS russian + semantic (pgvector) | P1 |
| **ML** | Нет | Moderation, ranking, captions, antifraud, STT/subs | P2 |
| **DB** | `seed.ts` типы | Полные схемы, миграции, индексы, HA | P0 |
| **Payments** | Market toast «В корзину» | ЮKassa/Tinkoff/CloudPayments/SBP, premium, ads | P2 |
| **152-ФЗ / stores** | Нет | Согласия, удаление ПДн, App Store / RuStore / Google Play | P0–P1 |

**Итог gap Parts 5–11:** доменные экраны есть (~30% UX), данные/realtime/ML/payments/compliance — почти 0%. Оценка feature-complete launch: **~210–280 person-days** поверх Parts 1–4 (~68–90 pd foundation).

---

# Часть 5. Core product functionality

**Effort:** 45–58 person-days (profile, feed, posts, comments, messenger, stories, notifications, search — без deep ML).

## 5.1 Profile

### Функции
- Публичный профиль: avatar, display name, `@username`, bio ≤160, counters followers/following/posts
- Edit: avatar upload (presigned S3), bio, privacy (`private_account`, `show_activity`, `allow_messages`: `everyone|followers|none`)
- Follow / unfollow / request (если private) / block / mute / report
- Tabs: Posts · Replies · Media · Likes (likes — только owner)

### API (поверх Part 3)
| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/v1/users/{username}` | Public card + relation to me |
| `PATCH` | `/v1/me` | Partial update; username change cooldown 14d |
| `POST` | `/v1/users/{id}/follow` | Idempotent |
| `DELETE` | `/v1/users/{id}/follow` | |
| `POST` | `/v1/users/{id}/block` | Cascades: unfollow both ways, hide DM |

### Concrete
- Username: `^[a-z0-9_]{3,30}$`, reserved list (`admin`, `hub`, `support`…)
- Avatar: max 5 MB, crop 1:1 → 512/256/64 WebP
- Rate: follow 60/hour/user; profile edit 20/hour

### Gap vs MVP
MVP: `User` в localStorage, password plaintext в seed, counters статические. → Убрать password из client types; counters из PG materialised / cached Redis.

**Effort profile:** 6–8 pd.

## 5.2 Feed

### Алгоритмы (launch)
1. **Following** (default): хронологический merge подписок + собственные, cursor `created_at,id`
2. **For You** (flag `feed_foryou`): scoring = `0.35*affinity + 0.25*engagement + 0.20*recency + 0.15*quality - 0.05*seen_penalty` (фичи Part 6)
3. Фильтры: скрыть muted/blocked; NSFW blur если `moderation_score≥0.7` и user не opted-in

### Concrete SLO
| Метрика | Target |
|---------|--------|
| Feed TTFB p50 / p99 | ≤120 ms / ≤400 ms (cached hot) |
| Page size | 20 posts |
| Cursor TTL | opaque, 24h |
| Home cache Redis | key `feed:{uid}:v{n}`, TTL 30s; invalidate on follow/post |

### Fanout
- **Push fanout** для авторов <5k followers: NATS `feed.fanout` → write `home_timeline` rows
- **Pull** для celebrity ≥5k: merge at read time (last 200 posts + graph)
- Гибрид с порогом 5k — ADR в Part 1 style

**Effort feed:** 8–10 pd.

## 5.3 Posts

### Модель
- Text ≤500 chars (как UI Part 4); media 0–4 images **или** 1 video ≤60s
- Types: `text`, `image`, `video`, `repost`, `quote`
- Visibility: `public`, `followers`, `mentioned`
- Soft-delete `deleted_at`; hard purge 30d job (152-ФЗ retention policy)

### Compose flow
```
Client → POST /v1/media/presign → PUT S3
      → POST /v1/posts {text, media_ids[], reply_to_id?, quote_id?}
      → 202/201 + NATS moderation.post.created
      → visible immediately if auto-score < threshold; else "pending"
```

### Limits
| Action | Limit |
|--------|-------|
| Create post | 30 / hour, 200 / day |
| Like / unlike | 300 / hour |
| Repost | 60 / hour |
| Edit | 1 edit / 15 min window; history not shown launch |

### Gap vs MVP
`Post.likes: string[]` / `reposts: string[]` / `replies: string[]` — не масштабируется. → Junction tables `post_likes`, `post_reposts`; counters denormalized на `posts`.

**Effort posts:** 7–9 pd.

## 5.4 Comments (replies)

- Thread depth **max 3** (post → reply → reply-to-reply)
- Sort: oldest (default thread) / newest
- Mentions `@username` → notify; highlight client
- Pagination: 20/page, parent expand lazy

**Effort comments:** 4–5 pd (частично в posts module).

## 5.5 Messenger

### Scope launch
- 1:1 DM only (groups phase 2)
- Text + image + reply-to-message
- States: `sent` → `delivered` → `read`
- Typing indicator (WS, ephemeral Redis TTL 3s)
- Presence: `online` if last_seen < 60s

### Protocol
- REST: list conversations, history cursor, send (fallback)
- WS `/v1/ws` (JWT query/header): events `msg.new`, `msg.read`, `typing`, `presence`
- NATS subjects: `chat.{conversation_id}`

### Concrete
| Param | Value |
|-------|-------|
| Max message length | 4000 |
| History page | 50 |
| Undelivered retry | client 3×; server durable JetStream |
| E2EE | **не** на launch (ADR: server-side encrypted at rest AES-GCM for `body`; plaintext in memory for push preview truncated) |

### Gap vs MVP
Local `Conversation`/`Message` без realtime, без media, без block. Settings `privacyAllowMessages` уже есть — связать с server.

**Effort messenger:** 10–12 pd.

## 5.6 Stories

### Scope
- Photo/video ≤15s; TTL **24h** от `expires_at`
- Max 1 active story «ring» / user; up to 20 segments
- Viewers list (owner only); no public reply on story launch (DM deep-link optional)
- Music stickers — **не делаем** (Music out of scope)

### Storage
- S3 prefix `stories/{user_id}/{story_id}/`; lifecycle rule delete 48h after expiry
- Table `stories` + `story_views`

**Effort stories:** 6–8 pd.

## 5.7 Notifications

### Channels
| Channel | Use |
|---------|-----|
| In-app Activity | like, follow, mention, reply, repost, system |
| Push | APNs + FCM via Expo; collapse keys per type |
| Email | Только security (login new device, password) — не product digests на launch |

### Prefs (map на MVP `AppSettings`)
`notifications_likes|follows|messages|mentions` + `push_enabled` + quiet hours 23:00–08:00 Europe/Moscow default off.

### Pipeline
```
Domain event → NATS notify.user.{id} → worker
  → check prefs/mute/block
  → insert notifications
  → if push_token: Expo push (batch 100)
  → smart push ranking (Part 6) optional flag
```

**Effort notifications:** 5–7 pd.

## 5.8 Search

### Launch
1. **Users:** trigram `pg_trgm` on `username`, `display_name`; limit 20
2. **Posts:** `tsvector` russian config on `text`; rank by `ts_rank` × recency
3. **Semantic:** pgvector cosine on post embeddings (Part 6/7) behind flag `search_semantic`

### API
`GET /v1/search?q=&type=users|posts|all&cursor=`

Rate: 30/min/user; empty query → recent/trending hashtags (top 20/24h Redis ZSET).

**Effort search:** 5–6 pd (без semantic) + 3 pd semantic wiring.

## 5.9 Риски Part 5

| Риск | Митигация |
|------|-----------|
| Fanout hotspot celebrity | Hybrid push/pull threshold 5k; cache author timelines |
| DM abuse / spam | First-message friction if not mutual follow; report + rate limit |
| Stories storage cost | Lifecycle S3 + max 20 segments; compress video 720p |
| Scope creep Market/Music | Market — Part 10; Music — never on launch |

**Effort breakdown Part 5:** profile 7 · feed 9 · posts 8 · comments 4 · messenger 11 · stories 7 · notifications 6 · search 5 · buffer 4–8 ≈ **45–58 pd**.

---

# Часть 6. Neural / ML features inside product

**Effort:** 38–52 person-days (workers, model I/O, flags, eval harness; без train-from-scratch foundation models).

Общий паттерн: **Go API** публикует job в NATS → **FastAPI AI worker** (как Part 1.6) → пишет результат в PG/Redis → optional webhook/event обратно.

Для каждой фичи: model/API · deploy · latency · cost · fallback.

## 6.1 Recommendations (For You)

| | |
|--|--|
| **Model/API** | Two-tower: user/post embeddings (multilingual-e5-small fine-tune RU) + rules rerank; feature store Redis |
| **Deploy** | AI worker GPU T4 / CPU batch nightly; online scoring CPU; embeddings dim 384 pgvector |
| **Latency** | Offline features <1h freshness; online score p99 ≤50 ms / candidate set 500 |
| **Cost** | ~₽8–15k / month GPU shared @ 50k DAU; embeddings incremental |
| **Fallback** | Chronological Following + engagement heuristics (likes 24h) |

## 6.2 Moderation (NSFW / hate / spam)

| | |
|--|--|
| **Model/API** | Image: OpenNSFW2 / CLIP-based classifier; Text: RU toxic BERT (cointegrated/rubert-tiny-toxicity или аналог 2026) + regex blocklists |
| **Deploy** | FastAPI GPU optional; CPU OK for text; queue `moderation.*` concurrency 8 |
| **Latency** | Text p99 ≤80 ms; image p99 ≤300 ms; video keyframe sample 1 fps ≤2s async |
| **Cost** | ~₽5–12k / month; human moderators ₽/hour separate |
| **Fallback** | Shadow-hide + human queue; if worker down — allow publish + async review (SLA 15 min) для non-media text; media **must** wait or blur |

Scores: `0–1`; auto-reject ≥0.92; review 0.70–0.92; pass <0.70.

## 6.3 Semantic search

| | |
|--|--|
| **Model/API** | `intfloat/multilingual-e5-small` (or bge-m3) embed query/post |
| **Deploy** | Same embed worker; HNSW index pgvector `vector(384)` |
| **Latency** | Embed query ≤40 ms; ANN top-50 ≤30 ms |
| **Cost** | Shared with recommendations |
| **Fallback** | Postgres FTS russian only |

## 6.4 Captions / hashtags

| | |
|--|--|
| **Model/API** | Vision-language (server): BLIP/Russian captioner; hashtags — LLM small (YandexGPT Lite / local Gemma-2B) constrained JSON |
| **Deploy** | Async on media upload; result in `media.alt_text`, `posts.suggested_tags` |
| **Latency** | Async 2–8 s; UI shows skeleton |
| **Cost** | ~₽0.01–0.05 / image; cap 100 gen / user / day |
| **Fallback** | Empty alt; user manual tags; client-side keyword extract |

## 6.5 Smart push

| | |
|--|--|
| **Model/API** | Logistic ranker on features: affinity, hour-of-day, type CTR, fatigue |
| **Deploy** | Redis features + lightweight scorer in notify worker (no GPU) |
| **Latency** | ≤15 ms decision |
| **Cost** | Negligible compute; saves push spend |
| **Fallback** | Rule: always push DM; batch likes (digest 15 min); skip if quiet hours |

## 6.6 Antifraud

| | |
|--|--|
| **Model/API** | Rules + anomaly: device fingerprint hash, IP velocity, graph sudden follows, copy-paste spam Jaccard |
| **Deploy** | Sync checks in Go middleware + async graph jobs |
| **Latency** | Sync ≤5 ms Redis; async 1–5 min |
| **Cost** | Low; SMS cost for step-up auth |
| **Fallback** | Conservative rate limits (Part 2); manual ban tools |

Signals → `risk_score`; ≥0.8 challenge (CAPTCHA/2FA); ≥0.95 auto-lock.

## 6.7 Assistant (compose)

| | |
|--|--|
| **Model/API** | Server: YandexGPT Lite / GigaChat / local LLM; Client: on-device suggestions (typo, tone chips) without sending full draft when possible |
| **Deploy** | Endpoint `POST /v1/ai/compose` streaming SSE; timeout 20s |
| **Latency** | First token ≤1.2 s; full ≤8 s |
| **Cost** | ₽0.2–1 / request; free tier 10/day, Premium unlimited soft-cap 200/day |
| **Fallback** | Disable button; local templates («короче», «нейтрально») |

**Privacy:** drafts not stored >24h; no train on user text without consent flag.

## 6.8 STT (voice → text)

| | |
|--|--|
| **Model/API** | Yandex SpeechKit / Whisper large-v3 RU self-host |
| **Deploy** | Async job for voice messages / video audio track |
| **Latency** | ~0.3–0.5× realtime; show progress |
| **Cost** | SpeechKit ~₽0.16 / 15s; self-host GPU amortize |
| **Fallback** | No transcript; user sees audio only |

## 6.9 Subtitles

| | |
|--|--|
| **Model/API** | STT + forced alignment; VTT stored beside video |
| **Deploy** | Pipeline after video transcode (1080→720/480) |
| **Latency** | Async minutes; notify when ready |
| **Cost** | STT + CPU align ~₽1–3 / min video |
| **Fallback** | Video without subs; burn-in not required launch |

## 6.10 Face detection

| | |
|--|--|
| **Model/API** | ScrFD / MediaPipe Face Detection — **bounding boxes only**, no recognition gallery |
| **Deploy** | On upload worker; optional client Expo ML Kit for story face blur UI |
| **Latency** | ≤100 ms / image server |
| **Cost** | CPU negligible |
| **Fallback** | Skip auto-crop; center crop |

**152-ФЗ note:** не строим biometric identification; только detection для UX (focus crop, blur). Explicit consent if later «tag people».

## 6.11 ML platform checklist

- Feature flags: `ml_foryou`, `ml_semantic`, `ml_compose`, `ml_smart_push`, …
- Eval: shadow mode 7d before full on; metrics AUC / precision@k / human agree rate
- PII: strip phone/email before LLM; prompt injection filters
- Observability: model_version label on metrics

## 6.12 Риски Part 6

| Риск | Митигация |
|------|-----------|
| GPU cost overrun | CPU models first; batch off-peak; cache embeddings |
| False positive bans | Human appeal queue <24h; dual threshold |
| LLM provider RF outage | Multi-provider adapter (YandexGPT ↔ GigaChat ↔ local) |
| Over-scope assistant | Soft-cap free tier; Premium Part 10 |

**Effort breakdown Part 6:** moderation 8 · embeddings+reco 10 · semantic 4 · captions 4 · smart push 3 · antifraud 5 · assistant 6 · STT/subs 5 · face 2 · buffer 4–8 ≈ **38–52 pd**.

---

# Часть 7. Database & storage

**Effort:** 22–30 person-days (DDL, migrations, indexes, backup drills, partition plan).

## 7.1 Принципы
- PostgreSQL **16** (YC MDB), charset UTF8, locale `ru_RU.UTF-8`
- PK: ULIDs/`uuidv7` as `TEXT` or `UUID` — выбор: **`UUID` v7** для sortability
- Soft-delete где user content; hard FK restrict на money tables
- Migrations: **goose** или golang-migrate; expand/contract; never edit applied
- Redis: sessions, rate limit, presence, hot feed; **не** source of truth
- S3: media originals + derivatives; DB stores keys/metadata only

## 7.2 ER (ключевые связи)

```
users 1──* posts
users 1──* follows (as follower / following)
posts 1──* post_likes
posts 1──* comments (posts.reply_to_id self-FK)
users 1──* conversations_participants *──1 conversations 1──* messages
users 1──* stories 1──* story_views
users 1──* notifications
posts 1──* post_embeddings
media 1──* post_media *──1 posts
```

## 7.3 SQL DDL (samples)

```sql
-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'banned', 'deleted');
CREATE TYPE media_kind AS ENUM ('image', 'video', 'audio');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read');

CREATE TABLE users (
  id              UUID PRIMARY KEY,
  username        CITEXT NOT NULL,
  display_name    TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
  email           CITEXT UNIQUE,
  phone_e164      TEXT UNIQUE,
  password_hash   TEXT, -- null if OAuth-only
  avatar_key      TEXT,
  bio             TEXT CHECK (char_length(bio) <= 160),
  status          user_status NOT NULL DEFAULT 'active',
  is_private      BOOLEAN NOT NULL DEFAULT FALSE,
  show_activity   BOOLEAN NOT NULL DEFAULT TRUE,
  allow_messages  TEXT NOT NULL DEFAULT 'everyone'
                  CHECK (allow_messages IN ('everyone','followers','none')),
  followers_count INT NOT NULL DEFAULT 0,
  following_count INT NOT NULL DEFAULT 0,
  posts_count     INT NOT NULL DEFAULT 0,
  session_ver     INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_username_uidx ON users (username) WHERE deleted_at IS NULL;
CREATE INDEX users_username_trgm_idx ON users USING gin (username gin_trgm_ops);
CREATE INDEX users_displayname_trgm_idx ON users USING gin (display_name gin_trgm_ops);

CREATE TABLE oauth_accounts (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL, -- vk|yandex|apple|google|telegram
  provider_uid  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE follows (
  follower_id  UUID NOT NULL REFERENCES users(id),
  following_id UUID NOT NULL REFERENCES users(id),
  state        TEXT NOT NULL DEFAULT 'active'
               CHECK (state IN ('active','pending')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX follows_following_idx ON follows (following_id, state);

CREATE TABLE blocks (
  blocker_id UUID NOT NULL REFERENCES users(id),
  blocked_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE media (
  id           UUID PRIMARY KEY,
  owner_id     UUID NOT NULL REFERENCES users(id),
  kind         media_kind NOT NULL,
  s3_key       TEXT NOT NULL,
  s3_bucket    TEXT NOT NULL,
  width        INT,
  height       INT,
  duration_ms  INT,
  bytes        BIGINT,
  mime         TEXT NOT NULL,
  alt_text     TEXT,
  mod_score    REAL,
  mod_status   TEXT NOT NULL DEFAULT 'pending'
               CHECK (mod_status IN ('pending','pass','review','reject')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_owner_idx ON media (owner_id, created_at DESC);

CREATE TABLE posts (
  id              UUID PRIMARY KEY,
  author_id       UUID NOT NULL REFERENCES users(id),
  text            TEXT NOT NULL DEFAULT '' CHECK (char_length(text) <= 500),
  reply_to_id     UUID REFERENCES posts(id),
  root_id         UUID REFERENCES posts(id), -- thread root
  quote_id        UUID REFERENCES posts(id),
  visibility      TEXT NOT NULL DEFAULT 'public'
                  CHECK (visibility IN ('public','followers','mentioned')),
  likes_count     INT NOT NULL DEFAULT 0,
  reposts_count   INT NOT NULL DEFAULT 0,
  replies_count   INT NOT NULL DEFAULT 0,
  mod_status      TEXT NOT NULL DEFAULT 'pass',
  lang            TEXT DEFAULT 'ru',
  tsv             TSVECTOR,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX posts_author_created_idx ON posts (author_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX posts_reply_to_idx ON posts (reply_to_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX posts_tsv_idx ON posts USING gin (tsv);
CREATE INDEX posts_created_idx ON posts (created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE post_media (
  post_id   UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id  UUID NOT NULL REFERENCES media(id),
  position  SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, media_id)
);

CREATE TABLE post_likes (
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_likes_user_idx ON post_likes (user_id, created_at DESC);

CREATE TABLE post_reposts (
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE home_timeline (
  user_id    UUID NOT NULL,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  scored_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id, scored_at)
) PARTITION BY RANGE (scored_at);
-- monthly partitions via goose scripts

CREATE TABLE conversations (
  id              UUID PRIMARY KEY,
  is_group        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ
);

CREATE TABLE conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  muted           BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_at    TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id);

CREATE TABLE messages (
  id               UUID PRIMARY KEY,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        UUID NOT NULL REFERENCES users(id),
  body_ciphertext  BYTEA, -- AES-GCM payload or plaintext bytes phase1
  body_text        TEXT,  -- if not E2EE; prefer one representation
  media_id         UUID REFERENCES media(id),
  reply_to_id      UUID REFERENCES messages(id),
  status           message_status NOT NULL DEFAULT 'sent',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX messages_conv_created_idx ON messages (conversation_id, created_at DESC);

CREATE TABLE stories (
  id          UUID PRIMARY KEY,
  author_id   UUID NOT NULL REFERENCES users(id),
  media_id    UUID NOT NULL REFERENCES media(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  views_count INT NOT NULL DEFAULT 0
);
CREATE INDEX stories_author_exp_idx ON stories (author_id, expires_at);
CREATE INDEX stories_expires_idx ON stories (expires_at);

CREATE TABLE story_views (
  story_id   UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id  UUID NOT NULL REFERENCES users(id),
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  actor_id    UUID REFERENCES users(id),
  type        TEXT NOT NULL,
  post_id     UUID REFERENCES posts(id),
  payload     JSONB NOT NULL DEFAULT '{}',
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);

CREATE TABLE push_tokens (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id),
  token      TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE post_embeddings (
  post_id     UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  embedding   vector(384) NOT NULL,
  model       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX post_embeddings_hnsw ON post_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   UUID,
  action     TEXT NOT NULL,
  ip         INET,
  meta       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- trigger example: maintain tsv
CREATE FUNCTION posts_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('russian', coalesce(NEW.text, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER posts_tsv_trg BEFORE INSERT OR UPDATE OF text ON posts
  FOR EACH ROW EXECUTE FUNCTION posts_tsv_update();
```

### Monetization-related (preview Part 10)

```sql
CREATE TABLE products (
  id          UUID PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE, -- premium_monthly, …
  title       TEXT NOT NULL,
  price_rub   INT NOT NULL, -- kopecks
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE payments (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id),
  provider        TEXT NOT NULL, -- yukassa|tinkoff|cloudpayments|sbp
  provider_payment_id TEXT,
  amount_rub      INT NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'RUB',
  status          TEXT NOT NULL, -- pending|succeeded|failed|refunded
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);
CREATE UNIQUE INDEX payments_provider_uidx ON payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
```

## 7.4 Migrations
- Directory `db/migrations/YYYYMMDDHHMMSS_name.sql`
- CI: `goose up` on ephemeral PG; `goose down` smoke for last N
- Policy: expand (add nullable) → deploy app → backfill → constrain → contract (drop)
- Seed: `db/seeds/dev.sql` — не prod

## 7.5 Sharding / replication

| Stage | Strategy |
|-------|----------|
| 0–100k MAU | Single primary + async replica (read feed/search); HA YC |
| 100k–1M | Partition `home_timeline`, `messages`, `notifications` by month; read replicas 2+ |
| 1M+ | Consider Citus / shard by `user_id` hash for timeline; extract messaging — **not before metrics say so** |

**Replication:** sync not required; RPO ≤ 5 min (PITR); RTO ≤ 30 min runbook.  
**Redis:** cluster optional; start standalone HA.  
**S3:** versioning on; cross-replica Selectel DR async weekly.

## 7.6 Gap vs MVP
Типы `User/Post/Message` → нормализованные таблицы; likes arrays → `post_likes`; нет stories/notifications/embeddings/payments tables.

## 7.7 Риски Part 7

| Риск | Митигация |
|------|-----------|
| pgvector HNSW RAM | Partial index recent 90d; rebuild offline |
| Counter races | Atomic `UPDATE … SET likes_count = likes_count + 1` + periodic reconcile |
| Migration lock | Concurrent indexes `CREATE INDEX CONCURRENTLY` in expand |

**Effort breakdown Part 7:** schema+goose 8 · indexes/triggers 4 · partitions 4 · backup/DR drill 3 · seed/tooling 2 · buffer 3–6 ≈ **22–30 pd**.

---

# Часть 8. Performance & optimization

**Effort:** 16–22 person-days (budgets, caching, profiling setup, mobile perf pass).

## 8.1 Backend

| Area | Target / technique |
|------|--------------------|
| API p99 read | ≤150 ms (ex-media) |
| API p99 write | ≤300 ms |
| DB | pgx pool 20–40; prepared statements; avoid N+1 (join/dataloader) |
| Cache | Redis feed 30s; user card 60s; negative cache 10s |
| Fanout | Async NATS; never block HTTP on celebrity fanout |
| Payload | JSON field filter `?fields=`; gzip/br at edge |
| Hot path | `GET /v1/feed` — single SQL + Redis; zero LLM sync |

**Tools:** pprof, `go tool trace`, OpenTelemetry traces, `pg_stat_statements`, EXPLAIN ANALYZE in staging.

## 8.2 Frontend (Web)

| Area | Target |
|------|--------|
| LCP app shell | ≤2.5 s 4G |
| INP | ≤200 ms |
| Bundle | route-based split; React `lazy`; vendor chunk <180 KB gz |
| List | virtualize feed (`@tanstack/virtual`) window 12 |
| Images | CDN AVIF/WebP srcset; blurhash placeholder |
| Cache | TanStack Query staleTime 30s feed; persist IndexedDB optional |

**Tools:** Lighthouse CI, Web Vitals RUM (own endpoint), React Profiler, Bundle Analyzer.

## 8.3 Mobile (Expo)

| Area | Target |
|------|--------|
| TTI cold | ≤3 s mid-device |
| JS FPS | 55+ scroll |
| Images | `expo-image` disk cache; memory cap |
| Lists | FlashList |
| App size | OTA for JS; native binary <60 MB IPA uncompressed target |
| Battery | WS backoff; presence heartbeat 45s |

**Tools:** React Native perf monitor, Flipper/network, Xcode Instruments, Android Profiler, Sentry performance.

## 8.4 Profiling playbook
1. Define SLOs → burn alerts
2. Weekly flamegraph on staging loadtest (k6 500 RPS feed)
3. Budget PR check: bundle size + goose migration time
4. Chaos: kill AI worker — feed must live

## 8.5 Риски Part 8

| Риск | Митигация |
|------|-----------|
| Premature micro-optim | Measure first; pprof gate |
| Cache stampede | Singleflight + jitter TTL |
| Mobile OOM images | Downscale; max concurrency 4 |

**Effort:** budgets+k6 4 · FE virtualize/images 4 · RN FlashList/perf 4 · observability dashboards 3 · buffer ≈ **16–22 pd**.

---

# Часть 9. Testing

**Effort:** 18–24 person-days (harness, critical suites, envs, flags).

## 9.1 Backend
| Layer | Tool | Coverage target |
|-------|------|-----------------|
| Unit | Go testing + testify | ≥70% packages auth/feed/msg |
| Integration | testcontainers PG/Redis/NATS | Critical repos + migrations |
| Contract | OpenAPI spectaql / newman | All public routes smoke |
| Load | k6 | Feed 500 RPS, chat 200 RPS WS |
| Security | govulncheck, semgrep | CI gate |

## 9.2 Frontend
| Layer | Tool | Target |
|-------|------|--------|
| Unit | Vitest | utils/store ≥80% |
| Component | Testing Library + Storybook | core UI |
| E2E | Playwright | login → feed → compose → like |
| Visual | Chromatic / Loki | design system |

## 9.3 Mobile
| Layer | Tool |
|-------|------|
| Unit | Jest |
| Component | RNTL |
| E2E | Maestro / Detox on EAS |
| Device matrix | iPhone 13 / 15; Pixel 7; Android API 28+ |

## 9.4 Coverage & quality gates
- CI red if: unit < threshold, `go test` race fail, e2e smoke fail, lighthouse pwa regress >10%
- Mutation testing — optional phase 2 on auth only

## 9.5 Environments

| Env | Data | Purpose |
|-----|------|---------|
| `local` | docker-compose | Dev |
| `ci` | ephemeral | PR |
| `staging` | anonymized subset | QA + canary twin |
| `prod` | real | |
| `prod-canary` | 5–10% users | New API version |

## 9.6 Canary & feature flags
- Flags: Unleash / GrowthBook / custom Redis (`flags:{key}`)
- Canary deploy: 5% → 25% → 100%; auto-rollback on error rate >2× baseline or p99 >2×
- Kill switches: `ml_foryou`, `stories`, `payments`, `ws_gateway`

## 9.7 Gap vs MVP
Сейчас: нет тестов backend; frontend минимум. → Ввести с Part 1 skeleton.

## 9.8 Риски Part 9

| Риск | Митигация |
|------|-----------|
| Flaky e2e | Quarantine + retry 1; deterministic seeds |
| Staging ≠ prod | Infra as code parity; synthetic probes |

**Effort:** BE suites 6 · FE/e2e 5 · mobile 4 · flags/canary 3 · buffer ≈ **18–24 pd**.

---

# Часть 10. Monetization & analytics

**Effort:** 20–28 person-days (payments adapters, premium, ads MVP, metrics, A/B).

## 10.1 Revenue streams (launch+)

| Stream | Phase | Notes |
|--------|-------|-------|
| **Premium** | P1.5 | Ad-light, badge, compose AI limits↑, longer video 3 min |
| **Ads** | P2 | Feed native ads 1 per 8 organic; Market placements |
| **Market take rate** | P2 | Catalog already in MVP UI; checkout + 5–10% fee |
| **Music** | — | **Не монетизируем / не запускаем** |

### Premium SKU (пример)
| SKU | Price | Period |
|-----|-------|--------|
| `premium_monthly` | 199 ₽ | 30d |
| `premium_yearly` | 1 990 ₽ | 365d (~17% off) |

## 10.2 RF payments

| Provider | Use | Integration |
|----------|-----|-------------|
| **ЮKassa** | Cards, primary | Checkout API + webhooks `payment.succeeded` |
| **Tinkoff Acquiring** | Cards alt / credit | Notification URL HMAC |
| **CloudPayments** | Cards, recurrent Premium | Widget + recurrent |
| **СБП** | Instant bank pay | Via ЮKassa or direct NSPK partner |

### Flow
```
Client → POST /v1/payments/intent {sku}
API → provider create payment → return confirmation_url / sdk payload
Provider webhook → verify signature → payments.status=succeeded
     → grant entitlement (premium_until)
Idempotency-Key on intent; unique (provider, provider_payment_id)
```

### Concrete
- Currency **RUB** only launch
- Receipts 54-ФЗ: provider side (ЮKassa/CloudPayments облачная касса)
- Refunds: admin tool + provider API; SLA 3–10 bank days
- PCI: **no** card data on Hub servers (redirect/widget)

## 10.3 Ads MVP
- `ad_campaigns`, `ad_creatives` tables (phase 2 DDL)
- Targeting: age band, interests from follows (consent), geo RF region
- Frequency cap 3 impressions / user / day / advertiser
- Brand safety: reuse moderation pipeline

## 10.4 Analytics & metrics

### Product KPIs
| Metric | Target early |
|--------|--------------|
| DAU/MAU | ≥0.25 |
| D1 / D7 retention | ≥40% / ≥20% |
| Posts / DAU | ≥0.3 |
| Feed→open profile CTR | ≥8% |
| Time to first post | ≤24h for 50% new users |
| Crash-free sessions | ≥99.5% |

### Tech SLIs (tie Part 11 SLO)
- API availability, feed latency, push delivery rate ≥95%

### Stack
- Events: `track(event, props)` → NATS `analytics.raw` → ClickHouse or PG rollups (start PG daily aggregates)
- Client: own minimal SDK web/RN; **не** слать ПДн в зарубежные SaaS без договора; допустим Yandex AppMetrica / собственный
- Funnel tables: `events_daily(user_bucket, event, count)`

### Core events
`auth_login`, `post_create`, `feed_impression`, `post_like`, `dm_send`, `story_view`, `search_query`, `pay_intent`, `pay_success`, `ad_impression`, `ad_click`

## 10.5 A/B
- Assign `bucket = hash(user_id, exp_id) % 100`
- Experiments table; analysis CUPED optional later
- Max 3 concurrent experiments / surface
- Guardrails: retention, report rate, latency

## 10.6 Gap vs MVP
Market UI без оплаты; нет entitlements/ads/analytics pipeline.

## 10.7 Риски Part 10

| Риск | Митигация |
|------|-----------|
| Webhook replay / fraud | Signature + idempotency + amount match sku |
| Provider outage | Multi-acquirer failover order: ЮKassa → CloudPayments → Tinkoff |
| Ad backlash | Clear labeling «Реклама»; Premium ad-light |
| 54-ФЗ mistakes | Use provider fiscalization; accountant review |

**Effort:** payments adapters 8 · premium entitlements 4 · ads MVP 5 · analytics+A/B 5 · buffer ≈ **20–28 pd**.

---

# Часть 11. Release & post-release

**Effort:** 14–20 person-days (checklists, compliance docs, store assets, on-call, SLO dashboards).

## 11.1 Pre-release checklist

### Engineering
- [ ] Migrations applied + rollback rehearsed
- [ ] Feature flags default safe
- [ ] Load test report attached
- [ ] Sentry/OTel/alerts green on staging
- [ ] Backup restore drill <30 days old
- [ ] Secrets in Lockbox; no secrets in images
- [ ] Dependency audit clean (Critical=0)

### Product / Legal
- [ ] Политика конфиденциальности + Пользовательское соглашение (RU)
- [ ] Cookie/consent banner (web)
- [ ] Возрастной рейтинг / parental copy
- [ ] DMCA/report contacts; moderator runbook
- [ ] Music **не** включён в билд / store copy

### Stores
- [ ] Apple App Store: Sign in with Apple, privacy nutrition labels
- [ ] Google Play: Data safety form
- [ ] **RuStore** (обязательный канал РФ 2026): package, screenshots, 152-ФЗ link
- [ ] Deep links `hub.ru` / `app.hub.ru` verified

## 11.2 152-ФЗ
| Requirement | Implementation |
|-------------|----------------|
| Хранение ПДн в РФ | Yandex Cloud / Selectel regions RU |
| Согласие | Checkbox register + versioned `consents` table |
| Минимизация | Не требовать phone если email+OAuth |
| Доступ / удаление | `DELETE /v1/me` → soft delete + purge job 30d (messages anonymize) |
| Поручение обработки | DPA с провайдерами AI/push/payments |
| Breach notify | Runbook 24–72h; contacts Роскомнадзор per counsel |
| Cookie | Consent categories; reject non-essential |

## 11.3 On-call & ops
- Rotation: primary + secondary, 24/7 after public launch; business-hours until 10k MAU acceptable with pager best-effort
- Pager: Telegram/Slack + SMS; severity Sev1–Sev4
- Runbooks: DB failover, Redis flush mistake, WS stampede, payment webhook lag, moderation backlog
- War room channel `#hub-incidents`

## 11.4 SLO / SLA (prod)

| SLI | SLO | Alert |
|-----|-----|-------|
| Availability API | 99.9% monthly | 5xx >1% / 5min |
| Feed latency p99 | ≤400 ms | burn rate |
| Auth login success | ≥99% | |
| Push delivery (provider accepted) | ≥95% | |
| WS connect success | ≥99% | |
| RPO / RTO | 5 min / 30 min | |

Error budget policy: freeze features if budget <25% remaining month.

## 11.5 Post-release (first 30 days)
- Day 0: canary 10% → 100% in 4h if green
- Daily: retention, crash-free, report volume, payment success rate
- Weekly: security review of new endpoints; ML false-positive rate
- Hotfix train: store expedite process documented

## 11.6 Риски Part 11

| Риск | Митигация |
|------|-----------|
| Store rejection | Pre-check Privacy / Sign in with Apple / RuStore docs |
| 152-ФЗ misconfig region | Terraform deny non-RU; audit quarterly |
| On-call burnout | Severity hygiene; follow-the-sun later |

**Effort:** legal/docs 4 · store submissions 4 · SLO/alerts/runbooks 4 · drills 2 · buffer ≈ **14–20 pd**.

---

## Сводка effort Parts 5–11

| Part | Person-days | Зависит от |
|------|-------------|------------|
| 5 Core product | 45–58 | Parts 1–3 (API), 4 (UI) |
| 6 Neural/ML | 38–52 | 5 events + 7 embeddings schema; Part 1 workers |
| 7 Database & storage | 22–30 | Part 1; **блокирует** 5 |
| 8 Performance | 16–22 | 5 + baseline traffic |
| 9 Testing | 18–24 | параллельно с 5–7 |
| 10 Monetization & analytics | 20–28 | 5 Market/Premium; 7 payments DDL |
| 11 Release & post-release | 14–20 | всё к launch |
| **Итого 5–11** | **~173–234** | |
| **Итого 1–11** | **~241–324** | Parts 1–4: 68–90 |

*Примечание:* верхняя оценка gap в начале (~210–280 на 5–11) согласуется с серединой/верхом диапазона при параллелизации.

---

## Приоритизированный roadmap (Parts 1–11)

```
Фаза A — Foundation (параллель)
  Part 1 Architecture & stack ████████░░░░
  Part 4 Design system      ████████░░░░  (parallel)
  Part 7 DB schema+migrations ████████░░  (после skeleton API)
  Part 9 Test harness       ████░░░░░░░░  (CI green path)
        ↓
Фаза B — Security & API
  Part 2 Auth & security    ██████████░░
  Part 3 API design         ████████░░░░
        ↓
Фаза C — Core product (P0)
  Part 5: Profile → Posts/Comments → Feed → Notifications
  Part 5: Search FTS
  Part 8: early budgets on feed path
        ↓
Фаза D — Engagement (P1)
  Part 5: Messenger + WS
  Part 5: Stories
  Part 6: Moderation + Antifraud (до роста UGC)
        ↓
Фаза E — Intelligence & money (P2)
  Part 6: Embeddings, For You, semantic search
  Part 6: Captions, smart push, assistant (flagged)
  Part 6: STT/subs/face as media matures
  Part 10: Payments + Premium; ads later
  Part 8: full perf pass + k6
        ↓
Фаза F — Launch
  Part 11: 152-ФЗ, stores (RuStore/App Store/Play), on-call, SLO
  Part 9: canary + flags freeze
  Part 10: analytics dashboards live
```

### Приоритеты launch-cut

| Must ship (P0) | Should (P1) | Later (P2) |
|----------------|-------------|------------|
| Auth JWT/OAuth, Profile, Posts, Feed Following, Comments, basic Notify in-app, FTS search, moderation text+image, 152-ФЗ, RuStore+iOS | Messenger, Stories, Push, Expo apps parity, hybrid fanout, antifraud | For You ML, semantic search, Premium/ads, assistant, STT/subs, Market checkout |

### Критический путь (сжатый)
**1 → 7 → 2 → 3 → 5(P0) → 6(moderation) → 11**  
Параллель: **4**, **9**, затем **8**, **10**, остальной **6**.

### Out of scope (подтверждение)
- **Music** / аудио-стикеры / music charts — не планируется  
- E2EE мессенджер — post-launch ADR  
- Groups chat, long video, global CDN ПДн вне РФ — нет

---

## Риски программы (сквозные)

| Риск | Митигация |
|------|-----------|
| Оценка 241–324 pd растянется | Жёсткий P0 cut; flags; modular monolith без раннего split |
| AI cost | Fallback rules; soft caps; Premium gate |
| Compliance delay stores | Юрист с Фазы A; RuStore параллельно Apple |
| MVP localStorage habit | Feature freeze UI; переключить store на API client рано (после Part 3) |

---

*Конец Parts 5–11. Документ согласован со стеком Parts 1–4: Go/chi, Postgres+Redis+S3+NATS, Expo, Next+React, JWT hybrid, Hub Threads-like, Россия 2026, без Music.*
