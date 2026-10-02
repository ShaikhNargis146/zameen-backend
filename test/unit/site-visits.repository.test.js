import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import * as enquiriesRepository from "../../src/modules/enquiries/enquiries.repository.js";
import * as siteVisitsRepository from "../../src/modules/site-visits/site-visits.repository.js";

// Both insertAndLinkUnlinkedVisits and site-visits' insert() now run inside
// pg.tx (an advisory lock, keyed identically in both modules, serializes
// the two against each other — see enquiries.repository.js linkingLockKey).
// The stub hands the transaction callback a fake `t` and records every
// query it runs, in order, so we can assert the lock is taken first and the
// linking logic matches the previous single-statement CTE behaviour.
const withTxStub = async (responses, callback) => {
  const original = pg.tx;
  const calls = [];
  pg.tx = async fn => {
    let index = 0;
    const t = {
      none: async (query, params) => {
        calls.push({ method: "none", query, params });
        return responses[index++]?.result;
      },
      any: async (query, params) => {
        calls.push({ method: "any", query, params });
        return responses[index++]?.result ?? [];
      },
      one: async (query, params) => {
        calls.push({ method: "one", query, params });
        return responses[index++]?.result;
      },
      oneOrNone: async (query, params) => {
        calls.push({ method: "oneOrNone", query, params });
        return responses[index++]?.result ?? null;
      }
    };
    try {
      const data = await fn(t);
      return { ok: true, data, error: null };
    } catch (error) {
      return { ok: false, data: null, error };
    }
  };
  try {
    await callback(calls);
  } finally {
    pg.tx = original;
  }
};

test("new enquiry atomically links earlier unlinked site visits, under a per-buyer-listing advisory lock", async () => {
  await withTxStub(
    [
      { result: undefined }, // advisory lock
      { result: [{ id: "visit-1" }] }, // unlinked visits
      { result: { id: "enquiry-1" } }, // insert enquiry
      { result: undefined } // link visits
    ],
    async calls => {
      const enquiry = await enquiriesRepository.insertAndLinkUnlinkedVisits({
        listingId: "listing-1",
        buyerUserId: "buyer-1",
        enquiryType: "CONTACT",
        message: "Need details"
      });
      assert.equal(enquiry.id, "enquiry-1");

      assert.match(calls[0].query, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
      assert.equal(calls[0].params[0], "listing-1:buyer-1:enquiry-visit-link");

      assert.match(calls[1].query, /SELECT id FROM marketplace\.site_visits/);
      assert.match(calls[1].query, /enquiry_id IS NULL AND listing_id = \$1 AND buyer_user_id = \$2/);

      assert.match(calls[2].query, /INSERT INTO marketplace\.enquiries/);
      assert.deepEqual(calls[2].params, ["listing-1", "buyer-1", "CONTACT", "Need details", "SITE_VISIT"]);

      assert.match(calls[3].query, /UPDATE marketplace\.site_visits SET enquiry_id = \$1 WHERE id = ANY/);
      assert.deepEqual(calls[3].params, ["enquiry-1", ["visit-1"]]);
    }
  );
});

test("a new enquiry with no unlinked visits is created as NEW, and never issues a link update", async () => {
  await withTxStub(
    [
      { result: undefined },
      { result: [] },
      { result: { id: "enquiry-2" } }
    ],
    async calls => {
      await enquiriesRepository.insertAndLinkUnlinkedVisits({
        listingId: "listing-1",
        buyerUserId: "buyer-1",
        enquiryType: "CONTACT",
        message: null
      });
      assert.deepEqual(calls[2].params, ["listing-1", "buyer-1", "CONTACT", null, "NEW"]);
      assert.equal(calls.length, 3);
    }
  );
});

test("new site visit atomically marks its linked enquiry as SITE_VISIT, under the same advisory lock key", async () => {
  await withTxStub(
    [
      { result: undefined }, // advisory lock
      { result: { id: "enquiry-1" } }, // existing open enquiry
      { result: { id: "visit-1" } }, // insert visit
      { result: undefined } // mark enquiry SITE_VISIT
    ],
    async calls => {
      const visit = await siteVisitsRepository.insert({
        listingId: "listing-1",
        buyerUserId: "buyer-1",
        preferredDate: "2026-09-10",
        preferredTimeSlot: "MORNING",
        visitorCount: 2,
        buyerNote: "Please confirm"
      });
      assert.equal(visit.id, "visit-1");

      assert.match(calls[0].query, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
      assert.equal(calls[0].params[0], "listing-1:buyer-1:enquiry-visit-link");

      assert.match(calls[1].query, /FROM marketplace\.enquiries/);
      assert.match(calls[1].query, /status NOT IN \('CLOSED','LOST'\)/);

      assert.match(calls[2].query, /INSERT INTO marketplace\.site_visits/);
      assert.deepEqual(calls[2].params, [
        "listing-1",
        "buyer-1",
        "enquiry-1",
        "2026-09-10",
        "MORNING",
        2,
        "Please confirm"
      ]);

      assert.match(calls[3].query, /UPDATE marketplace\.enquiries SET status = 'SITE_VISIT' WHERE id = \$1/);
      assert.deepEqual(calls[3].params, ["enquiry-1"]);
    }
  );
});

test("a site visit with no open enquiry links to nothing and never updates an enquiry", async () => {
  await withTxStub(
    [
      { result: undefined },
      { result: null },
      { result: { id: "visit-2" } }
    ],
    async calls => {
      await siteVisitsRepository.insert({
        listingId: "listing-1",
        buyerUserId: "buyer-2",
        preferredDate: "2026-09-10",
        preferredTimeSlot: "MORNING",
        visitorCount: 1,
        buyerNote: null
      });
      assert.deepEqual(calls[2].params, [
        "listing-1",
        "buyer-2",
        null,
        "2026-09-10",
        "MORNING",
        1,
        null
      ]);
      assert.equal(calls.length, 3);
    }
  );
});
