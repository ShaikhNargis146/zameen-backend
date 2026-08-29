import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import { userSummariesByIds } from "../../shared/userSummary.js";
import { assertListingAvailable } from "../../shared/listingAvailability.js";
import * as enquiriesRepository from "../enquiries/enquiries.repository.js";
import * as notifications from "../notifications/notifications.service.js";
import * as repository from "./site-visits.repository.js";
import { uuid } from "./site-visits.validation.js";

const mapDbError = error => {
  if (error?.code === "23503")
    return new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  return error;
};

const toSiteVisits = async rows => {
  if (!rows.length) return [];
  const [listingCards, buyerSummaries] = await Promise.all([
    listingCardsByIds(rows.map(row => row.listingId), null, { requirePublished: false }),
    userSummariesByIds(rows.map(row => row.buyerUserId))
  ]);
  const listingById = new Map(listingCards.map(card => [card.listingId, card]));
  return rows.map(row => ({
    id: row.id,
    listing: listingById.get(row.listingId) || null,
    buyer: buyerSummaries.get(row.buyerUserId) || null,
    preferredDate: row.preferredDate,
    preferredTimeSlot: row.preferredTimeSlot,
    scheduledAt: row.scheduledAt,
    visitorCount: row.visitorCount,
    status: row.status,
    buyerNote: row.buyerNote,
    sellerNote: row.sellerNote,
    createdAt: row.createdAt
  }));
};

const toSiteVisit = async row => (await toSiteVisits([row]))[0];

const noteColumnFor = (visit, actorId) =>
  visit.buyerUserId === actorId ? "buyer_note" : "seller_note";

const notifyCounterpart = (visit, actorId, payload) =>
  visit.buyerUserId === actorId
    ? notifications.notifySeller(visit.listingId, payload)
    : notifications.notifyUser(visit.buyerUserId, payload);

const confirmableStates = ["REQUESTED", "RESCHEDULED"];
const rescheduleableStates = ["REQUESTED", "CONFIRMED", "RESCHEDULED"];
const cancellableStates = ["REQUESTED", "CONFIRMED", "RESCHEDULED"];
const completableStates = ["CONFIRMED", "RESCHEDULED"];

export const ownedByBuyer = async (visitId, actorId) => {
  const row = await repository.findOwnedByBuyer(uuid(visitId, "visitId"), actorId);
  if (!row) throw new HttpError(404, "SITE_VISIT_NOT_FOUND", "Site visit was not found.");
  return row;
};

export const ownedBySeller = async (visitId, actorId) => {
  const row = await repository.findOwnedBySeller(uuid(visitId, "visitId"), actorId);
  if (!row) throw new HttpError(404, "SITE_VISIT_NOT_FOUND", "Site visit was not found.");
  return row;
};

export const ownedByParticipant = async (visitId, actorId) => {
  const row = await repository.findOwnedByParticipant(uuid(visitId, "visitId"), actorId);
  if (!row) throw new HttpError(404, "SITE_VISIT_NOT_FOUND", "Site visit was not found.");
  return row;
};

export const create = async ({ actorId, listingId, input }) => {
  await assertListingAvailable(listingId);
  const result = await repository.insert({
    listingId,
    buyerUserId: actorId,
    preferredDate: input.preferredDate,
    preferredTimeSlot: input.preferredTimeSlot,
    visitorCount: input.visitorCount,
    buyerNote: input.note
  });
  if (!result.ok) throw mapDbError(result.error);
  await notifications.notifySeller(listingId, {
    type: "SITE_VISIT_REQUESTED",
    title: "New site visit requested",
    body: "A buyer requested a site visit for your listing.",
    data: { visitId: result.data.id, listingId }
  });
  return toSiteVisit(result.data);
};

export const listForBuyer = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForBuyer(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: await toSiteVisits(rows), meta: paginationMeta({ page, limit, total }) };
};

export const listForSeller = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForSeller(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: await toSiteVisits(rows), meta: paginationMeta({ page, limit, total }) };
};

export const confirm = async ({ visit, scheduledAt, sellerNote }) => {
  if (!confirmableStates.includes(visit.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Site visit cannot be confirmed from its current state."
    );
  const result = await repository.confirm({ id: visit.id, scheduledAt, sellerNote });
  if (!result.ok) throw result.error;
  await notifications.notifyUser(visit.buyerUserId, {
    type: "SITE_VISIT_CONFIRMED",
    title: "Site visit confirmed",
    body: "Your site visit request was confirmed.",
    data: { visitId: visit.id, listingId: visit.listingId, scheduledAt }
  });
  return toSiteVisit(result.data);
};

export const reschedule = async ({ visit, actorId, scheduledAt, note }) => {
  if (!rescheduleableStates.includes(visit.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Site visit cannot be rescheduled from its current state."
    );
  const result = await repository.reschedule({
    id: visit.id,
    scheduledAt,
    noteColumn: noteColumnFor(visit, actorId),
    note
  });
  if (!result.ok) throw result.error;
  await notifyCounterpart(visit, actorId, {
    type: "SITE_VISIT_RESCHEDULED",
    title: "Site visit rescheduled",
    body: "A site visit was rescheduled to a new time.",
    data: { visitId: visit.id, listingId: visit.listingId, scheduledAt }
  });
  return toSiteVisit(result.data);
};

export const cancel = async ({ visit, actorId, reason }) => {
  if (!cancellableStates.includes(visit.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Site visit cannot be cancelled from its current state."
    );
  const result = await repository.cancel({
    id: visit.id,
    noteColumn: noteColumnFor(visit, actorId),
    note: reason
  });
  if (!result.ok) throw result.error;
  await notifyCounterpart(visit, actorId, {
    type: "SITE_VISIT_CANCELLED",
    title: "Site visit cancelled",
    body: "A site visit was cancelled.",
    data: { visitId: visit.id, listingId: visit.listingId, reason: reason || null }
  });
  return toSiteVisit(result.data);
};

export const complete = async ({ visit, sellerNote, enquiryStatus }) => {
  if (!completableStates.includes(visit.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Site visit cannot be completed from its current state."
    );
  const result = await repository.complete({ id: visit.id, sellerNote });
  if (!result.ok) throw result.error;

  if (enquiryStatus && visit.buyerUserId) {
    const openEnquiry = await enquiriesRepository.findOpenEnquiryForBuyer(
      visit.listingId,
      visit.buyerUserId
    );
    if (openEnquiry) await enquiriesRepository.updateStatus(openEnquiry.id, enquiryStatus);
  }

  return toSiteVisit(result.data);
};
