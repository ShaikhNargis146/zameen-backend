import { pg, run } from "../../shared/db.js";

const selectColumns = `
  sv.id, sv.listing_id AS "listingId", sv.buyer_user_id AS "buyerUserId",
  to_char(sv.preferred_date, 'YYYY-MM-DD') AS "preferredDate", sv.preferred_time_slot AS "preferredTimeSlot",
  sv.visitor_count AS "visitorCount", sv.requested_at AS "requestedAt", sv.scheduled_at AS "scheduledAt",
  sv.status, sv.buyer_note AS "buyerNote", sv.seller_note AS "sellerNote",
  sv.created_at AS "createdAt", sv.updated_at AS "updatedAt"
`;
const insertColumns = selectColumns.replace(/sv\./g, "");

const sellerOwnsListing = paramIndex => `EXISTS (
  SELECT 1 FROM marketplace.listings l
  WHERE l.id = sv.listing_id AND l.deleted_at IS NULL
    AND (l.seller_user_id = $${paramIndex} OR EXISTS (
      SELECT 1 FROM account.organization_members om
      WHERE om.organization_id = l.seller_organization_id AND om.user_id = $${paramIndex} AND om.status = 'ACTIVE'
    ))
)`;

export const insert = ({ listingId, buyerUserId, preferredDate, preferredTimeSlot, visitorCount, buyerNote }) =>
  pg.one(
    `INSERT INTO marketplace.site_visits (listing_id, buyer_user_id, preferred_date, preferred_time_slot, visitor_count, buyer_note)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${insertColumns}`,
    [listingId, buyerUserId, preferredDate, preferredTimeSlot, visitorCount, buyerNote]
  );

export const findOwnedByBuyer = (id, buyerId) =>
  run(
    "oneOrNone",
    `SELECT ${selectColumns} FROM marketplace.site_visits sv WHERE sv.id = $1 AND sv.buyer_user_id = $2`,
    [id, buyerId]
  );

export const findOwnedBySeller = (id, sellerId) =>
  run(
    "oneOrNone",
    `SELECT ${selectColumns} FROM marketplace.site_visits sv WHERE sv.id = $1 AND ${sellerOwnsListing(2)}`,
    [id, sellerId]
  );

export const findOwnedByParticipant = (id, actorId) =>
  run(
    "oneOrNone",
    `SELECT ${selectColumns} FROM marketplace.site_visits sv
     WHERE sv.id = $1 AND (sv.buyer_user_id = $2 OR ${sellerOwnsListing(2)})`,
    [id, actorId]
  );

export const listForBuyer = (buyerId, { status, fromDate, toDate }, { limit, offset }) =>
  run(
    "any",
    `SELECT ${selectColumns}, count(*) OVER()::int AS total
     FROM marketplace.site_visits sv
     WHERE sv.buyer_user_id = $1
       AND ($2::varchar IS NULL OR sv.status = $2)
       AND ($3::date IS NULL OR sv.preferred_date >= $3)
       AND ($4::date IS NULL OR sv.preferred_date <= $4)
     ORDER BY sv.created_at DESC LIMIT $5 OFFSET $6`,
    [buyerId, status || null, fromDate || null, toDate || null, limit, offset]
  );

export const listForSeller = (sellerId, { status, fromDate, toDate }, { limit, offset }) =>
  run(
    "any",
    `SELECT ${selectColumns}, count(*) OVER()::int AS total
     FROM marketplace.site_visits sv
     WHERE ${sellerOwnsListing(1)}
       AND ($2::varchar IS NULL OR sv.status = $2)
       AND ($3::date IS NULL OR sv.preferred_date >= $3)
       AND ($4::date IS NULL OR sv.preferred_date <= $4)
     ORDER BY sv.created_at DESC LIMIT $5 OFFSET $6`,
    [sellerId, status || null, fromDate || null, toDate || null, limit, offset]
  );

export const confirm = ({ id, scheduledAt, sellerNote }) =>
  pg.updateWhere({
    table: "marketplace.site_visits",
    set: { status: "CONFIRMED", scheduled_at: scheduledAt, seller_note: sellerNote },
    where: "id = ${id}",
    params: { id },
    returning: insertColumns
  });

export const reschedule = ({ id, scheduledAt, noteColumn, note }) =>
  pg.updateWhere({
    table: "marketplace.site_visits",
    set: { status: "RESCHEDULED", scheduled_at: scheduledAt, [noteColumn]: note },
    where: "id = ${id}",
    params: { id },
    returning: insertColumns
  });

export const cancel = ({ id, noteColumn, note }) =>
  pg.updateWhere({
    table: "marketplace.site_visits",
    set: { status: "CANCELLED", [noteColumn]: note },
    where: "id = ${id}",
    params: { id },
    returning: insertColumns
  });

export const complete = ({ id, sellerNote }) =>
  pg.updateWhere({
    table: "marketplace.site_visits",
    set: { status: "COMPLETED", seller_note: sellerNote },
    where: "id = ${id}",
    params: { id },
    returning: insertColumns
  });
