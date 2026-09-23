-- S15 optional: secret chat stub (UI/flag only — not E2EE)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_secret BOOLEAN NOT NULL DEFAULT false;
