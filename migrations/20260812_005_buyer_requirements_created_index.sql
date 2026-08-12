CREATE INDEX IF NOT EXISTS idx_marketplace_buyer_requirements_user_created
  ON marketplace.buyer_requirements (user_id, created_at DESC);
