-- Block 7 / item 4: real end-to-end encrypted secret chats (1:1, device-bound).
-- The server stores only public keys and ciphertext.

CREATE TABLE IF NOT EXISTS e2e_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  identity_dh   TEXT NOT NULL,   -- base64 raw P-256 ECDH public key
  identity_sign TEXT NOT NULL,   -- base64 raw P-256 ECDSA public key
  spk_id        INT  NOT NULL,
  spk_pub       TEXT NOT NULL,   -- signed prekey (ECDH P-256)
  spk_sig       TEXT NOT NULL,   -- ECDSA P-256/SHA-256 over spk_pub (IEEE P1363)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_e2e_devices_user ON e2e_devices (user_id, last_seen_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS e2e_prekeys (
  device_id UUID NOT NULL REFERENCES e2e_devices(id) ON DELETE CASCADE,
  key_id    INT  NOT NULL,
  pub       TEXT NOT NULL,
  PRIMARY KEY (device_id, key_id)
);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS secret_initiator        UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secret_initiator_device UUID REFERENCES e2e_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secret_peer_device      UUID REFERENCES e2e_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secret_init             JSONB,
  ADD COLUMN IF NOT EXISTS secret_ttl_seconds      INT NOT NULL DEFAULT 0;

-- Ciphertext envelope {v, dev, h, ct, iv}; body stays empty for e2e messages.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS e2e         JSONB,
  ADD COLUMN IF NOT EXISTS ttl_seconds INT;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_msg_type_check
  CHECK (msg_type IN ('text','voice','image','video_note','video','file','call','sticker','gif','poll','location','contact','e2e'));

-- Pre-existing "secret" flags came from the old UI-only stub (no encryption): clear them.
UPDATE conversations SET is_secret = false WHERE is_secret AND secret_initiator_device IS NULL;
