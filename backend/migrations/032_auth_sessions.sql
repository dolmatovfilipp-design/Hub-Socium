-- S15: session/device metadata on refresh tokens
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS device_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS user_agent  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ip          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
  ON refresh_tokens (user_id, created_at DESC)
  WHERE revoked_at IS NULL;
