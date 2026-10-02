# Subscription & Plan Entitlements — Changes Summary

**Status (2026-09-22):** Implemented on branch `FWD-Payment-gateway`, not yet committed. Implements [`subscription-entitlements-implementation-plan.md`](./subscription-entitlements-implementation-plan.md) in full, plus hardening found through a multi-round edge-case review, a redesign of AI-quota org-pooling, and three critical fixes from a follow-up product review (see §6). Read the plan doc first for the *design rationale*; this doc covers *what actually shipped* and *why it differs from the plan where it does*.

> **Note:** this file and its sibling [`subscription-entitlements-audit-checklist.md`](./subscription-entitlements-audit-checklist.md) were written earlier in this work and were found missing from disk partway through — recreated here reflecting the current, final state. If you have an earlier copy of either file, this version supersedes it.

All work verified: 216 unit tests passing (`npm test`), the full app module graph loads with no circular-import issues, and every new/changed SQL query — including the ones added in §6 — was run against a real local Postgres 14 instance before being considered done.

---

## 1. Core implementation (the plan, §3–§13)

| Plan section | What shipped | Where |
|---|---|---|
| §3 Owner resolution | `findActiveSubscriptionForOwner`/`ForUser` — the raw "does a real plan row exist" lookup; see §6 for `resolveEffectivePlanForOwner`/`ForUser`, the version everything below actually calls | `commerce.repository.js` |
| §3a AI quota unification | Removed the old channel-partner-only auto-detection; resolves through the same owner model as everything else — see §5/§6 for how the org-resolution rule was further refined | `ai.service.js`, `ai.repository.js` |
| §4 Active-listing limit | `resolveListingLimit` + enforcement inside `listings.repository.js#submitWithinLimit` **and** `#approveWithinLimit` (§6 — approval-side enforcement was added after the initial pass) | `entitlements.service.js`, `listings.repository.js`, `listings.service.js#submit`/`#approve` |
| §5 Per-property media limits | `resolveMediaLimits` + enforcement inside `properties.repository.js#createMediaBatch`, a locked transaction | `entitlements.service.js`, `properties.repository.js`, `properties.service.js#completeMedia` |
| §6 Team-member limit | `resolveTeamMemberLimit` + enforcement inside `organizations.repository.js#addMember`'s advisory-locked transaction | `entitlements.service.js`, `organizations.repository.js`, `organizations.service.js#addMember` |
| §7 Entitlement API | `GET /me/subscription` — plan, features, and used/limit for listings, media, featured listings, AI queries, in one response | `commerce.service.js#mySubscription`, `commerce.controller.js`, `commerce.routes.js` |
| §8 Boolean feature gating | `assertFeature(owner, key)` for `advancedAnalytics`/`verifiedBadge`/`bulkUpload` — scaffolding, no call sites yet since none of those endpoints exist | `entitlements.service.js` |
| §9 Featured listings | `POST /listings/:id/feature` — draws from the plan's monthly `featuredListingsPerMonth` allowance and grants the promotion directly, bypassing checkout; falls back to the existing paid-promotion flow when exhausted | `listings.service.js#feature`, `commerce.repository.js`, new `commerce.subscription_usage` table |
| §10 FREE plan on registration | `grantFreePlan({ userId })`/`grantFreePlan({ organizationId })` — a real, admin-editable `commerce.plan_subscriptions` row for both individuals and organizations | `entitlements.service.js`, `auth.service.js#verifyOtp`, `organizations.service.js#create` |
| §11 Cancellation | Confirmed out of scope (no recurring billing exists to cancel) — no code | — |

**New migration:** `migrations/016_subscription_entitlements.sql` — `commerce.subscription_usage` table, `commerce.plan_subscriptions.order_item_id` made nullable, idempotent seed data for `PLAN_FREE`/`PLAN_PRO`/`PLAN_BUSINESS`. Mirrored into `src/database/schema.sql`.

---

## 2. Multi-round edge-case audit — bugs found and fixed

The code was run through the `code-review` skill repeatedly (re-reviewing after each fix round), with every finding independently verified against the code before acting. Confirmed, fixed issues across the review rounds:

- Admin bypassed media limits entirely (a different property loader shape resolved owner fields as `undefined`) — fixed by resolving the owner via a dedicated `ownerFields()` query.
- Featured-listing allowance could be consumed with nothing granted (two independently-committed writes) — made atomic.
- Team-member, active-listing, and per-property-media limits all had the same TOCTOU race (two concurrent writes could both read "under the limit" before either committed) — closed with advisory-locked transactions on all three.
- Re-inviting a `REMOVED` org member bypassed the seat limit — fixed.
- `resolveMediaLimits` could throw a raw 500 if a plan's `features` column was itself `NULL` — fixed with safe optional chaining.
- `active.featuredDays || 30` treated an admin-configured `0` as "not set" — fixed with `??`.
- `completeMedia` threw an unhandled 500 (instead of 404) if the property was deleted mid-request — fixed.
- `grantFreePlan` could create two `ACTIVE` FREE plans for one user under a narrow registration race — fixed with an idempotency check.
- Double-tapping "Feature this listing" consumed two allowance units for one listing — fixed with an already-featured check inside the same locked transaction (`409 LISTING_ALREADY_FEATURED`).

Full detail on each, with file/line evidence, was in the original audit checklist (§4 below recreates its findings).

---

## 3. Organization FREE plan symmetry

`grantFreePlan` was generalized to `grantFreePlan({ userId, organizationId })` so organizations get the same real, admin-editable FREE plan row on creation that individuals get on registration — previously organizations permanently ran on hardcoded `DEFAULT_FREE_*` JS constants.

---

## 4. AI-quota org-pooling — two iterations

**First iteration (superseded — see §6, Critical 3):** to remove a frontend rollout dependency, `ai.service.js#reserveAiQuota` auto-detected which org (if any) should pool a user's AI quota, picking whichever org the user was an active member of with the most generous plan, when no `organizationId` was sent. A companion migration (`017_channel_partner_membership_backfill.sql`) and an ongoing hook in `channel-partners.service.js#transition` (approve action) ensured approved channel partners — previously linked to their org only via `channel_partner_profiles`, never `organization_members` — were real, active org members so this auto-detection (and everything else gated on membership) worked for them too.

**This auto-detection mechanism was removed in §6 (Critical 3)** after review found it could pool a personal AI question, or a question from a user in multiple orgs, against an org's paid quota that had nothing to do with the request — purely because that org happened to have the biggest plan. See §6 for the corrected design.

**What was kept:** the `organization_members` backfill and the ongoing channel-partner-approval membership grant. These remain valuable independent of AI quota — they're what makes property/listing management access, org-scoped purchases, and any *explicit* `organizationId` on a request resolve correctly for a channel partner, same as any other org member. `channel_partner_profiles` remains fully retired from entitlement/quota resolution, matching the plan's original intent.

---

## 5. Files changed (through §4)

**New:** `src/modules/commerce/entitlements.service.js`, `migrations/016_subscription_entitlements.sql`, `migrations/017_channel_partner_membership_backfill.sql`, and a full suite of new unit test files for entitlements, commerce, listings, organizations, properties, and channel-partners.

**Modified:** `ai.service.js`, `ai.repository.js`, `ai.validation.js`, `auth.service.js`, `channel-partners.service.js`, `channel-partners.repository.js`, `commerce.controller.js`, `commerce.repository.js`, `commerce.routes.js`, `commerce.service.js`, `listings.controller.js`, `listings.repository.js`, `listings.routes.js`, `listings.service.js`, `organizations.repository.js`, `organizations.service.js`, `properties.controller.js`, `properties.repository.js`, `properties.service.js`, `src/database/schema.sql`, `src/middlewares/error.js` (a genuine bug — the error middleware dropped `details` for plain-object payloads like `PLAN_LIMIT_REACHED`'s).

**New API surface:** `GET /me/subscription`, `POST /listings/:listingId/feature`.

---

## 6. Critical fixes from product review

A follow-up review against the audit checklist (§7 below) and this doc surfaced three critical issues, all confirmed and fixed:

### Critical 1 — Expired paid plans didn't return to the real Free plan

Exactly the audit's §D1 finding (see §7). **Fix:** `commerce.repository.js` gained `resolveEffectivePlanForOwner`/`resolveEffectivePlanForUser` — wrappers around the raw `findActiveSubscriptionForOwner`/`ForUser` that fall back to the **live** `PLAN_FREE` catalog row (fetched fresh, not a JS constant) whenever no real active row exists. Every entitlement-checking consumer (`resolveListingLimit`, `resolveMediaLimits`, `resolveTeamMemberLimit`, `assertFeature`, `grantFeaturedListing`, `mySubscription`, `reserveAiQuota`) now calls the *effective* resolver; only `grantFreePlan`'s own idempotency guard and the pre-existing `myPlanSubscription` (`GET /plans/me`, a billing-status indicator) still call the raw one, deliberately — both need to know whether a *real* row exists, not what effectively applies. No background sweep needed, exactly as requested — the fallback is resolved lazily at read time, same as the existing `ends_at` filtering already was.

Applied identically to individual and organization owners, and to both the entitlement checks and the `GET /me/subscription` API, per the request. Verified end to end against a live database: seeded a user with an `EXPIRED` original FREE row and a lapsed `PRO` row, edited the FREE plan's `listingLimit` via the admin-CRUD path, and confirmed the resolver returns the *edited* value, not the old hardcoded default.

### Critical 2 — Listing limits were enforced at submission, not approval

The plan doc had explicitly deferred this ("probably sufficient for Phase 1... add only if that race is a real concern" — §4 of the plan), and the earlier passes of this work followed that. Product review overrode that deferral as mandatory. **Fix:** `listings.repository.js` gained `approveWithinLimit`, mirroring `submitWithinLimit` exactly — same per-owner advisory lock key (`ACTIVE_LISTINGS:{owner}`), so a submission and an approval for the same owner now serialize against each other too, not just two submissions or two approvals. `listings.service.js#approve` resolves the listing's own owner via a dedicated `ownerFields()` query (not the `summary()` join, which silently reads as personally-owned if the owning org happens to be soft-deleted) and the plan's current limit, then calls the locked transaction. A listing already at its owner's active-listing limit is rejected with `403 PLAN_LIMIT_REACHED` at approval time, even if it was validly submitted while under the limit. Verified against a live database in both directions (blocks at the limit, succeeds under it).

### Critical 3 — AI requests could silently consume another organization's quota

The auto-detection design from §4 above picked whichever org gave the user the biggest available quota, with no connection to what the request was actually about — problematic for a personal AI question, or for a user in multiple orgs. **Fix:** removed `autoDetectPooledOrganizationForUser` entirely. Org-pooling for AI now only happens two ways, matching how every other entitlement check in this codebase resolves ownership:

1. **Explicitly selected** — the caller sends `organizationId`, validated against active membership (unchanged from before).
2. **The organization that owns the resource** — `generateListing` (the one AI endpoint with a genuine "resource the caller owns" — a property, already ownership-checked by the existing query) now infers the org from that property's own `owner_organization_id` when the caller didn't already name a different org explicitly. `ai.repository.js#ownedPropertyContext` was extended to select this column.

`/ai/search` and chat messages have no such owned resource, so with no explicit `organizationId` they now always draw from the caller's own personal plan — never an org, however generous, that the caller merely happens to also belong to. This reintroduces the original rollout consideration (org-pooling for search/chat needs the frontend to actually send `organizationId` to work at all) — a deliberate tradeoff, correctness over convenience, per the explicit instruction. Verified against a live database (the new `owner_organization_id` column resolves correctly for an org-owned property) and via unit tests proving membership is never even queried when no `organizationId` is sent.

### Also fixed during this round (found by the same review pass)

- `listings.service.js#approve` dereferenced the `ownerFields()` result without a null check — a listing withdrawn between the initial read and that lookup would 500 instead of returning `LISTING_NOT_FOUND`. Fixed with an explicit check, mirroring the identical fix already applied to `properties.service.js#completeMedia`.
- `grantFeaturedListing` returned a misleading `PLAN_LIMIT_REACHED` ("no allowance left") for a listing that was actually already featured, whenever the owner's plan had no plan-included allowance at all (e.g. FREE tier). Fixed with a standalone `isListingFeatured` check on that path, so the response is accurate (`409 LISTING_ALREADY_FEATURED`) regardless of plan tier.

---

## 7. What's intentionally not done

- **Cancellation endpoint** — confirmed out of scope by the plan (§11); no recurring billing exists to cancel.
- **Boolean feature gating call sites** — `assertFeature` exists and is tested, but nothing calls it yet since the gated features don't have endpoints in this codebase yet.
- **Org dashboard entitlement view** (`GET /organizations/:id/subscription`) — explicitly out of scope per the plan.
- **Suspend-cascades-to-membership-removal** for channel partners — deliberate: `organization_members` has its own independent lifecycle an org admin controls directly, and the channel-partners module can't tell whether a membership row is "theirs" or predates it.
- **A background sweep for lapsed plans** — deliberately not built; Critical 1's fix resolves the live `PLAN_FREE` row lazily at read time instead, which the reviewer explicitly confirmed was sufficient.
