-- Prevents a retried/double-clicked "Express Interest" call from creating
-- multiple open leads for the same investor on the same opportunity — see
-- investment-opportunities.repository.js createInterest/findOpenInterest.
-- A CLOSED lead doesn't block a fresh one, so a user can express interest
-- again later after the first lead was handled.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_investment_interests_open
  ON content.investment_interests(opportunity_id, user_id)
  WHERE status IN ('NEW','CONTACTED');
