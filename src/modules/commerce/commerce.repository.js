import { pg, run } from "../../shared/db.js";

const runTx = async fn => {
  const result = await pg.tx(fn);
  if (!result.ok) throw result.error;
  return result.data;
};

const planColumns = `
  pl.id, pr.id AS "productId", pr.code, pr.name, pl.plan_type AS "planType", pr.description,
  pr.amount_minor AS "amountMinor", pr.currency, pl.duration_days AS "durationDays",
  pl.listing_limit AS "listingLimit", pl.featured_days AS "featuredDays",
  pl.verification_included AS "verificationIncluded", pl.features, pr.is_active AS "isActive",
  pl.ai_monthly_quota AS "aiMonthlyQuota",
  pl.created_at AS "createdAt", pl.updated_at AS "updatedAt"
`;

export const listActivePlans = planType =>
  run(
    "any",
    `SELECT ${planColumns} FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE pr.is_active = true AND pr.type = 'PLAN'
       AND ($1::varchar IS NULL OR pl.plan_type = $1)
     ORDER BY pr.amount_minor`,
    [planType]
  );

export const findPlanById = id =>
  run(
    "oneOrNone",
    `SELECT ${planColumns} FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE pl.id = $1`,
    [id]
  );

export const listPlansAdmin = ({ planType, isActive, search, limit, offset }) =>
  run(
    "any",
    `SELECT ${planColumns}, count(*) OVER()::int AS total FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE ($1::varchar IS NULL OR pl.plan_type = $1)
       AND ($2::boolean IS NULL OR pr.is_active = $2)
       AND ($3::varchar IS NULL OR pr.code ILIKE $3 OR pr.name ILIKE $3)
     ORDER BY pr.amount_minor
     LIMIT $4 OFFSET $5`,
    [planType, isActive, search ? `%${search}%` : null, limit, offset]
  );

export const findPlanByCode = code =>
  run(
    "oneOrNone",
    `SELECT pl.id FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE pr.code = $1`,
    [code]
  );

export const planHasOrders = planId =>
  run(
    "oneOrNone",
    `SELECT 1 FROM commerce.order_items oi
     JOIN commerce.plans pl ON pl.product_id = oi.product_id
     WHERE pl.id = $1 LIMIT 1`,
    [planId]
  ).then(Boolean);

// The buyer's own currently-active personal plan (organization-scoped plans
// are out of scope here, same restriction as ai.repository's activePlanForUser).
// No background sweep flips a lapsed row's status to EXPIRED, so this filters
// on ends_at lazily, at read time, rather than trusting status = 'ACTIVE' alone.
export const findActiveSubscriptionForUser = userId =>
  run(
    "oneOrNone",
    `SELECT ps.status AS "subscriptionStatus", ps.starts_at AS "startsAt", ps.ends_at AS "endsAt",
            ${planColumns}
     FROM commerce.plan_subscriptions ps
     JOIN commerce.plans pl ON pl.id = ps.plan_id
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE ps.user_id = $1 AND ps.organization_id IS NULL
       AND ps.status = 'ACTIVE' AND (ps.ends_at IS NULL OR ps.ends_at > now())
     ORDER BY ps.ends_at DESC NULLS LAST
     LIMIT 1`,
    [userId]
  );

export const createPlan = ({
  code,
  name,
  description,
  amountMinor,
  currency,
  isActive,
  planType,
  durationDays,
  listingLimit,
  featuredDays,
  verificationIncluded,
  features,
  aiMonthlyQuota
}) =>
  runTx(async t => {
    const product = await t.one(
      `INSERT INTO commerce.products (code, type, name, description, amount_minor, currency, is_active)
       VALUES ($1,'PLAN',$2,$3,$4,$5,$6) RETURNING id`,
      [code, name, description, amountMinor, currency, isActive]
    );
    const plan = await t.one(
      `INSERT INTO commerce.plans (product_id, plan_type, duration_days, listing_limit, featured_days, verification_included, features, ai_monthly_quota)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
      [
        product.id,
        planType,
        durationDays,
        listingLimit,
        featuredDays,
        verificationIncluded,
        JSON.stringify(features || {}),
        aiMonthlyQuota ?? null
      ]
    );
    return plan.id;
  });

const productColumnMap = {
  code: "code",
  name: "name",
  description: "description",
  amountMinor: "amount_minor",
  currency: "currency",
  isActive: "is_active"
};
const planColumnMap = {
  planType: "plan_type",
  durationDays: "duration_days",
  listingLimit: "listing_limit",
  featuredDays: "featured_days",
  verificationIncluded: "verification_included",
  features: "features",
  aiMonthlyQuota: "ai_monthly_quota"
};

export const updatePlan = ({ productId, planId, changes }) =>
  runTx(async t => {
    const productChanges = {};
    const planChanges = {};
    for (const [field, column] of Object.entries(productColumnMap))
      if (Object.hasOwn(changes, field)) productChanges[column] = changes[field];
    for (const [field, column] of Object.entries(planColumnMap))
      if (Object.hasOwn(changes, field)) planChanges[column] = changes[field];

    if (Object.keys(productChanges).length) {
      const columns = Object.keys(productChanges);
      const setSql = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");
      await t.none(`UPDATE commerce.products SET ${setSql} WHERE id = $1`, [
        productId,
        ...columns.map(col => productChanges[col])
      ]);
    }
    if (Object.keys(planChanges).length) {
      const columns = Object.keys(planChanges);
      const setSql = columns
        .map((col, i) => (col === "features" ? `${col} = $${i + 2}::jsonb` : `${col} = $${i + 2}`))
        .join(", ");
      await t.none(`UPDATE commerce.plans SET ${setSql} WHERE id = $1`, [
        planId,
        ...columns.map(col => (col === "features" ? JSON.stringify(planChanges[col]) : planChanges[col]))
      ]);
    }
    return true;
  });

export const setPlanActive = (planId, isActive) =>
  run(
    "oneOrNone",
    `UPDATE commerce.products p SET is_active = $2
     FROM commerce.plans pl
     WHERE pl.product_id = p.id AND pl.id = $1
     RETURNING pl.id`,
    [planId, isActive]
  );

export const findProductsByIds = ids =>
  run(
    "any",
    `SELECT p.id, p.code, p.name, p.type, p.amount_minor AS "amountMinor", p.currency, p.is_active AS "isActive",
            pl.id AS "planId",
            promo.promotion_type AS "promotionType", promo.duration_days AS "promotionDurationDays"
     FROM commerce.products p
     LEFT JOIN commerce.plans pl ON pl.product_id = p.id
     LEFT JOIN commerce.promotion_catalog promo ON promo.product_id = p.id
     WHERE p.id = ANY($1::uuid[])`,
    [ids]
  );

// Ownership check for a PROMOTION order item's targetId (Section 7 of
// docs/razorpay-integration-plan.md) — the listing must belong to the buyer
// or their purchasing organization.
export const findOwnedListingForPromotion = (listingId, { actorId, organizationId }) =>
  run(
    "oneOrNone",
    `SELECT id FROM marketplace.listings
     WHERE id = $1 AND deleted_at IS NULL
       AND (seller_user_id = $2 OR ($3::uuid IS NOT NULL AND seller_organization_id = $3))`,
    [listingId, actorId, organizationId || null]
  );

// Ownership + payability check for a SERVICE order item's targetId. The
// service request must belong to the buyer and not already be paid for.
export const findPayableServiceRequest = (serviceRequestId, actorId) =>
  run(
    "oneOrNone",
    `SELECT id FROM commerce.service_requests
     WHERE id = $1 AND user_id = $2 AND status = 'REQUESTED' AND order_id IS NULL`,
    [serviceRequestId, actorId]
  );

const orderColumns = `
  o.id, o.order_number AS "orderNumber", o.user_id AS "userId", o.organization_id AS "organizationId",
  o.status, o.subtotal_minor AS "subtotalMinor", o.tax_minor AS "taxMinor", o.total_minor AS "totalMinor",
  o.currency, o.created_at AS "createdAt",
  (SELECT p.paid_at FROM commerce.payments p WHERE p.order_id = o.id AND p.status = 'CAPTURED'
   ORDER BY p.paid_at DESC LIMIT 1) AS "paidAt",
  -- o.status alone cannot distinguish "waiting on the current payment
  -- attempt" from "the last attempt failed, retry needed" — both leave the
  -- order in PAYMENT_PENDING so a same-order retry stays allowed (see
  -- createPaymentIntent). Surfacing the most recent payment's own status
  -- lets the result page tell the two apart instead of polling forever.
  (SELECT p.status FROM commerce.payments p WHERE p.order_id = o.id
   ORDER BY p.created_at DESC LIMIT 1) AS "latestPaymentStatus"
`;

export const createOrder = ({ orderNumber, userId, organizationId, subtotalMinor, taxMinor, totalMinor, currency, items }) =>
  runTx(async t => {
    const order = await t.one(
      `INSERT INTO commerce.orders (order_number, user_id, organization_id, status, subtotal_minor, tax_minor, total_minor, currency)
       VALUES ($1,$2,$3,'CREATED',$4,$5,$6,$7) RETURNING id`,
      [orderNumber, userId, organizationId, subtotalMinor, taxMinor, totalMinor, currency]
    );
    for (const item of items) {
      await t.none(
        `INSERT INTO commerce.order_items (order_id, product_id, quantity, unit_amount_minor, total_amount_minor, metadata)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          order.id,
          item.productId,
          item.quantity,
          item.unitAmountMinor,
          item.totalAmountMinor,
          JSON.stringify({ targetType: item.targetType || null, targetId: item.targetId || null })
        ]
      );
      // Re-claim the service request inside the transaction, not just at the
      // pre-check in commerce.service.js — closes the race where two
      // concurrent orders are created for the same unpaid service request.
      if (item.targetType === "SERVICE_REQUEST") {
        const claimed = await t.oneOrNone(
          `UPDATE commerce.service_requests
           SET status = 'PAYMENT_PENDING', order_id = $2
           WHERE id = $1 AND user_id = $3 AND status = 'REQUESTED' AND order_id IS NULL
           RETURNING id`,
          [item.targetId, order.id, userId]
        );
        if (!claimed) {
          const error = new Error("Service request is no longer payable.");
          error.code = "SERVICE_REQUEST_NOT_PAYABLE";
          throw error;
        }
      }
    }
    return order.id;
  });

export const findById = id =>
  run("oneOrNone", `SELECT ${orderColumns} FROM commerce.orders o WHERE o.id = $1`, [id]);

export const findOwnedByUser = (id, userId) =>
  run(
    "oneOrNone",
    `SELECT ${orderColumns} FROM commerce.orders o WHERE o.id = $1 AND o.user_id = $2`,
    [id, userId]
  );

export const listForUser = (userId, { status }, { limit, offset }) =>
  run(
    "any",
    `SELECT ${orderColumns}, count(*) OVER()::int AS total
     FROM commerce.orders o
     WHERE o.user_id = $1 AND ($2::varchar IS NULL OR o.status = $2)
     ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`,
    [userId, status, limit, offset]
  );

export const itemsForOrders = orderIds =>
  run(
    "any",
    `SELECT oi.order_id AS "orderId", oi.product_id AS "productId", pr.code, pr.name, oi.quantity,
            oi.unit_amount_minor AS "unitAmountMinor", oi.total_amount_minor AS "totalAmountMinor", oi.metadata
     FROM commerce.order_items oi
     JOIN commerce.products pr ON pr.id = oi.product_id
     WHERE oi.order_id = ANY($1::uuid[])
     ORDER BY oi.created_at`,
    [orderIds]
  );

export const setOrderStatus = (id, status) =>
  run("none", `UPDATE commerce.orders SET status = $2 WHERE id = $1`, [id, status]);

const paymentSelectColumns = `
  pay.id, pay.order_id AS "orderId", pay.provider, pay.provider_order_id AS "providerOrderId",
  pay.provider_payment_id AS "providerPaymentId", pay.status, pay.amount_minor AS "amountMinor",
  pay.currency, pay.paid_at AS "paidAt", pay.created_at AS "createdAt"
`;
const paymentInsertColumns = paymentSelectColumns.replace(/pay\./g, "");

// `id` is generated by the caller (not left to the column default) so it can
// be embedded in the Razorpay Payment Link's notes before this row exists —
// see commerce.service.js createPaymentIntent.
export const createPayment = ({ id, orderId, provider, providerOrderId, amountMinor, currency }) =>
  run(
    "one",
    `INSERT INTO commerce.payments (id, order_id, provider, provider_order_id, status, amount_minor, currency)
     VALUES ($1,$2,$3,$4,'CREATED',$5,$6)
     RETURNING ${paymentInsertColumns}`,
    [id, orderId, provider, providerOrderId, amountMinor, currency]
  );

export const findPaymentById = id =>
  run("oneOrNone", `SELECT ${paymentSelectColumns} FROM commerce.payments pay WHERE pay.id = $1`, [id]);

export const findPaymentByProviderOrderId = (provider, providerOrderId) =>
  run(
    "oneOrNone",
    `SELECT ${paymentSelectColumns} FROM commerce.payments pay
     WHERE pay.provider = $1 AND pay.provider_order_id = $2`,
    [provider, providerOrderId]
  );

// Explicitly fails any non-terminal payment attempt still open for this order
// before a fresh Payment Link is created for a retried /payments/:orderId/create
// call, per Section 8 of docs/razorpay-integration-plan.md.
export const failActivePaymentsForOrder = orderId =>
  run(
    "none",
    `UPDATE commerce.payments SET status = 'FAILED'
     WHERE order_id = $1 AND status IN ('CREATED','AUTHORIZED')`,
    [orderId]
  );

export const failPayment = ({ id, providerPayload }) =>
  pg.updateWhere({
    table: "commerce.payments",
    set: { status: "FAILED", provider_payload: providerPayload },
    where: "id = ${id}",
    params: { id },
    returning: paymentInsertColumns,
    jsonbCols: ["provider_payload"]
  });

// Extends an existing plan_subscriptions.ends_at, or starts a fresh window
// from `now` if there is no still-active existing entitlement to extend.
// Exported for unit testing independent of the database.
export const computePlanEndsAt = ({ existingEndsAt, durationDays, now }) => {
  if (durationDays == null) return null;
  const existingMs = existingEndsAt ? new Date(existingEndsAt).getTime() : 0;
  const base = existingMs > now.getTime() ? existingMs : now.getTime();
  return new Date(base + durationDays * 24 * 60 * 60 * 1000);
};

// Captures the payment, marks the order paid, and applies whatever product
// entitlement each order item grants — all in one transaction, so a payment
// is never left CAPTURED without its entitlement effect (or vice versa).
// Shared by both the Payment Link callback handler and the webhook handler
// (Sections 10-11 of docs/razorpay-integration-plan.md) so the two paths
// cannot disagree; each entitlement write is independently idempotent so
// calling this twice for the same payment is harmless.
export const capturePaymentAndApplyEntitlements = ({ id, orderId, providerPaymentId, providerPayload }) =>
  runTx(async t => {
    const payment = await t.one(
      `UPDATE commerce.payments
       SET status = 'CAPTURED', paid_at = now(), provider_payment_id = $2, provider_payload = $3::jsonb
       WHERE id = $1
       RETURNING ${paymentInsertColumns}`,
      [id, providerPaymentId, JSON.stringify(providerPayload || {})]
    );
    const order = await t.one(
      `UPDATE commerce.orders SET status = 'PAID' WHERE id = $1
       RETURNING user_id AS "userId", organization_id AS "organizationId"`,
      [orderId]
    );
    const items = await t.any(
      `SELECT oi.id AS "orderItemId", oi.metadata, p.type,
              pl.id AS "planId", pl.duration_days AS "durationDays",
              promo.promotion_type AS "promotionType", promo.duration_days AS "promotionDurationDays"
       FROM commerce.order_items oi
       JOIN commerce.products p ON p.id = oi.product_id
       LEFT JOIN commerce.plans pl ON pl.product_id = p.id
       LEFT JOIN commerce.promotion_catalog promo ON promo.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    const now = new Date();
    for (const item of items) {
      if (item.type === "PLAN") {
        const already = await t.oneOrNone(
          `SELECT id FROM commerce.plan_subscriptions WHERE order_item_id = $1`,
          [item.orderItemId]
        );
        if (already) continue;
        // Scoped to exactly this purchase's owner — a personal purchase
        // (organizationId null) must never match or expire an organization's
        // plan, and vice versa, even when the same person is on both sides.
        const existing = await t.oneOrNone(
          `SELECT id, ends_at AS "endsAt" FROM commerce.plan_subscriptions
           WHERE status = 'ACTIVE'
             AND (
               ($2::uuid IS NULL AND user_id = $1 AND organization_id IS NULL)
               OR ($2::uuid IS NOT NULL AND organization_id = $2)
             )
           ORDER BY ends_at DESC NULLS LAST LIMIT 1`,
          [order.userId, order.organizationId]
        );
        if (existing)
          await t.none(`UPDATE commerce.plan_subscriptions SET status = 'EXPIRED' WHERE id = $1`, [
            existing.id
          ]);
        const endsAt = computePlanEndsAt({
          existingEndsAt: existing?.endsAt,
          durationDays: item.durationDays,
          now
        });
        await t.none(
          `INSERT INTO commerce.plan_subscriptions
             (user_id, organization_id, plan_id, order_item_id, starts_at, ends_at, status)
           VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE')
           ON CONFLICT (order_item_id) DO NOTHING`,
          [order.userId, order.organizationId, item.planId, item.orderItemId, now, endsAt]
        );
      } else if (item.type === "PROMOTION") {
        const endsAt = new Date(now.getTime() + item.promotionDurationDays * 24 * 60 * 60 * 1000);
        await t.none(
          `INSERT INTO marketplace.listing_promotions
             (listing_id, promotion_type, order_item_id, starts_at, ends_at, status)
           VALUES ($1,$2,$3,$4,$5,'ACTIVE')
           ON CONFLICT (order_item_id) WHERE order_item_id IS NOT NULL DO NOTHING`,
          [item.metadata?.targetId, item.promotionType, item.orderItemId, now, endsAt]
        );
      } else if (item.type === "SERVICE") {
        await t.none(
          `UPDATE commerce.service_requests SET status = 'IN_PROGRESS'
           WHERE id = $1 AND order_id = $2 AND status = 'PAYMENT_PENDING'`,
          [item.metadata?.targetId, orderId]
        );
      }
    }

    return payment;
  });

// The ON CONFLICT DO UPDATE only fires (and thus RETURNING only yields a row)
// for a genuinely new event or a previously failed one ready for retry.
// markWebhookProcessed always sets processed_at, on both success and
// failure, so a failed event is only distinguishable by processing_error
// being non-null; the DO UPDATE claims the retry by clearing processed_at
// and processing_error in the same statement, so a duplicate delivery that
// arrives while this retry is in-flight sees processing_error already NULL
// and fails the WHERE clause instead of racing it to run capture/fail side
// effects twice. Postgres holds the row lock for the conflicting key while
// evaluating this, so concurrent deliveries for the same event serialize on it.
export const insertWebhookEvent = ({ provider, eventId, eventType, payload }) =>
  run(
    "oneOrNone",
    `INSERT INTO commerce.payment_webhook_events (provider, event_id, event_type, payload)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (provider, event_id) DO UPDATE
       SET event_type = EXCLUDED.event_type,
           processed_at = NULL,
           processing_error = NULL
       WHERE commerce.payment_webhook_events.processing_error IS NOT NULL
     RETURNING id, processed_at AS "processedAt", processing_error AS "processingError"`,
    [provider, eventId, eventType, JSON.stringify(payload || {})]
  );

export const markWebhookProcessed = (id, error = null) =>
  run(
    "none",
    `UPDATE commerce.payment_webhook_events SET processed_at = now(), processing_error = $2 WHERE id = $1`,
    [id, error]
  );

const serviceColumns = `
  sc.id, pr.id AS "productId", pr.code, sc.service_type AS "serviceType", pr.name, pr.description,
  pr.amount_minor AS "amountMinor", sc.requires_property AS "requiresProperty",
  sc.requires_documents AS "requiresDocuments", pr.is_active AS "isActive"
`;

export const listActiveServices = serviceType =>
  run(
    "any",
    `SELECT ${serviceColumns} FROM commerce.service_catalog sc
     JOIN commerce.products pr ON pr.id = sc.product_id
     WHERE pr.is_active = true AND pr.type = 'SERVICE'
       AND ($1::varchar IS NULL OR sc.service_type = $1)
     ORDER BY pr.name`,
    [serviceType]
  );

export const findServiceById = id =>
  run(
    "oneOrNone",
    `SELECT ${serviceColumns} FROM commerce.service_catalog sc
     JOIN commerce.products pr ON pr.id = sc.product_id
     WHERE sc.id = $1`,
    [id]
  );

export const servicesByIds = ids =>
  run(
    "any",
    `SELECT ${serviceColumns} FROM commerce.service_catalog sc
     JOIN commerce.products pr ON pr.id = sc.product_id
     WHERE sc.id = ANY($1::uuid[])`,
    [ids]
  );

const serviceRequestColumns = `
  sr.id, sr.service_id AS "serviceId", sr.user_id AS "userId", sr.property_id AS "propertyId",
  sr.listing_id AS "listingId", sr.order_id AS "orderId", sr.status,
  sr.assigned_to_user_id AS "assignedToUserId", sr.customer_notes AS "customerNotes",
  sr.internal_notes AS "internalNotes", sr.contact_phone AS "contactPhone", sr.contact_email AS "contactEmail",
  sr.completed_report_storage_key AS "completedReportStorageKey", sr.report_summary AS "reportSummary",
  sr.created_at AS "createdAt", sr.updated_at AS "updatedAt", sr.completed_at AS "completedAt"
`;
const serviceRequestInsertColumns = serviceRequestColumns.replace(/sr\./g, "");

export const createServiceRequest = ({
  serviceId,
  userId,
  propertyId,
  listingId,
  customerNotes,
  contactPhone,
  contactEmail
}) =>
  pg.one(
    `INSERT INTO commerce.service_requests (service_id, user_id, property_id, listing_id, customer_notes, contact_phone, contact_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING ${serviceRequestInsertColumns}`,
    [serviceId, userId, propertyId, listingId, customerNotes, contactPhone, contactEmail]
  );

export const findServiceRequestById = id =>
  run(
    "oneOrNone",
    `SELECT ${serviceRequestColumns} FROM commerce.service_requests sr WHERE sr.id = $1`,
    [id]
  );

export const findServiceRequestOwnedByUser = (id, userId) =>
  run(
    "oneOrNone",
    `SELECT ${serviceRequestColumns} FROM commerce.service_requests sr WHERE sr.id = $1 AND sr.user_id = $2`,
    [id, userId]
  );

export const listServiceRequestsForUser = (userId, { status }, { limit, offset }) =>
  run(
    "any",
    `SELECT ${serviceRequestColumns}, count(*) OVER()::int AS total
     FROM commerce.service_requests sr
     WHERE sr.user_id = $1 AND ($2::varchar IS NULL OR sr.status = $2)
     ORDER BY sr.created_at DESC LIMIT $3 OFFSET $4`,
    [userId, status, limit, offset]
  );

export const listServiceRequestsAdmin = ({ status, serviceType, search }, { limit, offset }) =>
  run(
    "any",
    `SELECT ${serviceRequestColumns}, count(*) OVER()::int AS total
     FROM commerce.service_requests sr
     JOIN commerce.service_catalog sc ON sc.id = sr.service_id
     JOIN auth.users u ON u.id = sr.user_id
     LEFT JOIN land.properties p ON p.id = sr.property_id
     WHERE ($1::varchar IS NULL OR sr.status = $1)
       AND ($2::varchar IS NULL OR sc.service_type = $2)
       AND ($3::varchar IS NULL OR u.display_name ILIKE $3 OR u.phone_e164 ILIKE $3
            OR u.email::text ILIKE $3 OR p.public_code ILIKE $3)
     ORDER BY sr.created_at DESC LIMIT $4 OFFSET $5`,
    [status, serviceType, search ? `%${search}%` : null, limit, offset]
  );

export const setServiceRequestStatus = ({ id, status, internalNote }) => {
  const set = { status };
  if (internalNote !== undefined) set.internal_notes = internalNote;
  if (status === "COMPLETED") set.completed_at = new Date();
  return pg.updateWhere({
    table: "commerce.service_requests",
    set,
    where: "id = ${id}",
    params: { id },
    returning: serviceRequestInsertColumns
  });
};

export const setServiceRequestReport = ({ id, storageKey, summary }) =>
  pg.updateWhere({
    table: "commerce.service_requests",
    set: {
      status: "COMPLETED",
      completed_report_storage_key: storageKey,
      report_summary: summary,
      completed_at: new Date()
    },
    where: "id = ${id}",
    params: { id },
    returning: serviceRequestInsertColumns
  });

const serviceRequestFileColumns = `
  f.id, f.storage_key AS "storageKey", f.file_name AS "fileName", f.mime_type AS "mimeType",
  f.file_size_bytes AS "fileSizeBytes", f.uploaded_by_user_id AS "uploadedByUserId", f.created_at AS "createdAt"
`;

export const insertServiceRequestFile = ({
  serviceRequestId,
  storageKey,
  fileName,
  mimeType,
  fileSizeBytes,
  uploadedByUserId
}) =>
  run(
    "one",
    `INSERT INTO commerce.service_request_files (service_request_id, storage_key, file_name, mime_type, file_size_bytes, uploaded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${serviceRequestFileColumns.replace(/f\./g, "")}`,
    [serviceRequestId, storageKey, fileName, mimeType, fileSizeBytes, uploadedByUserId]
  );

export const filesForServiceRequests = serviceRequestIds =>
  run(
    "any",
    `SELECT f.service_request_id AS "serviceRequestId", ${serviceRequestFileColumns} FROM commerce.service_request_files f
     WHERE f.service_request_id = ANY($1::uuid[]) ORDER BY f.created_at`,
    [serviceRequestIds]
  );
