-- N1: durable mention records (posts + DMs)
CREATE TABLE IF NOT EXISTS mentions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentioned_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     UUID REFERENCES posts(id) ON DELETE CASCADE,
    message_id  UUID REFERENCES messages(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (post_id IS NOT NULL OR message_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_mentions_mentioned_created
  ON mentions (mentioned_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mentions_post ON mentions (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mentions_message ON mentions (message_id) WHERE message_id IS NOT NULL;
