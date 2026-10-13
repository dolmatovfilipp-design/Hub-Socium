-- Block 6: voice transcription, translation cache, bots & mini-apps.

CREATE TABLE IF NOT EXISTS message_transcripts (
    message_id   UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
    text         TEXT NOT NULL DEFAULT '',
    provider     TEXT NOT NULL DEFAULT '',
    error        TEXT NOT NULL DEFAULT '',
    attempts     INT  NOT NULL DEFAULT 0,
    duration_ms  INT  NOT NULL DEFAULT 0,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transcripts_queue ON message_transcripts(created_at) WHERE status IN ('pending','processing');

CREATE TABLE IF NOT EXISTS message_translations (
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    target_lang TEXT NOT NULL,
    body_hash   TEXT NOT NULL,
    text        TEXT NOT NULL,
    source_lang TEXT NOT NULL DEFAULT '',
    provider    TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, target_lang, body_hash)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS bots (
    user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    owner_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash            TEXT NOT NULL UNIQUE,
    description           TEXT NOT NULL DEFAULT '',
    commands              JSONB NOT NULL DEFAULT '[]'::jsonb,
    webapp_url            TEXT NOT NULL DEFAULT '',
    webapp_title          TEXT NOT NULL DEFAULT '',
    allow_groups          BOOLEAN NOT NULL DEFAULT false,
    webhook_url           TEXT NOT NULL DEFAULT '',
    webhook_secret        TEXT NOT NULL DEFAULT '',
    webhook_last_error    TEXT NOT NULL DEFAULT '',
    webhook_last_error_at TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_id);

CREATE TABLE IF NOT EXISTS bot_updates (
    id              BIGSERIAL PRIMARY KEY,
    bot_id          UUID NOT NULL REFERENCES bots(user_id) ON DELETE CASCADE,
    payload         JSONB NOT NULL,
    attempts        INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_updates_pending ON bot_updates(bot_id, id) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS bot_callbacks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id          UUID NOT NULL REFERENCES bots(user_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    data            TEXT NOT NULL DEFAULT '',
    answered_at     TIMESTAMPTZ,
    answer_text     TEXT NOT NULL DEFAULT '',
    show_alert      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_callbacks_created ON bot_callbacks(created_at);
