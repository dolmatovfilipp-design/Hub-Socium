-- User presence / last seen for chat and follower lists
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_seen_at
  ON users (last_seen_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;
