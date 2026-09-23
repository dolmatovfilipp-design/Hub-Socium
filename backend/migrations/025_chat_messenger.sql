-- S5 + bonuses: reply, pin, archive, folders, reactions, themes, video notes, forward
ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT 'inbox';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_members_folder_check') THEN
    ALTER TABLE conversation_members
      ADD CONSTRAINT conversation_members_folder_check
      CHECK (folder IN ('inbox', 'important', 'archive'));
  END IF;
END $$;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forward_of UUID REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_msg_type_check
  CHECK (msg_type IN ('text', 'voice', 'image', 'video_note'));

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji),
    CHECK (char_length(emoji) BETWEEN 1 AND 16)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_msg ON message_reactions (message_id);

CREATE TABLE IF NOT EXISTS user_chat_prefs (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme_id    TEXT NOT NULL DEFAULT 'default',
    appearance  TEXT NOT NULL DEFAULT 'dark',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (appearance IN ('dark', 'light', 'system'))
);
