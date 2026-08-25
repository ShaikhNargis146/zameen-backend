ALTER TABLE content.ads DROP CONSTRAINT IF EXISTS ads_status_check;
UPDATE content.ads SET status = 'INACTIVE' WHERE status NOT IN ('ACTIVE','INACTIVE','SCHEDULED','EXPIRED');
ALTER TABLE content.ads ALTER COLUMN status SET DEFAULT 'INACTIVE';
ALTER TABLE content.ads ADD CONSTRAINT ads_status_check CHECK (status IN ('ACTIVE','INACTIVE','SCHEDULED','EXPIRED'));

ALTER TABLE content.ads DROP CONSTRAINT IF EXISTS chk_content_ads_dates;
UPDATE content.ads SET ends_at = starts_at + interval '1 day' WHERE ends_at IS NULL;
ALTER TABLE content.ads ALTER COLUMN ends_at SET NOT NULL;
ALTER TABLE content.ads ADD CONSTRAINT chk_content_ads_dates CHECK (ends_at > starts_at);
