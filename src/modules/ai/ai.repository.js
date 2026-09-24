import { pg, run } from "../../shared/db.js";

const runTx = async fn => {
  const result = await pg.tx(fn);
  if (!result.ok) throw result.error;
  return result.data;
};

const conversationColumns = `id, user_id AS "userId", context_type AS "contextType", listing_id AS "listingId", title, created_at AS "createdAt", updated_at AS "updatedAt"`;
const listedConversationColumns = `conversation.id, conversation.user_id AS "userId", conversation.context_type AS "contextType", conversation.listing_id AS "listingId", conversation.title, conversation.created_at AS "createdAt", conversation.updated_at AS "updatedAt"`;
export const createConversation = ({ userId, contextType, listingId, title }) =>
  pg.one(
    `INSERT INTO ai.conversations (user_id, context_type, listing_id, title)
     VALUES ($1,$2,$3,$4) RETURNING ${conversationColumns}`,
    [userId, contextType, listingId, title]
  );
export const conversation = id =>
  run(
    "oneOrNone",
    `SELECT ${conversationColumns} FROM ai.conversations WHERE id = $1`,
    [id]
  );
export const addMessage = ({
  conversationId,
  role,
  content,
  metadata = null
}) =>
  pg.one(
    `WITH inserted AS (
       INSERT INTO ai.messages (conversation_id, role, content, metadata)
       VALUES ($1,$2,$3,$4::jsonb)
       RETURNING id, conversation_id, role, content, metadata, created_at
     ), touched AS (
       UPDATE ai.conversations conversation
       SET title = COALESCE(conversation.title, CASE WHEN $2 = 'USER' THEN left($3, 255) END),
           updated_at = now()
       FROM inserted
       WHERE conversation.id = inserted.conversation_id
     )
     SELECT id, role, content, metadata, created_at AS "createdAt" FROM inserted`,
    [conversationId, role, content, metadata ? JSON.stringify(metadata) : null]
  );
// Only ever called on a failed/aborted chat attempt (see ai.service.js
// streamMessage's finally block) — the USER row this attempt saved must not
// linger as an unanswered turn that a later request's `messages.slice(-20)`
// would replay into the model's context, or that GET
// /ai/conversations/:id would show with no reply. role = 'USER' is a
// defensive scope, never intended to delete an ASSISTANT/SYSTEM row.
export const deleteMessage = id =>
  run("none", `DELETE FROM ai.messages WHERE id = $1 AND role = 'USER'`, [id]);
export const messages = conversationId =>
  run(
    "any",
    `SELECT id, role, content, metadata, created_at AS "createdAt" FROM ai.messages WHERE conversation_id = $1 ORDER BY created_at, id`,
    [conversationId]
  );

// Read-only current-month usage count for display (GET /me/subscription) —
// never used for enforcement, which always goes through reserveAiQuotaUsage's
// locked read-then-write below.
export const countMonthlyUsageForUser = userId =>
  run(
    "one",
    `SELECT count(*)::int AS count FROM ai.usage_events
     WHERE user_id = $1 AND organization_id IS NULL AND reserved_at >= date_trunc('month', now())
       AND (confirmed_at IS NOT NULL OR reserved_at > now() - interval '5 minutes')`,
    [userId]
  ).then(row => row.count);

// Atomically reserves one unit of monthly AI quota, from one of two mutually
// exclusive pools: the calling user's own personal quota (organizationId
// null) or their organization's shared quota (organizationId set, consumed
// together by every member the organization's plan applies to) — chat
// answers, /ai/search and /ai/listing/generate all draw from the same pool
// per scope (see migrations/008_ai_usage_events.sql,
// migrations/015_ai_org_quota.sql). The advisory lock is keyed on whichever
// scope is being charged (the org, or the user), so concurrent callers
// against the same pool serialize instead of racing past a low quota
// together — two requests started at once against a quota of 1 can't both
// pass the count check before either's reservation lands. Returns the
// reservation id, or null if quota is already used up.
export const reserveAiQuotaUsage = ({ userId, organizationId, quota, kind }) =>
  runTx(async t => {
    const lockKey = organizationId || userId;
    await t.any(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [lockKey]);
    const usage = await t.one(
      organizationId
        ? `SELECT count(*)::int AS used FROM ai.usage_events
           WHERE organization_id = $1 AND reserved_at >= date_trunc('month', now())
             AND (confirmed_at IS NOT NULL OR reserved_at > now() - interval '5 minutes')`
        : `SELECT count(*)::int AS used FROM ai.usage_events
           WHERE user_id = $1 AND organization_id IS NULL AND reserved_at >= date_trunc('month', now())
             AND (confirmed_at IS NOT NULL OR reserved_at > now() - interval '5 minutes')`,
      [lockKey]
    );
    if (usage.used >= quota) return null;
    const row = await t.one(
      `INSERT INTO ai.usage_events (user_id, organization_id, kind) VALUES ($1, $2, $3) RETURNING id`,
      [userId, organizationId, kind]
    );
    return row.id;
  });

// Converts a reservation into permanent usage for the rest of the month —
// called once the reserved attempt actually produced a billable result.
export const confirmAiQuotaUsage = id =>
  run("none", `UPDATE ai.usage_events SET confirmed_at = now() WHERE id = $1`, [id]);

// Releases a reservation that didn't pan out (failed/aborted attempt) so it
// never counts against quota, matching the pre-existing "answered questions
// only" invariant.
export const releaseAiQuotaUsage = id =>
  run("none", `DELETE FROM ai.usage_events WHERE id = $1`, [id]);
export const conversationsForUser = (userId, { limit, offset }) =>
  run(
    "any",
    `SELECT ${listedConversationColumns}, count(*) OVER()::int AS total,
       latest.role AS "lastMessageRole", latest.content AS "lastMessageContent",
       latest.created_at AS "lastMessageAt"
     FROM ai.conversations conversation
     LEFT JOIN LATERAL (
       SELECT role, content, created_at
       FROM ai.messages
       WHERE conversation_id = conversation.id
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     ) latest ON true
     WHERE conversation.user_id = $1
     ORDER BY conversation.updated_at DESC, conversation.id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
export const listingContext = id =>
  run(
    "oneOrNone",
    `SELECT p.id AS "propertyId", pt.id AS "propertyTypeId", pt.name AS "propertyType", d.area_value AS "areaValue", au.name AS "areaUnit",
       loc.id AS "locationId", loc.name AS "locationName", l.price_amount_minor AS "priceAmountMinor"
     FROM marketplace.listings l JOIN land.properties p ON p.id = l.property_id
     JOIN land.property_types pt ON pt.id = p.property_type_id
     LEFT JOIN land.property_land_details d ON d.property_id = p.id
     LEFT JOIN land.area_units au ON au.id = d.area_unit_id
     LEFT JOIN land.property_locations pl ON pl.property_id = p.id
     LEFT JOIN geo.locations loc ON loc.id = pl.location_id
     WHERE l.id = $1 AND l.deleted_at IS NULL AND l.status = 'PUBLISHED' AND l.review_status = 'APPROVED'
       AND (l.expires_at IS NULL OR l.expires_at > now())`,
    [id]
  );

export const searchCatalog = () =>
  run(
    "one",
    `SELECT
       (SELECT COALESCE(json_agg(json_build_object('code', code, 'name', name) ORDER BY sort_order, name), '[]'::json)
        FROM land.property_types WHERE is_active) AS "propertyTypes",
       (SELECT COALESCE(json_agg(json_build_object('code', code, 'name', name) ORDER BY name), '[]'::json)
        FROM land.area_units WHERE is_active AND state_location_id IS NULL) AS "areaUnits"`
  );

export const resolveSearchReferences = ({
  locationTerms,
  propertyTypeCodes,
  areaUnitCode
}) =>
  run(
    "one",
    `SELECT
       (SELECT COALESCE(array_agg(DISTINCT id), '{}'::uuid[])
        FROM geo.locations
        WHERE is_active AND lower(name) = ANY($1::text[])) AS "locationIds",
       (SELECT COALESCE(array_agg(id), '{}'::uuid[])
        FROM land.property_types
        WHERE is_active AND upper(code) = ANY($2::text[])) AS "propertyTypeIds",
       (SELECT id FROM land.area_units
        WHERE is_active AND state_location_id IS NULL AND upper(code) = upper($3::varchar)
        ORDER BY id LIMIT 1) AS "areaUnitId"`,
    [
      [
        ...new Set(
          (locationTerms || []).map(term =>
            String(term)
              .trim()
              .toLowerCase()
          )
        )
      ],
      [
        ...new Set(
          (propertyTypeCodes || []).map(code =>
            String(code)
              .trim()
              .toUpperCase()
          )
        )
      ],
      areaUnitCode || null
    ]
  );

export const publishedContentContext = ({ language, locationId, query }) =>
  run(
    "any",
    `SELECT ci.id, ct.slug, ct.title, left(COALESCE(ct.summary, ct.body, ''), 750) AS summary
     FROM content.content_items ci
     JOIN content.content_translations ct ON ct.content_id = ci.id AND ct.language_code = $1
     WHERE ci.deleted_at IS NULL AND ci.status = 'PUBLISHED'
       AND ($2::uuid IS NULL OR ci.location_id IS NULL OR ci.location_id = $2)
     ORDER BY
       CASE WHEN $3::text IS NOT NULL AND to_tsvector('simple', ct.title || ' ' || coalesce(ct.summary, '') || ' ' || coalesce(ct.body, '')) @@ plainto_tsquery('simple', $3) THEN 0 ELSE 1 END,
       ts_rank(to_tsvector('simple', ct.title || ' ' || coalesce(ct.summary, '') || ' ' || coalesce(ct.body, '')), plainto_tsquery('simple', coalesce($3, ''))) DESC,
       CASE WHEN ci.location_id = $2::uuid THEN 0 ELSE 1 END,
       ci.published_at DESC NULLS LAST, ci.created_at DESC
     LIMIT 3`,
    [language, locationId, query || null]
  );

export const marketTrendContext = ({ locationId, propertyTypeId }) =>
  run(
    "any",
    `SELECT mts.id, mts.metric, mts.unit, loc.name AS "locationName", pt.name AS "propertyType",
       mts.source_name AS "sourceName", mts.source_url AS "sourceUrl",
       COALESCE((
         SELECT json_agg(json_build_object('periodDate', point.period_date, 'value', point.value) ORDER BY point.period_date)
         FROM (
           SELECT period_date, value FROM content.market_trend_points
           WHERE series_id = mts.id ORDER BY period_date DESC LIMIT 6
         ) point
       ), '[]'::json) AS points
     FROM content.market_trend_series mts
     JOIN geo.locations loc ON loc.id = mts.location_id
     LEFT JOIN land.property_types pt ON pt.id = mts.property_type_id
     WHERE ($1::uuid IS NOT NULL AND mts.location_id = $1)
       AND ($2::uuid IS NULL OR mts.property_type_id IS NULL OR mts.property_type_id = $2)
     ORDER BY CASE WHEN mts.property_type_id = $2::uuid THEN 0 ELSE 1 END, mts.updated_at DESC
     LIMIT 3`,
    [locationId, propertyTypeId]
  );

export const publishedInvestmentContext = ({ locationId, propertyId, query }) =>
  run(
    "any",
    `SELECT io.id, io.title, io.investment_type AS "investmentType",
       io.minimum_investment_minor AS "minimumInvestmentMinor",
       left(COALESCE(io.description, ''), 750) AS description,
       loc.name AS "locationName", io.published_at AS "publishedAt"
     FROM content.investment_opportunities io
     LEFT JOIN geo.locations loc ON loc.id = io.location_id
     WHERE io.status = 'PUBLISHED'
       AND ($1::uuid IS NULL OR io.location_id IS NULL OR io.location_id = $1 OR io.property_id = $2::uuid)
     ORDER BY
       CASE WHEN $3::text IS NOT NULL AND to_tsvector('simple', io.title || ' ' || coalesce(io.description, '')) @@ plainto_tsquery('simple', $3) THEN 0 ELSE 1 END,
       ts_rank(to_tsvector('simple', io.title || ' ' || coalesce(io.description, '')), plainto_tsquery('simple', coalesce($3, ''))) DESC,
       io.published_at DESC NULLS LAST, io.created_at DESC
     LIMIT 3`,
    [locationId, propertyId, query || null]
  );
// owner_organization_id is included so ai.service.js#generateListing can
// draw AI quota from the property's own owning org when it's org-owned,
// without the caller having to separately name that org explicitly — this
// is resource-ownership-based org resolution, distinct from (and safer
// than) auto-detecting across every org the caller happens to belong to.
export const ownedPropertyContext = (propertyId, userId) =>
  run(
    "oneOrNone",
    `SELECT p.id AS "propertyId", p.owner_organization_id AS "ownerOrganizationId", pt.name AS "propertyType", d.area_value AS "areaValue", au.name AS "areaUnit", loc.name AS "locationName"
     FROM land.properties p JOIN land.property_types pt ON pt.id = p.property_type_id
     LEFT JOIN land.property_land_details d ON d.property_id = p.id
     LEFT JOIN land.area_units au ON au.id = d.area_unit_id
     LEFT JOIN land.property_locations pl ON pl.property_id = p.id
     LEFT JOIN geo.locations loc ON loc.id = pl.location_id
     WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.created_by_user_id = $2 OR EXISTS (SELECT 1 FROM account.organization_members om WHERE om.organization_id = p.owner_organization_id AND om.user_id = $2 AND om.status = 'ACTIVE'))`,
    [propertyId, userId]
  );
export const propertyType = id =>
  run(
    "oneOrNone",
    `SELECT name FROM land.property_types WHERE id = $1 AND is_active`,
    [id]
  );
