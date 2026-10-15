-- Quote snapshot and the original author of a forward.
-- reply_to_id and forward_of stay the live links. These JSON fields keep
-- the quote and «Переслано от» after the source row is deleted (ON DELETE SET NULL).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to JSONB,
  ADD COLUMN IF NOT EXISTS forwarded_from JSONB;
