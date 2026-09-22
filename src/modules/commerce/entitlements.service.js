import { HttpError } from "../../shared/http.js";
import * as repository from "./commerce.repository.js";
import * as listingsRepository from "../listings/listings.repository.js";

// Ambient Free-tier fallbacks — only used if the FREE plan somehow isn't
// seeded yet (see grantFreePlan below and migrations/016_subscription_entitlements.sql).
// Once seeded, every owner (user or organization — grantFreePlan is called
// for both, on registration and on organization creation respectively)
// resolves to a real, admin-editable plan row and these constants stop being
// exercised in steady state.
export const DEFAULT_FREE_LISTING_LIMIT = 2;
export const DEFAULT_FREE_TEAM_MEMBERS = 1;

const featureLabels = {
  advancedAnalytics: "Advanced analytics",
  verifiedBadge: "Verified badge",
  bulkUpload: "Bulk upload"
};

// Read-only limit resolution — deliberately NOT a check-then-throw "assert"
// function, for the same TOCTOU reason as resolveTeamMemberLimit below: two
// concurrent submissions from the same owner (e.g. a client double-submit,
// or two browser tabs) could both read the same pre-write "used" count and
// both pass. Enforcement instead happens inside
// listings.repository.js#submitWithinLimit's own advisory-locked
// transaction, which this resolved limit is passed into — see
// listings.service.js#submit. owner = { userId, organizationId } — resolved
// from the listing row itself (see
// docs/subscription-entitlements-implementation-plan.md §3), NOT from
// req.actor directly, so the right plan applies regardless of which org
// member happens to be acting. Returns null for unlimited.
export const resolveListingLimit = async owner => {
  const active = await repository.resolveEffectivePlanForOwner(owner);
  const limit = active ? active.listingLimit : DEFAULT_FREE_LISTING_LIMIT;
  return limit === null || limit === undefined ? null : limit;
};

// Read-only limit resolution — deliberately NOT a check-then-throw "assert"
// function, for the same TOCTOU reason as resolveListingLimit/
// resolveTeamMemberLimit: a plain read-then-write here (check usage, then
// separately insert media) would let two concurrent upload batches for the
// same property both read the same pre-write count and both pass.
// Enforcement instead happens inside
// properties.repository.js#createMediaBatch's own advisory-locked
// transaction (locked per-property, since this limit is per-property, not
// pooled across an owner's account like listing/team-member limits), which
// this resolved pair is passed into — see properties.service.js#completeMedia.
// owner = { userId, organizationId } — resolved by the caller from the
// property's own raw DB columns (propertiesRepository.ownerFields), NOT
// derived from whatever shape req.property happens to be: req.property
// varies by which loader populated it (an owner-scoped load vs.
// requireOwnedResource's admin loader use different SELECTs — see
// properties.repository.js#ownerFields), so deriving owner fields from it
// directly previously meant an ADMIN-completed upload silently skipped
// enforcement (both fields resolved undefined). `active?.features` (not
// `active ? active.features : {}`) also covers a plan row whose features
// column is itself NULL, not just a missing plan row.
export const resolveMediaLimits = async owner => {
  const active = await repository.resolveEffectivePlanForOwner(owner);
  const features = active?.features || {};
  return {
    imagesPerProperty: features.imagesPerProperty ?? null,
    videosPerProperty: features.videosPerProperty ?? null
  };
};

// Read-only limit resolution — deliberately NOT a check-then-throw "assert"
// function. A plain "count members, compare, throw" check here would be a
// TOCTOU race: two concurrent addMember calls for two different new users
// could both read the same pre-write count and both pass. Enforcement
// instead happens inside organizations.repository.js#addMember's own
// advisory-locked transaction (organizationMembershipLockKey), which this
// resolved limit is passed into — see organizations.service.js#addMember.
// Returns null for unlimited/not-set, matching the plan-lookup convention
// used everywhere else in this file.
export const resolveTeamMemberLimit = async organizationId => {
  const active = await repository.resolveEffectivePlanForOwner({ organizationId });
  const limit = active ? active.features?.teamMembers : DEFAULT_FREE_TEAM_MEMBERS;
  return limit === null || limit === undefined ? null : limit;
};

// Boolean feature gating (advancedAnalytics, verifiedBadge, bulkUpload) —
// these read as the acting user's own capability, not a property of a
// specific listing/property, so they resolve through the actor's
// personal-or-org plan rather than resource ownership.
export const assertFeature = async ({ userId, organizationId }, key) => {
  const active = organizationId
    ? await repository.resolveEffectivePlanForOwner({ organizationId })
    : await repository.resolveEffectivePlanForUser(userId);
  const features = active ? active.features : {};
  if (!features?.[key])
    throw new HttpError(403, "FEATURE_NOT_AVAILABLE", `${featureLabels[key] || key} is not available on your plan.`, {
      feature: key,
      upgradeRequired: true
    });
};

// Consumes one unit of the owner's plan-included monthly featured-listing
// allowance and grants the promotion, atomically — see
// commerce.repository.js#grantFeaturedListingFromAllowance. Returns
// { promotion, alreadyFeatured } either way: alreadyFeatured is true if the
// listing already has an active FEATURED promotion (e.g. bought separately
// through paid checkout), independent of whether the plan has any
// plan-included allowance at all — a listing that's already featured must
// report that accurately even on a FREE plan with zero allowance, not a
// misleading "no allowance left" for an action that already succeeded some
// other way. Otherwise: promotion null + alreadyFeatured false if there's no
// allowance configured, or if this period's allowance is exhausted;
// otherwise the granted { id, endsAt }. Deliberately not a separate
// "consume" + "grant" pair of calls: those would commit as two independent
// transactions, and a failure in the second could permanently consume the
// allowance with nothing actually featured.
export const grantFeaturedListing = async (owner, listingId) => {
  const active = await repository.resolveEffectivePlanForOwner(owner);
  const limit = active?.features?.featuredListingsPerMonth;
  if (!limit) {
    const alreadyFeatured = await repository.isListingFeatured(listingId);
    return { promotion: null, alreadyFeatured };
  }
  return repository.grantFeaturedListingFromAllowance({
    userId: owner.userId,
    organizationId: owner.organizationId,
    limit,
    listingId,
    // ?? not || -- an admin-configured featuredDays of 0 is a valid,
    // distinct value (schema only rejects negative), and must not be
    // treated the same as "not set".
    featuredDays: active.featuredDays ?? 30
  });
};

// Materializes an explicit FREE commerce.plan_subscriptions row for a user
// (on registration, see auth.service.js#verifyOtp) or an organization (on
// creation, see organizations.service.js#create) rather than leaving the
// Free tier as an ambient constant, so admins can edit its limits via
// PATCH /admin/plans/:planId without a deploy for either owner form.
// Tolerates a missing seed (FREE product/plan not yet inserted) rather than
// failing registration/org creation — the DEFAULT_FREE_* constants above
// cover that gap defensively. Exactly one of userId/organizationId is
// expected, matching chk_plan_subscription_owner.
//
// The existing-active-plan check below guards a real, if narrow, race:
// auth.service.js#verifyOtp's new-user branch (where this is called from)
// already has its own documented fallback for two concurrent OTP
// verifications racing to create the same new user — createUser/addDefaultRoles
// are both ON CONFLICT DO NOTHING and tolerate that race safely, but a plain
// INSERT here would not, and could leave a user or org with two ACTIVE FREE
// plan_subscriptions rows. This check-then-insert isn't itself lock-protected
// (there's no natural lock scaffolding to hook into here, unlike
// listings.repository.js#submitWithinLimit or organizations.repository.js#addMember),
// so it narrows the race rather than closing it completely — sufficient
// given how tight the actual window is (createUser/addDefaultRoles must both
// complete on one request before the other reaches this check).
export const grantFreePlan = async ({ userId = null, organizationId = null }) => {
  const existing = await repository.findActiveSubscriptionForOwner({ userId, organizationId });
  if (existing) return;
  const freePlan = await repository.findPlanByCode("PLAN_FREE");
  if (!freePlan) return;
  await repository.grantPlanDirectly({
    userId,
    organizationId,
    planId: freePlan.id,
    startsAt: new Date(),
    endsAt: null
  });
};
