-- Ensure pre-canonical shared databases support the documented
-- APPROVED_BUYERS document-access policy.

CREATE TABLE IF NOT EXISTS land.property_document_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_document_id uuid NOT NULL REFERENCES land.property_documents(id) ON DELETE RESTRICT,
  grantee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  granted_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_land_document_grant_expiry CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_land_document_access_grant_active
  ON land.property_document_access_grants(property_document_id, grantee_user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_land_document_access_grant_grantee
  ON land.property_document_access_grants(grantee_user_id, expires_at)
  WHERE revoked_at IS NULL;
