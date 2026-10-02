-- Optional owner for personal referral invite codes (GET /v1/me/referral)
ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invite_codes_owner_uidx
  ON invite_codes (owner_user_id)
  WHERE owner_user_id IS NOT NULL;
