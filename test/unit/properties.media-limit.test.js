import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { completeMedia } from "../../src/modules/properties/properties.service.js";

const withPgStubs = async (stubs, callback) => {
  const originals = {};
  for (const key of Object.keys(stubs)) {
    originals[key] = pg[key];
    pg[key] = stubs[key];
  }
  try {
    await callback();
  } finally {
    for (const key of Object.keys(originals)) pg[key] = originals[key];
  }
};

// Regression test for a real bug: req.property is populated by different
// loaders depending on actor role (properties.routes.js#requireOwnedProperty
// uses ownedProperty for the owning user, propertyForAdmin for an ADMIN),
// and those loaders return different shapes. propertyForAdmin's shape
// (properties.repository.js propertySummarySql) has neither
// created_by_user_id nor owner_organization_id under those names -- it
// aliases the org id as "organizationId" and doesn't select a creator id at
// all -- so a media-limit check that read `property.created_by_user_id`
// directly (as completeMedia originally did) always resolved undefined for
// an admin-loaded property, silently skipping enforcement entirely.
const adminShapedProperty = {
  id: "property-1",
  publicCode: "ZMN-P-ABC123",
  organizationId: null, // camelCase, and no created_by_user_id at all -- what propertyForAdmin actually returns
  status: "DRAFT"
};

const singleImageInput = {
  storageKey: "properties/property-1/media/photo.jpg",
  mediaType: "IMAGE",
  mimeType: "image/jpeg",
  fileName: "photo.jpg"
};

test("completeMedia resolves the owner from the property's own DB columns (properties.repository.js#ownerFields), not from req.property's shape, and still enforces the limit when req.property came from the admin loader", async () => {
  let batchInsertAttempted = false;
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/created_by_user_id AS "createdByUserId"/.test(query)) {
          assert.deepEqual(params, ["property-1"]);
          return { ok: true, data: { createdByUserId: "user-1", ownerOrganizationId: null } };
        }
        if (/ps\.user_id = \$1 AND ps\.organization_id IS NULL/.test(query)) {
          assert.deepEqual(params, ["user-1"]);
          return { ok: true, data: { features: { imagesPerProperty: 1 } } };
        }
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          one: async query => {
            assert.match(query, /media_type = ANY/);
            batchInsertAttempted = true; // set only if we ever get past the count check
            return { count: 1 }; // already at the limit of 1
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(
        completeMedia({
          property: adminShapedProperty,
          actorId: "admin-1",
          input: singleImageInput
        }),
        error => {
          assert.equal(error.code, "PLAN_LIMIT_REACHED");
          assert.equal(error.details.feature, "IMAGES_PER_PROPERTY");
          assert.equal(error.details.limit, 1);
          return true;
        }
      );
    }
  );
  // The count query itself is expected (that's how the limit is enforced);
  // what must never happen is an INSERT past it -- the stub's `one` throws
  // for any query that isn't the count, so reaching an INSERT would fail
  // the test with a different error than PLAN_LIMIT_REACHED above.
  assert.equal(batchInsertAttempted, true);
});

test("completeMedia throws PROPERTY_NOT_FOUND (not a raw TypeError) when the property was deleted between authorization and the owner-fields read", async () => {
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/created_by_user_id AS "createdByUserId"/.test(query)) return { ok: true, data: null }; // deleted_at now set -- no row
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      tx: async () => {
        throw new Error("must not open a transaction for a property that no longer exists");
      }
    },
    async () => {
      await assert.rejects(
        completeMedia({ property: adminShapedProperty, actorId: "admin-1", input: singleImageInput }),
        error => {
          assert.equal(error.status, 404);
          assert.equal(error.code, "PROPERTY_NOT_FOUND");
          return true;
        }
      );
    }
  );
});
