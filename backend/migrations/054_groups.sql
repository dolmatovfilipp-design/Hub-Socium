-- Block 4: groups — owner/admin/member roles, permissions, invite links, polls, per-member read log.

ALTER TABLE conversation_members DROP CONSTRAINT IF EXISTS conversation_members_role_check;
ALTER TABLE conversation_members ADD CONSTRAINT conversation_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- One owner per group: the creator if still a member, else the earliest admin, else the earliest member.
WITH pick AS (
  SELECT DISTINCT ON (cm.conversation_id) cm.conversation_id, cm.user_id
  FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  WHERE c.is_group
    AND NOT EXISTS (SELECT 1 FROM conversation_members o WHERE o.conversation_id = cm.conversation_id AND o.role = 'owner')
  ORDER BY cm.conversation_id,
           (c.created_by IS NOT NULL AND cm.user_id = c.created_by) DESC,
           (cm.role = 'admin') DESC,
           cm.joined_at ASC
)
UPDATE conversation_members cm SET role = 'owner'
FROM pick WHERE cm.conversation_id = pick.conversation_id AND cm.user_id = pick.user_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_members_owner
  ON conversation_members (conversation_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS idx_conversation_members_conv_joined
  ON conversation_members (conversation_id, joined_at);

-- Who may do what in a group: 'all' members or only 'admins' (owner + admins).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS perm_send TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS perm_add  TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS perm_info TEXT NOT NULL DEFAULT 'admins',
  ADD COLUMN IF NOT EXISTS perm_pin  TEXT NOT NULL DEFAULT 'all';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_perms_check') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_perms_check CHECK (
      perm_send IN ('all','admins') AND perm_add IN ('all','admins')
      AND perm_info IN ('all','admins') AND perm_pin IN ('all','admins'));
  END IF;
END $$;

-- Invite links
CREATE TABLE IF NOT EXISTS group_invite_links (
  token           TEXT PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  max_uses        INT CHECK (max_uses IS NULL OR max_uses > 0),
  uses            INT NOT NULL DEFAULT 0,
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_group_invite_links_conv
  ON group_invite_links (conversation_id) WHERE revoked_at IS NULL;

-- Polls
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_msg_type_check
  CHECK (msg_type IN ('text','voice','image','video_note','video','file','call','sticker','gif','poll'));

CREATE TABLE IF NOT EXISTS chat_polls (
  message_id      UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  creator_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  question        TEXT NOT NULL,
  options         JSONB NOT NULL,
  multiple        BOOLEAN NOT NULL DEFAULT false,
  anonymous       BOOLEAN NOT NULL DEFAULT true,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_poll_votes (
  message_id UUID NOT NULL REFERENCES chat_polls(message_id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_idx SMALLINT NOT NULL CHECK (option_idx >= 0 AND option_idx < 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, option_idx)
);

-- Per-member read history: each MarkRead that advanced the pointer. "Read at" for a message =
-- the first entry at/after its created_at (exact time the member saw it).
CREATE TABLE IF NOT EXISTS conversation_read_log (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (conversation_id, user_id, read_at)
);

CREATE INDEX IF NOT EXISTS idx_mentions_message_mentioned ON mentions (message_id, mentioned_id) WHERE message_id IS NOT NULL;
