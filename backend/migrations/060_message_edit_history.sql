-- Message edit history (plain chats; secret chats never use EditMessage).
CREATE TABLE IF NOT EXISTS message_edits (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    edited_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_edits_msg_time ON message_edits (message_id, edited_at DESC);
