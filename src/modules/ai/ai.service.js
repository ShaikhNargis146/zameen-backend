import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../../shared/http.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import * as discovery from "../discovery/discovery.service.js";
import * as repository from "./ai.repository.js";

const guestHash = token =>
  createHash("sha256")
    .update(token)
    .digest("hex");
const snippet = value =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const parsedSearch = ({ query, page, limit }) => {
  const normalized = snippet(query).toLowerCase();
  const crore = normalized.match(
    /(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s*(?:cr|crore)/i
  );
  const lakh = normalized.match(
    /(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s*(?:lakh|lac)/i
  );
  return {
    locationIds: [],
    propertyTypeIds: [],
    transactionTypes: normalized.match(/rent|lease/)
      ? ["LEASE"]
      : normalized.match(/buy|sale|sell/)
      ? ["SALE"]
      : [],
    minPriceMinor: null,
    maxPriceMinor: crore
      ? Math.round(Number(crore[1]) * 10000000 * 100)
      : lakh
      ? Math.round(Number(lakh[1]) * 100000 * 100)
      : null,
    minArea: null,
    maxArea: null,
    areaUnitId: null,
    verifiedOnly: /verified/.test(normalized),
    minRoadWidthM: null,
    facing: [],
    cornerPlot: null,
    sellerType: [],
    sort: "RELEVANCE",
    page,
    limit,
    offset: (page - 1) * limit
  };
};
const responseMessage = ({ content, listing }) => {
  if (listing)
    return `For this ${listing.propertyType || "property"}${
      listing.locationName ? ` in ${listing.locationName}` : ""
    }, I can help with the available listing details, land information, and next steps. ${content}`;
  return `I can help you discover properties, understand land details, and prepare a listing. ${content}`;
};
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
    guestHash(guestToken) === conversation.guestTokenHash
  )
    return conversation;
  throw new HttpError(
    404,
    "CONVERSATION_NOT_FOUND",
    "Conversation was not found."
  );
};

export const search = async ({ input, actorId }) => {
  const filters = parsedSearch(input);
  const result = await discovery.search({ filters, actorId });
  return {
    normalizedQuery: snippet(input.query),
    parsedFilters: { ...filters, offset: undefined },
    clarificationNeeded:
      !filters.transactionTypes.length && filters.maxPriceMinor === null,
    clarificationQuestion:
      !filters.transactionTypes.length && filters.maxPriceMinor === null
        ? "Are you looking to buy or lease, and what is your approximate budget?"
        : null,
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
    guestTokenHash: guestAccessToken ? guestHash(guestAccessToken) : null
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
export const addMessage = async ({
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
  const answer = await repository.addMessage({
    conversationId,
    role: "ASSISTANT",
    content: responseMessage({ content: input.content, listing }),
    metadata: {
      sources: listing
        ? [{ type: "LISTING", listingId: conversation.listingId }]
        : []
    }
  });
  if (!answer.ok) throw answer.error;
  return messageResponse(answer.data);
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
  const propertyType =
    property?.propertyType ||
    (input.propertyTypeId
      ? (await repository.propertyType(input.propertyTypeId))?.name
      : null) ||
    "property";
  const location = property?.locationName || input.locationText;
  const area = property?.areaValue
    ? `${property.areaValue} ${property.areaUnit || ""}`.trim()
    : input.areaText;
  const highlights = input.highlights.length
    ? input.highlights
    : [
        area && `Approx. ${area}`,
        input.roadWidthText && `${input.roadWidthText} road access`
      ].filter(Boolean);
  const title = [area, propertyType, location && `in ${location}`]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 255);
  const description = [
    `Explore this ${propertyType}${location ? ` located in ${location}` : ""}.`,
    area ? `The property offers approximately ${area}.` : null,
    input.priceText ? `Expected price: ${input.priceText}.` : null,
    highlights.length ? `Highlights include ${highlights.join(", ")}.` : null
  ]
    .filter(Boolean)
    .join(" ");
  return {
    title: title || `Verified ${propertyType} opportunity`,
    description,
    highlights,
    disclaimer:
      "AI-generated draft. Review all property, location, legal and price details before publishing."
  };
};
