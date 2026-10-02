-- content.ads.placement is no longer restricted to a fixed enum
-- ('HOME_TOP','SEARCH_TOP','PROPERTY_SIDEBAR','CONTENT'). New ad slots can
-- be introduced by admins without a schema change; matches
-- src/database/schema.sql.
ALTER TABLE content.ads
  DROP CONSTRAINT IF EXISTS ads_placement_check;
