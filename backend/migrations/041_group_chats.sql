-- G1/G4: group chats + invites
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_members_role_check') THEN
    ALTER TABLE conversation_members
      ADD CONSTRAINT conversation_members_role_check
      CHECK (role IN ('admin', 'member'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS conversation_invites (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_invites_user ON conversation_invites (user_id);
