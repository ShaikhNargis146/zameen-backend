-- Align persistent land details with the approved UI API contract.
-- Master IDs remain only where the contract declares a master reference.
ALTER TABLE land.property_land_details
  ADD COLUMN IF NOT EXISTS dimension_unit varchar(20),
  ADD COLUMN IF NOT EXISTS road_type varchar(50);

UPDATE land.property_land_details details
SET dimension_unit = CASE units.code
  WHEN 'SQFT' THEN 'FT'
  WHEN 'SQM' THEN 'M'
  ELSE NULL
END
FROM land.area_units units
WHERE details.dimension_unit_id = units.id;

UPDATE land.property_land_details details
SET road_type = CASE types.code
  WHEN 'TARRED' THEN 'PUCCA'
  WHEN 'CONCRETE' THEN 'PUCCA'
  WHEN 'DIRT' THEN 'KUTCHA'
  WHEN 'GRAVEL' THEN 'OTHER'
  ELSE NULL
END
FROM land.road_types types
WHERE details.road_type_id = types.id;

UPDATE land.property_land_details
SET facing = CASE facing
  WHEN 'NORTH' THEN 'N' WHEN 'NORTHEAST' THEN 'NE' WHEN 'EAST' THEN 'E'
  WHEN 'SOUTHEAST' THEN 'SE' WHEN 'SOUTH' THEN 'S' WHEN 'SOUTHWEST' THEN 'SW'
  WHEN 'WEST' THEN 'W' WHEN 'NORTHWEST' THEN 'NW' ELSE facing END;

ALTER TABLE land.property_land_details
  DROP CONSTRAINT IF EXISTS property_land_details_dimension_unit_id_fkey,
  DROP CONSTRAINT IF EXISTS property_land_details_road_type_id_fkey,
  DROP CONSTRAINT IF EXISTS property_land_details_facing_check,
  DROP COLUMN IF EXISTS dimension_unit_id,
  DROP COLUMN IF EXISTS road_type_id;

ALTER TABLE land.property_land_details
  ADD CONSTRAINT property_land_details_dimension_unit_check
    CHECK (dimension_unit IS NULL OR dimension_unit IN ('FT','M')),
  ADD CONSTRAINT property_land_details_road_type_check
    CHECK (road_type IS NULL OR road_type IN ('PUCCA','KUTCHA','HIGHWAY','OTHER')),
  ADD CONSTRAINT property_land_details_facing_check
    CHECK (facing IS NULL OR facing IN ('N','NE','E','SE','S','SW','W','NW'));
