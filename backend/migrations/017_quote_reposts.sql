-- N2: quote-reposts — quote_text on post_reposts + optional quote post link
ALTER TABLE post_reposts ADD COLUMN IF NOT EXISTS quote_text TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS repost_of UUID REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_posts_repost_of ON posts (repost_of) WHERE repost_of IS NOT NULL;
