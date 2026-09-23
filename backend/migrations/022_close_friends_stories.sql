-- S2: Close friends + story audience
CREATE TABLE IF NOT EXISTS close_friends (
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, friend_id),
    CHECK (owner_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS idx_close_friends_friend ON close_friends (friend_id);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_audience_check') THEN
    ALTER TABLE stories ADD CONSTRAINT stories_audience_check CHECK (audience IN ('all', 'close_friends'));
  END IF;
END $$;
