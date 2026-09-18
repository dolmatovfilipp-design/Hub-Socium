-- Local disk media metadata + optional post image URL (DB stores paths only)
CREATE TABLE IF NOT EXISTS media (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type  TEXT NOT NULL,
    bytes         INT NOT NULL,
    storage_name  TEXT NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_user_created ON media(user_id, created_at DESC);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
