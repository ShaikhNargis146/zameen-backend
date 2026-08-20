CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_one_live_listing_per_property
  ON marketplace.listings(property_id)
  WHERE deleted_at IS NULL
    AND review_status IN ('PENDING', 'APPROVED')
    AND status IN ('INACTIVE', 'PUBLISHED', 'PAUSED');
