CREATE INDEX IF NOT EXISTS idx_marketplace_favorites_user
  ON marketplace.favorites (user_id, created_at DESC);
