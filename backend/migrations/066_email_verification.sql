-- Registration codes: hashed, 10-minute TTL, attempt counter.
-- Existing accounts stay able to post and message. Phone stays unverified:
-- there is no SMS provider, and a client flag is not proof.

ALTER TABLE email_verify_codes
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

UPDATE users
SET email_verified = true
WHERE deleted_at IS NULL
  AND email_verified IS NOT TRUE;

UPDATE users
SET phone_verified = false
WHERE phone_verified IS TRUE;
