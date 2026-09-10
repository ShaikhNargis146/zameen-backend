-- Site visits link directly to an enquiry when one already exists. The link is
-- nullable because a buyer may request a visit without first submitting an
-- enquiry; the API must not create a hidden enquiry merely to populate this FK.
ALTER TABLE marketplace.site_visits
  ADD COLUMN IF NOT EXISTS enquiry_id uuid REFERENCES marketplace.enquiries(id) ON DELETE SET NULL;

-- Best-effort backfill for rows created before enquiry_id existed. Ambiguous
-- rows attach to the most-recent open enquiry, then the most-recent enquiry.
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

-- Preserve history while resolving legacy duplicate requests before adding the
-- unique index. The earliest request remains active; later duplicates become
-- CANCELLED and remain visible in the buyer/seller history.
WITH ranked_duplicates AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY listing_id, buyer_user_id, preferred_date, preferred_time_slot
           ORDER BY requested_at, created_at, id
         ) AS row_number
  FROM marketplace.site_visits
  WHERE status <> 'CANCELLED' AND buyer_user_id IS NOT NULL
)
UPDATE marketplace.site_visits sv
SET status = 'CANCELLED',
    seller_note = concat_ws(
      E'\n\n',
      nullif(btrim(sv.seller_note), ''),
      'Cancelled during the site-visit data upgrade because a duplicate request existed for the same date and time slot.'
    )
FROM ranked_duplicates duplicate
WHERE sv.id = duplicate.id AND duplicate.row_number > 1;

CREATE INDEX IF NOT EXISTS idx_marketplace_site_visits_enquiry
  ON marketplace.site_visits(enquiry_id) WHERE enquiry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_site_visits_dedupe
  ON marketplace.site_visits(listing_id, buyer_user_id, preferred_date, preferred_time_slot)
  WHERE status <> 'CANCELLED' AND buyer_user_id IS NOT NULL;
