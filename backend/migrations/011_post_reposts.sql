-- Plain reposts (Threads-lite): user X reposted post Y
CREATE TABLE IF NOT EXISTS post_reposts (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reposts_user_created
  ON post_reposts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_reposts_post
  ON post_reposts (post_id);
