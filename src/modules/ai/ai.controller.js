import { created, ok } from "../../shared/http.js";
import * as service from "./ai.service.js";
import * as validation from "./ai.validation.js";

const guestToken = req => req.headers["x-ai-conversation-token"] || null;
const publicServiceErrorCodes = new Set([
  "AI_PROVIDER_UNCONFIGURED",
  "AI_PROVIDER_UNAVAILABLE"
]);
const sse = (res, event, data) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const streamError = error => {
  const clientError = Number(error?.status) < 500;
  const publicServiceError = publicServiceErrorCodes.has(error?.code);
  return {
    code:
      clientError || publicServiceError
        ? error?.code || "REQUEST_ERROR"
        : "INTERNAL_ERROR",
    message:
      clientError || publicServiceError
        ? error?.message || "Request failed."
        : "Internal Server Error"
  };
};
export const search = async (req, res) =>
  ok(
    res,
    await service.search({
      input: validation.search(req.body || {}),
      actorId: req.actor?.id || null
    })
  );
export const createConversation = async (req, res) =>
  created(
    res,
    await service.createConversation({
      actorId: req.actor?.id || null,
      input: validation.conversation(req.body || {})
    })
  );
export const listConversations = async (req, res) => {
  const { data, meta } = await service.listConversations({
    actorId: req.actor.id,
    pagination: validation.conversationList(req.query || {})
  });
  ok(res, data, meta);
};
export const addMessage = async (req, res) => {
  const abortController = new AbortController();
  const stream = await service.streamMessage({
    conversationId: validation.conversationId(req.params.conversationId),
    actorId: req.actor?.id || null,
    guestToken: guestToken(req),
    input: validation.message(req.body || {}),
    signal: abortController.signal
  });
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders?.();
  const abortOnDisconnect = () => {
    if (!res.writableEnded) abortController.abort();
  };
  res.once("close", abortOnDisconnect);
  try {
    for await (const event of stream) {
      if (res.writableEnded || res.destroyed) break;
      if (event.type === "delta")
        sse(res, "message.delta", { delta: event.delta });
      if (event.type === "completed")
        sse(res, "message.completed", { message: event.message });
    }
  } catch (error) {
    if (!res.writableEnded && !res.destroyed && error?.name !== "AbortError")
      sse(res, "error", { error: streamError(error) });
  } finally {
    res.off("close", abortOnDisconnect);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
};
export const getConversation = async (req, res) =>
  ok(
    res,
    await service.getConversation({
      conversationId: validation.conversationId(req.params.conversationId),
      actorId: req.actor?.id || null,
      guestToken: guestToken(req)
    })
  );
export const generateListing = async (req, res) =>
  ok(
    res,
    await service.generateListing({
      actorId: req.actor.id,
      input: validation.listingGenerate(req.body || {})
    })
  );
