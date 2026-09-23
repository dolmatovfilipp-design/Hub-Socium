-- P5: WebRTC signaling for voice rooms (SDP/ICE over HTTP poll)
CREATE TABLE IF NOT EXISTS voice_room_signals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id      UUID NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at  TIMESTAMPTZ,
    CHECK (kind IN ('offer', 'answer', 'ice'))
);

CREATE INDEX IF NOT EXISTS idx_voice_signals_inbox
  ON voice_room_signals (room_id, to_user_id, created_at)
  WHERE consumed_at IS NULL;

-- Auto-expire old signals (cleanup via queries; no cron required for MVP)
