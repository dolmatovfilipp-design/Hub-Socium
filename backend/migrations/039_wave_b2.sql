-- WAVE B2: disappearing msgs, scheduled DM, presence, quiet favorites,
-- verified mod flag (column exists), attention gifts, story reply quote

-- T2 disappearing messages (per conversation)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS disappear_hours INT NULL,
  ADD COLUMN IF NOT EXISTS disappear_after_read BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_messages_expires
  ON messages (expires_at)
  WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

-- T3 scheduled DM
CREATE TABLE IF NOT EXISTS scheduled_dms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL DEFAULT '',
  media_url       TEXT NOT NULL DEFAULT '',
  msg_type        TEXT NOT NULL DEFAULT 'text',
  scheduled_at    TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scheduled_dms_due
  ON scheduled_dms (scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;

-- T7 profile status
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS presence_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS presence_text TEXT NOT NULL DEFAULT '';

-- T11 quiet hours: favorites still get through
ALTER TABLE notification_prefs
  ADD COLUMN IF NOT EXISTS quiet_allow_favorites BOOLEAN NOT NULL DEFAULT true;

-- T12 verified already on users (033); ensure column
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;

-- T13 attention gifts (no payments)
CREATE TABLE IF NOT EXISTS attention_gifts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id      UUID REFERENCES posts(id) ON DELETE CASCADE,
  sticker      TEXT NOT NULL DEFAULT '✨',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attention_gifts_once_post
  ON attention_gifts (from_user_id, post_id)
  WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attention_gifts_once_profile
  ON attention_gifts (from_user_id, to_user_id)
  WHERE post_id IS NULL;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS attention_count INT NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS attention_count INT NOT NULL DEFAULT 0;

-- T20 story reply quote on DM
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES stories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS story_quote JSONB;
