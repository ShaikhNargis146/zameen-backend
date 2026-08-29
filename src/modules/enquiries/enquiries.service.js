import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import { userSummariesByIds } from "../../shared/userSummary.js";
import { assertListingAvailable } from "../../shared/listingAvailability.js";
import * as notifications from "../notifications/notifications.service.js";
import * as repository from "./enquiries.repository.js";
import { uuid } from "./enquiries.validation.js";

const mapDbError = error => {
  if (error?.code === "23503")
    return new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  return error;
};

export const toEnquiries = async rows => {
  if (!rows.length) return [];
  const [listingCards, userSummaries] = await Promise.all([
    listingCardsByIds(rows.map(row => row.listingId), null, { requirePublished: false }),
    userSummariesByIds(rows.flatMap(row => [row.buyerUserId, row.assignedToUserId]))
  ]);
  const listingById = new Map(listingCards.map(card => [card.listingId, card]));
  return rows.map(row => ({
    id: row.id,
    listing: listingById.get(row.listingId) || null,
    buyer: userSummaries.get(row.buyerUserId) || null,
    enquiryType: row.enquiryType,
    message: row.message,
    status: row.status,
    assignedTo: row.assignedToUserId ? userSummaries.get(row.assignedToUserId) || null : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
};

const toEnquiry = async row => (await toEnquiries([row]))[0];

const toEnquiryNotes = async rows => {
  if (!rows.length) return [];
  const authors = await userSummariesByIds(rows.map(row => row.createdByUserId));
  return rows.map(row => ({
    id: row.id,
    note: row.note,
    createdBy: authors.get(row.createdByUserId) || null,
    createdAt: row.createdAt
  }));
};

const toSiteVisit = (row, listingCard, buyerSummary) => ({
  id: row.id,
  listing: listingCard || null,
  buyer: buyerSummary || null,
  preferredDate: row.preferredDate,
  preferredTimeSlot: row.preferredTimeSlot,
  scheduledAt: row.scheduledAt,
  visitorCount: row.visitorCount,
  status: row.status,
  buyerNote: row.buyerNote,
  sellerNote: row.sellerNote,
  createdAt: row.createdAt
});

export const ownedByBuyer = async (enquiryId, actorId) => {
  const row = await repository.findOwnedByBuyer(uuid(enquiryId, "enquiryId"), actorId);
  if (!row) throw new HttpError(404, "ENQUIRY_NOT_FOUND", "Enquiry was not found.");
  return row;
};

export const ownedBySeller = async (enquiryId, actorId) => {
  const row = await repository.findOwnedBySeller(uuid(enquiryId, "enquiryId"), actorId);
  if (!row) throw new HttpError(404, "ENQUIRY_NOT_FOUND", "Enquiry was not found.");
  return row;
};

export const create = async ({ actorId, listingId, input }) => {
  await assertListingAvailable(listingId);
  const result = await repository.insert({
    listingId,
    buyerUserId: actorId,
    enquiryType: input.enquiryType,
    message: input.message
  });
  if (!result.ok) throw mapDbError(result.error);
  await notifications.notifySeller(listingId, {
    type: "ENQUIRY_NEW",
    title: "New enquiry received",
    body: "A buyer submitted a new enquiry for your listing.",
    data: { enquiryId: result.data.id, listingId }
  });
  return toEnquiry(result.data);
};

export const listForBuyer = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForBuyer(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: await toEnquiries(rows), meta: paginationMeta({ page, limit, total }) };
};

export const listForSeller = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForSeller(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: await toEnquiries(rows), meta: paginationMeta({ page, limit, total }) };
};

const buildDetail = async (row, { includeNotes }) => {
  const [enquiry, noteRows, siteVisitRows] = await Promise.all([
    toEnquiry(row),
    includeNotes ? repository.notesForEnquiry(row.id) : Promise.resolve([]),
    repository.siteVisitsForListingBuyer(row.listingId, row.buyerUserId)
  ]);
  const notes = await toEnquiryNotes(noteRows);
  const siteVisits = siteVisitRows.map(visit =>
    toSiteVisit(visit, enquiry.listing, enquiry.buyer)
  );
  return { enquiry, notes, siteVisits };
};

export const detailForBuyer = row => buildDetail(row, { includeNotes: false });
export const detailForSeller = row => buildDetail(row, { includeNotes: true });

export const updateStatus = async ({ enquiry, status }) => {
  const result = await repository.updateStatus(enquiry.id, status);
  if (!result.ok) throw result.error;
  await notifications.notifyUser(enquiry.buyerUserId, {
    type: "ENQUIRY_STATUS_UPDATED",
    title: "Your enquiry was updated",
    body: `Your enquiry status changed to ${status}.`,
    data: { enquiryId: enquiry.id, listingId: enquiry.listingId, status }
  });
  return toEnquiry(result.data);
};

export const addNote = async ({ enquiry, actorId, note }) => {
  const row = await repository.insertNote({
    enquiryId: enquiry.id,
    createdByUserId: actorId,
    note
  });
  return (await toEnquiryNotes([row]))[0];
};

export const contactReveal = async ({ actorId, listingId, preferredChannel }) => {
  await assertListingAvailable(listingId);
  const sellerInfo = await repository.sellerContactInfo(listingId);
  if (!sellerInfo) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");

  const existing = await repository.findOpenEnquiryForBuyer(listingId, actorId);
  let leadCreated = false;
  if (!existing) {
    const result = await repository.insert({
      listingId,
      buyerUserId: actorId,
      enquiryType: "CONTACT",
      message: null
    });
    if (!result.ok) throw mapDbError(result.error);
    leadCreated = true;
    await notifications.notifySeller(listingId, {
      type: "ENQUIRY_NEW",
      title: "New enquiry received",
      body: "A buyer revealed your contact details and a new enquiry was created.",
      data: { enquiryId: result.data.id, listingId }
    });
  }

  await repository.recordContactRevealEvent({ listingId, userId: actorId, preferredChannel });

  return {
    listingId,
    sellerName: sellerInfo.sellerName,
    phoneE164: sellerInfo.phoneE164,
    email: sellerInfo.email,
    whatsappE164: sellerInfo.phoneE164,
    organizationName: sellerInfo.organizationName,
    leadCreated
  };
};
