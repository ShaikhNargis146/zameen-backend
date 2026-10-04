-- verificationIncluded is a plan capability, so keep its single source of
-- truth in commerce.plans.features with every other capability. Existing
-- feature values win if an administrator has already set the new key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'commerce'
      AND table_name = 'plans'
      AND column_name = 'verification_included'
  ) THEN
    EXECUTE $migration$
      UPDATE commerce.plans
      SET features = CASE
        WHEN COALESCE(features, '{}'::jsonb) ? 'verificationIncluded' THEN features
        ELSE COALESCE(features, '{}'::jsonb) ||
             jsonb_build_object('verificationIncluded', verification_included)
      END
    $migration$;
    ALTER TABLE commerce.plans DROP COLUMN verification_included;
  END IF;
END $$;
