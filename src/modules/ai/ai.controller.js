import { created, ok } from "../../shared/http.js";
import * as service from "./ai.service.js";
import * as validation from "./ai.validation.js";

const guestToken = req => req.headers["x-ai-conversation-token"] || null;
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
export const addMessage = async (req, res) =>
  created(
    res,
    await service.addMessage({
      conversationId: validation.conversationId(req.params.conversationId),
      actorId: req.actor?.id || null,
      guestToken: guestToken(req),
      input: validation.message(req.body || {})
    })
  );
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
