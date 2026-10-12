-- Wrong-code attempts counter for password reset (brute-force protection)

ALTER TABLE password_reset_codes
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
