import { HttpError } from "../../shared/http.js";
import { paginationMeta, parsePagination } from "../../shared/pagination.js";
import {
  belongsToAd,
  createAdStorageKey,
  signedReadUrl,
  signedWriteUrl
} from "../../utils/storage.js";
import * as repository from "./ads.repository.js";

const toAd = async row => ({
  id: row.id,
  name: row.name,
  placement: row.placement,
  imageUrl: await signedReadUrl(row.imageStorageKey),
  targetUrl: row.targetUrl,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  status: row.status
});

const toAdAdmin = async row => ({
  ...(await toAd(row)),
  imageStorageKey: row.imageStorageKey,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

export const listActive = async placement => {
  const rows = await repository.listActive(placement);
  return Promise.all(rows.map(toAd));
};

const notFound = () => new HttpError(404, "AD_NOT_FOUND", "Ad was not found.");

export const adminList = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const rows = await repository.listAdmin({ ...filters, limit, offset });
  const total = rows[0]?.total || 0;
  return { data: await Promise.all(rows.map(toAdAdmin)), meta: paginationMeta({ page, limit, total }) };
};

export const adminGet = async id => {
  const row = await repository.findById(id);
  if (!row) throw notFound();
  return toAdAdmin(row);
};

export const createMediaUpload = input =>
  signedWriteUrl({
    storageKey: createAdStorageKey({ fileName: input.fileName }),
    mimeType: input.mimeType
  });

export const completeMediaUpload = async input => {
  if (!belongsToAd({ storageKey: input.storageKey }))
    throw new HttpError(
      400,
      "INVALID_STORAGE_KEY",
      "storageKey does not belong to an ad creative upload."
    );
  return { imageStorageKey: input.storageKey, imageUrl: await signedReadUrl(input.storageKey) };
};

export const create = async input => {
  const inserted = await repository.create(input);
  return toAd(await repository.findById(inserted.id));
};

export const update = async ({ id, changes }) => {
  const existing = await repository.findById(id);
  if (!existing) throw notFound();

  const effectiveStartsAt = changes.starts_at ?? existing.startsAt;
  const effectiveEndsAt = changes.ends_at ?? existing.endsAt;
  if (new Date(effectiveEndsAt) <= new Date(effectiveStartsAt))
    throw new HttpError(400, "INVALID_ENDS_AT", "endsAt must be after startsAt.");

  const result = await repository.update(id, changes);
  if (!result.ok) throw result.error;
  return toAd(await repository.findById(id));
};

export const remove = async id => {
  const deleted = await repository.remove(id);
  if (!deleted) throw notFound();
};
