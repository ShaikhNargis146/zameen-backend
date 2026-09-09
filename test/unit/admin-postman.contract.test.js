import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const flattenRequests = (items, requests = []) => {
  for (const item of items) {
    if (item.item) flattenRequests(item.item, requests);
    else requests.push(item.request);
  }
  return requests;
};

const requestSignature = (request) => {
  const rawUrl =
    typeof request.url === "string" ? request.url : request.url?.raw || "";
  return `${request.method} ${rawUrl.replace(/\?.*$/, "")}`;
};

test("the consolidated admin Postman collection covers every mounted admin endpoint", async () => {
  const collection = JSON.parse(
    await readFile(
      new URL("../../postman/Zameens-Admin.postman_collection.json", import.meta.url),
      "utf8"
    )
  );
  const signatures = new Set(
    flattenRequests(collection.item).map(requestSignature)
  );

  const expected = [
    "GET {{baseUrl}}/admin/users",
    "GET {{baseUrl}}/admin/users/{{userId}}",
    "PATCH {{baseUrl}}/admin/users/{{userId}}/status",
    "PATCH {{baseUrl}}/admin/users/{{userId}}/roles",
    "GET {{baseUrl}}/admin/listings",
    "GET {{baseUrl}}/admin/listings/{{listingId}}",
    "POST {{baseUrl}}/admin/listings/{{listingId}}/approve",
    "POST {{baseUrl}}/admin/listings/{{listingId}}/reject",
    "POST {{baseUrl}}/admin/listings/{{listingId}}/suspend",
    "POST {{baseUrl}}/admin/listings/{{listingId}}/reinstate",
    "GET {{baseUrl}}/admin/verifications",
    "GET {{baseUrl}}/admin/verifications/{{verificationId}}",
    "PATCH {{baseUrl}}/admin/verifications/{{verificationId}}",
    "POST {{baseUrl}}/admin/plans",
    "PATCH {{baseUrl}}/admin/plans/{{planId}}",
    "POST {{baseUrl}}/admin/plans/{{planId}}/activate",
    "POST {{baseUrl}}/admin/plans/{{planId}}/deactivate",
    "GET {{baseUrl}}/admin/service-requests",
    "GET {{baseUrl}}/admin/service-requests/{{serviceRequestId}}",
    "PATCH {{baseUrl}}/admin/service-requests/{{serviceRequestId}}/status",
    "POST {{baseUrl}}/admin/service-requests/{{serviceRequestId}}/report",
    "POST {{baseUrl}}/admin/content",
    "PATCH {{baseUrl}}/admin/content/{{contentId}}",
    "DELETE {{baseUrl}}/admin/content/{{contentId}}",
    "POST {{baseUrl}}/admin/content/{{contentId}}/publish",
    "POST {{baseUrl}}/admin/content/{{contentId}}/archive",
    "POST {{baseUrl}}/admin/market-trends",
    "PATCH {{baseUrl}}/admin/market-trends/{{seriesId}}",
    "DELETE {{baseUrl}}/admin/market-trends/{{seriesId}}",
    "POST {{baseUrl}}/admin/market-trends/{{seriesId}}/points",
    "PATCH {{baseUrl}}/admin/market-trends/{{seriesId}}/points/{{pointId}}",
    "DELETE {{baseUrl}}/admin/market-trends/{{seriesId}}/points/{{pointId}}",
    "GET {{baseUrl}}/admin/channel-partners",
    "GET {{baseUrl}}/admin/channel-partners/{{partnerId}}",
    "POST {{baseUrl}}/admin/channel-partners/{{partnerId}}/approve",
    "POST {{baseUrl}}/admin/channel-partners/{{partnerId}}/reject",
    "POST {{baseUrl}}/admin/channel-partners/{{partnerId}}/suspend",
    "POST {{baseUrl}}/admin/investment-opportunities",
    "PATCH {{baseUrl}}/admin/investment-opportunities/{{opportunityId}}",
    "POST {{baseUrl}}/admin/investment-opportunities/{{opportunityId}}/publish",
    "POST {{baseUrl}}/admin/investment-opportunities/{{opportunityId}}/close",
    "POST {{baseUrl}}/admin/auctions",
    "PATCH {{baseUrl}}/admin/auctions/{{auctionId}}",
    "DELETE {{baseUrl}}/admin/auctions/{{auctionId}}",
    "POST {{baseUrl}}/admin/ads",
    "PATCH {{baseUrl}}/admin/ads/{{adId}}",
    "DELETE {{baseUrl}}/admin/ads/{{adId}}",
    "PATCH {{baseUrl}}/admin/organizations/{{organizationId}}/status"
  ];

  assert.deepEqual([...signatures].sort(), expected.sort());
  assert.equal(collection.auth?.bearer?.[0]?.value, "{{adminAccessToken}}");
  assert.equal(
    flattenRequests(collection.item).every(
      (request) => !request.auth || request.auth?.bearer?.[0]?.value === "{{adminAccessToken}}"
    ),
    true
  );
});
