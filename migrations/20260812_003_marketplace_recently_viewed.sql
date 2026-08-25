CREATE TABLE IF NOT EXISTS marketplace.recently_viewed (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_recently_viewed_user
  ON marketplace.recently_viewed (user_id, viewed_at DESC);
