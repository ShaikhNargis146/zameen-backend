-- Extends content.ads from a single flat image_storage_key to multi-image
-- support via content.ad_media, mirroring land.property_media. The ad row
-- itself is still hard-deleted (ads.repository.remove), so ad_id uses
-- ON DELETE CASCADE, unlike property_media's RESTRICT (properties are only
-- ever soft-deleted, so RESTRICT never fires there). image_storage_key
-- becomes a deprecated legacy column; content.ad_media is now the source of
-- truth and the cover is derived via a correlated subquery in
-- ads.repository.js, so the public GET /ads response shape is unchanged.

CREATE TABLE IF NOT EXISTS content.ad_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid NOT NULL REFERENCES content.ads(id) ON DELETE CASCADE,
  storage_key text NOT NULL, mime_type varchar(100),
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order >= 0), is_cover boolean NOT NULL DEFAULT false,
  uploaded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_content_ad_media_ad ON content.ad_media(ad_id, sort_order) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_ad_media_cover ON content.ad_media(ad_id) WHERE is_cover AND deleted_at IS NULL;

-- Backfill: every existing ad currently has a required single image_storage_key.
-- Migrate it in as that ad's cover. uploaded_by_user_id is left NULL — content.ads
-- has never tracked a creating actor. Guarded by NOT EXISTS so this is safe to
-- run again on a database where schema.sql already created content.ad_media
-- fresh (CI's clean-install-then-migrate check does exactly this).
INSERT INTO content.ad_media (ad_id, storage_key, sort_order, is_cover, created_at)
SELECT ads.id, ads.image_storage_key, 0, true, ads.created_at
FROM content.ads ads
WHERE ads.image_storage_key IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM content.ad_media m WHERE m.ad_id = ads.id);

ALTER TABLE content.ads ALTER COLUMN image_storage_key DROP NOT NULL;
COMMENT ON COLUMN content.ads.image_storage_key IS
  'Deprecated: no longer written by the API. Legacy pre-013 value only; content.ad_media is the source of truth.';
