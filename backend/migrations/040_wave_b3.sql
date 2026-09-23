-- WAVE B3: nearby geo, contact match hashes, guest links, 1:1 call signaling

-- T14 geo
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_consent_at TIMESTAMPTZ;

ALTER TABLE meetups
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

ALTER TABLE market_ads
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- T15 phone hash for contact match (no raw phone in match requests stored)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_users_phone_hash
  ON users (phone_hash)
  WHERE phone_hash IS NOT NULL AND deleted_at IS NULL;

-- T16 guest / family invite links (read-only feed+profile)
CREATE TABLE IF NOT EXISTS guest_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT NOT NULL UNIQUE,
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'Семья',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_guest_links_token
  ON guest_links (token)
  WHERE revoked_at IS NULL;

-- T6 1:1 video call signaling (separate from voice rooms)
CREATE TABLE IF NOT EXISTS dm_call_signals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dm_call_signals_inbox
  ON dm_call_signals (conversation_id, to_user_id, created_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS dm_calls (
  conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id       UUID NOT NULL REFERENCES users(id),
  callee_id       UUID NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'ringing',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);
