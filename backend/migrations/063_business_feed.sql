-- Business feed: account mode, product posts, media, specs, reviews, likes, orders.
-- Existing market_ads rows are copied. Users are not deleted.

ALTER TABLE users ADD COLUMN IF NOT EXISTS business_mode BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS products (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    price        INT NOT NULL DEFAULT 0,
    old_price    INT,
    short_text   TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT 'Разное',
    city         TEXT NOT NULL DEFAULT '',
    stock        INT NOT NULL DEFAULT 1,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'sold', 'draft')),
    views        INT NOT NULL DEFAULT 0,
    source_ad_id UUID,
    lat          DOUBLE PRECISION,
    lng          DOUBLE PRECISION,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS products_feed ON products (created_at DESC) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS products_seller ON products (seller_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS product_media (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo', 'video')),
    position   INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS product_media_product ON product_media (product_id, position);

CREATE TABLE IF NOT EXISTS product_specs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    spec_key   TEXT NOT NULL,
    spec_value TEXT NOT NULL,
    position   INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS product_specs_product ON product_specs (product_id, position);

CREATE TABLE IF NOT EXISTS product_likes (
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, user_id)
);

CREATE TABLE IF NOT EXISTS product_reviews (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL DEFAULT '',
    sentiment  TEXT NOT NULL DEFAULT '' CHECK (sentiment IN ('', 'positive', 'negative')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_reviews_product ON product_reviews (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS product_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    buyer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID,
    status          TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'done', 'cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_orders_seller ON product_orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_orders_buyer ON product_orders (buyer_id, created_at DESC);

INSERT INTO products (
    id, seller_id, title, price, short_text, description, category, city, stock, status, source_ad_id, lat, lng, created_at
)
SELECT a.id, a.seller_id, a.title, a.price,
       LEFT(COALESCE(a.description, ''), 180),
       COALESCE(a.description, ''),
       COALESCE(NULLIF(a.category, ''), 'Разное'),
       COALESCE(a.city, ''),
       1, 'active', a.id, a.lat, a.lng, a.created_at
FROM market_ads a
WHERE a.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_media (product_id, url, kind, position)
SELECT a.id, a.image_url, 'photo', 0
FROM market_ads a
WHERE a.deleted_at IS NULL
  AND btrim(a.image_url) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM product_media m WHERE m.product_id = a.id AND m.url = a.image_url
  );
