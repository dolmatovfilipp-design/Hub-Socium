-- S6: Voice rooms MVP (presence, not full WebRTC)
CREATE TABLE IF NOT EXISTS voice_rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    topic       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voice_rooms_open ON voice_rooms (created_at DESC) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS voice_room_members (
    room_id     UUID NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted       BOOLEAN NOT NULL DEFAULT true,
    role        TEXT NOT NULL DEFAULT 'listener',
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, user_id),
    CHECK (role IN ('host', 'speaker', 'listener'))
);

CREATE INDEX IF NOT EXISTS idx_voice_room_members_user ON voice_room_members (user_id);
