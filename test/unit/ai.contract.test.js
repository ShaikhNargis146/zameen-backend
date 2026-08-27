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
