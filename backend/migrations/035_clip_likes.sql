-- P2: Clip likes
CREATE TABLE IF NOT EXISTS clip_likes (
    clip_id    UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (clip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_clip_likes_user
  ON clip_likes (user_id, created_at DESC);
