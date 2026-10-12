-- Pause all notifications (push + new activity) without wiping per-type prefs.
ALTER TABLE notification_prefs
  ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;
