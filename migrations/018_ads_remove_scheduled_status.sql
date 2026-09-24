-- Removes the SCHEDULED status from content.ads: ads no longer support a
-- future-dated "go live later" state, so any existing SCHEDULED rows are
-- promoted to ACTIVE (matching the app's new create-time rule that
-- startsAt/endsAt must already be open) and the column default moves from
-- INACTIVE to ACTIVE. Matches src/database/schema.sql.
UPDATE content.ads SET status = 'ACTIVE' WHERE status = 'SCHEDULED';

ALTER TABLE content.ads
  ALTER COLUMN status SET DEFAULT 'ACTIVE';

ALTER TABLE content.ads
  DROP CONSTRAINT IF EXISTS ads_status_check;
ALTER TABLE content.ads
  ADD CONSTRAINT ads_status_check CHECK (status IN ('ACTIVE','INACTIVE','EXPIRED'));
