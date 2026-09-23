-- People search / profile facets (beta)
-- Age is derived from birth_date (DATE). Prefer birth_date over integer age so
-- age stays correct over time; API returns computed `age` (years) optionally.
-- gender: 'male' | 'female' | NULL (any)
-- city: normalized RF city name (TEXT), matched exactly against curated list on FE

ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;

-- Soft check: allow only known gender tokens when set
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_gender_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_city ON users (city)
  WHERE city IS NOT NULL AND city <> '' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_display_name_lower ON users (lower(display_name))
  WHERE deleted_at IS NULL;
