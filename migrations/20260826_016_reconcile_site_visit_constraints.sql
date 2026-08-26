-- Remove duplicate checks left by the earlier broad migration. The named
-- constraints from the dedicated scheduling migration remain authoritative.
ALTER TABLE marketplace.site_visits
  DROP CONSTRAINT IF EXISTS site_visits_visitor_count_check,
  DROP CONSTRAINT IF EXISTS site_visits_preferred_time_slot_check;
