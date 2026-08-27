import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI chat is authenticated and has no guest-token implementation", async () => {
  const [routes, controller, service, repository, schema] = await Promise.all([
    readFile(new URL("../../src/modules/ai/ai.routes.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/modules/ai/ai.controller.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/modules/ai/ai.service.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/modules/ai/ai.repository.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/database/schema.sql", import.meta.url), "utf8")
  ]);
  assert.match(routes, /"\/ai\/conversations",\n  requireAuth/);
  assert.match(routes, /conversations\/:conversationId\/messages",\n  requireAuth/);
  assert.doesNotMatch(`${controller}${service}${repository}${schema}`, /guestToken|guest_token/i);
});

test("conversation history query qualifies columns from its latest-message join", async () => {
  const repository = await readFile(
    new URL("../../src/modules/ai/ai.repository.js", import.meta.url),
    "utf8"
  );
  assert.match(repository, /conversation\.created_at AS "createdAt"/);
  assert.match(repository, /ORDER BY conversation\.updated_at DESC/);
});

test("chat establishes SSE before preparing database context", async () => {
  const [controller, service] = await Promise.all([
    readFile(new URL("../../src/modules/ai/ai.controller.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/modules/ai/ai.service.js", import.meta.url), "utf8")
  ]);
  const headerPosition = controller.indexOf('"Content-Type": "text/event-stream');
  const iterationPosition = controller.indexOf("for await (const event of stream)");
  const contextPosition = service.indexOf("const context = await messageContext(params);");
  const iteratorPosition = service.indexOf("async *[Symbol.asyncIterator]()");

  assert.ok(headerPosition >= 0 && headerPosition < iterationPosition);
  assert.ok(iteratorPosition >= 0 && iteratorPosition < contextPosition);
  assert.match(controller, /"AI_CONTEXT_UNAVAILABLE"/);
  assert.match(controller, /"AI_PROVIDER_INVALID_RESPONSE"/);
  assert.match(controller, /"AI_PROVIDER_INCOMPLETE"/);
  assert.match(controller, /"AI_CONVERSATION_UNAVAILABLE"/);
});

test("GPT-5 chat reserves output capacity for its visible reply", async () => {
  const provider = await readFile(
    new URL("../../src/modules/ai/ai.provider.js", import.meta.url),
    "utf8"
  );
  assert.match(provider, /reasoning: \{ effort: "minimal" \}/);
  assert.match(provider, /max_output_tokens: 1200/);
  assert.match(provider, /event\?\.type === "response\.incomplete"/);
});

test("Postman chat requests use the authenticated collection context", async () => {
  const collection = await readFile(
    new URL("../../postman/Zameens-Dev1.postman_collection.json", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(collection, /guestConversationToken|guestAccessToken|X-AI-Conversation-Token/);
  assert.match(
    collection,
    /"Create AI conversation"[\s\S]*?"method": "POST", "header"/
  );
  assert.match(
    collection,
    /"Send AI message \(SSE stream\)"[\s\S]*?"method": "POST", "header"/
  );
});
