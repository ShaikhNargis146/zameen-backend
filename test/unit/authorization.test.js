import assert from "node:assert/strict";
import test from "node:test";
import { requireOwnedResource } from "../../src/shared/authorization.js";

test("resource middleware supports optional-auth viewers", async () => {
  const middleware = requireOwnedResource({
    param: "propertyId",
    target: "property",
    load: async (propertyId, actorId) => ({ propertyId, actorId })
  });
  const request = { params: { propertyId: "property-1" } };
  await new Promise((resolve, reject) =>
    middleware(request, {}, error => (error ? reject(error) : resolve()))
  );
  assert.deepEqual(request.property, { propertyId: "property-1", actorId: null });
});

test("resource middleware gives administrators the explicit admin loader", async () => {
  const middleware = requireOwnedResource({
    param: "listingId",
    target: "listing",
    load: async () => {
      throw new Error("owner loader must not run");
    },
    loadForAdmin: async listingId => ({ listingId, access: "admin" })
  });
  const request = {
    params: { listingId: "listing-1" },
    actor: { id: "admin-1", roles: ["ADMIN"] }
  };
  await new Promise((resolve, reject) =>
    middleware(request, {}, error => (error ? reject(error) : resolve()))
  );
  assert.deepEqual(request.listing, { listingId: "listing-1", access: "admin" });
});
