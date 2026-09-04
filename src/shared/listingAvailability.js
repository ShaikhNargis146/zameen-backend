import { run } from "./db.js";
import { HttpError } from "./http.js";

export const assertListingAvailable = async listingId => {
  const row = await run(
    "oneOrNone",
    `SELECT id FROM marketplace.listings
     WHERE id = $1 AND status = 'PUBLISHED' AND review_status = 'APPROVED' AND deleted_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [listingId]
  );
  if (!row) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
};
