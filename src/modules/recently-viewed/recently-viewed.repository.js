import { pg, run } from "../../shared/db.js";
import {
  listingFilterJoins,
  listingFilterParams,
  listingFilterWhere
} from "../../shared/listingFilters.js";

export const upsertView = (userId, listingId) =>
  pg.none(
    `INSERT INTO marketplace.recently_viewed (user_id, listing_id, viewed_at)
     VALUES ($1,$2,now())
     ON CONFLICT (user_id, listing_id) DO UPDATE SET viewed_at = now()`,
    [userId, listingId]
  );

export const recentListingIds = (userId, filters, { limit, offset }) =>
  run(
    "any",
    `SELECT source.listing_id AS "listingId"
     FROM marketplace.recently_viewed source
     ${listingFilterJoins}
     WHERE source.user_id = $1
     ${listingFilterWhere}
     ORDER BY source.viewed_at DESC
     LIMIT $9 OFFSET $10`,
    [userId, ...listingFilterParams(filters), limit, offset]
  );

export const countRecentlyViewed = (userId, filters) =>
  run(
    "one",
    `SELECT count(*)::int AS count
     FROM marketplace.recently_viewed source
     ${listingFilterJoins}
     WHERE source.user_id = $1
     ${listingFilterWhere}`,
    [userId, ...listingFilterParams(filters)]
  );
