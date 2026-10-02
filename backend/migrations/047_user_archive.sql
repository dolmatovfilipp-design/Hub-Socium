-- User-curated archive (posts, messages, contacts, listings, photo/video refs).
CREATE TABLE IF NOT EXISTS user_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('post', 'message', 'contact', 'listing', 'photo', 'video')),
  ref_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_type, ref_id)
);

CREATE INDEX IF NOT EXISTS user_archive_user_created_idx
  ON user_archive (user_id, created_at DESC);
