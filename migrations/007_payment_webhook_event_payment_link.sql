-- Links each webhook delivery to the internal payment it's about. Until now
-- commerce.payment_webhook_events only correlated to a payment indirectly,
-- by an admin re-parsing payload->payment->entity->notes.internalPaymentId
-- out of the stored JSON — there was no queryable FK. This lets admin
-- payment visibility (GET /admin/payments/:paymentId) show the exact
-- webhook trace for a payment. Nullable: not every delivery resolves to a
-- known payment (unrelated event types, or a payload whose
-- notes.internalPaymentId doesn't match any row) — see
-- commerce.service.js handleWebhook.
ALTER TABLE commerce.payment_webhook_events
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES commerce.payments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_commerce_webhook_events_payment
  ON commerce.payment_webhook_events(payment_id) WHERE payment_id IS NOT NULL;
