-- Idempotency key for chat sends. A retried POST with the same client_id
-- returns the original row instead of inserting a second message.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_id text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_client_id_uniq
  ON messages (conversation_id, sender_id, client_id)
  WHERE client_id IS NOT NULL AND deleted_at IS NULL;
