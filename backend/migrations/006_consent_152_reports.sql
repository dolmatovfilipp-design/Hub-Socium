-- Align Phase 1 P0: consent_152_at + nullable report targets

ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_152_at TIMESTAMPTZ;

-- Backfill from earlier consent_v1_at if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'consent_v1_at'
  ) THEN
    UPDATE users
    SET consent_152_at = consent_v1_at
    WHERE consent_152_at IS NULL AND consent_v1_at IS NOT NULL;
  END IF;
END $$;

-- reports: post_id nullable, reported_user_id optional
ALTER TABLE reports ALTER COLUMN post_id DROP NOT NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON reports(reported_user_id, created_at DESC);

-- At least one target required (enforced in app; soft check when both columns exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_target_chk'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_target_chk
      CHECK (post_id IS NOT NULL OR reported_user_id IS NOT NULL);
  END IF;
END $$;
