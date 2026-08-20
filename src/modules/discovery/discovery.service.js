import { HttpError } from "../../shared/http.js";
import { signedReadUrl } from "../../utils/storage.js";
import {
  listingCardsByIds,
  formatPriceDisplay
} from "../../shared/listingCard.js";
import * as repository from "./discovery.repository.js";

const paginationMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit)
});

export const search = async ({ filters, actorId }) => {
  const rows = await repository.searchIds(filters);
  const total = rows[0]?.total || 0;
  return {
    data: await listingCardsByIds(
      rows.map(row => row.listingId),
      actorId
    ),
    meta: paginationMeta({ page: filters.page, limit: filters.limit, total })
  };
};
export const suggestions = repository.suggestions;
export const map = async filters =>
  Promise.all(
    (await repository.mapPins(filters)).map(async pin => ({
      listingId: pin.listingId,
      latitude: Number(pin.latitude),
      longitude: Number(pin.longitude),
      priceAmountMinor:
        pin.priceAmountMinor === null ? null : Number(pin.priceAmountMinor),
      priceDisplay: formatPriceDisplay(pin.priceAmountMinor),
      areaDisplay:
        pin.areaValue === null
          ? "Area unavailable"
          : `${Number(pin.areaValue)} ${pin.areaUnitCode || ""}`.trim(),
      propertyTypeName: pin.propertyTypeName,
      thumbnailUrl: await signedReadUrl(pin.thumbnailStorageKey),
      isPremium: pin.isPremium
    }))
  );
export const similar = async ({ listingId, limit, actorId }) =>
  listingCardsByIds(
    (await repository.similarIds(listingId, limit)).map(row => row.listingId),
    actorId
  );
export const compare = async ({ listingIds, actorId }) => {
  const listings = await listingCardsByIds(listingIds, actorId);
  if (listings.length !== listingIds.length)
    throw new HttpError(
      404,
      "LISTING_NOT_FOUND",
      "One or more listings are unavailable."
    );
  const values = key =>
    Object.fromEntries(
      listings.map(listing => [listing.listingId, key(listing)])
    );
  return {
    listings,
    rows: [
      {
        key: "price",
        label: "Price",
        valuesByListingId: values(listing => listing.priceDisplay)
      },
      {
        key: "propertyType",
        label: "Property type",
        valuesByListingId: values(listing => listing.propertyType.name)
      },
      {
        key: "transactionType",
        label: "Transaction",
        valuesByListingId: values(listing => listing.transactionType)
      },
      {
        key: "area",
        label: "Area",
        valuesByListingId: values(listing =>
          listing.areaValue === null
            ? null
            : `${listing.areaValue} ${listing.areaUnit?.name || ""}`.trim()
        )
      },
      {
        key: "location",
        label: "Location",
        valuesByListingId: values(
          listing => listing.location?.displayPath || null
        )
      }
    ],
    aiSummaryAvailable: false
  };
};
