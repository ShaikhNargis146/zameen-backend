import { ok } from "../../shared/http.js";
import * as service from "./notifications.service.js";
import * as validation from "./notifications.validation.js";

export const list = async (req, res) => {
  const { data, meta } = await service.list({
    actorId: req.actor.id,
    filters: validation.notificationListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const markRead = async (req, res) => ok(res, await service.markRead(req.notification));

export const markAllRead = async (req, res) => {
  await service.markAllRead(req.actor.id);
  ok(res, {
    message: "All notifications marked as read.",
    status: "OK",
    requestId: req.headers["x-request-id"] || null
  });
};

export const getPreferences = async (req, res) => ok(res, await service.getPreferences(req.actor.id));

export const updatePreferences = async (req, res) =>
  ok(
    res,
    await service.updatePreferences({
      actorId: req.actor.id,
      input: validation.notificationPreferencesInput(req.body || {})
    })
  );
