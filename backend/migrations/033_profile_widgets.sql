-- S19: profile widgets (price list / portfolio) — self-serve limited or verified
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS profile_widgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('price_list', 'portfolio')),
  title       TEXT NOT NULL DEFAULT '',
  payload     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_widgets_user ON profile_widgets (user_id, sort_order, created_at);
