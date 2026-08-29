import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import * as repository from "./notifications.repository.js";
import { uuid } from "./notifications.validation.js";

const toNotification = row => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  data: row.data ?? null,
  readAt: row.readAt,
  createdAt: row.createdAt
});

const toPreferences = row => ({
  emailEnabled: row.emailEnabled,
  smsEnabled: row.smsEnabled,
  whatsappEnabled: row.whatsappEnabled,
  marketingEnabled: row.marketingEnabled,
  updatedAt: row.updatedAt
});

export const list = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForUser(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: rows.map(toNotification), meta: paginationMeta({ page, limit, total }) };
};

const notFound = () => new HttpError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found.");

export const ownedByUser = async (notificationId, actorId) => {
  const row = await repository.findOwnedByUser(uuid(notificationId, "notificationId"), actorId);
  if (!row) throw notFound();
  return row;
};

export const markRead = async notification => toNotification(await repository.markRead(notification.id));

export const notifyUser = async (userId, { type, title, body, data }) => {
  if (!userId) return;
  await repository.create({ userId, type, title, body, data });
};

export const notifySeller = async (listingId, { type, title, body, data }) => {
  const recipients = await repository.sellerRecipientsForListing(listingId);
  await Promise.all(
    recipients.map(({ userId }) => repository.create({ userId, type, title, body, data }))
  );
};

export const markAllRead = async actorId => {
  await repository.markAllRead(actorId);
};

export const getPreferences = async actorId => {
  const existing = await repository.findPreferences(actorId);
  if (existing) return toPreferences(existing);
  await repository.insertDefaultPreferences(actorId);
  return toPreferences(await repository.findPreferences(actorId));
};

export const updatePreferences = async ({ actorId, input }) =>
  toPreferences(await repository.upsertPreferences({ userId: actorId, ...input }));
