-- Self-hosted errors and anonymous product events. No third-party collector.
-- is_admin marks the owner account that may open the in-app summary.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Existing admin (Филипп / role=admin), otherwise the earliest account.
WITH picked AS (
    SELECT id
    FROM users
    WHERE deleted_at IS NULL
      AND (role = 'admin' OR username = 'филипп')
    ORDER BY created_at ASC, id ASC
    LIMIT 1
)
UPDATE users AS u
SET is_admin = true
FROM picked AS p
WHERE u.id = p.id;

WITH picked AS (
    SELECT id
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC, id ASC
    LIMIT 1
)
UPDATE users AS u
SET is_admin = true,
    role = 'admin'
FROM picked AS p
WHERE u.id = p.id
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin);

CREATE TABLE IF NOT EXISTS telemetry_errors (
    fingerprint  TEXT PRIMARY KEY,
    message      TEXT NOT NULL,
    stack        TEXT NOT NULL DEFAULT '',
    route        TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT '',
    app_version  TEXT NOT NULL DEFAULT '',
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    source       TEXT NOT NULL DEFAULT 'client',
    count        INTEGER NOT NULL DEFAULT 1,
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_errors_last
    ON telemetry_errors (last_seen DESC);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id  TEXT NOT NULL DEFAULT '',
    route       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_created
    ON telemetry_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_name
    ON telemetry_events (name, created_at DESC);
