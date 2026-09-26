-- Existing databases may already have run migration 019 with either of the
-- old contact-unlock keys. Consolidate them into one configuration field and
-- remove the legacy keys. A pre-existing contactUnlocks value wins so this is
-- safe to re-run and never overwrites an admin's newer configuration.
UPDATE commerce.plans
SET features =
  (COALESCE(features, '{}'::jsonb) - 'contactUnlocksLifetime' - 'contactUnlocksPerMonth') ||
  CASE
    WHEN COALESCE(features, '{}'::jsonb) ? 'contactUnlocks' THEN
      jsonb_build_object('contactUnlocks', features->'contactUnlocks')
    WHEN COALESCE(features, '{}'::jsonb) ? 'contactUnlocksLifetime' THEN
      jsonb_build_object('contactUnlocks', features->'contactUnlocksLifetime')
    WHEN COALESCE(features, '{}'::jsonb) ? 'contactUnlocksPerMonth' THEN
      jsonb_build_object('contactUnlocks', features->'contactUnlocksPerMonth')
    ELSE '{}'::jsonb
  END
WHERE COALESCE(features, '{}'::jsonb) ?| ARRAY['contactUnlocks', 'contactUnlocksLifetime', 'contactUnlocksPerMonth'];
