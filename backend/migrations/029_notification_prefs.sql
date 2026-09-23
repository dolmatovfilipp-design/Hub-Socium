-- S10: Notification preferences
CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    likes           BOOLEAN NOT NULL DEFAULT true,
    comments        BOOLEAN NOT NULL DEFAULT true,
    follows         BOOLEAN NOT NULL DEFAULT true,
    messages        BOOLEAN NOT NULL DEFAULT true,
    mentions        BOOLEAN NOT NULL DEFAULT true,
    digest_hours    INT NOT NULL DEFAULT 0,
    quiet_start     INT,
    quiet_end       INT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (digest_hours >= 0 AND digest_hours <= 168),
    CHECK (quiet_start IS NULL OR (quiet_start >= 0 AND quiet_start <= 23)),
    CHECK (quiet_end IS NULL OR (quiet_end >= 0 AND quiet_end <= 23))
);
