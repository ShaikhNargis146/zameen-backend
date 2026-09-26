-- Adds the fields needed to render a GST tax invoice PDF for a paid order
-- (Download Invoice feature). amountMinor on commerce.products is treated as
-- already GST-inclusive -- this only adds a tax *breakdown* for display, it
-- never changes order.total_minor or what Razorpay actually charges.
--
-- gst_rate_bps/hsn_sac_code live on both commerce.products (the current
-- catalog value, admin-editable) and commerce.order_items (a snapshot taken
-- at order-creation time, same pattern as unit_amount_minor/total_amount_minor
-- already snapshotting price) so an invoice stays stable even if a product's
-- rate changes later.
--
-- There is no buyer billing address anywhere in the schema, so place of
-- supply can't be derived from a real address. commerce.orders.
-- place_of_supply_state_code/buyer_gstin/cgst_minor/sgst_minor/igst_minor are
-- computed once, at payment-capture time, in commerce.repository.js
-- capturePaymentAndApplyEntitlements: intra-state (CGST+SGST) by default,
-- unless the order is organization-billed and that organization has a
-- gst_number on file, in which case the buyer's state is read from the
-- GSTIN's 2-digit state-code prefix and IGST is used if it differs from the
-- seller's own state (INVOICE_SELLER_GSTIN in env).
--
-- invoice_number is assigned from commerce.invoice_number_seq at the same
-- capture-time moment, so every paid order gets one immediately and
-- redownloading its invoice is deterministic. The sequence is not reset per
-- financial year -- a single always-increasing sequence still satisfies the
-- "unique and sequential" GST requirement.

ALTER TABLE commerce.products
  ADD COLUMN IF NOT EXISTS gst_rate_bps integer NOT NULL DEFAULT 1800 CHECK (gst_rate_bps BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS hsn_sac_code varchar(20);

ALTER TABLE commerce.order_items
  ADD COLUMN IF NOT EXISTS gst_rate_bps integer NOT NULL DEFAULT 0 CHECK (gst_rate_bps BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS hsn_sac_code varchar(20);

ALTER TABLE commerce.orders
  ADD COLUMN IF NOT EXISTS invoice_number varchar(50),
  ADD COLUMN IF NOT EXISTS buyer_gstin varchar(30),
  ADD COLUMN IF NOT EXISTS place_of_supply_state_code varchar(2),
  ADD COLUMN IF NOT EXISTS cgst_minor bigint NOT NULL DEFAULT 0 CHECK (cgst_minor >= 0),
  ADD COLUMN IF NOT EXISTS sgst_minor bigint NOT NULL DEFAULT 0 CHECK (sgst_minor >= 0),
  ADD COLUMN IF NOT EXISTS igst_minor bigint NOT NULL DEFAULT 0 CHECK (igst_minor >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_orders_invoice_number
  ON commerce.orders(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS commerce.invoice_number_seq;
