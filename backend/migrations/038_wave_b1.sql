-- WAVE B1: multi-photo, polls, bookmark folders, pinned message, saved messages

CREATE TABLE IF NOT EXISTS post_images (
    post_id  UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    position INT  NOT NULL DEFAULT 0,
    url      TEXT NOT NULL,
    PRIMARY KEY (post_id, position),
    CHECK (position >= 0 AND position < 10)
);

CREATE TABLE IF NOT EXISTS polls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
    channel_post_id UUID UNIQUE REFERENCES channel_posts(id) ON DELETE CASCADE,
    question        TEXT NOT NULL,
    multi           BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
      (post_id IS NOT NULL AND channel_post_id IS NULL)
      OR (post_id IS NULL AND channel_post_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS poll_options (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id  UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    label    TEXT NOT NULL,
    position INT  NOT NULL DEFAULT 0,
    CHECK (char_length(label) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options (poll_id, position);

CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id   UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (poll_id, user_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_option ON poll_votes (option_id);

CREATE TABLE IF NOT EXISTS bookmark_folders (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name),
    CHECK (char_length(name) BETWEEN 1 AND 60)
);

ALTER TABLE post_bookmarks
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES bookmark_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_post_bookmarks_folder
  ON post_bookmarks (user_id, folder_id, created_at DESC);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_saved BOOLEAN NOT NULL DEFAULT false;

