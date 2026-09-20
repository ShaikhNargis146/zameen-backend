-- Adds the per-plan AI Property Assistant monthly question quota. NULL means
-- unlimited. Enforcement lives in src/modules/ai/ai.service.js.
ALTER TABLE commerce.plans
  ADD COLUMN IF NOT EXISTS ai_monthly_quota integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plans_ai_monthly_quota_check' AND conrelid = 'commerce.plans'::regclass
  ) THEN
    ALTER TABLE commerce.plans
      ADD CONSTRAINT plans_ai_monthly_quota_check CHECK (ai_monthly_quota IS NULL OR ai_monthly_quota >= 0);
  END IF;
END $$;
