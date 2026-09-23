-- Moderation queue: report status + optional user role for admin gate

ALTER TABLE reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_status_chk'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_status_chk
      CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON reports (status, created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_chk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_chk
      CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- Private-beta seed: филипп is admin when present
UPDATE users SET role = 'admin' WHERE username = 'филипп' AND role <> 'admin';
