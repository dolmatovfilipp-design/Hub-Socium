-- Block 3: search, stickers, GIFs, link previews, delete-for-me, delivery receipts.

-- 10. Message text search: FTS (russian stemming) + trigram substring index.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable: %', SQLERRM;
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_body_fts
  ON messages USING gin (to_tsvector('russian', COALESCE(body,'')))
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_body_trgm ON messages USING gin (body gin_trgm_ops) WHERE deleted_at IS NULL';
  END IF;
END $$;

-- 11/12. Sticker + GIF message types; generic per-message metadata.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_msg_type_check
  CHECK (msg_type IN ('text','voice','image','video_note','video','file','call','sticker','gif'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta JSONB;

-- 13. Link preview cache (server-side OpenGraph fetch).
CREATE TABLE IF NOT EXISTS link_previews (
  url          TEXT PRIMARY KEY,
  ok           BOOLEAN NOT NULL DEFAULT false,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  image_url    TEXT NOT NULL DEFAULT '',
  site_name    TEXT NOT NULL DEFAULT '',
  final_url    TEXT NOT NULL DEFAULT '',
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. Delete for me.
CREATE TABLE IF NOT EXISTS message_hidden (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_message_hidden_msg ON message_hidden(message_id);

-- 17. Delivery receipts.
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;
UPDATE conversation_members SET last_delivered_at = last_read_at WHERE last_delivered_at IS NULL AND last_read_at IS NOT NULL;
