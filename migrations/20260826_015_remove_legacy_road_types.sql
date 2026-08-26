-- Land-detail road types are contract enums, not configurable master data.
-- Migration 013 has already converted every legacy reference before this runs.
DROP TABLE IF EXISTS land.road_types;
