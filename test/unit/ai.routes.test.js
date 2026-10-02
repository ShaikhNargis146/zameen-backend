import assert from "node:assert/strict";
import test from "node:test";

import aiRoutes from "../../src/modules/ai/ai.routes.js";
import {
  AI_RATE_LIMIT_MAX,
  AI_RATE_LIMIT_WINDOW_MS
} from "../../src/config/rate-limit.config.js";

test("AI rate limiting is scoped to AI paths only", () => {
  const limiterLayer = aiRoutes.stack.find(
    layer => !layer.route && layer.regexp.test("/ai/search")
  );

  assert.ok(limiterLayer);
  assert.equal(limiterLayer.regexp.test("/content"), false);
  assert.equal(limiterLayer.regexp.test("/property-types"), false);
  assert.equal(AI_RATE_LIMIT_WINDOW_MS, 60 * 1000);
  assert.equal(AI_RATE_LIMIT_MAX, 60);
});
