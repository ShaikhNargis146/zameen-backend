import { pg, run } from "../../shared/db.js";

const notificationColumns = `id, type, title, body, data, read_at AS "readAt", created_at AS "createdAt"`;
const preferencesColumns = `email_enabled AS "emailEnabled", sms_enabled AS "smsEnabled", whatsapp_enabled AS "whatsappEnabled", marketing_enabled AS "marketingEnabled", updated_at AS "updatedAt"`;

export const listForUser = (userId, { unreadOnly, type }, { limit, offset }) =>
  run(
    "any",
    `SELECT ${notificationColumns}, count(*) OVER()::int AS total
     FROM ops.notifications
     WHERE user_id = $1
       AND (NOT $2::boolean OR read_at IS NULL)
       AND ($3::varchar IS NULL OR type = $3)
     ORDER BY created_at DESC
     LIMIT $4 OFFSET $5`,
    [userId, unreadOnly, type, limit, offset]
  );

export const findOwnedByUser = (id, userId) =>
  run(
    "oneOrNone",
    `SELECT ${notificationColumns} FROM ops.notifications WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

export const markRead = id =>
  run(
    "oneOrNone",
    `UPDATE ops.notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 RETURNING ${notificationColumns}`,
    [id]
  );

export const markAllRead = userId =>
  run(
    "none",
    `UPDATE ops.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );

export const create = ({ userId, type, title, body, data }) =>
  run(
    "one",
    `INSERT INTO ops.notifications (user_id, type, title, body, data)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     RETURNING ${notificationColumns}`,
    [userId, type, title, body, JSON.stringify(data ?? null)]
  );

export const sellerRecipientsForListing = listingId =>
  run(
    "any",
    `SELECT user_id AS "userId" FROM (
       SELECT l.seller_user_id AS user_id FROM marketplace.listings l
       WHERE l.id = $1 AND l.seller_user_id IS NOT NULL
       UNION
       SELECT om.user_id FROM marketplace.listings l
       JOIN account.organization_members om
         ON om.organization_id = l.seller_organization_id AND om.status = 'ACTIVE' AND om.role IN ('OWNER','ADMIN')
       WHERE l.id = $1 AND l.seller_user_id IS NULL
     ) recipients`,
    [listingId]
  );

export const findPreferences = userId =>
  run(
    "oneOrNone",
    `SELECT ${preferencesColumns} FROM ops.notification_preferences WHERE user_id = $1`,
    [userId]
  );

export const insertDefaultPreferences = userId =>
  pg.none(
    `INSERT INTO ops.notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

export const upsertPreferences = ({ userId, emailEnabled, smsEnabled, whatsappEnabled, marketingEnabled }) =>
  run(
    "one",
    `INSERT INTO ops.notification_preferences (user_id, email_enabled, sms_enabled, whatsapp_enabled, marketing_enabled, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (user_id) DO UPDATE SET
       email_enabled = EXCLUDED.email_enabled,
       sms_enabled = EXCLUDED.sms_enabled,
       whatsapp_enabled = EXCLUDED.whatsapp_enabled,
       marketing_enabled = EXCLUDED.marketing_enabled,
       updated_at = EXCLUDED.updated_at
     RETURNING ${preferencesColumns}`,
    [userId, emailEnabled, smsEnabled, whatsappEnabled, marketingEnabled]
  );
