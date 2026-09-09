import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("site-visit duplicate conflicts and linked enquiry updates are handled", async () => {
  const service = await readFile(
    new URL("../../src/modules/site-visits/site-visits.service.js", import.meta.url),
    "utf8"
  );

  assert.match(service, /error\?\.code === "23505"/);
  assert.match(service, /"SITE_VISIT_DUPLICATE"/);
  assert.match(service, /const updateEnquiryStatus = async/);
  assert.match(service, /await updateEnquiryStatus\(enquiryId, "SITE_VISIT"\)/);
  assert.match(service, /await updateEnquiryStatus\(enquiryId, enquiryStatus\)/);
});
