-- Waitlist emails + invite codes (PB-06 landing)

CREATE TABLE IF NOT EXISTS waitlist_emails (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_emails_email_lower_uidx
    ON waitlist_emails (lower(email));

CREATE TABLE IF NOT EXISTS invite_codes (
    code       TEXT PRIMARY KEY,
    max_uses   INT NOT NULL DEFAULT 1,
    uses       INT NOT NULL DEFAULT 0,
    active     BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invite_codes_max_uses_chk CHECK (max_uses > 0),
    CONSTRAINT invite_codes_uses_chk CHECK (uses >= 0)
);

INSERT INTO invite_codes (code, max_uses, uses, active)
VALUES ('HUB-BETA', 1000, 0, true)
ON CONFLICT (code) DO NOTHING;
