import { run } from "../../shared/db.js";

const sellerScope = (listingAlias = "l") => `(
  ($2::uuid IS NULL AND (${listingAlias}.seller_user_id = $1 OR EXISTS (
    SELECT 1 FROM account.organization_members om
    WHERE om.organization_id = ${listingAlias}.seller_organization_id AND om.user_id = $1 AND om.status = 'ACTIVE'
  )))
  OR ($2::uuid IS NOT NULL AND ${listingAlias}.seller_organization_id = $2)
)`;

const inRange = (column, fromIndex, toIndex) => `
  ($${fromIndex}::date IS NULL OR ${column} >= $${fromIndex}::date)
  AND ($${toIndex}::date IS NULL OR ${column} < ($${toIndex}::date + interval '1 day'))
`;

export const listingCounts = (actorId, organizationId) =>
  run(
    "one",
    `SELECT
       count(*) FILTER (WHERE l.status = 'PUBLISHED')::int AS "activeListings",
       count(*) FILTER (WHERE l.review_status = 'DRAFT')::int AS "draftListings",
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM marketplace.listing_promotions promo
         WHERE promo.listing_id = l.id AND promo.promotion_type = 'PREMIUM' AND promo.status = 'ACTIVE'
           AND promo.starts_at <= now() AND (promo.ends_at IS NULL OR promo.ends_at > now())
       ))::int AS "premiumListings"
     FROM marketplace.listings l
     WHERE l.deleted_at IS NULL AND ${sellerScope()}`,
    [actorId, organizationId]
  );

export const totalViews = (actorId, organizationId, fromDate, toDate) =>
  run(
    "one",
    `SELECT count(*)::int AS count
     FROM marketplace.listing_events ev
     JOIN marketplace.listings l ON l.id = ev.listing_id AND l.deleted_at IS NULL
     WHERE ev.event_type = 'VIEW' AND ${sellerScope()} AND ${inRange("ev.created_at", 3, 4)}`,
    [actorId, organizationId, fromDate, toDate]
  );

export const enquiryCounts = (actorId, organizationId, fromDate, toDate) =>
  run(
    "one",
    `SELECT
       count(*)::int AS "totalEnquiries",
       count(*) FILTER (WHERE e.status = 'NEW')::int AS "newEnquiries"
     FROM marketplace.enquiries e
     JOIN marketplace.listings l ON l.id = e.listing_id AND l.deleted_at IS NULL
     WHERE ${sellerScope()} AND ${inRange("e.created_at", 3, 4)}`,
    [actorId, organizationId, fromDate, toDate]
  );

export const siteVisitCount = (actorId, organizationId, fromDate, toDate) =>
  run(
    "one",
    `SELECT count(*)::int AS count
     FROM marketplace.site_visits sv
     JOIN marketplace.listings l ON l.id = sv.listing_id AND l.deleted_at IS NULL
     WHERE ${sellerScope()} AND ${inRange("sv.created_at", 3, 4)}`,
    [actorId, organizationId, fromDate, toDate]
  );

export const recentEnquiries = (actorId, organizationId, limit) =>
  run(
    "any",
    `SELECT e.id, e.listing_id AS "listingId", e.buyer_user_id AS "buyerUserId", e.enquiry_type AS "enquiryType",
            e.message, e.status, e.assigned_to_user_id AS "assignedToUserId",
            e.created_at AS "createdAt", e.updated_at AS "updatedAt"
     FROM marketplace.enquiries e
     JOIN marketplace.listings l ON l.id = e.listing_id AND l.deleted_at IS NULL
     WHERE ${sellerScope()}
     ORDER BY e.created_at DESC
     LIMIT $3`,
    [actorId, organizationId, limit]
  );

export const topListings = (actorId, organizationId, fromDate, toDate, limit) =>
  run(
    "any",
    `SELECT l.id AS "listingId", l.title,
            count(DISTINCT ev.id)::int AS views,
            count(DISTINCT e.id)::int AS enquiries
     FROM marketplace.listings l
     LEFT JOIN marketplace.listing_events ev ON ev.listing_id = l.id AND ev.event_type = 'VIEW'
       AND ${inRange("ev.created_at", 3, 4)}
     LEFT JOIN marketplace.enquiries e ON e.listing_id = l.id
       AND ${inRange("e.created_at", 3, 4)}
     WHERE l.deleted_at IS NULL AND ${sellerScope()}
     GROUP BY l.id, l.title
     ORDER BY views DESC, enquiries DESC, l.created_at DESC
     LIMIT $5`,
    [actorId, organizationId, fromDate, toDate, limit]
  );
