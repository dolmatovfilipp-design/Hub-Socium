-- S7: City ads + seller reviews
CREATE TABLE IF NOT EXISTS market_ads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price       INT NOT NULL DEFAULT 0,
    city        TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Разное',
    image_url   TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_market_ads_city ON market_ads (lower(city)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_market_ads_created ON market_ads (created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS seller_reviews (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (seller_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller ON seller_reviews (seller_id, created_at DESC);
