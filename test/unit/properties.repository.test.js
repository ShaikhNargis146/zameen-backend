import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { createMediaBatch } from "../../src/modules/properties/properties.repository.js";

// createMediaBatch runs the advisory lock, the per-category media count
// check(s), and the actual inserts inside one transaction, so two concurrent
// upload batches for the SAME property can't both read a stale "under the
// limit" count before either commits. Exercised directly via a stubbed
// pg.tx, mirroring this repo's existing convention (see
// organizations.repository.test.js, listings.repository.test.js).

const withTxStub = async (t, callback) => {
  const original = pg.tx;
  pg.tx = async fn => {
    try {
      const data = await fn(t);
      return { ok: true, data, error: null };
    } catch (error) {
      return { ok: false, data: null, error };
    }
  };
  try {
    await callback();
  } finally {
    pg.tx = original;
  }
};

const stubT = ({ imageCount = null, videoCount = null, insertIds = [] }) => {
  const calls = { lock: [], imageCount: [], videoCount: [], insert: [], cover: [] };
  let insertIndex = 0;
  return {
    calls,
    t: {
      any: async (query, params) => {
        assert.match(query, /pg_advisory_xact_lock/);
        calls.lock.push(params);
      },
      none: async (query, params) => {
        calls.cover.push([query, params]);
      },
      one: async (query, params) => {
        if (/media_type = ANY/.test(query)) {
          if (params[1].includes("IMAGE")) {
            calls.imageCount.push(params);
            return imageCount;
          }
          calls.videoCount.push(params);
          return videoCount;
        }
        assert.match(query, /INSERT INTO land\.property_media/);
        calls.insert.push(params);
        const id = insertIds[insertIndex];
        insertIndex += 1;
        return { id };
      }
    }
  };
};

test("a batch that stays within both limits locks per-property, counts each category once, then inserts everything", async () => {
  const { t, calls } = stubT({ imageCount: { count: 2 }, videoCount: { count: 0 }, insertIds: ["media-1", "media-2"] });
  await withTxStub(t, async () => {
    const result = await createMediaBatch(
      "property-1",
      [
        { mediaType: "IMAGE", storageKey: "a", mimeType: "image/jpeg", sortOrder: 0, isCover: false, caption: null, userId: "user-1" },
        { mediaType: "VIDEO", storageKey: "b", mimeType: "video/mp4", sortOrder: 1, isCover: false, caption: null, userId: "user-1" }
      ],
      { imagesPerProperty: 5, videosPerProperty: 1 }
    );
    assert.deepEqual(result, { ids: ["media-1", "media-2"], reason: null });
  });
  assert.deepEqual(calls.lock, [["PROPERTY_MEDIA:property-1"]]);
  assert.equal(calls.imageCount.length, 1);
  assert.equal(calls.videoCount.length, 1);
  assert.equal(calls.insert.length, 2);
});

test("a batch that would push images over the limit is rejected, and nothing is inserted (not even the videos in the same batch)", async () => {
  const { t, calls } = stubT({ imageCount: { count: 5 } });
  await withTxStub(t, async () => {
    const result = await createMediaBatch(
      "property-1",
      [{ mediaType: "IMAGE", storageKey: "a", mimeType: "image/jpeg", sortOrder: 0, isCover: false, caption: null, userId: "user-1" }],
      { imagesPerProperty: 5, videosPerProperty: null }
    );
    assert.deepEqual(result, { ids: null, reason: "LIMIT_REACHED", category: "IMAGE", used: 5, limit: 5 });
  });
  assert.equal(calls.insert.length, 0);
});

test("VIDEO and DRONE_VIDEO share one videosPerProperty count query, not one per item, and SITE_PLAN is never counted", async () => {
  const { t, calls } = stubT({ videoCount: { count: 0 }, insertIds: ["m1", "m2", "m3"] });
  await withTxStub(t, async () => {
    await createMediaBatch(
      "property-1",
      [
        { mediaType: "VIDEO", storageKey: "a", mimeType: "video/mp4", sortOrder: 0, isCover: false, caption: null, userId: "user-1" },
        { mediaType: "DRONE_VIDEO", storageKey: "b", mimeType: "video/mp4", sortOrder: 1, isCover: false, caption: null, userId: "user-1" },
        { mediaType: "SITE_PLAN", storageKey: "c", mimeType: "application/pdf", sortOrder: 2, isCover: false, caption: null, userId: "user-1" }
      ],
      { imagesPerProperty: null, videosPerProperty: 5 }
    );
  });
  assert.equal(calls.videoCount.length, 1);
  assert.deepEqual(calls.videoCount[0], ["property-1", ["VIDEO", "DRONE_VIDEO"]]);
  assert.equal(calls.imageCount.length, 0);
});

test("null limits (unlimited) skip both count queries entirely", async () => {
  const { t, calls } = stubT({ insertIds: ["m1"] });
  await withTxStub(t, async () => {
    await createMediaBatch(
      "property-1",
      [{ mediaType: "IMAGE", storageKey: "a", mimeType: "image/jpeg", sortOrder: 0, isCover: false, caption: null, userId: "user-1" }],
      { imagesPerProperty: null, videosPerProperty: null }
    );
  });
  assert.equal(calls.imageCount.length, 0);
  assert.equal(calls.insert.length, 1);
});

test("omitting limits entirely (backward-compatible call shape) also skips enforcement", async () => {
  const { t, calls } = stubT({ insertIds: ["m1"] });
  await withTxStub(t, async () => {
    await createMediaBatch("property-1", [
      { mediaType: "IMAGE", storageKey: "a", mimeType: "image/jpeg", sortOrder: 0, isCover: false, caption: null, userId: "user-1" }
    ]);
  });
  assert.equal(calls.imageCount.length, 0);
  assert.equal(calls.insert.length, 1);
});
