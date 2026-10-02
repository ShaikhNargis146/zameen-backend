import assert from "node:assert/strict";
import test from "node:test";
import {
  createAd,
  updateAd,
  adminAdListQuery,
  mediaUpload,
  mediaComplete,
  mediaOrder
} from "../../src/modules/ads/ads.validation.js";

const iso = offsetMs => new Date(Date.now() + offsetMs).toISOString();
const dayMs = 24 * 60 * 60 * 1000;

test("createAd defaults status to ACTIVE and accepts a window that is already open", () => {
  const ad = createAd({
    name: "test admin",
    placement: "AD-BUY-INFEED-01",
    startsAt: iso(-60_000),
    endsAt: iso(7 * dayMs)
  });
  assert.equal(ad.status, "ACTIVE");
  assert.equal(ad.placement, "AD-BUY-INFEED-01");
});

test("createAd rejects a future startsAt — no more scheduling ahead of time", () => {
  assert.throws(
    () =>
      createAd({
        name: "test admin",
        placement: "AD-BUY-INFEED-01",
        startsAt: iso(dayMs),
        endsAt: iso(7 * dayMs)
      }),
    error => error.code === "INVALID_STARTS_AT"
  );
});

test("createAd rejects an endsAt that has already passed", () => {
  assert.throws(
    () =>
      createAd({
        name: "test admin",
        placement: "AD-BUY-INFEED-01",
        startsAt: iso(-2 * dayMs),
        endsAt: iso(-dayMs)
      }),
    error => error.code === "INVALID_ENDS_AT"
  );
});

test("createAd still rejects endsAt at or before startsAt", () => {
  assert.throws(
    () =>
      createAd({
        name: "test admin",
        placement: "AD-BUY-INFEED-01",
        startsAt: iso(-60_000),
        endsAt: iso(-60_000)
      }),
    error => error.code === "INVALID_ENDS_AT"
  );
});

test("createAd rejects SCHEDULED as a status — it's no longer a valid value", () => {
  assert.throws(
    () =>
      createAd({
        name: "test admin",
        placement: "AD-BUY-INFEED-01",
        startsAt: iso(-60_000),
        endsAt: iso(dayMs),
        status: "SCHEDULED"
      }),
    error => error.code === "INVALID_STATUS"
  );
});

test("createAd still accepts an explicit INACTIVE or EXPIRED status", () => {
  const inactive = createAd({
    name: "test admin",
    placement: "AD-BUY-INFEED-01",
    startsAt: iso(-60_000),
    endsAt: iso(dayMs),
    status: "INACTIVE"
  });
  assert.equal(inactive.status, "INACTIVE");

  const expired = createAd({
    name: "test admin",
    placement: "AD-BUY-INFEED-01",
    startsAt: iso(-60_000),
    endsAt: iso(dayMs),
    status: "EXPIRED"
  });
  assert.equal(expired.status, "EXPIRED");
});

test("updateAd (PATCH) can still set ACTIVE, INACTIVE, or EXPIRED with no window constraint", () => {
  assert.equal(updateAd({ status: "EXPIRED" }).status, "EXPIRED");
  assert.equal(updateAd({ status: "INACTIVE" }).status, "INACTIVE");
  assert.equal(updateAd({ status: "ACTIVE" }).status, "ACTIVE");
});

test("updateAd rejects SCHEDULED", () => {
  assert.throws(
    () => updateAd({ status: "SCHEDULED" }),
    error => error.code === "INVALID_STATUS"
  );
});

test("updateAd throws NO_CHANGES when the body is empty", () => {
  assert.throws(() => updateAd({}), error => error.code === "NO_CHANGES");
});

test("adminAdListQuery status filter no longer accepts SCHEDULED", () => {
  assert.throws(
    () => adminAdListQuery({ status: "SCHEDULED" }),
    error => error.code === "INVALID_STATUS"
  );
  assert.equal(adminAdListQuery({ status: "ACTIVE" }).status, "ACTIVE");
  assert.equal(adminAdListQuery({}).status, null);
});

test("ad media upload accepts image and video mime types", () => {
  const image = mediaUpload({ fileName: "cover.jpg", mimeType: "image/jpeg", fileSizeBytes: 1024 });
  assert.equal(image.mimeType, "image/jpeg");

  const mp4 = mediaUpload({ fileName: "clip.mp4", mimeType: "video/mp4", fileSizeBytes: 20 * 1024 * 1024 });
  assert.equal(mp4.mimeType, "video/mp4");

  const webm = mediaUpload({ fileName: "clip.webm", mimeType: "video/webm", fileSizeBytes: 20 * 1024 * 1024 });
  assert.equal(webm.mimeType, "video/webm");
});

test("ad media upload rejects an unsupported mime type", () => {
  assert.throws(
    () => mediaUpload({ fileName: "clip.mov", mimeType: "video/quicktime", fileSizeBytes: 1024 }),
    error => error.code === "INVALID_MIME_TYPE"
  );
});

test("ad media upload rejects a file over the size cap", () => {
  assert.throws(
    () =>
      mediaUpload({
        fileName: "huge.mp4",
        mimeType: "video/mp4",
        fileSizeBytes: 51 * 1024 * 1024
      }),
    error => error.code === "INVALID_FILE_SIZE_BYTES"
  );
});

test("ad media upload supports a batch of files, capped at 8", () => {
  const files = Array.from({ length: 8 }, (_, index) => ({
    fileName: `file-${index}.jpg`,
    mimeType: "image/jpeg",
    fileSizeBytes: 1024
  }));
  const results = mediaUpload({ files });
  assert.equal(results.length, 8);

  assert.throws(
    () => mediaUpload({ files: [...files, { fileName: "one-too-many.jpg", mimeType: "image/jpeg", fileSizeBytes: 1024 }] }),
    error => error.code === "VALIDATION_ERROR"
  );
});

test("ad media complete requires a storageKey and defaults sortOrder/isCover", () => {
  const completed = mediaComplete({
    fileName: "cover.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: 1024,
    storageKey: "ads/ad-1/media/cover.jpg"
  });
  assert.equal(completed.sortOrder, 0);
  assert.equal(completed.isCover, false);

  assert.throws(
    () =>
      mediaComplete({
        fileName: "cover.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 1024
      }),
    error => error.code === "INVALID_STORAGE_KEY"
  );
});

test("mediaOrder requires a unique, non-empty list of ids", () => {
  assert.deepEqual(mediaOrder({ mediaIds: ["a", "b"] }), ["a", "b"]);
  assert.throws(
    () => mediaOrder({ mediaIds: ["a", "a"] }),
    error => error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => mediaOrder({ mediaIds: [] }),
    error => error.code === "VALIDATION_ERROR"
  );
});
