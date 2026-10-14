-- Live batch: chat AI prefs, reminders, view-once, group threads,
-- seller drafts, in-chat orders, paid channels.

ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS auto_translate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS translate_lang TEXT NOT NULL DEFAULT '';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS view_once BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thread_root_id UUID REFERENCES messages(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_messages_thread_root
  ON messages (thread_root_id)
  WHERE thread_root_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS message_views (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS reply_reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
  note            TEXT NOT NULL DEFAULT '',
  remind_at       TIMESTAMPTZ NOT NULL,
  fired_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reply_reminders_due
  ON reply_reminders (remind_at)
  WHERE fired_at IS NULL;

CREATE TABLE IF NOT EXISTS seller_reply_drafts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seller_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_message_id UUID,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'sent', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_seller_drafts_conv
  ON seller_reply_drafts (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seller_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id          UUID REFERENCES messages(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  amount_minor        INT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'RUB',
  status              TEXT NOT NULL DEFAULT 'pending',
  provider_payment_id TEXT NOT NULL DEFAULT '',
  confirmation_url    TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ,
  CHECK (status IN ('pending', 'paid', 'cancelled')),
  CHECK (amount_minor > 0)
);

CREATE INDEX IF NOT EXISTS idx_chat_orders_conv
  ON chat_orders (conversation_id, created_at DESC);

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS price_minor INT NOT NULL DEFAULT 0;

ALTER TABLE channel_posts
  ADD COLUMN IF NOT EXISTS price_minor INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS channel_subscriptions (
  channel_id          UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'pending',
  provider_payment_id TEXT NOT NULL DEFAULT '',
  confirmation_url    TEXT NOT NULL DEFAULT '',
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id),
  CHECK (status IN ('pending', 'active', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS channel_post_unlocks (
  post_id             UUID NOT NULL REFERENCES channel_posts(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_payment_id TEXT NOT NULL DEFAULT '',
  confirmation_url    TEXT NOT NULL DEFAULT '',
  paid_at             TIMESTAMPTZ,
  PRIMARY KEY (post_id, user_id)
);
