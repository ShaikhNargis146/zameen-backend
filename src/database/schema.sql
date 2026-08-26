-- ============================================================================
-- Zameens Phase 1: canonical clean-install PostgreSQL schema
-- This is NOT a migration for the prior random schema. See docs/architecture.md.
-- PostgreSQL 14+ with PostGIS is required.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS account;
CREATE SCHEMA IF NOT EXISTS geo;
CREATE SCHEMA IF NOT EXISTS land;
CREATE SCHEMA IF NOT EXISTS marketplace;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS content;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS ai;

CREATE OR REPLACE FUNCTION ops.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ---------------------------------------------------------------------------
-- AUTH: one user may hold several roles; do not create buyer/seller user tables.
-- ---------------------------------------------------------------------------
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 varchar(20),
  email citext,
  first_name varchar(100),
  last_name varchar(100),
  display_name varchar(200) NOT NULL,
  preferred_language varchar(10) NOT NULL DEFAULT 'en',
  status varchar(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','DELETED')),
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  avatar_storage_key text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_users_contact CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX uq_auth_users_phone ON auth.users(phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_auth_users_email ON auth.users(email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_auth_users_status ON auth.users(status) WHERE deleted_at IS NULL;

CREATE TABLE auth.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO auth.roles (code, name) VALUES
  ('BUYER','Buyer'), ('SELLER','Seller'), ('BROKER','Broker'),
  ('DEVELOPER','Developer'), ('CHANNEL_PARTNER','Channel Partner'),
  ('CORPORATE','Corporate'), ('ADMIN','Administrator')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE auth.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES auth.roles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_auth_user_roles_role ON auth.user_roles(role_id, user_id);

CREATE TABLE auth.otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  destination varchar(255) NOT NULL,
  channel varchar(20) NOT NULL CHECK (channel IN ('SMS','EMAIL')),
  purpose varchar(30) NOT NULL CHECK (purpose IN ('LOGIN','REGISTER','VERIFY_PHONE','VERIFY_EMAIL')),
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_otp_expiry CHECK (expires_at > created_at)
);
CREATE INDEX idx_auth_otp_destination ON auth.otp_challenges(destination, purpose, created_at DESC);
CREATE INDEX idx_auth_otp_ip_created ON auth.otp_challenges(ip_address, created_at DESC) WHERE ip_address IS NOT NULL;

CREATE TABLE auth.refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id varchar(255),
  device_name varchar(255),
  ip_address inet,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT chk_refresh_expiry CHECK (expires_at > created_at)
);
CREATE INDEX idx_auth_refresh_sessions_active ON auth.refresh_sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_auth_refresh_sessions_family_active ON auth.refresh_sessions(family_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE auth.user_verification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  check_type varchar(50) NOT NULL CHECK (check_type IN ('PHONE','EMAIL','IDENTITY','PAN','BUSINESS')),
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_user_verification_queue ON auth.user_verification_checks(status, created_at);

-- ---------------------------------------------------------------------------
-- GEO: hierarchy supports all India without six separate location tables.
-- ---------------------------------------------------------------------------
CREATE TABLE geo.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT,
  type varchar(30) NOT NULL CHECK (type IN ('COUNTRY','STATE','DISTRICT','SUBDISTRICT','CITY','LOCALITY','VILLAGE')),
  name varchar(255) NOT NULL,
  slug varchar(255) NOT NULL,
  state_code varchar(10),
  center geography(Point,4326),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_geo_root CHECK (type <> 'COUNTRY' OR parent_id IS NULL)
);
CREATE UNIQUE INDEX uq_geo_location_parent_type_slug ON geo.locations
  (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), type, slug);
CREATE INDEX idx_geo_locations_parent_type ON geo.locations(parent_id, type) WHERE is_active;
CREATE INDEX idx_geo_locations_type_name ON geo.locations(type, name) WHERE is_active;
CREATE INDEX idx_geo_locations_slug ON geo.locations(slug);
CREATE INDEX idx_geo_locations_name_trgm ON geo.locations USING gin (name gin_trgm_ops);
CREATE INDEX idx_geo_locations_center ON geo.locations USING gist(center);

CREATE TABLE geo.location_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES geo.locations(id) ON DELETE CASCADE,
  alias varchar(255) NOT NULL,
  language_code varchar(10),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, alias, language_code)
);
CREATE INDEX idx_geo_location_aliases_trgm ON geo.location_aliases USING gin (alias gin_trgm_ops);

CREATE TABLE geo.postal_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(10) NOT NULL UNIQUE,
  state_code varchar(10),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE geo.postal_code_locations (
  postal_code_id uuid NOT NULL REFERENCES geo.postal_codes(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES geo.locations(id) ON DELETE RESTRICT,
  PRIMARY KEY (postal_code_id, location_id)
);
CREATE INDEX idx_geo_postal_code_locations_location ON geo.postal_code_locations(location_id);

-- ---------------------------------------------------------------------------
-- ACCOUNT: commercial entities and memberships; a partner remains a user.
-- ---------------------------------------------------------------------------
CREATE TABLE account.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  type varchar(30) NOT NULL CHECK (type IN ('BROKERAGE','DEVELOPER','CORPORATE','AGENCY')),
  slug varchar(255),
  phone varchar(20),
  email citext,
  gst_number varchar(30),
  rera_number varchar(100),
  logo_storage_key text,
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED')),
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_account_organizations_slug ON account.organizations(slug) WHERE slug IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_account_organizations_status ON account.organizations(status) WHERE deleted_at IS NULL;

CREATE TABLE account.organization_members (
  organization_id uuid NOT NULL REFERENCES account.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role varchar(30) NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INVITED','REMOVED')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_account_organization_members_user ON account.organization_members(user_id, organization_id);

CREATE TABLE account.channel_partner_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES account.organizations(id) ON DELETE SET NULL,
  rera_number varchar(100),
  about text,
  experience_years smallint CHECK (experience_years IS NULL OR experience_years BETWEEN 0 AND 80),
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
  approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account.channel_partner_locations (
  channel_partner_user_id uuid NOT NULL REFERENCES account.channel_partner_profiles(user_id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES geo.locations(id) ON DELETE RESTRICT,
  PRIMARY KEY (channel_partner_user_id, location_id)
);

-- ---------------------------------------------------------------------------
-- LAND MASTERS AND PHYSICAL PROPERTY (Developer 1 owns this domain).
-- ---------------------------------------------------------------------------
CREATE TABLE land.property_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL, is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE land.land_use_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL, is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE land.ownership_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL, is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE land.area_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(30) NOT NULL,
  name varchar(100) NOT NULL, sqft_multiplier numeric(20,8) NOT NULL CHECK (sqft_multiplier > 0),
  state_location_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_land_area_units_global ON land.area_units(code) WHERE state_location_id IS NULL;
CREATE UNIQUE INDEX uq_land_area_units_state ON land.area_units(state_location_id, code) WHERE state_location_id IS NOT NULL;
CREATE TABLE land.road_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL, is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE land.amenities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL, category varchar(50), is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE land.document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(100) NOT NULL,
  name varchar(255) NOT NULL, is_active boolean NOT NULL DEFAULT true,
  state_location_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT,
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_land_document_types_global ON land.document_types(code) WHERE state_location_id IS NULL;
CREATE UNIQUE INDEX uq_land_document_types_state ON land.document_types(state_location_id, code) WHERE state_location_id IS NOT NULL;
CREATE INDEX idx_land_document_types_state ON land.document_types(state_location_id, sort_order) WHERE is_active = true;
CREATE TABLE land.parcel_identifier_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_location_id uuid NOT NULL REFERENCES geo.locations(id) ON DELETE RESTRICT,
  code varchar(50) NOT NULL,
  name varchar(100) NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  placeholder varchar(255),
  is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_location_id, code)
);
CREATE TABLE land.parcel_configurations (
  state_location_id uuid PRIMARY KEY REFERENCES geo.locations(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO land.property_types (code,name,sort_order) VALUES
 ('RESIDENTIAL_PLOT','Residential Plot',10), ('AGRICULTURAL_LAND','Agricultural Land',20),
 ('INDUSTRIAL_LAND','Industrial Land',30), ('COMMERCIAL_LAND','Commercial Land',40),
 ('INSTITUTIONAL_LAND','Institutional Land',50), ('FARM_LAND','Farm Land',60),
 ('MIXED_USE','Mixed Use',70), ('OTHER','Other',99) ON CONFLICT (code) DO NOTHING;
INSERT INTO land.land_use_types (code,name,sort_order) VALUES
 ('RESIDENTIAL','Residential',10), ('AGRICULTURAL','Agricultural',20), ('INDUSTRIAL','Industrial',30),
 ('COMMERCIAL','Commercial',40), ('INSTITUTIONAL','Institutional',50), ('MIXED_USE','Mixed Use',60)
 ON CONFLICT (code) DO NOTHING;
INSERT INTO land.ownership_types (code,name,sort_order) VALUES
 ('FREEHOLD','Freehold',10), ('LEASEHOLD','Leasehold',20), ('POWER_OF_ATTORNEY','Power of Attorney',30), ('OTHER','Other',99)
 ON CONFLICT (code) DO NOTHING;
INSERT INTO land.area_units (code,name,sqft_multiplier) VALUES
 ('SQFT','Square feet',1), ('SQYD','Square yards',9), ('SQM','Square metres',10.76391042),
 ('ACRE','Acre',43560), ('HECTARE','Hectare',107639.1042), ('GUNTHA','Guntha',1089),
 ('KANAL','Kanal',5445), ('CENT','Cent',435.6)
 ON CONFLICT DO NOTHING;
INSERT INTO land.road_types (code,name,sort_order) VALUES
 ('TARRED','Tarred Road',10), ('CONCRETE','Concrete Road',20), ('GRAVEL','Gravel Road',30), ('DIRT','Dirt Road',40)
ON CONFLICT (code) DO NOTHING;
INSERT INTO land.amenities (code,name,category,sort_order) VALUES
 ('WATER','Water','UTILITIES',10), ('ELECTRICITY','Electricity','UTILITIES',20), ('BOREWELL','Borewell','UTILITIES',30),
 ('DRAINAGE','Drainage','UTILITIES',40), ('APPROACH_ROAD','Approach Road','ACCESS',50), ('STREET_LIGHT','Street Light','ACCESS',60), ('BOUNDARY_WALL','Boundary Wall','SECURITY',70)
 ON CONFLICT (code) DO NOTHING;
INSERT INTO land.document_types (code,name,sort_order) VALUES
 ('SALE_DEED','Sale Deed',10), ('SEVEN_TWELVE','7/12 Extract',20), ('PROPERTY_CARD','Property Card',30),
 ('MUTATION','Mutation',40), ('NA_ORDER','NA Order',50), ('TITLE_REPORT','Title Report',60),
 ('TAX_RECEIPT','Tax Receipt',70), ('SURVEY_PLAN','Survey Plan',80), ('LAYOUT_APPROVAL','Layout Approval',90), ('RERA','RERA',100), ('OTHER','Other',999)
 ON CONFLICT (code) DO NOTHING;

CREATE TABLE land.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code varchar(30) NOT NULL UNIQUE,
  property_type_id uuid NOT NULL REFERENCES land.property_types(id) ON DELETE RESTRICT,
  land_use_type_id uuid REFERENCES land.land_use_types(id) ON DELETE RESTRICT,
  ownership_type_id uuid REFERENCES land.ownership_types(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  owner_organization_id uuid REFERENCES account.organizations(id) ON DELETE RESTRICT,
  source varchar(30) NOT NULL DEFAULT 'USER' CHECK (source IN ('USER','ADMIN','PARTNER')),
  status varchar(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX idx_land_properties_type ON land.properties(property_type_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_land_properties_land_use ON land.properties(land_use_type_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_land_properties_creator ON land.properties(created_by_user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_land_properties_owner_organization ON land.properties(owner_organization_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE land.property_land_details (
  property_id uuid PRIMARY KEY REFERENCES land.properties(id) ON DELETE RESTRICT,
  area_value numeric(18,4) NOT NULL CHECK (area_value > 0),
  area_unit_id uuid NOT NULL REFERENCES land.area_units(id) ON DELETE RESTRICT,
  area_sqft numeric(20,4) NOT NULL CHECK (area_sqft > 0),
  length_value numeric(18,4) CHECK (length_value IS NULL OR length_value > 0),
  width_value numeric(18,4) CHECK (width_value IS NULL OR width_value > 0),
  dimension_unit varchar(20) CHECK (dimension_unit IS NULL OR dimension_unit IN ('FT','M')),
  frontage_m numeric(18,4) CHECK (frontage_m IS NULL OR frontage_m >= 0),
  road_width_m numeric(18,4) CHECK (road_width_m IS NULL OR road_width_m >= 0),
  road_type varchar(50) CHECK (road_type IS NULL OR road_type IN ('PUCCA','KUTCHA','HIGHWAY','OTHER')),
  facing varchar(2) CHECK (facing IS NULL OR facing IN ('N','NE','E','SE','S','SW','W','NW')),
  open_sides smallint CHECK (open_sides IS NULL OR open_sides BETWEEN 0 AND 4),
  is_corner_plot boolean NOT NULL DEFAULT false,
  has_boundary_wall boolean,
  terrain varchar(50), road_access_type varchar(50),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_land_property_details_area ON land.property_land_details(area_sqft);
CREATE INDEX idx_land_property_details_road_width ON land.property_land_details(road_width_m);

CREATE TABLE land.property_parcel_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES land.properties(id) ON DELETE RESTRICT,
  identifier_type_id uuid NOT NULL REFERENCES land.parcel_identifier_types(id) ON DELETE RESTRICT,
  identifier_value varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, identifier_type_id, identifier_value)
);
CREATE INDEX idx_land_parcel_identifier_lookup ON land.property_parcel_identifiers(identifier_type_id, identifier_value);
CREATE INDEX idx_land_parcel_identifier_property ON land.property_parcel_identifiers(property_id);

CREATE TABLE land.property_locations (
  property_id uuid PRIMARY KEY REFERENCES land.properties(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES geo.locations(id) ON DELETE RESTRICT,
  postal_code_id uuid REFERENCES geo.postal_codes(id) ON DELETE RESTRICT,
  address_line text, landmark varchar(255),
  coordinates geography(Point,4326),
  location_precision varchar(20) NOT NULL DEFAULT 'APPROXIMATE' CHECK (location_precision IN ('EXACT','APPROXIMATE')),
  show_exact_location boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_land_property_locations_location ON land.property_locations(location_id);
CREATE INDEX idx_land_property_locations_postal_code ON land.property_locations(postal_code_id);
CREATE INDEX idx_land_property_locations_coordinates ON land.property_locations USING gist(coordinates);

CREATE TABLE land.property_amenities (
  property_id uuid NOT NULL REFERENCES land.properties(id) ON DELETE RESTRICT,
  amenity_id uuid NOT NULL REFERENCES land.amenities(id) ON DELETE RESTRICT,
  value_text varchar(255), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, amenity_id)
);
CREATE INDEX idx_land_property_amenities_amenity ON land.property_amenities(amenity_id, property_id);

CREATE TABLE land.property_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES land.properties(id) ON DELETE RESTRICT,
  media_type varchar(20) NOT NULL CHECK (media_type IN ('IMAGE','VIDEO','DRONE_VIDEO','SITE_PLAN')),
  storage_key text NOT NULL, thumbnail_storage_key text, mime_type varchar(100),
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0), is_cover boolean NOT NULL DEFAULT false,
  caption varchar(255),
  uploaded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX idx_land_property_media_property ON land.property_media(property_id, sort_order) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_land_property_media_cover ON land.property_media(property_id) WHERE is_cover AND deleted_at IS NULL;

CREATE TABLE land.property_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES land.properties(id) ON DELETE RESTRICT,
  document_type_id uuid NOT NULL REFERENCES land.document_types(id) ON DELETE RESTRICT,
  storage_key text NOT NULL, file_name varchar(255) NOT NULL, mime_type varchar(100), file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes > 0),
  visibility varchar(20) NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE','OWNER_ONLY','APPROVED_BUYERS')),
  verification_status varchar(30) NOT NULL DEFAULT 'NOT_REVIEWED' CHECK (verification_status IN ('NOT_REVIEWED','PENDING','VERIFIED','REJECTED')),
  uploaded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX idx_land_property_documents_property ON land.property_documents(property_id, document_type_id) WHERE deleted_at IS NULL;
CREATE TABLE land.property_document_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_document_id uuid NOT NULL REFERENCES land.property_documents(id) ON DELETE RESTRICT,
  grantee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  granted_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_land_document_grant_expiry CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE UNIQUE INDEX uq_land_document_access_grant_active
  ON land.property_document_access_grants(property_document_id, grantee_user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_land_document_access_grant_grantee
  ON land.property_document_access_grants(grantee_user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE land.property_verification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES land.properties(id) ON DELETE RESTRICT,
  check_type varchar(50) NOT NULL CHECK (check_type IN ('LOCATION','LAND_DETAILS','PARCEL_IDENTITY','DOCUMENTS','SITE_VISIT')),
  status varchar(30) NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','PENDING','VERIFIED','REJECTED','PARTIAL')),
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, reviewed_at timestamptz,
  notes text, internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, check_type)
);
CREATE INDEX idx_land_property_verification_queue ON land.property_verification_checks(status, created_at);

-- ---------------------------------------------------------------------------
-- MARKETPLACE: commercial offer and buyer/lead activity. Never duplicate land facts here.
-- ---------------------------------------------------------------------------
CREATE TABLE marketplace.listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_code varchar(30) NOT NULL UNIQUE,
  property_id uuid NOT NULL REFERENCES land.properties(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  seller_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  seller_organization_id uuid REFERENCES account.organizations(id) ON DELETE RESTRICT,
  transaction_type varchar(20) NOT NULL DEFAULT 'SALE' CHECK (transaction_type IN ('SALE','LEASE')),
  title varchar(255) NOT NULL, description text, canonical_language varchar(10) NOT NULL DEFAULT 'en',
  price_amount_minor bigint CHECK (price_amount_minor IS NULL OR price_amount_minor >= 0), currency char(3) NOT NULL DEFAULT 'INR', is_negotiable boolean NOT NULL DEFAULT false,
  review_status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (review_status IN ('DRAFT','PENDING','APPROVED','REJECTED')),
  status varchar(20) NOT NULL DEFAULT 'INACTIVE' CHECK (status IN ('INACTIVE','PUBLISHED','PAUSED','EXPIRED','SOLD','WITHDRAWN','SUSPENDED')),
  rejection_reason text, submitted_at timestamptz, approved_at timestamptz, published_at timestamptz, expires_at timestamptz, sold_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT chk_listing_seller CHECK (seller_user_id IS NOT NULL OR seller_organization_id IS NOT NULL),
  CONSTRAINT chk_listing_published_review CHECK (status <> 'PUBLISHED' OR review_status = 'APPROVED')
);
CREATE INDEX idx_marketplace_listings_property ON marketplace.listings(property_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_marketplace_listings_seller_user ON marketplace.listings(seller_user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_marketplace_listings_seller_org ON marketplace.listings(seller_organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_marketplace_listings_published_search ON marketplace.listings(price_amount_minor, published_at DESC) WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_marketplace_one_live_listing_per_property ON marketplace.listings(property_id)
  WHERE deleted_at IS NULL AND review_status IN ('PENDING', 'APPROVED') AND status IN ('INACTIVE', 'PUBLISHED', 'PAUSED');
CREATE INDEX idx_marketplace_listings_full_text ON marketplace.listings
  USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')))
  WHERE deleted_at IS NULL;

CREATE TABLE marketplace.listing_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  promotion_type varchar(30) NOT NULL CHECK (promotion_type IN ('PREMIUM','FEATURED','VERIFIED_BADGE','TOP_SEARCH')),
  order_item_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','ACTIVE','EXPIRED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT chk_listing_promotion_dates CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX idx_marketplace_listing_promotions_active ON marketplace.listing_promotions(listing_id, ends_at) WHERE status = 'ACTIVE';

CREATE TABLE marketplace.favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX idx_marketplace_favorites_listing ON marketplace.favorites(listing_id, created_at DESC);
CREATE INDEX idx_marketplace_favorites_user ON marketplace.favorites(user_id, created_at DESC);

CREATE TABLE marketplace.recently_viewed (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  viewed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX idx_marketplace_recently_viewed_user ON marketplace.recently_viewed(user_id, viewed_at DESC);

CREATE TABLE marketplace.listing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, session_id varchar(255),
  event_type varchar(40) NOT NULL CHECK (event_type IN ('VIEW','CONTACT_REVEAL','SHARE','WHATSAPP_CLICK','PHONE_CLICK')),
  metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketplace_listing_events_listing ON marketplace.listing_events(listing_id, created_at DESC);
CREATE INDEX idx_marketplace_listing_events_user ON marketplace.listing_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_marketplace_listing_events_type ON marketplace.listing_events(event_type, created_at DESC);

CREATE TABLE marketplace.buyer_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name varchar(255), location_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT,
  property_type_id uuid REFERENCES land.property_types(id) ON DELETE RESTRICT,
  min_area_sqft numeric(20,4) CHECK (min_area_sqft IS NULL OR min_area_sqft > 0), max_area_sqft numeric(20,4) CHECK (max_area_sqft IS NULL OR max_area_sqft > 0),
  min_budget_minor bigint CHECK (min_budget_minor IS NULL OR min_budget_minor >= 0), max_budget_minor bigint CHECK (max_budget_minor IS NULL OR max_budget_minor >= 0), currency char(3) NOT NULL DEFAULT 'INR',
  purpose varchar(30) CHECK (purpose IS NULL OR purpose IN ('INVESTMENT','RESIDENTIAL','INDUSTRIAL','COMMERCIAL','WAREHOUSE','AGRICULTURE','OTHER')),
  extra_filters jsonb, status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_buyer_requirement_area_range CHECK (max_area_sqft IS NULL OR min_area_sqft IS NULL OR max_area_sqft >= min_area_sqft),
  CONSTRAINT chk_buyer_requirement_budget_range CHECK (max_budget_minor IS NULL OR min_budget_minor IS NULL OR max_budget_minor >= min_budget_minor)
);
CREATE INDEX idx_marketplace_buyer_requirements_user ON marketplace.buyer_requirements(user_id, status);
CREATE INDEX idx_marketplace_buyer_requirements_user_created ON marketplace.buyer_requirements(user_id, created_at DESC);

CREATE TABLE marketplace.enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enquiry_type varchar(30) NOT NULL CHECK (enquiry_type IN ('CONTACT','CALLBACK','DETAILS','DOCUMENT_REQUEST','GENERAL')),
  message text, preferred_contact_channel varchar(20) CHECK (preferred_contact_channel IS NULL OR preferred_contact_channel IN ('PHONE','WHATSAPP','EMAIL')),
  status varchar(30) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','INTERESTED','SITE_VISIT','CLOSED','LOST')),
  assigned_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketplace_enquiries_listing ON marketplace.enquiries(listing_id, created_at DESC);
CREATE INDEX idx_marketplace_enquiries_buyer ON marketplace.enquiries(buyer_user_id, created_at DESC) WHERE buyer_user_id IS NOT NULL;
CREATE INDEX idx_marketplace_enquiries_queue ON marketplace.enquiries(status, assigned_to_user_id, created_at);
CREATE TABLE marketplace.enquiry_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enquiry_id uuid NOT NULL REFERENCES marketplace.enquiries(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketplace_enquiry_notes_enquiry ON marketplace.enquiry_notes(enquiry_id, created_at);

CREATE TABLE marketplace.site_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  preferred_date date NOT NULL, preferred_time_slot varchar(20) NOT NULL CHECK (preferred_time_slot IN ('MORNING','AFTERNOON','EVENING')),
  visitor_count integer NOT NULL DEFAULT 1 CHECK (visitor_count BETWEEN 1 AND 20),
  requested_at timestamptz NOT NULL DEFAULT now(), scheduled_at timestamptz,
  status varchar(30) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','CONFIRMED','RESCHEDULED','COMPLETED','CANCELLED')),
  seller_note text, buyer_note text, reschedule_note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketplace_site_visits_listing ON marketplace.site_visits(listing_id, scheduled_at);
CREATE INDEX idx_marketplace_site_visits_buyer ON marketplace.site_visits(buyer_user_id, scheduled_at) WHERE buyer_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- COMMERCE: one payment model for plans, promotions and services.
-- ---------------------------------------------------------------------------
CREATE TABLE commerce.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(100) NOT NULL UNIQUE,
  type varchar(30) NOT NULL CHECK (type IN ('PLAN','PROMOTION','SERVICE')),
  name varchar(255) NOT NULL, description text, amount_minor bigint NOT NULL CHECK (amount_minor >= 0), currency char(3) NOT NULL DEFAULT 'INR',
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL UNIQUE REFERENCES commerce.products(id) ON DELETE RESTRICT,
  plan_type varchar(30) NOT NULL CHECK (plan_type IN ('FREE','PREMIUM','BROKER')), duration_days integer CHECK (duration_days IS NULL OR duration_days > 0),
  listing_limit integer CHECK (listing_limit IS NULL OR listing_limit >= 0), featured_days integer CHECK (featured_days IS NULL OR featured_days >= 0),
  verification_included boolean NOT NULL DEFAULT false, features jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number varchar(50) NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, organization_id uuid REFERENCES account.organizations(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','PAYMENT_PENDING','PAID','FAILED','CANCELLED','REFUNDED')),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0), tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0), total_minor bigint NOT NULL CHECK (total_minor >= 0), currency char(3) NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_commerce_orders_user ON commerce.orders(user_id, created_at DESC);
CREATE TABLE commerce.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES commerce.orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES commerce.products(id) ON DELETE RESTRICT, quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor >= 0), total_amount_minor bigint NOT NULL CHECK (total_amount_minor >= 0), metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT chk_order_item_total CHECK (total_amount_minor = quantity * unit_amount_minor)
);
CREATE INDEX idx_commerce_order_items_order ON commerce.order_items(order_id);
ALTER TABLE marketplace.listing_promotions
  ADD CONSTRAINT fk_marketplace_listing_promotions_order_item
  FOREIGN KEY (order_item_id) REFERENCES commerce.order_items(id) ON DELETE SET NULL;
CREATE TABLE commerce.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES commerce.orders(id) ON DELETE RESTRICT,
  provider varchar(30) NOT NULL CHECK (provider IN ('RAZORPAY','STRIPE','OTHER')), provider_order_id varchar(255), provider_payment_id varchar(255),
  status varchar(30) NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','AUTHORIZED','CAPTURED','FAILED','REFUNDED')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0), currency char(3) NOT NULL DEFAULT 'INR', paid_at timestamptz, provider_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_commerce_payment_provider_id ON commerce.payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX idx_commerce_payments_order ON commerce.payments(order_id, created_at DESC);
CREATE TABLE commerce.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(30) NOT NULL CHECK (provider IN ('RAZORPAY','STRIPE','OTHER')),
  event_id varchar(255) NOT NULL,
  event_type varchar(100) NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
CREATE INDEX idx_commerce_webhook_events_unprocessed
  ON commerce.payment_webhook_events(provider, received_at) WHERE processed_at IS NULL;
CREATE TABLE commerce.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES commerce.payments(id) ON DELETE RESTRICT,
  provider_refund_id varchar(255),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSED','FAILED')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE UNIQUE INDEX uq_commerce_payment_refund_provider
  ON commerce.payment_refunds(provider_refund_id) WHERE provider_refund_id IS NOT NULL;
CREATE TABLE commerce.service_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL UNIQUE REFERENCES commerce.products(id) ON DELETE RESTRICT,
  code varchar(100) NOT NULL UNIQUE, service_type varchar(50) NOT NULL CHECK (service_type IN ('LEGAL_REVIEW','TITLE_SEARCH','VALUATION','LOAN_ASSISTANCE','REGISTRATION')),
  requires_property boolean NOT NULL DEFAULT false, requires_documents boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_id uuid NOT NULL REFERENCES commerce.service_catalog(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, property_id uuid REFERENCES land.properties(id) ON DELETE RESTRICT,
  listing_id uuid REFERENCES marketplace.listings(id) ON DELETE RESTRICT, order_id uuid REFERENCES commerce.orders(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PAYMENT_PENDING','IN_PROGRESS','DOCUMENTS_REQUIRED','COMPLETED','CANCELLED')),
  assigned_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, customer_notes text, internal_notes text,
  contact_phone varchar(20), contact_email citext, completed_report_storage_key text, report_summary text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX idx_commerce_service_requests_user ON commerce.service_requests(user_id, created_at DESC);
CREATE INDEX idx_commerce_service_requests_queue ON commerce.service_requests(status, assigned_to_user_id, created_at);
CREATE TABLE commerce.service_request_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_request_id uuid NOT NULL REFERENCES commerce.service_requests(id) ON DELETE RESTRICT,
  storage_key text NOT NULL, file_name varchar(255) NOT NULL, mime_type varchar(100) NOT NULL, file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  uploaded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_commerce_service_request_files_request ON commerce.service_request_files(service_request_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- CONTENT and OPS.
-- ---------------------------------------------------------------------------
CREATE TABLE content.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type varchar(40) NOT NULL CHECK (type IN ('NEWS','ARTICLE','EBOOK','LAND_OPPORTUNITY','PROPERTY_LAW','GUIDE')),
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  location_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT, cover_storage_key text, source_name varchar(255), source_url text, published_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX idx_content_items_published ON content.content_items(type, published_at DESC) WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE TABLE content.content_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), content_id uuid NOT NULL REFERENCES content.content_items(id) ON DELETE RESTRICT,
  language_code varchar(10) NOT NULL, slug varchar(255) NOT NULL, title varchar(500) NOT NULL, summary text, body text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, language_code), UNIQUE (language_code, slug)
);
CREATE INDEX idx_content_translations_full_text ON content.content_translations
  USING gin (to_tsvector('simple', title || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '')));
CREATE TABLE content.market_trend_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id uuid NOT NULL REFERENCES geo.locations(id) ON DELETE RESTRICT,
  property_type_id uuid REFERENCES land.property_types(id) ON DELETE RESTRICT,
  metric varchar(50) NOT NULL CHECK (metric IN ('ASKING_PRICE','GOVT_RATE','AVG_PRICE_PER_SQFT','AVG_PRICE_PER_ACRE')),
  unit varchar(50) NOT NULL, source_name varchar(255), source_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_content_trend_series_all_types
  ON content.market_trend_series(location_id, metric, unit) WHERE property_type_id IS NULL;
CREATE UNIQUE INDEX uq_content_trend_series_property_type
  ON content.market_trend_series(location_id, property_type_id, metric, unit) WHERE property_type_id IS NOT NULL;
CREATE TABLE content.market_trend_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), series_id uuid NOT NULL REFERENCES content.market_trend_series(id) ON DELETE RESTRICT,
  period_date date NOT NULL, value numeric(20,4) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (series_id, period_date)
);
CREATE TABLE content.auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title varchar(500) NOT NULL, institution_name varchar(255) NOT NULL,
  location_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT, reserve_price_minor bigint CHECK (reserve_price_minor IS NULL OR reserve_price_minor >= 0), currency char(3) NOT NULL DEFAULT 'INR',
  emd_amount_minor bigint CHECK (emd_amount_minor IS NULL OR emd_amount_minor >= 0), auction_at timestamptz NOT NULL, official_url text NOT NULL, description text,
  status varchar(20) NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING','CLOSED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_auctions_upcoming ON content.auctions(auction_at) WHERE status = 'UPCOMING';
CREATE TABLE content.investment_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title varchar(500) NOT NULL, location_id uuid REFERENCES geo.locations(id) ON DELETE RESTRICT,
  property_id uuid REFERENCES land.properties(id) ON DELETE RESTRICT, investment_type varchar(50) NOT NULL,
  minimum_investment_minor bigint CHECK (minimum_investment_minor IS NULL OR minimum_investment_minor >= 0), description text,
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')), published_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content.investment_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES content.investment_opportunities(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES account.organizations(id) ON DELETE SET NULL,
  contact_phone varchar(20), contact_email citext, message text,
  status varchar(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL,
  placement varchar(50) NOT NULL CHECK (placement IN ('HOME_TOP','SEARCH_TOP','PROPERTY_SIDEBAR','CONTENT')),
  image_storage_key text NOT NULL, target_url text, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'INACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SCHEDULED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_content_ads_dates CHECK (ends_at > starts_at)
);
CREATE INDEX idx_content_ads_active ON content.ads(placement, starts_at, ends_at) WHERE status = 'ACTIVE';

CREATE TABLE ops.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  type varchar(50) NOT NULL, title varchar(255) NOT NULL, body text NOT NULL, data jsonb, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ops_notifications_inbox ON ops.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE TABLE ops.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_id uuid NOT NULL REFERENCES ops.notifications(id) ON DELETE RESTRICT,
  channel varchar(20) NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP')), provider varchar(50),
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','DELIVERED','FAILED')),
  provider_message_id varchar(255), error_message text, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ops_notification_deliveries_pending ON ops.notification_deliveries(status, created_at) WHERE status IN ('PENDING','FAILED');
CREATE TABLE ops.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email_enabled boolean NOT NULL DEFAULT true, sms_enabled boolean NOT NULL DEFAULT true, whatsapp_enabled boolean NOT NULL DEFAULT true,
  marketing_enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ops.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action varchar(100) NOT NULL, entity_type varchar(100) NOT NULL, entity_id uuid,
  before_data jsonb, after_data jsonb, ip_address inet, request_id varchar(100), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ops_audit_logs_entity ON ops.audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_ops_audit_logs_actor ON ops.audit_logs(actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE TABLE ops.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(50) NOT NULL CHECK (event_type IN ('PROPERTY_VIEW','SEARCH','FAVORITE','CONTACT','SITE_VISIT','PREMIUM_PURCHASE','AI_SEARCH')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id varchar(255),
  listing_id uuid REFERENCES marketplace.listings(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ops_analytics_events_type ON ops.analytics_events(event_type, created_at DESC);
CREATE INDEX idx_ops_analytics_events_user ON ops.analytics_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_ops_analytics_events_listing ON ops.analytics_events(listing_id, created_at DESC) WHERE listing_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- AI: conversation history is useful for support, quality and cost analysis.
-- ---------------------------------------------------------------------------
CREATE TABLE ai.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  context_type varchar(30) NOT NULL DEFAULT 'GENERAL' CHECK (context_type IN ('GENERAL','SEARCH','PROPERTY')),
  property_id uuid REFERENCES land.properties(id) ON DELETE SET NULL, listing_id uuid REFERENCES marketplace.listings(id) ON DELETE SET NULL,
  title varchar(255), guest_token_hash char(64), guest_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ai_property_context CHECK (context_type <> 'PROPERTY' OR property_id IS NOT NULL OR listing_id IS NOT NULL)
);
CREATE INDEX idx_ai_conversations_user ON ai.conversations(user_id, updated_at DESC) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_ai_conversations_guest_token_hash ON ai.conversations(guest_token_hash) WHERE guest_token_hash IS NOT NULL;
CREATE TABLE ai.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES ai.conversations(id) ON DELETE RESTRICT,
  role varchar(20) NOT NULL CHECK (role IN ('USER','ASSISTANT','SYSTEM')), content text NOT NULL, model varchar(100),
  prompt_tokens integer CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0), completion_tokens integer CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0), metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_messages_conversation ON ai.messages(conversation_id, created_at);

-- Land Passport and Scanner Lite are deterministic read models, not AI or
-- legal opinions. They are recalculated from the canonical property records.
CREATE OR REPLACE VIEW land.v_property_scanner AS
SELECT
  p.id AS property_id,
  (CASE WHEN EXISTS (SELECT 1 FROM land.property_land_details d WHERE d.property_id = p.id) THEN 25 ELSE 0 END
   + CASE WHEN EXISTS (SELECT 1 FROM land.property_locations l WHERE l.property_id = p.id) THEN 25 ELSE 0 END
   + CASE WHEN EXISTS (SELECT 1 FROM land.property_parcel_identifiers i WHERE i.property_id = p.id) THEN 15 ELSE 0 END
   + CASE WHEN EXISTS (SELECT 1 FROM land.property_documents doc WHERE doc.property_id = p.id AND doc.deleted_at IS NULL) THEN 20 ELSE 0 END
   + CASE WHEN EXISTS (SELECT 1 FROM land.property_media media WHERE media.property_id = p.id AND media.deleted_at IS NULL) THEN 15 ELSE 0 END) AS readiness_score,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_land_details d WHERE d.property_id = p.id) THEN 'Land details' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_locations l WHERE l.property_id = p.id) THEN 'Property location' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_parcel_identifiers i WHERE i.property_id = p.id) THEN 'Parcel identifier' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_documents doc WHERE doc.property_id = p.id AND doc.deleted_at IS NULL) THEN 'Property document' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_media media WHERE media.property_id = p.id AND media.deleted_at IS NULL) THEN 'Property media' END
  ], NULL) AS missing_items
FROM land.properties p
WHERE p.deleted_at IS NULL;

CREATE OR REPLACE VIEW land.v_land_passports AS
SELECT
  p.id AS property_id,
  p.public_code,
  scanner.readiness_score AS completeness_percent,
  COALESCE(checks.verification_checks, '{}'::jsonb) AS verification_checks,
  (SELECT count(*) FROM land.property_documents doc WHERE doc.property_id = p.id AND doc.deleted_at IS NULL) AS document_count,
  p.updated_at AS last_updated
FROM land.properties p
JOIN land.v_property_scanner scanner ON scanner.property_id = p.id
LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(c.check_type, c.status) AS verification_checks
  FROM land.property_verification_checks c
  WHERE c.property_id = p.id
) checks ON true
WHERE p.deleted_at IS NULL;

CREATE OR REPLACE VIEW marketplace.v_listing_scanner AS
SELECT
  listing.id AS listing_id,
  listing.property_id,
  (CASE WHEN EXISTS (SELECT 1 FROM land.property_land_details d WHERE d.property_id = listing.property_id) THEN 30 ELSE 0 END
   + CASE WHEN EXISTS (SELECT 1 FROM land.property_locations l WHERE l.property_id = listing.property_id) THEN 20 ELSE 0 END
   + CASE WHEN (listing.seller_user_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM auth.user_verification_checks seller_check
       WHERE seller_check.user_id = listing.seller_user_id
         AND seller_check.check_type = 'IDENTITY'
         AND seller_check.status = 'VERIFIED'
     )) OR (listing.seller_organization_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM account.organizations seller_org
       WHERE seller_org.id = listing.seller_organization_id
         AND seller_org.status = 'ACTIVE'
         AND seller_org.deleted_at IS NULL
     )) THEN 15 ELSE 0 END
   + CASE WHEN EXISTS (SELECT 1 FROM land.property_documents doc WHERE doc.property_id = listing.property_id AND doc.deleted_at IS NULL) THEN 25 ELSE 0 END
   + CASE WHEN EXISTS (SELECT 1 FROM land.property_parcel_identifiers parcel WHERE parcel.property_id = listing.property_id) THEN 10 ELSE 0 END) AS readiness_score,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_land_details d WHERE d.property_id = listing.property_id) THEN 'Land details' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_locations l WHERE l.property_id = listing.property_id) THEN 'Property location' END,
    CASE WHEN NOT ((listing.seller_user_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM auth.user_verification_checks seller_check WHERE seller_check.user_id = listing.seller_user_id AND seller_check.check_type = 'IDENTITY' AND seller_check.status = 'VERIFIED'
    )) OR (listing.seller_organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM account.organizations seller_org WHERE seller_org.id = listing.seller_organization_id AND seller_org.status = 'ACTIVE' AND seller_org.deleted_at IS NULL
    ))) THEN 'Seller verification' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_documents doc WHERE doc.property_id = listing.property_id AND doc.deleted_at IS NULL) THEN 'Property document' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM land.property_parcel_identifiers parcel WHERE parcel.property_id = listing.property_id) THEN 'Parcel identifier' END
  ], NULL) AS missing_items
FROM marketplace.listings listing
WHERE listing.deleted_at IS NULL;

-- Trigger every mutable table. Tables without updated_at are intentionally excluded.
DO $$
DECLARE item text;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'auth.users','auth.roles','auth.user_verification_checks',
    'geo.locations','account.organizations','account.channel_partner_profiles',
    'land.property_types','land.land_use_types','land.ownership_types','land.area_units','land.road_types','land.amenities','land.document_types','land.parcel_identifier_types','land.parcel_configurations','land.properties','land.property_land_details','land.property_parcel_identifiers','land.property_locations','land.property_verification_checks',
    'marketplace.listings','marketplace.buyer_requirements','marketplace.enquiries','marketplace.site_visits',
    'commerce.products','commerce.plans','commerce.orders','commerce.payments','commerce.payment_webhook_events','commerce.service_catalog','commerce.service_requests',
    'content.content_items','content.content_translations','content.market_trend_series','content.auctions','content.investment_opportunities','content.investment_interests','content.ads',
    'ops.notification_deliveries','ai.conversations'
  ] LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at()', item);
  END LOOP;
END $$;
