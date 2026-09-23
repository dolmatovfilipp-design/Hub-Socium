-- S17: Post view stats
ALTER TABLE posts ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS post_views (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    viewer_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_views_post ON post_views (post_id, viewed_at DESC);
