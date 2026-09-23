-- N5: Stories 24h MVP
CREATE TABLE IF NOT EXISTS stories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL DEFAULT '',
    media_url   TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stories_author_created
  ON stories (author_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stories_expires
  ON stories (expires_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS story_views (
    story_id   UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, viewer_id)
);
