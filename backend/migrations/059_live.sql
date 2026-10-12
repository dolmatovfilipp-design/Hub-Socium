-- Block 7 item 7: live broadcasts in groups and channels (media goes through the LiveKit SFU).
CREATE TABLE IF NOT EXISTS live_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 80),
  video BOOLEAN NOT NULL DEFAULT TRUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  peak_viewers INT NOT NULL DEFAULT 0,
  CHECK (num_nonnulls(conversation_id, channel_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_one_active_conv ON live_streams(conversation_id) WHERE ended_at IS NULL AND conversation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_one_active_chan ON live_streams(channel_id) WHERE ended_at IS NULL AND channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS live_streams_started ON live_streams(started_at DESC);
