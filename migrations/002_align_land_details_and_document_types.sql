-- Align canonical databases created from the pre-clean baseline with the
-- contract fields used by the property and listing APIs. This is deliberately
-- idempotent so a database created from the current clean-install schema can
-- also record it safely.

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
