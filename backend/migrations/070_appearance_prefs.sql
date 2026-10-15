-- Appearance: accent, chat font size, and a generic chat background.
-- Wallpaper ids are not enumerated here. The client resolves them from
-- /wallpapers/manifest.json, so new images do not need another migration.
ALTER TABLE user_chat_prefs
  ADD COLUMN IF NOT EXISTS accent TEXT NOT NULL DEFAULT 'graphite',
  ADD COLUMN IF NOT EXISTS font_scale TEXT NOT NULL DEFAULT 'md',
  ADD COLUMN IF NOT EXISTS chat_background JSONB NOT NULL DEFAULT '{"kind":"none"}'::jsonb;

-- NULL means "use the account-wide background".
ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS chat_background JSONB;
