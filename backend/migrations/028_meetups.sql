-- S8: Meetups / events
CREATE TABLE IF NOT EXISTS meetups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    city        TEXT NOT NULL DEFAULT '',
    place       TEXT NOT NULL DEFAULT '',
    starts_at   TIMESTAMPTZ NOT NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meetups_starts ON meetups (starts_at ASC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS meetup_rsvps (
    meetup_id   UUID NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'going',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (meetup_id, user_id),
    CHECK (status IN ('going', 'maybe', 'cancelled'))
);
