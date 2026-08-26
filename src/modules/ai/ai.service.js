import { randomBytes } from "node:crypto";
import { HttpError } from "../../shared/http.js";
import { hashWithPepper, safeEqualHex } from "../../utils/crypto.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import * as discovery from "../discovery/discovery.service.js";
import { search as validateListingSearch } from "../discovery/discovery.validation.js";
import * as provider from "./ai.provider.js";
import * as repository from "./ai.repository.js";

const guestTokenTtlHours = Number(process.env.AI_GUEST_TOKEN_TTL_HOURS || 24);
const guestHash = token => hashWithPepper(`ai-guest:${token}`);
const snippet = value =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const publicConversation = conversation => ({
  id: conversation.id,
  contextType: conversation.contextType,
  listingId: conversation.listingId,
  title: conversation.title,
  createdAt: conversation.createdAt
});
const messageResponse = message => ({
  ...message,
  sources: message.metadata?.sources || []
});

const requireAccess = async ({ conversationId, actorId, guestToken }) => {
  const conversation = await repository.conversation(conversationId);
  if (!conversation)
    throw new HttpError(
      404,
      "CONVERSATION_NOT_FOUND",
      "Conversation was not found."
    );
  if (conversation.userId && conversation.userId === actorId)
    return conversation;
  if (
    !conversation.userId &&
    guestToken &&
    conversation.guestTokenExpiresAt &&
    new Date(conversation.guestTokenExpiresAt) > new Date() &&
    safeEqualHex(guestHash(guestToken), conversation.guestTokenHash)
  )
    return conversation;
  throw new HttpError(
    404,
    "CONVERSATION_NOT_FOUND",
    "Conversation was not found."
  );
};

export const search = async ({ input, actorId }) => {
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
  return {
    normalizedQuery: snippet(input.query),
    parsedFilters,
    clarificationNeeded,
    clarificationQuestion,
    results: result.data,
    meta: result.meta
  };
};
export const createConversation = async ({ actorId, input }) => {
  if (input.listingId && !(await repository.listingContext(input.listingId)))
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  const guestAccessToken = actorId
    ? null
    : randomBytes(32).toString("base64url");
  const result = await repository.createConversation({
    userId: actorId,
    contextType: input.contextType,
    listingId: input.listingId,
    title: input.initialQuery
      ? snippet(input.initialQuery).slice(0, 255)
      : null,
    guestTokenHash: guestAccessToken ? guestHash(guestAccessToken) : null,
    guestTokenExpiresAt: guestAccessToken
      ? new Date(Date.now() + guestTokenTtlHours * 3600000)
      : null
  });
  if (!result.ok) throw result.error;
  if (input.initialQuery)
    await repository.addMessage({
      conversationId: result.data.id,
      role: "USER",
      content: input.initialQuery
    });
  return {
    ...publicConversation(result.data),
    ...(guestAccessToken ? { guestAccessToken } : {})
  };
};
const messageContext = async ({
  conversationId,
  actorId,
  guestToken,
  input
}) => {
  const conversation = await requireAccess({
    conversationId,
    actorId,
    guestToken
  });
  const saved = await repository.addMessage({
    conversationId,
    role: "USER",
    content: input.content
  });
  if (!saved.ok) throw saved.error;
  const listing = conversation.listingId
    ? await repository.listingContext(conversation.listingId)
    : null;
  const [messages, catalog, content, trends, investments] = await Promise.all([
    repository.messages(conversationId),
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
    }
  };
};

export const streamMessage = async ({ signal, ...params }) => {
  const context = await messageContext(params);
  return {
    async *[Symbol.asyncIterator]() {
      let content = "";
      for await (const delta of provider.streamConversationReply({
        ...context.providerInput,
        signal
      })) {
        content += delta;
        yield { type: "delta", delta };
      }
      // Keep the persisted message byte-for-byte aligned with rendered deltas,
      // except for inconsequential leading/trailing whitespace.
      const response = content.trim();
      if (!response)
        throw new HttpError(
          502,
          "AI_PROVIDER_INVALID_RESPONSE",
          "AI service returned an unusable response."
        );
      const answer = await repository.addMessage({
        conversationId: params.conversationId,
        role: "ASSISTANT",
        content: response,
        metadata: context.metadata
      });
      if (!answer.ok) throw answer.error;
      yield { type: "completed", message: messageResponse(answer.data) };
    }
  };
};
export const getConversation = async ({
  conversationId,
  actorId,
  guestToken
}) => {
  const conversation = await requireAccess({
    conversationId,
    actorId,
    guestToken
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
  return {
    ...draft,
    disclaimer:
      "AI-generated draft. Review all property, location, legal and price details before publishing."
  };
};
