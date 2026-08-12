import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta } from "../../shared/pagination.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import * as repository from "./recently-viewed.repository.js";

export const recordView = async ({ actorId, listingId }) => {
  if (!actorId) return;
  const result = await repository.upsertView(actorId, listingId);
  if (!result.ok) {
    if (result.error?.code === "23503")
      throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
    throw result.error;
  }
};

export const listRecentlyViewed = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const [rows, { count }] = await Promise.all([
    repository.recentListingIds(actorId, filters, { limit, offset }),
    repository.countRecentlyViewed(actorId, filters)
  ]);
  const data = await listingCardsByIds(rows.map(row => row.listingId), actorId);
  return { data, meta: paginationMeta({ page, limit, total: count }) };
};
