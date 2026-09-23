-- N6: drafts + scheduled posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_status_check') THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_status_check
      CHECK (status IN ('draft', 'scheduled', 'published'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_scheduled
  ON posts (scheduled_at)
  WHERE status = 'scheduled' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_author_status
  ON posts (author_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
