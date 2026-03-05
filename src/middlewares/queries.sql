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
  CREATE TYPE user_role AS ENUM (
    'user',
    'agent',
    'org_admin',
    'org_member',
    'admin',
    'super_admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('draft', 'pending', 'live', 'rejected', 'sold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'inactive', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE land_kind AS ENUM ('agri', 'na', 'commercial', 'industrial', 'residential_plot', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_intent AS ENUM ('sell', 'buy');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE area_unit_kind AS ENUM (
    'sqft',
    'sqyd',
    'sqmt',
    'acre',
    'hectare',
    'guntha',
    'bigha',
    'kanal',
    'marla',
    'cent',
    'ground',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inquiry_status AS ENUM ('new', 'contacted', 'closed', 'spam');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE media_kind AS ENUM ('image', 'document', 'video');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ad_status AS ENUM ('draft', 'scheduled', 'running', 'paused', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ad_placement AS ENUM ('home_top', 'home_mid', 'search_top', 'search_inline', 'detail_sidebar', 'detail_bottom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ownership_type AS ENUM ('FREEHOLD', 'LEASEHOLD', 'COOPERATIVE', 'JOINT_OWNERSHIP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE facing_direction AS ENUM ('NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTHEAST', 'NORTHWEST', 'SOUTHEAST', 'SOUTHWEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE schedule_type AS ENUM ('weekday', 'weekend', 'anytime');
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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_org_updated_at'
      AND tgrelid = 'org'::regclass
  ) THEN
    CREATE TRIGGER trg_org_updated_at
    BEFORE UPDATE ON org
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- --------------------------
-- Users
-- --------------------------
CREATE TABLE IF NOT EXISTS app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES org(id) ON DELETE SET NULL,

  role          user_role NOT NULL DEFAULT 'user',
  is_internal   boolean NOT NULL DEFAULT false,
  status        user_status NOT NULL DEFAULT 'active',

  name          text NOT NULL,
  phone         text NOT NULL,
  email         citext,

  last_login_at timestamptz,
  last_login_ip inet,
  last_login_user_agent text,

  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_app_user_phone UNIQUE (phone),
  CONSTRAINT chk_app_user_phone_len CHECK (char_length(phone) BETWEEN 10 AND 20),
  CONSTRAINT chk_app_user_role_scope CHECK (
    (is_internal = true AND role IN ('admin', 'super_admin') AND org_id IS NULL)
    OR
    (is_internal = false AND role IN ('user', 'agent', 'org_admin', 'org_member'))
  ),
  CONSTRAINT chk_app_user_org_role CHECK (
    (role IN ('org_admin', 'org_member') AND org_id IS NOT NULL)
    OR
    (role NOT IN ('org_admin', 'org_member'))
  )
);

CREATE INDEX IF NOT EXISTS idx_app_user_org_id ON app_user(org_id);
CREATE INDEX IF NOT EXISTS idx_app_user_role ON app_user(role);
CREATE INDEX IF NOT EXISTS idx_app_user_internal_status ON app_user(is_internal, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_email ON app_user(email) WHERE email IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_app_user_updated_at'
      AND tgrelid = 'app_user'::regclass
  ) THEN
    CREATE TRIGGER trg_app_user_updated_at
    BEFORE UPDATE ON app_user
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- --------------------------
-- Auth Sessions (OTP login)
-- --------------------------
CREATE TABLE IF NOT EXISTS auth_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_auth_session_token_hash UNIQUE (token_hash),
  CONSTRAINT chk_auth_session_expiry CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_expires_at ON auth_session(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_session_revoked_at ON auth_session(revoked_at);

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
CREATE INDEX IF NOT EXISTS idx_location_state_district_city ON location(state, district, city);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_location_updated_at'
      AND tgrelid = 'location'::regclass
  ) THEN
    CREATE TRIGGER trg_location_updated_at
    BEFORE UPDATE ON location
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- --------------------------
-- Listings (LAND ONLY)
-- --------------------------
CREATE TABLE IF NOT EXISTS listing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  org_id          uuid REFERENCES org(id) ON DELETE SET NULL,
  status          listing_status NOT NULL DEFAULT 'draft',
  intent          listing_intent NOT NULL DEFAULT 'sell',
  title           text NOT NULL,
  description     text,
  land_type       land_kind NOT NULL DEFAULT 'other',
  currency_code   char(3) NOT NULL DEFAULT 'INR',
  -- Pricing
  price_total     numeric(14,2) NOT NULL, -- total asking price / budget
  price_per_unit  numeric(14,2),          -- optional
  is_negotiable      boolean NOT NULL DEFAULT false,
  is_under_loan      boolean NOT NULL DEFAULT false,
  -- Land dimensions
  plot_length       numeric(12,2),
  plot_width       numeric(12,2),
  plot_area       numeric(14,2),
  area_unit       area_unit_kind NOT NULL,
  is_boundary_wall   boolean,
  is_road_approach   boolean,
  -- Land characteristics
  ownership       ownership_type,
  facing          facing_direction,
  -- Address + geo (store as plain fields to keep Phase-1 simple)
  address_line    text,
  street text,
  village         text,
  taluka   text,
  latitude        numeric(10,7),
  longitude       numeric(10,7),
  state           text,
  district        text,
  city            text,
  area            text,         -- locality / village / panchayat name
  pincode         text,
  landmark        text,         -- landmark 
  -- Land attributes (keep as columns for common fields; jsonb for extra)
  is_road_access     boolean,
  is_water_available boolean,
  is_electricity     boolean,

  -- Infrastructure
  is_water_connection boolean,
  is_drainage_system boolean,
  is_electric_connection boolean,
  is_gated_security boolean,
  -- Documents
  additional_info      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Schedule Visiting
  schedule_type   schedule_type DEFAULT 'anytime',
  schedule_time_from timestamptz,
  schedule_time_to   timestamptz,
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
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_listing_title_len CHECK (char_length(title) BETWEEN 10 AND 150),
  CONSTRAINT chk_listing_price_total CHECK (price_total > 0),
  CONSTRAINT chk_listing_price_per_unit CHECK (price_per_unit IS NULL OR price_per_unit > 0),
  CONSTRAINT chk_listing_area_value CHECK (area_value > 0),
  CONSTRAINT chk_listing_latitude CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CONSTRAINT chk_listing_longitude CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  CONSTRAINT chk_listing_sort_score CHECK (sort_score >= 0),
  CONSTRAINT chk_listing_publish_state CHECK (
    published_at IS NULL OR status IN ('live', 'sold')
  )
);

CREATE INDEX IF NOT EXISTS idx_listing_owner ON listing(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_listing_org ON listing(org_id);
CREATE INDEX IF NOT EXISTS idx_listing_status ON listing(status);
--CREATE INDEX IF NOT EXISTS idx_listing_location ON listing(location_id);
CREATE INDEX IF NOT EXISTS idx_listing_intent_status ON listing(intent, status);
CREATE INDEX IF NOT EXISTS idx_listing_land_type ON listing(land_type);
CREATE INDEX IF NOT EXISTS idx_listing_state_district_city ON listing(state, district, city);
CREATE INDEX IF NOT EXISTS idx_listing_pincode ON listing(pincode);
CREATE INDEX IF NOT EXISTS idx_listing_geo ON listing(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_listing_verified ON listing(is_verified);
CREATE INDEX IF NOT EXISTS idx_listing_hot ON listing(is_hot_sale);
CREATE INDEX IF NOT EXISTS idx_listing_published ON listing(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_search_live ON listing(status, intent, land_type, district, city, price_total);
CREATE INDEX IF NOT EXISTS idx_listing_ownership ON listing(ownership);
CREATE INDEX IF NOT EXISTS idx_listing_facing ON listing(facing);
CREATE INDEX IF NOT EXISTS idx_listing_negotiable ON listing(negotiable);
CREATE INDEX IF NOT EXISTS idx_listing_boundary_wall ON listing(boundary_wall);
CREATE INDEX IF NOT EXISTS idx_listing_infrastructure ON listing(approach_road, water_connection, drainage_system, electric_connection, security);
CREATE INDEX IF NOT EXISTS idx_listing_documents ON listing(seven_twelve, encumbrance_certificate, land_record, sale_deed, title_certificate);
CREATE INDEX IF NOT EXISTS idx_listing_schedule_type ON listing(schedule_type);
CREATE INDEX IF NOT EXISTS idx_listing_schedule_times ON listing(schedule_time_from, schedule_time_to);

-- JSONB basic index for attrs search later
CREATE INDEX IF NOT EXISTS idx_listing_attrs_gin ON listing USING gin (attrs);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_listing_updated_at'
      AND tgrelid = 'listing'::regclass
  ) THEN
    CREATE TRIGGER trg_listing_updated_at
    BEFORE UPDATE ON listing
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- --------------------------
-- Listing Media (images/docs)
-- --------------------------
CREATE TABLE IF NOT EXISTS listing_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,

  media_type          media_kind   NOT NULL DEFAULT 'image',
  url           text NOT NULL,          -- store GCS/S3/public URL
  thumb_url     text,
  caption       text,
  sort_order    integer NOT NULL DEFAULT 0,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_media_listing ON listing_media(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_media_sort ON listing_media(listing_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_media_sort_order ON listing_media(listing_id, sort_order);

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
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_inquiry_contact_presence CHECK (
    buyer_user_id IS NOT NULL
    OR buyer_phone IS NOT NULL
    OR buyer_email IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_inquiry_listing ON inquiry(listing_id);
CREATE INDEX IF NOT EXISTS idx_inquiry_status ON inquiry(status);
CREATE INDEX IF NOT EXISTS idx_inquiry_assigned ON inquiry(assigned_to);
CREATE INDEX IF NOT EXISTS idx_inquiry_buyer_user ON inquiry(buyer_user_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_inquiry_updated_at'
      AND tgrelid = 'inquiry'::regclass
  ) THEN
    CREATE TRIGGER trg_inquiry_updated_at
    BEFORE UPDATE ON inquiry
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_ad_campaign_updated_at'
      AND tgrelid = 'ad_campaign'::regclass
  ) THEN
    CREATE TRIGGER trg_ad_campaign_updated_at
    BEFORE UPDATE ON ad_campaign
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

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
    SELECT 1 FROM app_user WHERE role IN ('admin', 'super_admin')
  ) THEN
    INSERT INTO app_user (
      name,
      phone,
      email,
      role,
      is_internal,
      status
    )
    VALUES (
      'Super Admin',
      '9999999999',
      'admin@zameen.local',
      'super_admin',
      true,
      'active'
    );
  END IF;
END $$;
