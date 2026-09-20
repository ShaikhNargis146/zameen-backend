import { pg, run } from "../../shared/db.js";

const runTx = async fn => {
  const result = await pg.tx(fn);
  if (!result.ok) throw result.error;
  return result.data;
};

const selectColumns = `
  e.id, e.listing_id AS "listingId", e.buyer_user_id AS "buyerUserId", e.enquiry_type AS "enquiryType",
  e.message, e.status, e.assigned_to_user_id AS "assignedToUserId",
  e.created_at AS "createdAt", e.updated_at AS "updatedAt"
`;
const insertColumns = selectColumns.replace(/e\./g, "");

const sellerOwnsListing = paramIndex => `EXISTS (
  SELECT 1 FROM marketplace.listings l
  WHERE l.id = e.listing_id AND l.deleted_at IS NULL
    AND (l.seller_user_id = $${paramIndex} OR EXISTS (
      SELECT 1 FROM account.organization_members om
      WHERE om.organization_id = l.seller_organization_id AND om.user_id = $${paramIndex} AND om.status = 'ACTIVE'
    ))
)`;

// Key shared with site-visits.repository.js's own advisory lock — both
// enquiry creation and site-visit creation for the same buyer+listing must
// serialize against each other, or one can read "no unlinked visit"/"no
// open enquiry" a moment before the other commits, leaving both rows
// permanently unlinked (each only links at its own creation time; nothing
// sweeps up afterward).
const linkingLockKey = (listingId, buyerUserId) => `${listingId}:${buyerUserId}:enquiry-visit-link`;

export const insertAndLinkUnlinkedVisits = ({
  listingId,
  buyerUserId,
  enquiryType,
  message
}) =>
  runTx(async t => {
    await t.none(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      linkingLockKey(listingId, buyerUserId)
    ]);
    const unlinkedVisits = await t.any(
      `SELECT id FROM marketplace.site_visits
       WHERE enquiry_id IS NULL AND listing_id = $1 AND buyer_user_id = $2 AND status <> 'CANCELLED'`,
      [listingId, buyerUserId]
    );
    const enquiry = await t.one(
      `INSERT INTO marketplace.enquiries (listing_id, buyer_user_id, enquiry_type, message, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${insertColumns}`,
      [listingId, buyerUserId, enquiryType, message, unlinkedVisits.length ? "SITE_VISIT" : "NEW"]
    );
    if (unlinkedVisits.length)
      await t.none(
        `UPDATE marketplace.site_visits SET enquiry_id = $1 WHERE id = ANY($2::uuid[])`,
        [enquiry.id, unlinkedVisits.map(visit => visit.id)]
      );
    return enquiry;
  });

// Atomically finds the buyer's open enquiry for this listing, or creates one
// (linking any unlinked site visits, same as insertAndLinkUnlinkedVisits) if
// none exists — used by contactReveal so two concurrent "reveal contact"
// calls can't both see no open enquiry and both create one, each firing its
// own seller notification for the same buyer action.
export const findOrCreateEnquiryForContactReveal = ({
  listingId,
  buyerUserId,
  enquiryType,
  message
}) =>
  runTx(async t => {
    await t.none(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      linkingLockKey(listingId, buyerUserId)
    ]);
    const existing = await t.oneOrNone(
      `SELECT ${insertColumns} FROM marketplace.enquiries
       WHERE listing_id = $1 AND buyer_user_id = $2 AND status NOT IN ('CLOSED','LOST')
       ORDER BY created_at DESC LIMIT 1`,
      [listingId, buyerUserId]
    );
    if (existing) return { enquiry: existing, created: false };

    const unlinkedVisits = await t.any(
      `SELECT id FROM marketplace.site_visits
       WHERE enquiry_id IS NULL AND listing_id = $1 AND buyer_user_id = $2 AND status <> 'CANCELLED'`,
      [listingId, buyerUserId]
    );
    const enquiry = await t.one(
      `INSERT INTO marketplace.enquiries (listing_id, buyer_user_id, enquiry_type, message, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${insertColumns}`,
      [listingId, buyerUserId, enquiryType, message, unlinkedVisits.length ? "SITE_VISIT" : "NEW"]
    );
    if (unlinkedVisits.length)
      await t.none(
        `UPDATE marketplace.site_visits SET enquiry_id = $1 WHERE id = ANY($2::uuid[])`,
        [enquiry.id, unlinkedVisits.map(visit => visit.id)]
      );
    return { enquiry, created: true };
  });

// Used to block a seller from enquiring on (or contact-revealing) their own
// listing — see enquiries.service.js create/contactReveal.
export const listingOwnedBySeller = (listingId, sellerId) =>
  run(
    "oneOrNone",
    `SELECT 1 FROM marketplace.listings l
     WHERE l.id = $1 AND l.deleted_at IS NULL
       AND (l.seller_user_id = $2 OR EXISTS (
         SELECT 1 FROM account.organization_members om
         WHERE om.organization_id = l.seller_organization_id AND om.user_id = $2 AND om.status = 'ACTIVE'
       ))`,
    [listingId, sellerId]
  ).then(Boolean);

export const findOwnedByBuyer = (id, buyerId) =>
  run(
    "oneOrNone",
    `SELECT ${selectColumns} FROM marketplace.enquiries e WHERE e.id = $1 AND e.buyer_user_id = $2`,
    [id, buyerId]
  );

export const findOwnedBySeller = (id, sellerId) =>
  run(
    "oneOrNone",
    `SELECT ${selectColumns} FROM marketplace.enquiries e WHERE e.id = $1 AND ${sellerOwnsListing(
      2
    )}`,
    [id, sellerId]
  );

export const listForBuyer = (
  buyerId,
  { status, listingId },
  { limit, offset }
) =>
  run(
    "any",
    `SELECT ${selectColumns}, count(*) OVER()::int AS total
     FROM marketplace.enquiries e
     WHERE e.buyer_user_id = $1
       AND ($2::varchar IS NULL OR e.status = $2)
       AND ($3::uuid IS NULL OR e.listing_id = $3)
     ORDER BY e.created_at DESC LIMIT $4 OFFSET $5`,
    [buyerId, status || null, listingId || null, limit, offset]
  );

export const listForSeller = (
  sellerId,
  { status, listingId, search },
  { limit, offset }
) =>
  run(
    "any",
    `SELECT ${selectColumns}, count(*) OVER()::int AS total
     FROM marketplace.enquiries e
     JOIN marketplace.listings l ON l.id = e.listing_id AND l.deleted_at IS NULL
     LEFT JOIN auth.users buyer ON buyer.id = e.buyer_user_id
     WHERE ${sellerOwnsListing(1)}
       AND ($2::varchar IS NULL OR e.status = $2)
       AND ($3::uuid IS NULL OR e.listing_id = $3)
       AND ($4::varchar IS NULL OR buyer.display_name ILIKE $4 OR buyer.phone_e164 ILIKE $4 OR buyer.email::text ILIKE $4 OR l.title ILIKE $4)
     ORDER BY e.created_at DESC LIMIT $5 OFFSET $6`,
    [
      sellerId,
      status || null,
      listingId || null,
      search ? `%${search}%` : null,
      limit,
      offset
    ]
  );

// Compare-and-swap on the enquiry's status at the moment the caller read it
// — guards the state-machine check in enquiries.service.js against two
// concurrent PATCHes both reading the same starting status and both being
// individually valid transitions that shouldn't both be allowed to land.
// Returns null (not an error) when fromStatus no longer matches, which the
// service maps to a 409.
export const updateStatus = (id, fromStatus, status) =>
  pg.updateWhere({
    table: "marketplace.enquiries",
    set: { status },
    where: "id = ${id} AND status = ${fromStatus}",
    params: { id, fromStatus },
    returning: insertColumns
  });

export const insertNote = ({ enquiryId, createdByUserId, note }) =>
  run(
    "one",
    `INSERT INTO marketplace.enquiry_notes (enquiry_id, created_by_user_id, note)
     VALUES ($1,$2,$3)
     RETURNING id, note, created_by_user_id AS "createdByUserId", created_at AS "createdAt"`,
    [enquiryId, createdByUserId, note]
  );

export const notesForEnquiry = enquiryId =>
  run(
    "any",
    `SELECT id, note, created_by_user_id AS "createdByUserId", created_at AS "createdAt"
     FROM marketplace.enquiry_notes WHERE enquiry_id = $1 ORDER BY created_at`,
    [enquiryId]
  );

export const siteVisitsForEnquiry = enquiryId =>
  run(
    "any",
    `SELECT id, listing_id AS "listingId", buyer_user_id AS "buyerUserId", enquiry_id AS "enquiryId",
            to_char(preferred_date, 'YYYY-MM-DD') AS "preferredDate", preferred_time_slot AS "preferredTimeSlot",
            visitor_count AS "visitorCount", requested_at AS "requestedAt", scheduled_at AS "scheduledAt", status,
            seller_note AS "sellerNote", buyer_note AS "buyerNote", created_at AS "createdAt"
     FROM marketplace.site_visits
     WHERE enquiry_id = $1
     ORDER BY created_at DESC`,
    [enquiryId]
  );

export const sellerContactInfo = listingId =>
  run(
    "oneOrNone",
    `SELECT
       CASE WHEN l.seller_user_id IS NOT NULL THEN u.display_name ELSE org.name END AS "sellerName",
       CASE WHEN l.seller_user_id IS NOT NULL THEN u.phone_e164 ELSE org.phone END AS "phoneE164",
       CASE WHEN l.seller_user_id IS NOT NULL THEN u.email::text ELSE org.email::text END AS email,
       org.name AS "organizationName"
     FROM marketplace.listings l
     LEFT JOIN auth.users u ON u.id = l.seller_user_id
     LEFT JOIN account.organizations org ON org.id = l.seller_organization_id
     WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [listingId]
  );

export const recordContactRevealEvent = ({
  listingId,
  userId,
  preferredChannel
}) =>
  run(
    "none",
    `INSERT INTO marketplace.listing_events (listing_id, user_id, event_type, metadata)
     VALUES ($1,$2,'CONTACT_REVEAL',$3::jsonb)`,
    [
      listingId,
      userId,
      JSON.stringify({ preferredChannel: preferredChannel || null })
    ]
  );
