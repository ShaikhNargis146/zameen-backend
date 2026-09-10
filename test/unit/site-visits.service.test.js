import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import * as siteVisitsService from "../../src/modules/site-visits/site-visits.service.js";

const withOneOrNoneStub = async (stub, callback) => {
  const original = pg.oneOrNone;
  pg.oneOrNone = stub;
  try {
    await callback();
  } finally {
    pg.oneOrNone = original;
  }
};

test("requesting a duplicate site visit returns 409 with the existing visit's id", async () => {
  await withOneOrNoneStub(
    async query => {
      if (/FROM marketplace\.listings/.test(query))
        return { ok: true, data: { id: "listing-1" } };
      if (/FROM marketplace\.site_visits/.test(query))
        return {
          ok: true,
          data: { id: "visit-existing", status: "REQUESTED" }
        };
      throw new Error(`unexpected query: ${query}`);
    },
    async () => {
      await assert.rejects(
        () =>
          siteVisitsService.create({
            actorId: "buyer-1",
            listingId: "listing-1",
            input: {
              preferredDate: "2026-09-10",
              preferredTimeSlot: "MORNING",
              visitorCount: 1,
              note: null
            }
          }),
        error => {
          assert.equal(error.status, 409);
          assert.equal(error.code, "SITE_VISIT_DUPLICATE");
          assert.deepEqual(error.details, [{ visitId: "visit-existing" }]);
          return true;
        }
      );
    }
  );
});

test("requesting a site visit for an unavailable listing never reaches the duplicate check", async () => {
  await withOneOrNoneStub(
    async query => {
      assert.match(query, /FROM marketplace\.listings/);
      return { ok: true, data: null };
    },
    async () => {
      await assert.rejects(
        () =>
          siteVisitsService.create({
            actorId: "buyer-1",
            listingId: "listing-missing",
            input: {
              preferredDate: "2026-09-10",
              preferredTimeSlot: "MORNING",
              visitorCount: 1,
              note: null
            }
          }),
        error => {
          assert.equal(error.status, 404);
          assert.equal(error.code, "LISTING_NOT_FOUND");
          return true;
        }
      );
    }
  );
});
