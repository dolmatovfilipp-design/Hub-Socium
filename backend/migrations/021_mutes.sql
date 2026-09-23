-- N8: mutes (hide from feed/activity/push without unfollow/block)
CREATE TABLE IF NOT EXISTS mutes (
    muter_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (muter_id, muted_id),
    CHECK (muter_id <> muted_id)
);

CREATE INDEX IF NOT EXISTS idx_mutes_muted ON mutes (muted_id);

-- Optional conversation mute
CREATE TABLE IF NOT EXISTS conversation_mutes (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, conversation_id)
);
