-- Live gaps: message requests, hidden words, feed signals, parental pin, music, contact codes.
-- Seed cleanup deletes only rows that match the startup seed's exact markers.
-- The user филипп is not deleted. Real posts, chats, and follows outside these markers stay.

ALTER TABLE users ADD COLUMN IF NOT EXISTS message_policy TEXT NOT NULL DEFAULT 'requests';
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_words TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_stories BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parental_pin_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_gate_note BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS inbox_state TEXT NOT NULL DEFAULT 'inbox';

ALTER TABLE activities ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS feed_signals (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (kind IN ('interest', 'hide_author', 'restrict', 'hide_post')),
    CHECK (
        (kind = 'hide_post' AND post_id IS NOT NULL AND target_user_id IS NULL)
        OR (kind <> 'hide_post' AND target_user_id IS NOT NULL AND post_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS feed_signals_user_target
    ON feed_signals (user_id, kind, target_user_id)
    WHERE target_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS feed_signals_user_post
    ON feed_signals (user_id, kind, post_id)
    WHERE post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact TEXT NOT NULL,
    channel TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_codes_contact_created ON contact_codes (contact, created_at DESC);

CREATE TABLE IF NOT EXISTS music_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_tracks_user_created ON music_tracks (user_id, created_at DESC);

-- Seed markers. Emails and exact copy come from backend/cmd/api seedDemo.
-- Users themselves are kept.

DELETE FROM comments
WHERE body = 'Супер пост!'
  AND author_id IN (SELECT id FROM users WHERE email = 'anna@hub.app' AND username = 'anna_k');

DELETE FROM post_likes
WHERE user_id IN (SELECT id FROM users WHERE email = 'masha@hub.app' AND username = 'masha')
  AND post_id IN (
    SELECT id FROM posts
    WHERE body IN (
        'Привет, Get Hub! Демо-пост — лента и API работают.',
        'Привет, Hub! Демо-пост — лента и API работают.'
    )
  );

DELETE FROM activities a
USING users actor
WHERE a.actor_id = actor.id
  AND (
    (actor.email = 'anna@hub.app' AND actor.username = 'anna_k' AND a.type = 'reply' AND a.meta->>'text' = 'Супер пост!')
    OR (actor.email = 'masha@hub.app' AND actor.username = 'masha' AND a.type = 'mention' AND a.meta->>'text' = '@филипп смотри')
    OR (actor.email = 'anna@hub.app' AND actor.username = 'anna_k' AND a.type = 'follow' AND a.post_id IS NULL
        AND a.user_id IN (SELECT id FROM users WHERE email = 'philip@hub.app' AND username = 'филипп'))
    OR (actor.email = 'masha@hub.app' AND actor.username = 'masha' AND a.type = 'like'
        AND a.post_id IN (
          SELECT id FROM posts WHERE body IN (
            'Привет, Get Hub! Демо-пост — лента и API работают.',
            'Привет, Hub! Демо-пост — лента и API работают.'
          )
        ))
  );

DELETE FROM follows f
USING users a, users b
WHERE f.follower_id = a.id AND f.followee_id = b.id
  AND a.email IN ('philip@hub.app', 'anna@hub.app', 'masha@hub.app', 'ivan@hub.app', 'oleg@hub.app')
  AND b.email IN ('philip@hub.app', 'anna@hub.app', 'masha@hub.app', 'ivan@hub.app', 'oleg@hub.app')
  AND a.username IN ('филипп', 'anna_k', 'masha', 'ivan_spb', 'oleg_msk')
  AND b.username IN ('филипп', 'anna_k', 'masha', 'ivan_spb', 'oleg_msk');

DELETE FROM comments WHERE post_id IN (
    SELECT p.id FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE u.email IN ('philip@hub.app', 'anna@hub.app', 'masha@hub.app')
      AND u.username IN ('филипп', 'anna_k', 'masha')
      AND p.body IN (
        'Привет, Get Hub! Демо-пост — лента и API работают.',
        'Привет, Hub! Демо-пост — лента и API работают.',
        'Доброе утро из Петербурга ☕️',
        'Новый макет в Figma — почти Threads, но наш Get Hub.',
        'Новый макет в Figma — почти Threads, но наш Hub.',
        'Кто-нибудь в Парке Горького сегодня?',
        'Городской дневник: дождь и хорошая книга.'
      )
);

DELETE FROM post_likes WHERE post_id IN (
    SELECT p.id FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE u.email IN ('philip@hub.app', 'anna@hub.app', 'masha@hub.app')
      AND u.username IN ('филипп', 'anna_k', 'masha')
      AND p.body IN (
        'Привет, Get Hub! Демо-пост — лента и API работают.',
        'Привет, Hub! Демо-пост — лента и API работают.',
        'Доброе утро из Петербурга ☕️',
        'Новый макет в Figma — почти Threads, но наш Get Hub.',
        'Новый макет в Figma — почти Threads, но наш Hub.',
        'Кто-нибудь в Парке Горького сегодня?',
        'Городской дневник: дождь и хорошая книга.'
      )
);

DELETE FROM posts p
USING users u
WHERE p.author_id = u.id
  AND u.email IN ('philip@hub.app', 'anna@hub.app', 'masha@hub.app')
  AND u.username IN ('филипп', 'anna_k', 'masha')
  AND p.body IN (
    'Привет, Get Hub! Демо-пост — лента и API работают.',
    'Привет, Hub! Демо-пост — лента и API работают.',
    'Доброе утро из Петербурга ☕️',
    'Новый макет в Figma — почти Threads, но наш Get Hub.',
    'Новый макет в Figma — почти Threads, но наш Hub.',
    'Кто-нибудь в Парке Горького сегодня?',
    'Городской дневник: дождь и хорошая книга.'
  );

DELETE FROM messages
WHERE body IN (
    'Привет! Как тебе Get Hub?',
    'Привет! Как тебе Hub?',
    'Круто, как раз тестирую сообщения 👋',
    'Отлично — напиши, если что-то сломается',
    'Завтра кофе?',
    'Давай в 11 у Парка Горького'
)
AND sender_id IN (
    SELECT id FROM users
    WHERE email IN ('philip@hub.app', 'anna@hub.app', 'masha@hub.app')
      AND username IN ('филипп', 'anna_k', 'masha')
);

DELETE FROM conversations c
WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
  AND EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = c.id
      AND u.email IN ('anna@hub.app', 'masha@hub.app')
      AND u.username IN ('anna_k', 'masha')
  )
  AND NOT EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = c.id
      AND NOT (u.email IN ('philip@hub.app', 'anna@hub.app', 'masha@hub.app')
               AND u.username IN ('филипп', 'anna_k', 'masha'))
  );

UPDATE clips SET deleted_at = now()
WHERE deleted_at IS NULL
  AND media_url = '/demo-clip.mp4'
  AND caption IN ('Демо-клип Get Hub · короткое видео', 'Демо-клип Hub · короткое видео');

DELETE FROM channel_posts
WHERE body = 'Привет! Это пост сообщества — владелец может назначить админа.'
  AND channel_id IN (
    SELECT id FROM channels WHERE slug = 'hub-demo' AND title IN ('Get Hub Демо', 'Hub Демо')
  );

DELETE FROM channel_members
WHERE channel_id IN (
    SELECT id FROM channels WHERE slug = 'hub-demo' AND title IN ('Get Hub Демо', 'Hub Демо')
);

DELETE FROM channels
WHERE slug = 'hub-demo' AND title IN ('Get Hub Демо', 'Hub Демо');
