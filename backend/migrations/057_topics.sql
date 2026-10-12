-- Block 7 / item 6: forum-style topics in groups.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS topics_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS conversation_topics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 64),
  icon            TEXT NOT NULL DEFAULT '',
  color           TEXT NOT NULL DEFAULT 'blue',
  is_general      BOOLEAN NOT NULL DEFAULT false,
  closed_at       TIMESTAMPTZ,
  pinned_at       TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_topics_general
  ON conversation_topics (conversation_id) WHERE is_general;
CREATE INDEX IF NOT EXISTS idx_conversation_topics_conv ON conversation_topics (conversation_id);

-- NULL topic_id = the «Общее» (general) topic, so legacy/forwarded/bot messages land there.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES conversation_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_topic_created
  ON messages (topic_id, created_at DESC) WHERE topic_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_topic_reads (
  topic_id     UUID NOT NULL REFERENCES conversation_topics(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (topic_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversation_topic_mutes (
  topic_id   UUID NOT NULL REFERENCES conversation_topics(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_topic_mutes_user ON conversation_topic_mutes (user_id);
