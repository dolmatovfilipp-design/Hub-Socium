-- Block 5: channel post comments/reactions/views, direct multipart uploads,
-- location/contact messages, story reactions.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS channel_post_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES channel_posts(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    reply_to_id UUID REFERENCES channel_post_comments(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cpc_post_created ON channel_post_comments (post_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cpc_author_created ON channel_post_comments (author_id, created_at);

CREATE TABLE IF NOT EXISTS channel_post_reactions (
    post_id    UUID NOT NULL REFERENCES channel_posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS channel_post_views (
    post_id   UUID NOT NULL REFERENCES channel_posts(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS media_uploads (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    s3_key       TEXT NOT NULL,
    upload_id    TEXT NOT NULL,
    content_type TEXT NOT NULL,
    filename     TEXT NOT NULL DEFAULT '',
    size         BIGINT NOT NULL,
    part_size    BIGINT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    aborted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_media_uploads_open ON media_uploads (created_at) WHERE completed_at IS NULL AND aborted_at IS NULL;

ALTER TABLE media ADD COLUMN IF NOT EXISTS filename TEXT NOT NULL DEFAULT '';
ALTER TABLE media ALTER COLUMN bytes TYPE BIGINT;

CREATE TABLE IF NOT EXISTS story_reactions (
    story_id   UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, user_id)
);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_msg_type_check
  CHECK (msg_type IN ('text','voice','image','video_note','video','file','call','sticker','gif','poll','location','contact'));
