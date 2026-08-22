ALTER TABLE content.investment_opportunities
  ADD COLUMN IF NOT EXISTS published_at timestamptz;
