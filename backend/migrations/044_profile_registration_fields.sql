-- Registration/profile: country, visibility flags, contact verification
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_gender BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_country BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_contact BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_country_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_country_check
      CHECK (country IS NULL OR country IN ('RU', 'BY'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_country ON users (country)
  WHERE country IS NOT NULL AND deleted_at IS NULL;
