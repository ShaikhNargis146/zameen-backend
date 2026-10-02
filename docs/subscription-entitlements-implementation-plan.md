# Subscription & Plan Entitlements — Phase 1 Implementation Plan

**Status (2026-09-22):** Planning. Written against branch `FWD-Payment-gateway`. For the existing payment flow this builds on, see [`razorpay-payment-flow-implementation.md`](./razorpay-payment-flow-implementation.md) and [`razorpay-integration-plan.md`](./razorpay-integration-plan.md).

## 0. Key finding — do not build a new Subscription module

The brief this plan is based on proposes a brand-new `Subscription` module with 3 tables (`subscription_plans`, `user_subscriptions`, `subscription_usage`). **That system already exists in this codebase**, under `src/modules/commerce/`, and is more complete than the brief assumes:

| Brief's proposal | Already exists as |
|---|---|
| `subscription_plans` (code, name, price, `features` jsonb) | `commerce.products` + `commerce.plans` (same idea, split across two tables: catalog/pricing vs plan-specific fields) |
| `user_subscriptions` (user, plan, status, period, provider) | `commerce.plan_subscriptions` (same fields, plus `order_item_id` linking it to the purchase that created it, **and already has an `organization_id` column** — org-owned plans are a first-class case, not just a user thing) |
| `subscription_usage` (feature, used_count, period) | `ai.usage_events` — a working usage ledger, but **only for AI queries** today, and (see §3 below) its org-pooling is narrower than plain org ownership |
| `SubscriptionService` | `commerce.service.js` (`myPlanSubscription`, `listPlans`, admin CRUD) + `ai.service.js` (`reserveAiQuota` — the quota-check pattern) |
| Checkout → payment → webhook → activate plan | Fully built: `POST /orders` (already accepts an `organizationId`) → `POST /payments/:orderId/create` (Razorpay Payment Link) → `POST /payments/webhook` → `capturePaymentAndApplyEntitlements` |
| Admin plan management | `GET/POST/PATCH /admin/plans`, `.../activate`, `.../deactivate` — already implemented |

**Building a parallel `subscription_plans`/`user_subscriptions` schema, as the brief's SQL literally describes, would create two competing sources of truth for "what plan does this user have."** The work in this plan is instead: (1) fill the **enforcement gap** — limits exist in the data model but nothing checks them, for either individuals or organizations — and (2) add the couple of user-facing pieces that are genuinely missing (a full entitlement API, a featured-listing endpoint, boolean feature gating, a team-member limit, registration hook, cancellation).

This keeps the spirit of the brief's "Final Recommendation" section (3 tables, one service, no premature abstractions) while not duplicating what's already shipped.

### Terminology map (brief → codebase)

| Brief term | Codebase equivalent |
|---|---|
| `subscription_plans.code` | `commerce.products.code` (e.g. `PLAN_FREE`, `PLAN_PRO`) |
| `subscription_plans.features` (jsonb) | `commerce.plans.features` (jsonb) — already exists, currently unused for anything but pass-through |
| `user_subscriptions` | `commerce.plan_subscriptions` — `user_id` **or** `organization_id`, never both (see §3) |
| `subscription_usage` | `ai.usage_events` (AI only) — **needs a second, generic table for featured listings** (§6) |
| `req.user` | `req.actor` (`{ id, name, roles: string[], ... }`, set by `requireAuth`/`requireAdmin` in `auth.routes.js`) |
| Throwing a typed API error | `throw new HttpError(status, code, message, details?)` from `src/shared/http.js` — flows through `asyncRoute` to the central error handler automatically |
| `POST /properties/:id/publish` | This codebase's equivalent is a two-step flow: `POST /properties/:id/listings` (create, DRAFT) → `POST /listings/:id/submit` → admin `POST /admin/listings/:id/approve` (→ `status = PUBLISHED`) |

---

## 1. What already fully works (no action needed)

- **Plan catalog**: `GET /plans` (public), `GET /plans/me` (auth) — already returns `listingLimit`, `featuredDays`, `verificationIncluded`, `features` (jsonb), `aiMonthlyQuota`.
- **Admin plan CRUD**: `GET/POST /admin/plans`, `PATCH /admin/plans/:planId`, `.../activate`, `.../deactivate` — admin can already change any plan's limits/price without a deploy (brief §17 — done).
- **Checkout → payment → activation**: `POST /orders`, `POST /payments/:orderId/create`, `POST /payments/webhook` (Razorpay, HMAC-verified, idempotent) — brief §8/§9 — done. `commerce.repository.capturePaymentAndApplyEntitlements` already extends `ends_at` correctly if the user/org already has an active plan (upgrade/renewal), not just overwrite. Orders already support buying a plan on behalf of an organization (`organizationId` in `POST /orders`, membership-validated).
- **AI query quota enforcement**: `ai.service.js`'s `reserveAiQuota` (reserve → confirm/release) already gates `POST /ai/conversations/:id/messages` against `commerce.plans.ai_monthly_quota`, with an ambient `DEFAULT_FREE_AI_MONTHLY_QUOTA = 5` for users with no plan row, and a Postgres advisory-lock query to stay race-safe under concurrent requests. **This reserve/confirm/release + advisory-lock shape is the reference pattern for every other limit check below — mirror it, don't reinvent it.**
  - Its org-pooling, however, is **narrower than general org ownership**: `activeOrganizationPlanForChannelPartner` only pools quota for a user who is an *approved channel partner* (`account.channel_partner_profiles.status = 'APPROVED'`) — a separate, narrower relationship from ordinary `account.organization_members` (OWNER/ADMIN/MEMBER). A regular member of a BROKERAGE/DEVELOPER org whose org bought a plan gets **no** AI-quota benefit from it today unless they're also a channel partner. This is an existing asymmetry in the codebase, not something introduced by this plan — **resolved in §3a below**, so it doesn't ship as a second, inconsistent mechanism alongside the owner-resolution model the rest of this plan uses.
- **Invoices**: PDF generation + GST split already implemented (`invoice.pdf.js`, `tax.js`).

## 2. Gaps to close (the actual work)

In priority order:

1. `commerce.plans.listing_limit` is never enforced anywhere, for individuals or orgs (§4)
2. No per-property image/video count limits (§5)
3. `teamMembers` is never enforced — an org can add unlimited members regardless of plan (§6)
4. No entitlement API shaped like the brief's `GET /me/subscription` (features + limits + usage in one response) (§7)
5. No boolean feature gating (`advancedAnalytics`, `verifiedBadge`, `bulkUpload`) (§8)
6. Featured-listing flow is purchase-only; brief wants a plan-included monthly allowance — **needs a decision** (§9)
7. No explicit "grant FREE plan on registration" — currently implicit/ambient (§10)
8. No cancellation endpoint (§11 — also needs a decision)

---

## 3. Owner resolution — individual vs. organization (read this before §4–§9)

This is cross-cutting and every enforcement check below depends on it, so it's worth getting right once rather than re-deciding it per feature.

**The correct signal for "whose plan applies" is who *owns* the resource being acted on, not who is clicking the button.** The schema already carries this:

- `land.properties.owner_organization_id` (nullable — falls back to `created_by_user_id` when null)
- `marketplace.listings.seller_organization_id` (nullable — falls back to `seller_user_id`; `chk_listing_seller` guarantees exactly one owner form)
- `commerce.plan_subscriptions.organization_id` (nullable — falls back to `user_id`; a plan is bought for a user *or* an org, never both, matching `findActiveSubscriptionForUser`'s existing `organization_id IS NULL` filter)

So resolving entitlements for a specific property/listing means: read that row's own `*_organization_id`, and if set, look up the **org's** plan; otherwise look up the **owning user's** plan. This is deliberately *not* the channel-partner mechanism AI quota uses (§1) — that's a narrower "does this specific person get to draw on their org's AI pool" check, whereas listing/media/featured-listing limits are a property of the resource itself, resolved the same way regardless of which org member is acting on it.

**New shared repository helper** (`commerce.repository.js`), used by every check in §4–§6 and §9 instead of `findActiveSubscriptionForUser` directly:

```js
export const findActiveSubscriptionForOwner = ({ userId, organizationId }) =>
  organizationId
    ? run(
        "oneOrNone",
        `SELECT ps.status AS "subscriptionStatus", ps.starts_at AS "startsAt", ps.ends_at AS "endsAt", ${planColumns}
         FROM commerce.plan_subscriptions ps
         JOIN commerce.plans pl ON pl.id = ps.plan_id
         JOIN commerce.products pr ON pr.id = pl.product_id
         WHERE ps.organization_id = $1
           AND ps.status = 'ACTIVE' AND (ps.ends_at IS NULL OR ps.ends_at > now())
         ORDER BY ps.ends_at DESC NULLS LAST LIMIT 1`,
        [organizationId]
      )
    : findActiveSubscriptionForUser(userId);
```

**Free-tier default for orgs — decided: reuse the same free-tier constants used for individuals** (`DEFAULT_FREE_LISTING_LIMIT`, `DEFAULT_FREE_TEAM_MEMBERS`, `DEFAULT_FREE_AI_MONTHLY_QUOTA`), applied to `organizationId` lookups the same way they already apply to `userId` lookups. Simpler, one set of constants instead of two, and nothing in the brief asks for a lower org default. If a business-account free tier should in fact be zero/blocked, that's a one-line change to `findActiveSubscriptionForOwner`'s caller once product asks for it — not a reason to build two code paths now.

### 3a. Fixing AI quota's channel-partner-only pooling

This resolves the asymmetry flagged in §1: AI quota currently pools by channel-partner status, while §4–§6 pool by plain org ownership/membership. Two different mechanisms answering the same question ("does this org's plan cover this user's usage right now?") is the actual bug — not which mechanism is "more correct" in isolation. Fix: **make AI quota use the exact same owner-resolution model as everything else in this plan**, and stop using `channel_partner_profiles` for entitlement purposes at all — it stays a professional-verification profile, unrelated to billing.

**Why not just widen `activeOrganizationPlanForChannelPartner` to check `organization_members` instead of `channel_partner_profiles`?** Because `channel_partner_profiles` is a 1:1 table (`user_id PRIMARY KEY`, at most one `organization_id`), so there was never any ambiguity about *which* org's quota a channel partner draws from. `organization_members` is many-to-many — a user can belong to more than one org — so a membership-only check can't silently pick one. The fix has to also change *how the org is selected*, not just which table gates it.

**Concrete fix — mirror `commerce.service.js#createOrder`'s existing pattern exactly** (it already solves this same problem for orders): the caller states which org it's acting for, the server validates active membership, and only then resolves that org's plan.

1. **API surface**: add an optional `organizationId` to the AI request bodies that currently have no org context — `POST /ai/conversations/:conversationId/messages`, `POST /ai/search`, `POST /ai/listing/generate` (`ai.validation.js`, `optionalUuid`-style, same helper `commerce.validation.js` already has).
2. **Membership check** (`ai.service.js`, new `resolveOrganizationContext`), copied from `commerce.service.js#createOrder` lines 257–265:
   ```js
   const resolveOrganizationContext = async (actorId, organizationId) => {
     if (!organizationId) return null;
     const membership = await organizationsRepository.findMembership(organizationId, actorId);
     if (!membership || membership.status !== "ACTIVE")
       throw new HttpError(403, "ORGANIZATION_ACCESS_DENIED", "You are not an active member of that organisation.");
     return organizationId;
   };
   ```
3. **Quota resolution** — replace `activeOrganizationPlanForChannelPartner` with the **same `commerce.repository.findActiveSubscriptionForOwner({ organizationId })` from §3** that §4–§6 use, instead of a separate AI-only org-plan query:
   ```js
   // ai.service.js reserveAiQuota, rewritten
   const reserveAiQuota = async (actorId, kind, organizationId) => {
     const orgId = await resolveOrganizationContext(actorId, organizationId);
     const active = orgId
       ? await commerceRepository.findActiveSubscriptionForOwner({ organizationId: orgId })
       : await commerceRepository.findActiveSubscriptionForUser(actorId);
     const quota = active ? active.aiMonthlyQuota : DEFAULT_FREE_AI_MONTHLY_QUOTA;
     if (quota === null) return noopRelease;
     const reservationId = await repository.reserveAiQuotaUsage({ userId: actorId, organizationId: orgId, quota, kind });
     if (reservationId === null)
       throw new HttpError(403, "AI_MONTHLY_QUOTA_EXCEEDED", `You have used all ${quota} AI Property Assistant questions ...`);
     return async (succeeded = false) => succeeded ? repository.confirmAiQuotaUsage(reservationId) : repository.releaseAiQuotaUsage(reservationId);
   };
   ```
   `ai.repository.reserveAiQuotaUsage`/`confirmAiQuotaUsage`/`releaseAiQuotaUsage` and the `ai.usage_events` table are untouched — they already accept an `organizationId` generically. Only *which org, and how it's authorized* changes. The doc comment currently sitting above `reserveAiQuota` in `ai.service.js` ("Scope is auto-detected... an APPROVED channel partner attached to an organization...") describes the mechanism being replaced — update/remove it in the same change, not leave it describing dead behavior.
4. **Remove** `ai.repository.js#activeOrganizationPlanForChannelPartner` and `ai.service.js`'s `orgPlan`/`activePlanForUser`-branching logic it drove — `activePlanForUser` (personal path) also becomes redundant with `commerce.repository.findActiveSubscriptionForUser` and can be deleted in favor of it, so there's exactly one "resolve a plan for {user, org}" query in the codebase, not three.
5. **No schema migration** — `ai.usage_events.organization_id` already exists and is already nullable/generic; this is a query- and API-surface-level fix only.
6. **Coordination needed**: any channel partner currently relying on *implicit* org-quota pooling (no `organizationId` sent today, since the param doesn't exist yet) will fall back to their **personal** quota once this ships, until the frontend starts sending `organizationId` on these three calls. Sequence this with a frontend change, or ship both in the same release — flag to whoever owns the frontend AI integration.
7. **Test impact**: `test/unit/ai.quota.test.js` currently asserts the channel-partner-gated query shape — it needs rewriting to assert the membership-check + `findActiveSubscriptionForOwner` shape instead, plus new cases for `ORGANIZATION_ACCESS_DENIED` (org id supplied but not an active member) and the multi-org case being resolved by whichever org the caller specified.

---

## 4. Active-listing limit enforcement

**Where to check:** in `src/modules/listings/listings.service.js`, in `submit()` (the user-initiated "go live" action — closest analog to the brief's `publish` endpoint). Recommend also re-checking in `approve()` (admin-side) as a defensive backstop, since a user could submit several listings back-to-back while under the limit and have an admin approve all of them later, exceeding it. For Phase 1, the `submit()` check alone is probably sufficient — add the `approve()` check only if that race is a real concern.

**New helper**, e.g. `src/modules/commerce/entitlements.service.js` (new file, keeps `commerce.service.js` from growing unbounded):

```js
import { HttpError } from "../../shared/http.js";
import * as repository from "./commerce.repository.js";
import * as listingsRepository from "../listings/listings.repository.js"; // countLiveForOwner, new

const DEFAULT_FREE_LISTING_LIMIT = 2; // matches ai.service.js's ambient-free-tier convention

// owner = { userId, organizationId } — resolved from the listing/property row
// itself (see §3), NOT from req.actor directly, so the right plan applies
// regardless of which org member happens to be submitting.
export const assertListingLimit = async owner => {
  const active = await repository.findActiveSubscriptionForOwner(owner);
  const limit = active ? active.listingLimit : DEFAULT_FREE_LISTING_LIMIT;
  if (limit === null) return; // unlimited
  const used = await listingsRepository.countLiveForOwner(owner);
  if (used >= limit)
    throw new HttpError(403, "PLAN_LIMIT_REACHED", `This plan allows up to ${limit} active listings.`, {
      feature: "ACTIVE_LISTINGS", used, limit, upgradeRequired: true
    });
};
```

**New repository query** (`listings.repository.js`), counting against whichever owner form applies — org-wide if org-owned, so all of an org's members share the same pool of active listings, matching how `teamMembers` (§6) implies a shared-org-quota model rather than a per-member one:

```js
export const countLiveForOwner = ({ userId, organizationId }) =>
  run(
    "one",
    organizationId
      ? `SELECT count(*)::int AS count FROM marketplace.listings WHERE seller_organization_id = $1 AND status = 'PUBLISHED'`
      : `SELECT count(*)::int AS count FROM marketplace.listings WHERE seller_user_id = $1 AND seller_organization_id IS NULL AND status = 'PUBLISHED'`,
    [organizationId || userId]
  ).then(r => r.count);
```

**Call site** — top of `submit()` in `listings.service.js`, before the existing `propertyScanner` readiness check. `listing.seller_organization_id`/`listing.seller_user_id` come straight off the row already loaded by `ownedListing`:
```js
export const submit = async listing => {
  await assertListingLimit({ userId: listing.seller_user_id, organizationId: listing.seller_organization_id }); // new
  if (!["DRAFT","REJECTED"].includes(listing.review_status) || listing.status !== "INACTIVE") ...
```

**Error shape** matches the brief's contract exactly, for free, because `HttpError`'s 4th arg (`details`) is spread into the JSON body by the existing error middleware:
```json
{ "success": false, "error": { "code": "PLAN_LIMIT_REACHED", "message": "...", "details": { "feature": "ACTIVE_LISTINGS", "used": 2, "limit": 2, "upgradeRequired": true } } }
```
This nests `feature`/`used`/`limit`/`upgradeRequired` under `details` rather than flat on `error`, per this codebase's existing convention (see `ai.service.js`'s `AI_MONTHLY_QUOTA_EXCEEDED`). **Decided: keep the nested shape** — matching every existing error in this codebase beats matching the brief's literal JSON, and the frontend only needs to read one extra level (`error.details.limit` instead of `error.limit`) to get the identical fields. Applies to every `PLAN_LIMIT_REACHED`/`FEATURE_NOT_AVAILABLE` thrown anywhere in this plan (§5, §6, §8, §9), not just this one.

---

## 5. Per-property image/video limits

`land.property_media.media_type` is `IMAGE | VIDEO | DRONE_VIDEO | SITE_PLAN`. The brief only defines `imagesPerProperty`/`videosPerProperty`; decide how `SITE_PLAN` and `DRONE_VIDEO` map (recommendation: `VIDEO` + `DRONE_VIDEO` both count against `videosPerProperty`; `SITE_PLAN` stays uncounted, since it's a document-like asset, not marketing media).

Since `commerce.plans` has no dedicated `images_per_property`/`videos_per_property` columns, store these under the existing `commerce.plans.features` jsonb (no migration needed for the columns themselves):
```json
{ "imagesPerProperty": 20, "videosPerProperty": 1, "advancedAnalytics": true, "verifiedBadge": true, "bulkUpload": false, "teamMembers": 1 }
```

**Where to check:** `src/modules/properties/properties.service.js`, in `completeMedia()`, before `repository.createMediaBatch(...)` — count existing media rows of the same category for that property and reject if the batch would exceed the limit. Same owner-resolution as §4: use `property.owner_organization_id ?? property.created_by_user_id`, not `actorId`, so the limit is the property owner's plan regardless of which org member is uploading.

```js
export const completeMedia = async ({ propertyId, actorId, input }) => {
  const items = Array.isArray(input) ? input : [input];
  await assertMediaLimit({ property, items }); // new — property already loaded by the route's requireOwnedResource
  ...
```

`assertMediaLimit` calls `entitlements.assertListingLimit`'s sibling using `findActiveSubscriptionForOwner({ userId: property.created_by_user_id, organizationId: property.owner_organization_id })`, plus a new repository count query (`properties.repository.js`):
```js
export const countMediaByType = (propertyId, types) =>
  run("one", `SELECT count(*)::int AS count FROM land.property_media WHERE property_id = $1 AND media_type = ANY($2::text[])`, [propertyId, types])
    .then(r => r.count);
```

---

## 6. Team-member limit enforcement (`teamMembers`)

Genuinely missing today: `POST /organizations/:organizationId/members` (`organizations.service.js#addMember`) has no cap at all. This is the one limit that is inherently org-only (an individual has no "team").

**Where to check:** `src/modules/organizations/organizations.service.js#addMember` (currently lines 119–154). That function is reused for both inviting a brand-new member *and* changing an existing member's role (see `changesOwnership`/`existing` handling) — the limit must only apply to the **new-member** path, not a role change on someone already on the team. Insert right after the existing `const existing = await repository.findMembership(organizationId, userId);` (line 122) and before `repository.addMember(...)` (line 141):

```js
export const addMember = async ({ organizationId, actorId, userId, role }) => {
  requireActiveOrganization(await requireOrganization(organizationId));
  const actorMembership = await requireManager(organizationId, actorId);
  const existing = await repository.findMembership(organizationId, userId);
  if (!existing) await assertTeamMemberLimit(organizationId); // new — only gates genuinely new members, not role changes
  const changesOwnership = role === "OWNER" || existing?.role === "OWNER";
  ...
```

Count existing members with `status IN ('ACTIVE','INVITED')` (both consume a seat — an outstanding invite should count, otherwise an org could out-invite its limit and race acceptances — **decided**, see §13) against `commerce.plans.features.teamMembers`, resolved via `findActiveSubscriptionForOwner({ organizationId })` (no `userId` fallback — an org with no plan uses the free-tier `teamMembers` default, e.g. `1`, matching the brief's FREE tier).

```js
export const assertTeamMemberLimit = async organizationId => {
  const active = await repository.findActiveSubscriptionForOwner({ organizationId });
  const limit = active ? active.features.teamMembers : DEFAULT_FREE_TEAM_MEMBERS; // e.g. 1
  if (limit === null || limit === undefined) return; // unlimited / not set = no cap
  const used = await organizationsRepository.countActiveOrInvitedMembers(organizationId);
  if (used >= limit)
    throw new HttpError(403, "PLAN_LIMIT_REACHED", `This organization's plan allows up to ${limit} team members.`, {
      feature: "TEAM_MEMBERS", used, limit, upgradeRequired: true
    });
};
```

---

## 7. Entitlement API — `GET /me/subscription`

The brief's single most important endpoint. Since `commerce.routes.js` mounts at the API root already (not under `/commerce`), this can be added directly there without a new module:

```js
// commerce.routes.js
router.get("/me/subscription", requireAuth, asyncRoute(controller.mySubscription));
```

This is the **acting user's own personal entitlement view** — `req.actor.id`, not an org. `commerce.service.js` — new `mySubscription(actorId)`, composing existing pieces plus new read-only usage counts:

```js
export const mySubscription = async actorId => {
  const active = await repository.findActiveSubscriptionForUser(actorId); // personal only, deliberately not findActiveSubscriptionForOwner
  const plan = active ? toPlan(active) : FREE_PLAN_DEFAULTS; // ambient free tier, see §10
  const [listingsUsed, aiUsed, featuredUsed] = await Promise.all([
    listingsRepository.countLiveForOwner({ userId: actorId, organizationId: null }),
    aiRepository.countMonthlyUsageForUser(actorId),      // new, read-only — mirrors reserveAiQuotaUsage's SELECT
    usageRepository.countThisPeriod(actorId, "FEATURED_LISTINGS") // new table, see §9
  ]);
  return {
    plan: { code: plan.code, name: plan.name, monthlyPrice: plan.amountMinor / 100 },
    status: active ? active.subscriptionStatus : "ACTIVE",
    currentPeriodStart: active ? active.startsAt : null,
    currentPeriodEnd: active ? active.endsAt : null,
    features: plan.features,
    limits: {
      activeListings: limitBlock(listingsUsed, plan.listingLimit),
      imagesPerProperty: { limit: plan.features.imagesPerProperty },
      videosPerProperty: { limit: plan.features.videosPerProperty },
      featuredListings: limitBlock(featuredUsed, plan.featuredListingsPerMonth),
      aiQueries: limitBlock(aiUsed, plan.aiMonthlyQuota)
    }
  };
};
const limitBlock = (used, limit) => limit === null
  ? { used, limit: null }
  : { used, limit, remaining: Math.max(0, limit - used) };
```

This one response is what should power every UI surface the brief lists (My Zameens, subscription page, upgrade banners, usage bars) — matches brief §6 exactly.

**Org dashboards are out of scope for this endpoint** — a channel-partner or org-admin UI that wants to show the *organization's* plan/usage (e.g. team seats used, org-wide active listings) needs a parallel `GET /organizations/:id/subscription`, built the same way but calling `findActiveSubscriptionForOwner({ organizationId })` and the `*ForOwner` counters from §4–§6 instead of the `*ForUser` ones. Not in this plan's Phase 1 scope, but the owner-resolution work in §3 makes it a small follow-up, not a redesign.

Note `aiRepository.countMonthlyUsageForUser` is a **new, read-only** query — do not reuse the advisory-lock reservation path for display purposes, that lock is only needed at write time to prevent races between concurrent quota checks.

---

## 8. Boolean feature gating

`advancedAnalytics`, `verifiedBadge`, `bulkUpload` live in the same `commerce.plans.features` jsonb as §5. Unlike §4–§6, these read as properties of *the acting user's own capability* (e.g. "can this user see advanced analytics"), not of a specific listing/property — so they resolve through the actor's personal-or-org plan the same way `mySubscription` does, not through resource ownership:

```js
export const assertFeature = async ({ userId, organizationId }, key) => {
  const active = organizationId
    ? await repository.findActiveSubscriptionForOwner({ organizationId })
    : await repository.findActiveSubscriptionForUser(userId);
  const features = active ? active.features : {};
  if (!features[key])
    throw new HttpError(403, "FEATURE_NOT_AVAILABLE", `${featureLabels[key]} is not available on your plan.`, { feature: key, upgradeRequired: true });
};
```

Call this from whichever endpoint needs gating — e.g. a bulk-upload endpoint (if/when it exists), an "advanced analytics" dashboard route, verified-badge display logic — passing `req.actor.id` and, if the action is being taken on behalf of an org (e.g. a bulk-upload done under an org context), that org's id. None of these endpoints currently exist in the codebase per the explore pass, so this is scaffolding for when they're built, not an immediate call-site change.

---

## 9. Featured listings — build the free monthly allowance (decided: Option A)

**This is a real conflict between the brief and the existing system, not just a naming gap.** Today, "featuring" a listing is a **paid add-on**: `commerce.products` has a `PROMOTION` type, purchased via the normal `POST /orders` → payment → webhook flow, which inserts a `marketplace.listing_promotions` row (see `capturePaymentAndApplyEntitlements`). There is no concept of "N free featured listings included in your plan."

The brief (§12) explicitly specifies a monthly allowance (`featuredListingsPerMonth`) consumed via a usage ledger, independent of any purchase, resolved via the same owner (user-or-org) as §4 — a listing owned by an org should draw from the org's monthly allowance, not the individual member's.

**Decided: build it (Option A)** — add the free monthly allowance on top of the existing paid path, since the brief calls for it explicitly and this plan's job is to close gaps against the brief, not narrow its scope. (Rejected alternative: skip the allowance and keep featuring purely a paid promotion — simpler, but silently drops a feature the brief asked for, so only worth revisiting if product says this specific one isn't needed for the Phase 1 launch.)

`POST /listings/:id/feature`: resolve the listing's owner (§3), check `commerce.plans.features.featuredListingsPerMonth` for that owner via a new usage table (below); if allowance is left, consume it and insert `marketplace.listing_promotions` directly (bypassing checkout); if not, respond `PLAN_LIMIT_REACHED` and let the frontend fall back to the existing paid-promotion checkout flow.

New migration adds a generic usage table (mirrors `ai.usage_events`, but generic enough to reuse for any future monthly-reset feature instead of hardcoding to featured listings). Note it needs an owner column pair, same as `plan_subscriptions` (`user_id` or `organization_id`, not both):
```sql
-- migrations/016_subscription_usage.sql
CREATE TABLE commerce.subscription_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES account.organizations(id) ON DELETE RESTRICT,
  feature varchar(50) NOT NULL, -- e.g. 'FEATURED_LISTINGS'
  used_count integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_subscription_usage_owner CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL),
  UNIQUE (user_id, feature, period_start),
  UNIQUE (organization_id, feature, period_start)
);
```
This is the one piece of the brief's original 3-table design that's actually net-new — everything else already has a home. **Also update `src/database/schema.sql` in the same PR** (per repo convention — migrations and the canonical schema file must stay in sync, see `docs/backend-development.md`), and add a `migrations.contract.test.js`-style test per repo convention if that file asserts against specific migrations.

Reservation logic should follow the exact same advisory-lock shape as `ai.repository.reserveAiQuotaUsage` — lock on `hashtext(organizationId || userId)`, count current-period rows for that owner, reject if `used >= limit`, else increment/insert.

---

## 10. Grant FREE plan on registration

Hook point: `src/modules/auth/auth.service.js`, in `verifyOtp`, right after `repository.addDefaultRoles(userId)` (new-user branch), before `createSession`. This is per-user only — organizations don't self-register a free tier; an org's first plan comes from a purchase (or stays on the ambient org free-tier defaults from §3 until then).

**Decided: materialize an explicit `commerce.plan_subscriptions` row** for a real `FREE` plan (`plan_type = 'FREE'`), rather than following the AI-quota system's "no row, just a constant" convention. The AI-quota convention is a shortcut that happens to work for one number (`aiMonthlyQuota`); it doesn't scale to this plan's actual requirement — the brief explicitly asks for admin-editable Free-tier limits ("Admin should therefore be able to change plan limits without deployment," brief §17), and a constant baked into `entitlements.service.js` can't be edited from `PATCH /admin/plans/:planId` the way a real row can. Since `commerce.plans` already supports `plan_type = 'FREE'` and admin CRUD already exists, this is one `INSERT` away.

This does mean `DEFAULT_FREE_LISTING_LIMIT`/`DEFAULT_FREE_TEAM_MEMBERS`/etc. constants (§4, §6) are **only** a fallback for the case where the FREE plan somehow isn't seeded yet (defensive, shouldn't happen once §10's seed step runs) — not the steady-state mechanism. Once seeded, every registered user has a real row and every lookup (`findActiveSubscriptionForUser`/`Owner`) returns real, admin-editable numbers.

```js
// auth.service.js, new-user branch
userId = (await repository.createUser({ ... }))?.id;
await repository.addDefaultRoles(userId);
await commerceService.grantFreePlan(userId); // new — no-op if a FREE product/plan isn't seeded
```

```js
// commerce.service.js
export const grantFreePlan = async userId => {
  const freePlan = await repository.findPlanByCode("PLAN_FREE"); // seed this product/plan first, see below
  if (!freePlan) return; // tolerate missing seed data rather than failing registration
  await repository.grantPlanDirectly({ userId, planId: freePlan.id, startsAt: new Date(), endsAt: null }); // new repository fn — no order_item_id, so plan_subscriptions.order_item_id NOT NULL constraint needs relaxing for free grants, or a placeholder $0 order/order_item must be created
};
```

**Note the schema obstacle**: `commerce.plan_subscriptions.order_item_id` is currently `NOT NULL UNIQUE` (every entitlement today comes from a real purchase). A free grant with no purchase either needs (a) that column made nullable (small migration), or (b) a synthetic $0 order + order_item created for the free grant so the existing insert path is reused unchanged. **(a)** is simpler and matches "no half-finished implementations" — recommend it, and fold it into the same `016_*.sql` migration as §9 if both are being built together.

**Seed data is net-new work, not a lookup**: `scripts/seed-demo-data.js` has no plan/product seeding at all today (confirmed — no `commerce.plans`/`commerce.products` rows anywhere in it). The brief's FREE/PRO/BUSINESS `features` JSON (§2 of the brief) needs to be inserted as `commerce.products`/`commerce.plans` rows from scratch, including the new `imagesPerProperty`/`videosPerProperty`/`teamMembers` keys under `features`. Recommend an idempotent seed step in the `016_*.sql` migration itself (`INSERT ... ON CONFLICT (code) DO NOTHING` on `commerce.products.code`), not `seed-demo-data.js`, since the FREE plan must exist in every environment (including production) for §10's registration hook to work — demo-only seed scripts don't run in production.

---

## 11. Cancellation — out of scope for Phase 1 (decided: skip)

The brief's `POST /subscription/cancel` (§16) assumes **recurring billing** ("Do not immediately downgrade. At period end: PRO → FREE"). This codebase deliberately has no recurring billing — `migrations/006_remove_recurring_billing.sql` explicitly removed that scaffolding, and every plan purchase today is a one-time Razorpay Payment Link for a fixed `duration_days`. There is no future charge to prevent, so there is nothing to "cancel" in the brief's sense — a plan just lapses at its `ends_at` on its own, and the user (or org) simply doesn't repurchase.

**Decided: don't build this endpoint for Phase 1.** Nothing auto-renews, so there's no charge to stop — building a `cancel` action here would be exactly the kind of speculative scaffolding the brief's own "Final Recommendation" warns against (no subscription-event table, no add-on table "yet"). If product later wants a cosmetic "don't show me renewal upsells" signal, that's a small follow-up: `cancel_at_period_end boolean DEFAULT false` on `commerce.plan_subscriptions`, a `POST /plans/cancel` that sets it, surfaced through `mySubscription`. It would change no billing behavior since there's no billing to change, and — if built — would need an authorization check against `account.organization_members.role IN ('OWNER','ADMIN')` for org-owned subscriptions, not just "the user who placed the order." Not needed until asked for.

---

## 12. Summary of concrete changes

New migration `migrations/016_subscription_entitlements.sql`:
- `commerce.subscription_usage` table (§9), with both `user_id` and `organization_id` owner columns
- `commerce.plan_subscriptions.order_item_id` → nullable (§10)
- idempotent seed `INSERT`s for the FREE/PRO/BUSINESS `commerce.products`/`commerce.plans` rows (§10)
- mirror every change into `src/database/schema.sql` in the same PR
- (not included: `cancel_at_period_end` — §11 is out of scope for Phase 1)

New/changed files:
| File | Change |
|---|---|
| `src/modules/commerce/entitlements.service.js` | **new** — `assertListingLimit`, `assertMediaLimit`, `assertTeamMemberLimit`, `assertFeature`, `grantFreePlan` — all owner-resolution-aware per §3 |
| `src/modules/commerce/commerce.service.js` | add `mySubscription`, `toPlan` features passthrough already exists |
| `src/modules/commerce/commerce.controller.js` | add `mySubscription` |
| `src/modules/commerce/commerce.routes.js` | add `GET /me/subscription` |
| `src/modules/commerce/commerce.repository.js` | add `findActiveSubscriptionForOwner` (§3), `grantPlanDirectly` (§10) |
| `src/modules/listings/listings.service.js` | call `assertListingLimit` in `submit()` (and optionally `approve()`), passing the listing's own owner fields |
| `src/modules/listings/listings.repository.js` | add `countLiveForOwner` |
| `src/modules/properties/properties.service.js` | call `assertMediaLimit` in `completeMedia()`, passing the property's own owner fields |
| `src/modules/properties/properties.repository.js` | add `countMediaByType` |
| `src/modules/organizations/organizations.service.js` | call `assertTeamMemberLimit` in `addMember()` (§6) |
| `src/modules/organizations/organizations.repository.js` | add `countActiveOrInvitedMembers` |
| `src/modules/ai/ai.repository.js` | add read-only `countMonthlyUsageForUser` (for §7's display-only usage, not enforcement); **remove** `activeOrganizationPlanForChannelPartner` and `activePlanForUser` (§3a) |
| `src/modules/ai/ai.service.js` | replace org/personal plan branching in `reserveAiQuota` with `resolveOrganizationContext` + `commerce.repository.findActiveSubscriptionForOwner`/`ForUser` (§3a) |
| `src/modules/ai/ai.validation.js`, `ai.controller.js` | accept optional `organizationId` on message/search/listing-generate requests (§3a) |
| `src/modules/auth/auth.service.js` | call `grantFreePlan` after `addDefaultRoles` (only if §10's explicit-row option is chosen) |
| `test/unit/entitlements.*.test.js` | new, mirroring `ai.quota.test.js`'s stub-`pg` convention — cover both the personal-user and org-owner branches of every check |

## 13. Decisions — resolved

Every open question from the previous draft has been settled below, each with the reasoning, so implementation can start without stalling on a product sign-off round-trip. All are cheap to override later — none of them is a schema shape that would be painful to walk back — so flag any disagreement as a one-line change against a specific §, not a reason to reopen the whole plan.

| # | Decision | Resolution | Reasoning | § |
|---|---|---|---|---|
| 1 | Error body shape | **Nested** — `error.details.{feature,used,limit,upgradeRequired}` | Matches every existing error in this codebase (`AI_MONTHLY_QUOTA_EXCEEDED`); consistency with the rest of the API beats matching the brief's literal JSON layout | §4 |
| 2 | Org free-tier defaults | **Same constants as individuals** | One set of numbers, not two; nothing in the brief asks for a lower org default | §3 |
| 3 | AI quota's channel-partner-only pooling | **Unified** onto explicit `organizationId` + active-membership + `findActiveSubscriptionForOwner` | Two mechanisms answering the same question was the actual bug; only remaining work is sequencing the frontend change | §3a |
| 4 | `INVITED` members count toward `teamMembers`? | **Yes, `ACTIVE` + `INVITED` both count** | Otherwise an org can out-invite its seat count and win the race on acceptance | §6 |
| 5 | Featured listings | **Build the free monthly allowance (Option A)** | The brief explicitly specifies `featuredListingsPerMonth`; this plan's job is closing gaps against the brief | §9 |
| 6 | Free tier: ambient constant vs. real row | **Real `commerce.plan_subscriptions` row** | Only way to satisfy the brief's explicit ask that admins edit Free-tier limits without a deploy (brief §17) | §10 |
| 7 | Cancellation endpoint | **Skip for Phase 1** | Nothing auto-renews (recurring billing was deliberately removed, migration 006), so there's no charge to stop cancelling | §11 |
| 8 | `DRONE_VIDEO`/`SITE_PLAN` mapping | **`VIDEO` + `DRONE_VIDEO`** → `videosPerProperty`; `SITE_PLAN` uncounted | Drone footage is marketing media like video; a site plan is a document, not marketing media | §5 |

**Build order**: §3 (owner resolution) first — it's a prerequisite for §4, §5, §6, §8, and §9. §3a (AI quota unification) can land independently, any time, since it only touches `ai.*` and needs no other section. §7 (`GET /me/subscription`) should land before §4–§6, §8–§9 reach users, since it's what makes those limits visible on the frontend at all — a limit nothing can see coming is just a surprise 403. §10 (Free plan row + seed data) is a soft prerequisite for everything else in practice, since §4/§6's `DEFAULT_FREE_*` constants are meant as a defensive fallback, not the steady state — seed the FREE plan early so real numbers are what's actually exercised in testing.
