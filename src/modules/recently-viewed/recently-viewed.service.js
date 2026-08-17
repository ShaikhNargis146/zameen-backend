import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import { assertListingAvailable } from "../../shared/listingAvailability.js";
import * as repository from "./recently-viewed.repository.js";

export const recordView = async ({ actorId, listingId }) => {
  if (!actorId) return;
  await assertListingAvailable(listingId);
  const result = await repository.upsertView(actorId, listingId);
  if (!result.ok) {
    if (result.error?.code === "23503")
      throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
    throw result.error;
  }
};

export const listRecentlyViewed = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.recentListingIds(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  const data = await listingCardsByIds(rows.map(row => row.listingId), actorId);
  return { data, meta: paginationMeta({ page, limit, total }) };
};
