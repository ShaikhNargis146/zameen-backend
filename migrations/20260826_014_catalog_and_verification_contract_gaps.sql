-- Backfill master and verification fields required by the published API contract.
-- This migration deliberately contains only fields not covered by another
-- dedicated migration.

ALTER TABLE account.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_status_check;

ALTER TABLE account.organization_members
  ADD CONSTRAINT organization_members_status_check
  CHECK (status IN ('ACTIVE', 'INVITED', 'REMOVED'));

ALTER TABLE land.document_types
  ADD COLUMN IF NOT EXISTS state_location_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT;

ALTER TABLE land.document_types
  DROP CONSTRAINT IF EXISTS document_types_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_land_document_types_global
  ON land.document_types(code)
  WHERE state_location_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_land_document_types_state
  ON land.document_types(state_location_id, code)
  WHERE state_location_id IS NOT NULL;

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
  ADD COLUMN IF NOT EXISTS preferred_contact_channel varchar(20);

ALTER TABLE marketplace.enquiries
  DROP CONSTRAINT IF EXISTS chk_marketplace_enquiries_contact_channel;

ALTER TABLE marketplace.enquiries
  ADD CONSTRAINT chk_marketplace_enquiries_contact_channel
    CHECK (preferred_contact_channel IS NULL OR preferred_contact_channel IN ('PHONE', 'WHATSAPP', 'EMAIL'));
