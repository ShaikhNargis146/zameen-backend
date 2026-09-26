import { HttpError } from "../../shared/http.js";
import { paginationMeta, parsePagination, splitCountedRows } from "../../shared/pagination.js";
import {
  belongsToAd,
  createAdStorageKey,
  optionalSignedReadUrl,
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
const mediaNotFound = () => new HttpError(404, "AD_MEDIA_NOT_FOUND", "Ad media was not found.");

export const adForAdmin = async id => {
  const row = await repository.findById(id);
  if (!row) throw notFound();
  return row;
};

export const adminList = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listAdmin({ ...filters, limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: await Promise.all(rows.map(toAdAdmin)), meta: paginationMeta({ page, limit, total }) };
};

export const adminGet = async id => {
  const row = await repository.findById(id);
  if (!row) throw notFound();
  return toAdAdmin(row);
};

const mediaResponse = async item => ({
  ...item,
  url: await optionalSignedReadUrl(item.storageKey)
});

export const createMediaUpload = ({ adId, input }) => {
  const ticket = item =>
    signedWriteUrl({
      storageKey: createAdStorageKey({ adId, fileName: item.fileName }),
      mimeType: item.mimeType
    });
  return Array.isArray(input) ? Promise.all(input.map(ticket)) : ticket(input);
};

export const completeMediaUpload = async ({ adId, actorId, input }) => {
  const items = Array.isArray(input) ? input : [input];
  items.forEach(item => {
    if (!belongsToAd({ adId, storageKey: item.storageKey }))
      throw new HttpError(400, "INVALID_STORAGE_KEY", "storageKey does not belong to this ad upload.");
  });
  const ids = await repository.createMediaBatch(adId, items.map(item => ({ ...item, userId: actorId })));
  const media = await repository.media(adId);
  const responses = await Promise.all(ids.map(id => mediaResponse(media.find(item => item.id === id))));
  return Array.isArray(input) ? responses : responses[0];
};

export const listMedia = async adId => Promise.all((await repository.media(adId)).map(mediaResponse));

export const updateMedia = async ({ adId, mediaId, changes }) => {
  if (!(await repository.mediaForAd(adId, mediaId))) throw mediaNotFound();
  const result = await repository.updateMedia(mediaId, changes);
  if (!result.ok) throw result.error;
  if (!result.data) throw mediaNotFound();
  return mediaResponse((await repository.media(adId)).find(item => item.id === mediaId));
};

export const deleteMedia = async ({ adId, mediaId }) => {
  if (!(await repository.mediaForAd(adId, mediaId))) throw mediaNotFound();
  await repository.deleteMedia(mediaId);
};

export const reorderMedia = async ({ adId, mediaIds }) => {
  const current = await repository.media(adId);
  if (current.length !== mediaIds.length || current.some(item => !mediaIds.includes(item.id)))
    throw new HttpError(400, "INVALID_MEDIA_ORDER", "mediaIds must contain every ad media item exactly once.");
  await repository.reorderMedia(adId, mediaIds);
  return listMedia(adId);
};

export const setMediaCover = async ({ adId, mediaId }) => {
  if (!(await repository.mediaForAd(adId, mediaId))) throw mediaNotFound();
  await repository.setCover(adId, mediaId);
  return listMedia(adId);
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
