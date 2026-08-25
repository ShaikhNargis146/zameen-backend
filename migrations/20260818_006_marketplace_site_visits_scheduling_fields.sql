ALTER TABLE marketplace.site_visits
  ADD COLUMN IF NOT EXISTS preferred_date date,
  ADD COLUMN IF NOT EXISTS preferred_time_slot varchar(20),
  ADD COLUMN IF NOT EXISTS visitor_count integer NOT NULL DEFAULT 1;

UPDATE marketplace.site_visits
  SET preferred_date = COALESCE(preferred_date, scheduled_at::date, requested_at::date, created_at::date),
      preferred_time_slot = COALESCE(preferred_time_slot, 'MORNING');

ALTER TABLE marketplace.site_visits
  ALTER COLUMN preferred_date SET NOT NULL,
  ALTER COLUMN preferred_time_slot SET NOT NULL;

ALTER TABLE marketplace.site_visits
  ADD CONSTRAINT chk_marketplace_site_visits_preferred_time_slot CHECK (preferred_time_slot IN ('MORNING','AFTERNOON','EVENING')),
  ADD CONSTRAINT chk_marketplace_site_visits_visitor_count CHECK (visitor_count BETWEEN 1 AND 20);
