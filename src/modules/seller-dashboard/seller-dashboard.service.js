import { HttpError } from "../../shared/http.js";
import { toEnquiries } from "../enquiries/enquiries.service.js";
import * as organizationsRepository from "../organizations/organizations.repository.js";
import * as repository from "./seller-dashboard.repository.js";

const RECENT_ENQUIRIES_LIMIT = 5;
const TOP_LISTINGS_LIMIT = 5;

const assertOrganizationMembership = async (organizationId, actorId) => {
  if (!organizationId) return;
  const membership = await organizationsRepository.findMembership(organizationId, actorId);
  if (!membership || membership.status !== "ACTIVE")
    throw new HttpError(
      403,
      "ORGANIZATION_MEMBERSHIP_REQUIRED",
      "You are not a member of this organization."
    );
};

export const summary = async ({ actorId, filters }) => {
  const { from, to, organizationId } = filters;
  await assertOrganizationMembership(organizationId, actorId);

  const [counts, views, enquiries, siteVisits, recentEnquiryRows, topListingRows] =
    await Promise.all([
      repository.listingCounts(actorId, organizationId),
      repository.totalViews(actorId, organizationId, from, to),
      repository.enquiryCounts(actorId, organizationId, from, to),
      repository.siteVisitCount(actorId, organizationId, from, to),
      repository.recentEnquiries(actorId, organizationId, RECENT_ENQUIRIES_LIMIT),
      repository.topListings(actorId, organizationId, from, to, TOP_LISTINGS_LIMIT)
    ]);

  return {
    activeListings: counts.activeListings,
    draftListings: counts.draftListings,
    totalViews: views.count,
    newEnquiries: enquiries.newEnquiries,
    totalEnquiries: enquiries.totalEnquiries,
    siteVisits: siteVisits.count,
    premiumListings: counts.premiumListings,
    recentEnquiries: await toEnquiries(recentEnquiryRows),
    topListings: topListingRows.map(row => ({
      listingId: row.listingId,
      title: row.title,
      views: row.views,
      enquiries: row.enquiries
    }))
  };
};
