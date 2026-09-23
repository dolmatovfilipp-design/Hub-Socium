-- N4: voice messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS msg_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration_ms INT NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_msg_type_check') THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_msg_type_check
      CHECK (msg_type IN ('text', 'voice', 'image'));
  END IF;
END $$;
