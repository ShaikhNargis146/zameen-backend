import { HttpError } from "../../shared/http.js";
import { paginationMeta, parsePagination } from "../../shared/pagination.js";
import * as repository from "./auctions.repository.js";

const toLocationSummary = row =>
  row.locationId
    ? {
        id: row.locationId,
        name: row.locationName,
        type: row.locationType,
        parentId: row.locationParentId,
        stateCode: row.locationStateCode,
        latitude: row.locationLatitude === null ? null : Number(row.locationLatitude),
        longitude: row.locationLongitude === null ? null : Number(row.locationLongitude),
        displayPath: row.locationDisplayPath
      }
    : null;

const toAuction = row => ({
  id: row.id,
  title: row.title,
  institutionName: row.institutionName,
  location: toLocationSummary(row),
  reservePriceMinor: row.reservePriceMinor === null ? null : Number(row.reservePriceMinor),
  emdAmountMinor: row.emdAmountMinor === null ? null : Number(row.emdAmountMinor),
  currency: row.currency,
  auctionAt: row.auctionAt,
  officialUrl: row.officialUrl,
  description: row.description,
  status: row.status
});

export const list = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const rows = await repository.list({ ...filters, limit, offset });
  const total = rows[0]?.total || 0;
  return { data: rows.map(toAuction), meta: paginationMeta({ page, limit, total }) };
};

const notFound = () => new HttpError(404, "AUCTION_NOT_FOUND", "Auction was not found.");

export const detail = async id => {
  const row = await repository.findById(id);
  if (!row) throw notFound();
  return toAuction(row);
};

const mapReferenceError = error => {
  if (error?.code === "23503")
    throw new HttpError(400, "INVALID_REFERENCE", "locationId does not exist.");
  throw error;
};

export const create = async input => {
  let id;
  try {
    const inserted = await repository.create(input);
    id = inserted.id;
  } catch (error) {
    mapReferenceError(error);
  }
  return toAuction(await repository.findById(id));
};

export const update = async ({ id, changes }) => {
  const existing = await repository.findById(id);
  if (!existing) throw notFound();
  try {
    const result = await repository.update(id, changes);
    if (!result.ok) throw result.error;
  } catch (error) {
    mapReferenceError(error);
  }
  return toAuction(await repository.findById(id));
};

export const remove = async id => {
  const deleted = await repository.remove(id);
  if (!deleted) throw notFound();
};
