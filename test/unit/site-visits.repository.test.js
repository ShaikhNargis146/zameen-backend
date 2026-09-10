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
      assert.match(query, /WITH created_enquiry AS/);
      assert.match(query, /UPDATE marketplace\.site_visits visit/);
      assert.match(query, /visit\.enquiry_id IS NULL/);
      assert.match(query, /visit\.status <> 'CANCELLED'/);
      assert.match(query, /SET status = CASE/);
      assert.match(query, /THEN 'SITE_VISIT'/);
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
