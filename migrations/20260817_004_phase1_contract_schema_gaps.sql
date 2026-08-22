-- Phase 1 contract-alignment additions. Safe to apply to databases created by
-- the prior migration sequence; the full schema.sql contains the final shape.

ALTER TABLE account.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_status_check;

ALTER TABLE account.organization_members
  ADD CONSTRAINT organization_members_status_check
  CHECK (status IN ('ACTIVE', 'INVITED', 'REMOVED'));

CREATE TABLE IF NOT EXISTS marketplace.recently_viewed (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_recently_viewed_user
  ON marketplace.recently_viewed(user_id, viewed_at DESC);

ALTER TABLE land.document_types
  ADD COLUMN IF NOT EXISTS state_location_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_land_document_types_state
  ON land.document_types(state_location_id, sort_order)
  WHERE is_active = true;

ALTER TABLE land.parcel_identifier_types
  ADD COLUMN IF NOT EXISTS placeholder varchar(255);

CREATE TABLE IF NOT EXISTS land.parcel_configurations (
  state_location_id uuid PRIMARY KEY REFERENCES geo.locations(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at ON land.parcel_configurations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON land.parcel_configurations
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

ALTER TABLE land.property_verification_checks
  ADD COLUMN IF NOT EXISTS internal_notes text;

ALTER TABLE marketplace.enquiries
  ADD COLUMN IF NOT EXISTS preferred_contact_channel varchar(20),
  ADD CONSTRAINT chk_marketplace_enquiries_contact_channel
    CHECK (preferred_contact_channel IS NULL OR preferred_contact_channel IN ('PHONE', 'WHATSAPP', 'EMAIL'));

ALTER TABLE marketplace.site_visits
  ADD COLUMN IF NOT EXISTS preferred_date date,
  ADD COLUMN IF NOT EXISTS preferred_time_slot varchar(50),
  ADD COLUMN IF NOT EXISTS visitor_count smallint NOT NULL DEFAULT 1
    CHECK (visitor_count BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS reschedule_note text;

ALTER TABLE commerce.service_requests
  ADD COLUMN IF NOT EXISTS contact_phone varchar(20),
  ADD COLUMN IF NOT EXISTS contact_email citext,
  ADD COLUMN IF NOT EXISTS completed_report_summary text;

ALTER TABLE commerce.service_request_files
  ADD COLUMN IF NOT EXISTS mime_type varchar(100),
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0);

CREATE INDEX IF NOT EXISTS idx_commerce_service_request_files_request
  ON commerce.service_request_files(service_request_id, created_at DESC);

ALTER TABLE account.channel_partner_profiles
  ADD COLUMN IF NOT EXISTS about text;

ALTER TABLE content.investment_interests
  ADD COLUMN IF NOT EXISTS contact_phone varchar(20),
  ADD COLUMN IF NOT EXISTS contact_email citext,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES account.organizations(id) ON DELETE SET NULL;
