import { pg, run } from "../../shared/db.js";
import {
  listingFilterJoins,
  listingFilterParams,
  listingFilterWhere
} from "../../shared/listingFilters.js";

export const insertFavorite = (userId, listingId) =>
  pg.none(
    `INSERT INTO marketplace.favorites (user_id, listing_id) VALUES ($1,$2)
     ON CONFLICT (user_id, listing_id) DO NOTHING`,
    [userId, listingId]
  );

export const deleteFavorite = (userId, listingId) =>
  run(
    "none",
    `DELETE FROM marketplace.favorites WHERE user_id = $1 AND listing_id = $2`,
    [userId, listingId]
  );

export const favoriteListingIds = (userId, filters, { limit, offset }) =>
  run(
    "any",
    `SELECT source.listing_id AS "listingId", count(*) OVER()::int AS total
     FROM marketplace.favorites source
     ${listingFilterJoins}
     WHERE source.user_id = $1
     ${listingFilterWhere}
     ORDER BY source.created_at DESC
     LIMIT $9 OFFSET $10`,
    [userId, ...listingFilterParams(filters), limit, offset]
  );
