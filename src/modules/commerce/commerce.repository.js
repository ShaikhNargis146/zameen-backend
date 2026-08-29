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
  pl.verification_included AS "verificationIncluded", pl.features, pr.is_active AS "isActive"
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
  features
}) =>
  runTx(async t => {
    const product = await t.one(
      `INSERT INTO commerce.products (code, type, name, description, amount_minor, currency, is_active)
       VALUES ($1,'PLAN',$2,$3,$4,$5,$6) RETURNING id`,
      [code, name, description, amountMinor, currency, isActive]
    );
    const plan = await t.one(
      `INSERT INTO commerce.plans (product_id, plan_type, duration_days, listing_limit, featured_days, verification_included, features)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
      [
        product.id,
        planType,
        durationDays,
        listingLimit,
        featuredDays,
        verificationIncluded,
        JSON.stringify(features || {})
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
  features: "features"
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
    `SELECT id, code, name, amount_minor AS "amountMinor", currency, is_active AS "isActive"
     FROM commerce.products WHERE id = ANY($1::uuid[])`,
    [ids]
  );

const orderColumns = `
  o.id, o.order_number AS "orderNumber", o.user_id AS "userId", o.organization_id AS "organizationId",
  o.status, o.subtotal_minor AS "subtotalMinor", o.tax_minor AS "taxMinor", o.total_minor AS "totalMinor",
  o.currency, o.created_at AS "createdAt",
  (SELECT p.paid_at FROM commerce.payments p WHERE p.order_id = o.id AND p.status = 'CAPTURED'
   ORDER BY p.paid_at DESC LIMIT 1) AS "paidAt"
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

export const createPayment = ({ orderId, provider, providerOrderId, amountMinor, currency }) =>
  run(
    "one",
    `INSERT INTO commerce.payments (order_id, provider, provider_order_id, status, amount_minor, currency)
     VALUES ($1,$2,$3,'CREATED',$4,$5)
     RETURNING ${paymentInsertColumns}`,
    [orderId, provider, providerOrderId, amountMinor, currency]
  );

export const findPaymentOwnedByUser = (id, userId) =>
  run(
    "oneOrNone",
    `SELECT ${paymentSelectColumns} FROM commerce.payments pay
     JOIN commerce.orders o ON o.id = pay.order_id
     WHERE pay.id = $1 AND o.user_id = $2`,
    [id, userId]
  );

export const findPaymentByProviderOrderId = (provider, providerOrderId) =>
  run(
    "oneOrNone",
    `SELECT ${paymentSelectColumns} FROM commerce.payments pay
     WHERE pay.provider = $1 AND pay.provider_order_id = $2`,
    [provider, providerOrderId]
  );

export const capturePayment = ({ id, providerPaymentId, providerPayload }) =>
  pg.updateWhere({
    table: "commerce.payments",
    set: {
      status: "CAPTURED",
      paid_at: new Date(),
      provider_payment_id: providerPaymentId,
      provider_payload: providerPayload
    },
    where: "id = ${id}",
    params: { id },
    returning: paymentInsertColumns,
    jsonbCols: ["provider_payload"]
  });

export const capturePaymentAndMarkOrderPaid = ({ id, orderId, providerPaymentId, providerPayload }) =>
  runTx(async t => {
    const payment = await t.one(
      `UPDATE commerce.payments
       SET status = 'CAPTURED', paid_at = now(), provider_payment_id = $2, provider_payload = $3::jsonb
       WHERE id = $1
       RETURNING ${paymentInsertColumns}`,
      [id, providerPaymentId, JSON.stringify(providerPayload || {})]
    );
    await t.none(`UPDATE commerce.orders SET status = 'PAID' WHERE id = $1`, [orderId]);
    return payment;
  });

export const failPayment = ({ id, providerPayload }) =>
  pg.updateWhere({
    table: "commerce.payments",
    set: { status: "FAILED", provider_payload: providerPayload },
    where: "id = ${id}",
    params: { id },
    returning: paymentInsertColumns,
    jsonbCols: ["provider_payload"]
  });

export const insertWebhookEvent = ({ provider, eventId, eventType, payload }) =>
  run(
    "one",
    `INSERT INTO commerce.payment_webhook_events (provider, event_id, event_type, payload)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (provider, event_id) DO UPDATE SET event_type = EXCLUDED.event_type
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
  sc.id, pr.code, sc.service_type AS "serviceType", pr.name, pr.description,
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
