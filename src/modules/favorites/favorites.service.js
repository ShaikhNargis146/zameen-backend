import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta } from "../../shared/pagination.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import * as repository from "./favorites.repository.js";

export const addFavorite = async ({ actorId, listingId }) => {
  const result = await repository.insertFavorite(actorId, listingId);
  if (!result.ok) {
    if (result.error?.code === "23503")
      throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
    throw result.error;
  }
  return { listingId, isFavorite: true };
};

export const removeFavorite = async ({ actorId, listingId }) => {
  await repository.deleteFavorite(actorId, listingId);
};

export const listFavorites = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const [rows, { count }] = await Promise.all([
    repository.favoriteListingIds(actorId, filters, { limit, offset }),
    repository.countFavorites(actorId, filters)
  ]);
  const data = await listingCardsByIds(rows.map(row => row.listingId), actorId);
  return { data, meta: paginationMeta({ page, limit, total: count }) };
};
