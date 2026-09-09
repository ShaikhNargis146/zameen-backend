-- Site visits: link each visit to the buyer's enquiry for the same listing.
-- Before this, marketplace.site_visits had no enquiry_id column at all - the
-- relationship was only ever inferred at query time by matching
-- (listing_id, buyer_user_id), which breaks once a buyer can have more than
-- one enquiry "generation" for the same listing over time (a closed/lost
-- enquiry followed by a new one) and gave no server-side way to prevent
-- duplicate active enquiries or duplicate visit requests.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'marketplace' AND table_name = 'site_visits' AND column_name = 'enquiry_id'
  ) THEN
    ALTER TABLE marketplace.site_visits
      ADD COLUMN enquiry_id uuid REFERENCES marketplace.enquiries(id) ON DELETE SET NULL;

    -- Best-effort backfill for rows created before this column existed:
    -- attach each visit to the most recent open (non CLOSED/LOST) enquiry for
    -- the same buyer+listing, falling back to the most recent enquiry of any
    -- status when none is open.
    UPDATE marketplace.site_visits sv
    SET enquiry_id = matched.id
    FROM (
      SELECT DISTINCT ON (e.listing_id, e.buyer_user_id)
        e.id, e.listing_id, e.buyer_user_id
      FROM marketplace.enquiries e
      ORDER BY e.listing_id, e.buyer_user_id,
               (e.status NOT IN ('CLOSED','LOST')) DESC, e.created_at DESC
    ) matched
    WHERE sv.enquiry_id IS NULL
      AND sv.listing_id = matched.listing_id
      AND sv.buyer_user_id = matched.buyer_user_id;

    CREATE INDEX idx_marketplace_site_visits_enquiry
      ON marketplace.site_visits(enquiry_id) WHERE enquiry_id IS NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'marketplace' AND indexname = 'idx_marketplace_site_visits_dedupe'
  ) THEN
    CREATE UNIQUE INDEX idx_marketplace_site_visits_dedupe
      ON marketplace.site_visits(listing_id, buyer_user_id, preferred_date, preferred_time_slot)
      WHERE status <> 'CANCELLED';
  END IF;
END $$;
