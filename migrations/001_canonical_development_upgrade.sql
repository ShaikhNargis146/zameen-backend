-- Development-only canonical upgrade.
--
-- This single idempotent script replaces the earlier incremental development
-- migrations. It upgrades an older canonical database and is also safe after
-- src/database/schema.sql has created a fresh database.

-- AI chat is authenticated-only and location suggestions have prefix indexes.
DROP INDEX IF EXISTS ai.uq_ai_conversations_guest_token_hash;
ALTER TABLE ai.conversations
  DROP COLUMN IF EXISTS guest_token_hash,
  DROP COLUMN IF EXISTS guest_token_expires_at;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'ai'
      AND table_name = 'conversations'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ai_conversations_owner'
      AND conrelid = 'ai.conversations'::regclass
  ) THEN
    ALTER TABLE ai.conversations
      ADD CONSTRAINT chk_ai_conversations_owner
      CHECK (user_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

ALTER TABLE ai.conversations
  DROP CONSTRAINT IF EXISTS conversations_user_id_fkey,
  ADD CONSTRAINT conversations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_geo_locations_name_prefix
  ON geo.locations (lower(name) text_pattern_ops) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_geo_location_aliases_prefix
  ON geo.location_aliases (lower(alias) text_pattern_ops);

-- Align legacy land-detail values with the API contract.
ALTER TABLE land.property_land_details
  ADD COLUMN IF NOT EXISTS dimension_unit varchar(20),
  ADD COLUMN IF NOT EXISTS road_type varchar(50);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'land'
      AND table_name = 'property_land_details'
      AND column_name = 'dimension_unit_id'
  ) THEN
    UPDATE land.property_land_details detail
    SET dimension_unit = CASE unit.code
      WHEN 'SQFT' THEN 'FT'
      WHEN 'SQM' THEN 'M'
      ELSE NULL
    END
    FROM land.area_units unit
    WHERE unit.id = detail.dimension_unit_id;

    UPDATE land.property_land_details detail
    SET road_type = CASE road.code
      WHEN 'TARRED' THEN 'PUCCA'
      WHEN 'CONCRETE' THEN 'PUCCA'
      WHEN 'GRAVEL' THEN 'KUTCHA'
      WHEN 'DIRT' THEN 'KUTCHA'
      ELSE 'OTHER'
    END
    FROM land.road_types road
    WHERE road.id = detail.road_type_id;

    ALTER TABLE land.property_land_details
      DROP CONSTRAINT IF EXISTS property_land_details_facing_check,
      DROP CONSTRAINT IF EXISTS property_land_details_frontage_m_check,
      DROP CONSTRAINT IF EXISTS property_land_details_road_width_m_check;

    UPDATE land.property_land_details
    SET facing = CASE facing
      WHEN 'NORTH' THEN 'N'
      WHEN 'NORTHEAST' THEN 'NE'
      WHEN 'EAST' THEN 'E'
      WHEN 'SOUTHEAST' THEN 'SE'
      WHEN 'SOUTH' THEN 'S'
      WHEN 'SOUTHWEST' THEN 'SW'
      WHEN 'WEST' THEN 'W'
      WHEN 'NORTHWEST' THEN 'NW'
      ELSE facing
    END;

    ALTER TABLE land.property_land_details
      ALTER COLUMN facing TYPE varchar(2),
      DROP COLUMN dimension_unit_id,
      DROP COLUMN road_type_id,
      ADD CONSTRAINT property_land_details_dimension_unit_check
        CHECK (dimension_unit IS NULL OR dimension_unit IN ('FT','M')),
      ADD CONSTRAINT property_land_details_road_type_check
        CHECK (road_type IS NULL OR road_type IN ('PUCCA','KUTCHA','HIGHWAY','OTHER')),
      ADD CONSTRAINT property_land_details_facing_check
        CHECK (facing IS NULL OR facing IN ('N','NE','E','SE','S','SW','W','NW')),
      ADD CONSTRAINT property_land_details_frontage_m_check
        CHECK (frontage_m IS NULL OR frontage_m >= 0),
      ADD CONSTRAINT property_land_details_road_width_m_check
        CHECK (road_width_m IS NULL OR road_width_m >= 0);

    DROP TABLE IF EXISTS land.road_types;
  END IF;
END $$;

ALTER TABLE land.document_types
  DROP CONSTRAINT IF EXISTS document_types_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_land_document_types_global
  ON land.document_types(code) WHERE state_location_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_land_document_types_state
  ON land.document_types(state_location_id, code) WHERE state_location_id IS NOT NULL;

-- Document grants implement the APPROVED_BUYERS access policy.
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

-- We are deliberately consolidating only while this project is in development.
DELETE FROM ops.schema_migrations
WHERE name IN (
  '001_secure_ai_chat_and_optimize_location_search.sql',
  '002_align_land_details_and_document_types.sql',
  '003_document_access_grants.sql'
);

-- Organization membership status: REMOVED (plus INVITED for pending invites)
-- replaces the earlier INACTIVE value application code used for a removed
-- member, matching src/database/schema.sql.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_members_status_check'
      AND conrelid = 'account.organization_members'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%REMOVED%'
  ) THEN
    ALTER TABLE account.organization_members
      DROP CONSTRAINT organization_members_status_check;
    UPDATE account.organization_members SET status = 'REMOVED' WHERE status = 'INACTIVE';
    ALTER TABLE account.organization_members
      ADD CONSTRAINT organization_members_status_check
        CHECK (status IN ('ACTIVE','INVITED','REMOVED'));
  END IF;
END $$;
