import { HttpError } from "../../shared/http.js";
import { paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import logger from "../../utils/logger.js";
import * as discovery from "../discovery/discovery.service.js";
import { search as validateListingSearch } from "../discovery/discovery.validation.js";
import * as provider from "./ai.provider.js";
import * as repository from "./ai.repository.js";

const snippet = value =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const publicConversation = conversation => ({
  id: conversation.id,
  contextType: conversation.contextType,
  listingId: conversation.listingId,
  title: conversation.title,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt
});
const messageResponse = message => ({
  ...message,
  sources: message.metadata?.sources || []
});
const safeLogValue = value =>
  String(value || "none")
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 100);
const logChatFailure = (stage, error) =>
  logger.error(
    `AI chat ${stage} failed ` +
      `[name=${safeLogValue(error?.name)}, ` +
      `status=${safeLogValue(error?.status || error?.statusCode)}, ` +
      `code=${safeLogValue(error?.code)}]`
  );

// Applies when a user has no active plan_subscription at all — there is no
// database row for the ambient "Free" tier, so its quota lives here.
export const DEFAULT_FREE_AI_MONTHLY_QUOTA = 5;

const noopRelease = async () => {};

// Reserves one unit of the caller's monthly AI quota before the paid LLM
// call starts. Chat answers, /ai/search and /ai/listing/generate all draw
// from the same pool (see ai.repository.js reserveAiQuotaUsage) — a rejected
// question must cost nothing and a caller must never be able to exceed
// quota by racing concurrent requests. Returns a release function the
// caller MUST invoke exactly once when its own work finishes: `true`
// converts the reservation into permanent usage, `false` (the default, for
// any failure/abort) deletes it so a failed attempt never costs quota.
const reserveAiQuota = async (actorId, kind) => {
  const plan = await repository.activePlanForUser(actorId);
  const quota = plan ? plan.aiMonthlyQuota : DEFAULT_FREE_AI_MONTHLY_QUOTA;
  if (quota === null) return noopRelease;
  const reservationId = await repository.reserveAiQuotaUsage(actorId, quota, kind);
  if (reservationId === null)
    throw new HttpError(
      403,
      "AI_MONTHLY_QUOTA_EXCEEDED",
      `You have used all ${quota} AI Property Assistant questions included in your plan this month.`
    );
  return async (succeeded = false) =>
    succeeded
      ? repository.confirmAiQuotaUsage(reservationId)
      : repository.releaseAiQuotaUsage(reservationId);
};

const requireAccess = async ({ conversationId, actorId }) => {
  const conversation = await repository.conversation(conversationId);
  if (!conversation)
    throw new HttpError(
      404,
      "CONVERSATION_NOT_FOUND",
      "Conversation was not found."
    );
  if (conversation.userId === actorId) return conversation;
  throw new HttpError(
    404,
    "CONVERSATION_NOT_FOUND",
    "Conversation was not found."
  );
};

export const search = async ({ input, actorId }) => {
  // Anonymous callers (optionalAuth) have no plan to meter against, so this
  // only reserves for a logged-in actor — the same rate limit that already
  // applies to this route is the only guard for anonymous traffic.
  const releaseQuota = actorId ? await reserveAiQuota(actorId, "SEARCH") : noopRelease;
  let succeeded = false;
  try {
    const intent = await provider.searchIntent({
      query: input.query,
      language: input.language,
      catalog: await repository.searchCatalog()
    });
    const references = await repository.resolveSearchReferences(intent);
    if (
      (intent.minArea !== null || intent.maxArea !== null) &&
      !references.areaUnitId
    )
      throw new HttpError(
        502,
        "AI_PROVIDER_INVALID_RESPONSE",
        "AI service returned an unusable response."
      );
    const filters = validateListingSearch({
      locationIds: references.locationIds,
      propertyTypeIds: references.propertyTypeIds,
      transactionTypes: intent.transactionTypes,
      minPriceMinor: intent.minPriceMinor,
      maxPriceMinor: intent.maxPriceMinor,
      minArea: intent.minArea,
      maxArea: intent.maxArea,
      areaUnitId: references.areaUnitId,
      verifiedOnly: intent.verifiedOnly,
      minRoadWidthM: intent.minRoadWidthM,
      facing: intent.facing,
      cornerPlot: intent.cornerPlot,
      sellerType: intent.sellerType,
      sort: intent.sort,
      page: input.page,
      limit: input.limit
    });
    const result = await discovery.search({ filters, actorId });
    const isAmbiguous =
      !filters.locationIds.length &&
      !filters.propertyTypeIds.length &&
      !filters.transactionTypes.length &&
      filters.minPriceMinor === null &&
      filters.maxPriceMinor === null &&
      filters.minArea === null &&
      filters.maxArea === null;
    const clarificationNeeded = intent.clarificationNeeded || isAmbiguous;
    const clarificationQuestion = clarificationNeeded
      ? snippet(intent.clarificationQuestion).slice(0, 500) ||
        "What location, property type, budget, or area do you have in mind?"
      : null;
    const { offset, ...parsedFilters } = filters;
    succeeded = true;
    return {
      normalizedQuery: snippet(input.query),
      parsedFilters,
      clarificationNeeded,
      clarificationQuestion,
      results: result.data,
      meta: result.meta
    };
  } finally {
    await releaseQuota(succeeded);
  }
};
export const createConversation = async ({ actorId, input }) => {
  if (input.listingId && !(await repository.listingContext(input.listingId)))
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  const result = await repository.createConversation({
    userId: actorId,
    contextType: input.contextType,
    listingId: input.listingId,
    title: input.initialQuery ? snippet(input.initialQuery).slice(0, 255) : null
  });
  if (!result.ok) throw result.error;
  if (input.initialQuery)
    await repository.addMessage({
      conversationId: result.data.id,
      role: "USER",
      content: input.initialQuery
    });
  return publicConversation(result.data);
};
export const listConversations = async ({ actorId, pagination }) => {
  const { page, limit, offset } = pagination;
  const counted = await repository.conversationsForUser(actorId, pagination);
  const { data: rows, total } = splitCountedRows(counted);
  return {
    data: rows.map(row => ({
      ...publicConversation(row),
      lastMessage: row.lastMessageContent
        ? {
            role: row.lastMessageRole,
            content: row.lastMessageContent,
            createdAt: row.lastMessageAt
          }
        : null
    })),
    meta: paginationMeta({ page, limit, total })
  };
};
const messageContext = async ({ conversationId, actorId, input }) => {
  const conversation = await requireAccess({
    conversationId,
    actorId
  });
  // Reserved before any context assembly or provider call: a rejected
  // question should cost nothing and leave no history. The reservation is
  // released by streamMessage's finally block once this attempt's outcome
  // is known.
  const releaseQuota = await reserveAiQuota(actorId, "CHAT");
  try {
    const listing = conversation.listingId
      ? await repository.listingContext(conversation.listingId)
      : null;
    let catalog;
    let content;
    let trends;
    let investments;
    try {
      [catalog, content, trends, investments] = await Promise.all([
        repository.searchCatalog(),
        repository.publishedContentContext({
          language: input.language,
          locationId: listing?.locationId || null,
          query: input.content
        }),
        repository.marketTrendContext({
          locationId: listing?.locationId || null,
          propertyTypeId: listing?.propertyTypeId || null
        }),
        repository.publishedInvestmentContext({
          locationId: listing?.locationId || null,
          propertyId: listing?.propertyId || null,
          query: input.content
        })
      ]);
    } catch (error) {
      // Context is database-derived. Do not save a user message if assembling it
      // failed, otherwise retries create duplicate history entries.
      logChatFailure("context", error);
      throw new HttpError(
        503,
        "AI_CONTEXT_UNAVAILABLE",
        "AI chat context is temporarily unavailable."
      );
    }
    const saved = await repository.addMessage({
      conversationId,
      role: "USER",
      content: input.content
    });
    if (!saved.ok) throw saved.error;
    const messages = await repository.messages(conversationId);
    return {
      providerInput: {
        language: input.language,
        listing,
        catalog,
        content: content.map(item => ({
          id: item.id,
          title: item.title,
          summary: item.summary
        })),
        trends,
        investments,
        messages: messages.slice(-20).map(item => ({
          role: item.role,
          content: item.content
        }))
      },
      metadata: {
        sources: [
          ...(listing
            ? [{ type: "LISTING", listingId: conversation.listingId }]
            : []),
          ...content.map(item => ({
            type: "CONTENT",
            contentId: item.id,
            slug: item.slug
          })),
          ...trends.map(item => ({
            type: "MARKET_TREND",
            trendSeriesId: item.id
          })),
          ...investments.map(item => ({
            type: "INVESTMENT_OPPORTUNITY",
            opportunityId: item.id
          }))
        ]
      },
      // Handed back so streamMessage's finally block can release the quota
      // reservation and, on failure, delete this USER row — once this
      // attempt's real outcome (answered vs. failed) is known.
      releaseQuota,
      userMessageId: saved.data.id
    };
  } catch (error) {
    await releaseQuota(false);
    throw error;
  }
};

export const streamMessage = async ({ signal, ...params }) => {
  return {
    async *[Symbol.asyncIterator]() {
      // The controller sends SSE headers before it starts this iterator. That
      // keeps every chat failure in the documented SSE error channel, including
      // database context failures that happen before the OpenAI request.
      const context = await messageContext(params);
      let content = "";
      let succeeded = false;
      try {
        try {
          for await (const delta of provider.streamConversationReply({
            ...context.providerInput,
            signal
          })) {
            content += delta;
            yield { type: "delta", delta };
          }
        } catch (error) {
          logChatFailure("provider-stream", error);
          throw error;
        }
        // Keep the persisted message byte-for-byte aligned with rendered deltas,
        // except for inconsequential leading/trailing whitespace.
        const response = content.trim();
        if (!response) {
          const error = new HttpError(
            502,
            "AI_PROVIDER_INVALID_RESPONSE",
            "AI service returned an unusable response."
          );
          logChatFailure("provider-stream-empty", error);
          throw error;
        }
        const answer = await repository.addMessage({
          conversationId: params.conversationId,
          role: "ASSISTANT",
          content: response,
          metadata: context.metadata
        });
        if (!answer.ok) {
          logChatFailure("assistant-message-save", answer.error);
          throw new HttpError(
            503,
            "AI_CONVERSATION_UNAVAILABLE",
            "AI chat history is temporarily unavailable."
          );
        }
        succeeded = true;
        yield { type: "completed", message: messageResponse(answer.data) };
      } finally {
        await context.releaseQuota(succeeded);
        // A failed/aborted attempt (provider error, empty response, save
        // failure, client disconnect) must not leave its USER row behind —
        // otherwise it sits as an unanswered turn in the conversation, and
        // a later attempt's `messages.slice(-20)` context would replay it.
        if (!succeeded)
          await repository.deleteMessage(context.userMessageId).catch(error => {
            logChatFailure("orphaned-user-message-cleanup", error);
          });
      }
    }
  };
};
export const getConversation = async ({ conversationId, actorId }) => {
  const conversation = await requireAccess({
    conversationId,
    actorId
  });
  return {
    conversation: publicConversation(conversation),
    messages: (await repository.messages(conversationId)).map(messageResponse),
    listing: conversation.listingId
      ? (await listingCardsByIds([conversation.listingId], actorId))[0] || null
      : null
  };
};
export const generateListing = async ({ actorId, input }) => {
  const releaseQuota = await reserveAiQuota(actorId, "LISTING_GENERATE");
  let succeeded = false;
  try {
    const property = input.propertyId
      ? await repository.ownedPropertyContext(input.propertyId, actorId)
      : null;
    if (input.propertyId && !property)
      throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property was not found.");
    const propertyType = input.propertyTypeId
      ? await repository.propertyType(input.propertyTypeId)
      : null;
    const draft = provider.normalizeListingDraft(
      await provider.listingDraft({
        language: input.language,
        property,
        input: {
          ...input,
          propertyTypeName: propertyType?.name || null
        }
      })
    );
    succeeded = true;
    return {
      ...draft,
      disclaimer:
        "AI-generated draft. Review all property, location, legal and price details before publishing."
    };
  } finally {
    await releaseQuota(succeeded);
  }
};
