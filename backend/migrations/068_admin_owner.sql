-- The summary belongs to the production owner, username филипп.
-- When that account exists, it is the only is_admin row.

UPDATE users
SET is_admin = true,
    role = 'admin'
WHERE username = 'филипп'
  AND deleted_at IS NULL;

UPDATE users
SET is_admin = false
WHERE is_admin
  AND username IS DISTINCT FROM 'филипп'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE username = 'филипп' AND deleted_at IS NULL
  );
