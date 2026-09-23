-- S3: Short vertical video clips
CREATE TABLE IF NOT EXISTS clips (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption     TEXT NOT NULL DEFAULT '',
    media_url   TEXT NOT NULL,
    duration_ms INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_clips_created
  ON clips (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clips_author
  ON clips (author_id, created_at DESC)
  WHERE deleted_at IS NULL;
