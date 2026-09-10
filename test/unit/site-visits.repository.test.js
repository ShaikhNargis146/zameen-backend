import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import * as enquiriesRepository from "../../src/modules/enquiries/enquiries.repository.js";
import * as siteVisitsRepository from "../../src/modules/site-visits/site-visits.repository.js";

const withOneStub = async (stub, callback) => {
  const original = pg.one;
  pg.one = stub;
  try {
    await callback();
  } finally {
    pg.one = original;
  }
};

test("new enquiry atomically links earlier unlinked site visits", async () => {
  await withOneStub(
    async (query, params) => {
      // The enquiry's status must be decided in the INSERT itself, from a
      // read-only CTE over the pre-existing site_visits rows. A sibling CTE
      // cannot UPDATE the row that another CTE in the same WITH just
      // INSERTed into the same table: all data-modifying CTEs in one WITH
      // share a single snapshot, so that UPDATE silently matches zero rows
      // (confirmed against a real Postgres instance, not just this stub).
      assert.match(query, /WITH unlinked_visits AS/);
      assert.match(query, /INSERT INTO marketplace\.enquiries/);
      assert.match(
        query,
        /VALUES \(\$1, \$2, \$3, \$4, CASE WHEN EXISTS \(SELECT 1 FROM unlinked_visits\) THEN 'SITE_VISIT' ELSE 'NEW' END\)/
      );
      assert.match(query, /UPDATE marketplace\.site_visits visit/);
      assert.match(query, /WHERE visit\.id IN \(SELECT id FROM unlinked_visits\)/);
      assert.match(query, /SELECT [\s\S]*FROM created_enquiry/);
      assert.deepEqual(params, [
        "listing-1",
        "buyer-1",
        "CONTACT",
        "Need details"
      ]);
      return { ok: true, data: { id: "enquiry-1" } };
    },
    async () => {
      const result = await enquiriesRepository.insertAndLinkUnlinkedVisits({
        listingId: "listing-1",
        buyerUserId: "buyer-1",
        enquiryType: "CONTACT",
        message: "Need details"
      });
      assert.equal(result.data.id, "enquiry-1");
    }
  );
});

test("new site visit atomically marks its linked enquiry as SITE_VISIT", async () => {
  await withOneStub(
    async (query, params) => {
      assert.match(query, /WITH created_visit AS/);
      assert.match(query, /UPDATE marketplace\.enquiries enquiry/);
      assert.match(query, /SET status = 'SITE_VISIT'/);
      assert.match(query, /visit\.enquiry_id IS NOT NULL/);
      assert.deepEqual(params, [
        "listing-1",
        "buyer-1",
        "enquiry-1",
        "2026-09-10",
        "MORNING",
        2,
        "Please confirm"
      ]);
      return { ok: true, data: { id: "visit-1" } };
    },
    async () => {
      const result = await siteVisitsRepository.insert({
        listingId: "listing-1",
        buyerUserId: "buyer-1",
        enquiryId: "enquiry-1",
        preferredDate: "2026-09-10",
        preferredTimeSlot: "MORNING",
        visitorCount: 2,
        buyerNote: "Please confirm"
      });
      assert.equal(result.data.id, "visit-1");
    }
  );
});
