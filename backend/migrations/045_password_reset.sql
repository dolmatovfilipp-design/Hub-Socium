-- Password reset codes (DEV-honest: API returns code when SMTP unset)

CREATE TABLE IF NOT EXISTS password_reset_codes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_created
  ON password_reset_codes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_contact_active
  ON password_reset_codes (contact, expires_at)
  WHERE used_at IS NULL;
