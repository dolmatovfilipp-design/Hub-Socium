-- Block 2: call sessions (1:1 + group mesh), participants, call history messages.
CREATE TABLE IF NOT EXISTS calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  initiator_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_group        BOOLEAN NOT NULL DEFAULT false,
  video           BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','ended')),
  outcome         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at     TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_live_conv ON calls (conversation_id) WHERE status IN ('ringing','active');
CREATE INDEX IF NOT EXISTS idx_calls_live ON calls (status, created_at) WHERE status IN ('ringing','active');

CREATE TABLE IF NOT EXISTS call_participants (
  call_id      UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state        TEXT NOT NULL DEFAULT 'ringing' CHECK (state IN ('ringing','joined','left','declined','missed')),
  video        BOOLEAN NOT NULL DEFAULT false,
  invited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at    TIMESTAMPTZ,
  left_at      TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_call_participants_user ON call_participants (user_id, state);

ALTER TABLE dm_call_signals ADD COLUMN IF NOT EXISTS call_id UUID;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_msg_type_check
  CHECK (msg_type IN ('text','voice','image','video_note','video','file','call'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS call_meta JSONB;
