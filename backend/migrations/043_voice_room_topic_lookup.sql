-- Wave H1: find-or-create group voice rooms by topic (e.g. conv:{uuid})
CREATE INDEX IF NOT EXISTS idx_voice_rooms_topic_open
  ON voice_rooms (topic, created_at DESC)
  WHERE closed_at IS NULL AND topic <> '';
