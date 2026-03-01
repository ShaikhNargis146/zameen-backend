-- ============================================================
-- Zameen (Land-only) — Phase-1 Postgres DDL
-- Node.js friendly, admin-friendly, scalable to Phase-2
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- --------------------------
-- Helpers
-- --------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- --------------------------
-- Enums
-- --------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'agent', 'corporate', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('draft', 'pending', 'live', 'rejected', 'sold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE land_kind AS ENUM ('agri', 'na', 'commercial', 'industrial', 'residential_plot', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inquiry_status AS ENUM ('new', 'contacted', 'closed', 'spam');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE media_kind AS ENUM ('image', 'document');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ad_status AS ENUM ('draft', 'scheduled', 'running', 'paused', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ad_placement AS ENUM ('home_top', 'home_mid', 'search_top', 'search_inline', 'detail_sidebar', 'detail_bottom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------
-- Organizations (for corporate accounts)
-- --------------------------
CREATE TABLE IF NOT EXISTS org (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  legal_name    text,
  phone         text,
  email         citext,
  addr          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_org_updated_at
BEFORE UPDATE ON org
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------
-- Users
-- --------------------------
CREATE TABLE IF NOT EXISTS app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES org(id) ON DELETE SET NULL,

  role          user_role NOT NULL DEFAULT 'user',

  full_name     text NOT NULL,
  phone         text NOT NULL,
  email         citext,

  -- auth fields can be expanded later (OTP, password hash, etc.)
  is_active     boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_app_user_phone UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_app_user_org_id ON app_user(org_id);
CREATE INDEX IF NOT EXISTS idx_app_user_role ON app_user(role);

CREATE TRIGGER trg_app_user_updated_at
BEFORE UPDATE ON app_user
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------
-- Locations (simple Phase-1)
-- You can later normalize further (state/district/taluka/village)
-- --------------------------
CREATE TABLE IF NOT EXISTS location (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state         text,
  district      text,
  city          text,
  area          text,         -- locality / village / panchayat name
  pincode       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_location_pincode ON location(pincode);
CREATE INDEX IF NOT EXISTS idx_location_district ON location(district);
CREATE INDEX IF NOT EXISTS idx_location_city ON location(city);

CREATE TRIGGER trg_location_updated_at
BEFORE UPDATE ON location
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------
-- Listings (LAND ONLY)
-- --------------------------
CREATE TABLE IF NOT EXISTS listing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  org_id          uuid REFERENCES org(id) ON DELETE SET NULL,

  status          listing_status NOT NULL DEFAULT 'draft',

  title           text NOT NULL,
  description     text,

  land_type       land_kind NOT NULL DEFAULT 'other',

  -- Pricing
  price_total     numeric(14,2),          -- total asking price
  price_per_unit  numeric(14,2),          -- optional

  -- Area
  area_value      numeric(14,2),
  area_unit       text,                   -- "sqft", "sqmt", "acre", "guntha", etc.

  -- Address + geo (store as plain fields to keep Phase-1 simple)
  address_line    text,
  latitude        numeric(10,7),
  longitude       numeric(10,7),
  state         text,
  district      text,
  city          text,
  area          text,         -- locality / village / panchayat name
  pincode       text,
  landmark       text,         -- landmark 

  -- Land attributes (keep as columns for common fields; jsonb for extra)
  road_access     boolean,
  water_available boolean,
  electricity     boolean,
  frontage_m      numeric(10,2),
  depth_m         numeric(10,2),

  attrs           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Admin flags
  is_verified     boolean NOT NULL DEFAULT false,
  verified_at     timestamptz,
  verified_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,

  is_hot_sale     boolean NOT NULL DEFAULT false,
  hot_sale_until  timestamptz,
  hot_sale_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,

  -- Visibility / ranking helpers
  published_at    timestamptz,
  sort_score      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_owner ON listing(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_listing_org ON listing(org_id);
CREATE INDEX IF NOT EXISTS idx_listing_status ON listing(status);
CREATE INDEX IF NOT EXISTS idx_listing_geo ON listing(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_listing_verified ON listing(is_verified);
CREATE INDEX IF NOT EXISTS idx_listing_hot ON listing(is_hot_sale);
CREATE INDEX IF NOT EXISTS idx_listing_published ON listing(published_at DESC);

-- JSONB basic index for attrs search later
CREATE INDEX IF NOT EXISTS idx_listing_attrs_gin ON listing USING gin (attrs);

CREATE TRIGGER trg_listing_updated_at
BEFORE UPDATE ON listing
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------
-- Listing Media (images/docs)
-- --------------------------
CREATE TABLE IF NOT EXISTS listing_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,

  kind          media_kind NOT NULL DEFAULT 'image',
  url           text NOT NULL,          -- store GCS/S3/public URL
  thumb_url     text,
  caption       text,
  sort_order    integer NOT NULL DEFAULT 0,

  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_media_listing ON listing_media(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_media_sort ON listing_media(listing_id, sort_order);

-- --------------------------
-- Enquiries (Buyer -> Listing)
-- --------------------------
CREATE TABLE IF NOT EXISTS inquiry (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,

  buyer_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  buyer_name     text,
  buyer_phone    text,
  buyer_email    citext,

  message        text,
  status         inquiry_status NOT NULL DEFAULT 'new',

  assigned_to    uuid REFERENCES app_user(id) ON DELETE SET NULL, -- seller/agent/corp user who will handle
  last_contacted_at timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiry_listing ON inquiry(listing_id);
CREATE INDEX IF NOT EXISTS idx_inquiry_status ON inquiry(status);
CREATE INDEX IF NOT EXISTS idx_inquiry_assigned ON inquiry(assigned_to);

CREATE TRIGGER trg_inquiry_updated_at
BEFORE UPDATE ON inquiry
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------
-- Admin Actions (Audit Trail)
-- Tracks verification/hot sale/status changes cleanly
-- --------------------------
CREATE TABLE IF NOT EXISTS listing_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,

  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL, -- admin
  action        text NOT NULL,          -- e.g. "VERIFY_SET", "HOT_SET", "STATUS_CHANGE"
  note          text,

  before_state  jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state   jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_audit_listing ON listing_audit(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_audit_actor ON listing_audit(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_listing_audit_created ON listing_audit(created_at DESC);

-- --------------------------
-- Advertisements (Admin)
-- "Post advertisement" + place it in app slots
-- --------------------------
CREATE TABLE IF NOT EXISTS ad_campaign (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  title         text NOT NULL,
  status        ad_status NOT NULL DEFAULT 'draft',

  sponsor_name  text,
  sponsor_phone text,
  sponsor_email citext,

  start_at      timestamptz,
  end_at        timestamptz,

  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaign_status ON ad_campaign(status);
CREATE INDEX IF NOT EXISTS idx_ad_campaign_dates ON ad_campaign(start_at, end_at);

CREATE TRIGGER trg_ad_campaign_updated_at
BEFORE UPDATE ON ad_campaign
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Each campaign can have multiple creatives/placements
CREATE TABLE IF NOT EXISTS ad_creative (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES ad_campaign(id) ON DELETE CASCADE,

  placement     ad_placement NOT NULL,
  headline      text,
  subtext       text,

  image_url     text,         -- banner image
  click_url     text,         -- where it goes
  sort_order    integer NOT NULL DEFAULT 0,

  is_active     boolean NOT NULL DEFAULT true,

  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_creative_campaign ON ad_creative(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_placement ON ad_creative(placement);
CREATE INDEX IF NOT EXISTS idx_ad_creative_active ON ad_creative(is_active);

-- Optional: track impressions/clicks later (Phase-2 analytics)
-- In Phase-1 you can skip events to keep it light.

-- ============================================================
-- Notes for backend (Node.js):
-- - Use listing.status transitions:
--   draft -> pending -> live/rejected; live -> sold
-- - When admin marks verified/hot, update listing and insert listing_audit row.
-- - Ads: query ad_creative where is_active=true and campaign status running
--   and now() between start_at/end_at (if present)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_user WHERE role = 'admin'
  ) THEN
    INSERT INTO app_user (
      full_name,
      phone,
      email,
      role,
      is_active
    )
    VALUES (
      'Super Admin',
      '9999999999',
      'admin@zameen.local',
      'admin',
      true
    );
  END IF;
END $$;