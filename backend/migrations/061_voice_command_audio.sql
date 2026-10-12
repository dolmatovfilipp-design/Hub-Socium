-- Short voice-command clips for server STT. Not chat messages.
-- Objects live 24 hours under voice-stt/ in the media bucket.
CREATE TABLE IF NOT EXISTS voice_command_audio (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key  TEXT NOT NULL,
    bytes        INT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_command_audio_expires
    ON voice_command_audio (expires_at);
