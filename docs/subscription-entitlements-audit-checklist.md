# Subscription Entitlements — Registration, Enforcement & Plan-Change Audit

**Status (2026-09-22):** Audit of branch `FWD-Payment-gateway`. Originally written as a read-only analysis; **§D1 and the listing-approval gap it's paired with were since fixed** (see [`subscription-entitlements-changes-summary.md`](./subscription-entitlements-changes-summary.md) §6, Critical 1 and Critical 2) — this version reflects that. Every other row below is unchanged from the original analysis and still reflects the current code, re-verified.

> **Note:** this file was found missing from disk partway through a follow-up turn — recreated here with the resolutions applied. If you have an earlier copy, this version supersedes it.

Legend: ✅ Implemented and verified · ⚠️ Partial / works but has a real caveat · ❌ Gap (missing entirely) · 🔧 **Resolved this session** (was a gap, now fixed) · N/A Doesn't apply (path doesn't exist, confirmed)

---

## A. Does every way an account can come into existence get a plan?

| # | Use case | Status | Evidence |
|---|---|---|---|
| A1 | Individual self-registers via OTP (any eventual role) | ✅ | `auth.service.js#verifyOtp` new-user branch calls `grantFreePlan({ userId })`. |
| A2 | Organization self-registers (`POST /organizations`) | ✅ | `organizations.service.js#create` calls `grantFreePlan({ organizationId })`. |
| A3 | Admin creates a user account directly | N/A | No such endpoint exists. `users/admin.routes.js` has exactly 4 routes, none of them `POST`. |
| A4 | Admin creates an organization on someone's behalf | N/A | `organizations.admin.routes.js` only has `PATCH /organizations/:organizationId/status`. |
| A5 | Bulk-upload (CSV listing import) creates new user/org accounts | N/A | `listings.bulk-upload.service.js` only creates listings for the already-authenticated actor. |
| A6 | Organization member invite creates a new user account | N/A | `addMember` requires an existing `userId`. |
| A7 | Demo/dev seed script (`scripts/seed-demo-data.js`) creates a user | ❌ Gap (dev-only) | Inserts directly into `auth.users`, bypassing `grantFreePlan`. Gated behind `DEMO_DATA=true`, doesn't run in production. Not fixed this session — low real-world impact. |
| A8 | Channel partner gets approved | ✅ | `channel-partners.service.js#transition` (approve) grants real `organization_members` access via `ensureOrganizationMembership` whenever the partner has an `organizationId`. |

---

## B. Is every plan feature actually tracked and restricted?

| # | Feature | Status | Evidence |
|---|---|---|---|
| B1 | `listingLimit` (active listings) | ✅ | Enforced at both submit (`submitWithinLimit`) **and** approval (`approveWithinLimit`) — see Critical 2. |
| B2 | `features.imagesPerProperty` | ✅ | `properties.repository.js#createMediaBatch`, locked. |
| B3 | `features.videosPerProperty` | ✅ | Same as B2. |
| B4 | `features.teamMembers` | ✅ | `organizations.repository.js#addMember`, locked. |
| B5 | `aiMonthlyQuota` | ✅ | `ai.service.js#reserveAiQuota`, reserve/confirm/release, locked. Org-pooling scope corrected — see Critical 3. |
| B6 | `features.featuredListingsPerMonth` | ✅ | `commerce.repository.js#grantFeaturedListingFromAllowance`, atomic, now also reports `alreadyFeatured` accurately regardless of plan tier. |
| B7 | `features.advancedAnalytics`/`verifiedBadge`/`bulkUpload` | ⚠️ Scaffolding only | `assertFeature` exists, unit-tested, zero call sites — the gated features have no endpoints yet. |
| B8 | `verificationIncluded` (plan column) | ❌ Gap | Still never read anywhere outside catalog CRUD/display. Not fixed this session — no verification endpoint was touched. |
| B9 | `durationDays` | ✅ | Pre-existing, re-verified. |

---

## C. Can a user opt into, upgrade, or change their plan at any time?

| # | Use case | Status | Evidence |
|---|---|---|---|
| C1–C4 | Buy first plan / upgrade / renew / org buys on its own behalf | ✅ | Unchanged — `POST /orders` → `capturePaymentAndApplyEntitlements` covers all four; renewal extends `ends_at` from remaining time, not from `now`. |
| C5 | A dedicated "change/switch plan" endpoint | N/A | Still absent — the only mechanism is buying a plan product. Unchanged. |
| C6 | Self-service downgrade/cancel to FREE | N/A (by design) | Still out of scope per plan §11. |
| C7 | Admin manually assigns/overrides a specific account's plan | ❌ Gap | Still absent — admin plan routes remain catalog-only. Not fixed this session (not one of the three critical items). |
| C8 | What happens when a paid plan's `ends_at` passes and nothing is repurchased | 🔧 **Resolved** | See §D1. |

---

## D. Usage reset/change semantics when a plan changes

### D1. 🔧 Resolved — a lapsed paid plan now correctly falls back to the real, admin-editable Free plan

**Original finding:** buying any plan expires the owner's previously-active row (including their original FREE grant). When that new paid plan later lapsed with nothing repurchased, every entitlement check fell back to hardcoded `DEFAULT_FREE_*` JS constants instead of the actual, admin-editable `PLAN_FREE` catalog row — silently defeating the entire reason §10 chose a real database row over a constant.

**Fix:** `commerce.repository.js#resolveEffectivePlanForOwner`/`ForUser` — wrappers around the raw active-subscription lookup that fall back to the *live* `PLAN_FREE` catalog row (a fresh query, not a constant) whenever no real active row exists, for both individual and organization owners, applied to every entitlement check and `GET /me/subscription`. No background sweep — resolved lazily at read time. Verified end to end against a live database: a user with an `EXPIRED` original FREE row and a lapsed `PRO` row correctly sees an admin's edited `PLAN_FREE.listingLimit`, not the old hardcoded default.

The raw (non-fallback) lookup is kept for exactly two callers that need to know "does a real row exist," not "what effectively applies": `grantFreePlan`'s own idempotency guard, and the pre-existing `GET /plans/me` endpoint (a billing-status indicator, distinct from the newer `GET /me/subscription`).

### D2. Live-count limits (listings, media, team members) — always current, but never retroactively enforced

Unchanged from the original finding. These reflect current DB state against whichever plan is active *right now* — no reset needed. Enforcement runs only when something new is added; a downgrade that puts an owner over a new, lower limit doesn't retroactively remove existing resources. Confirmed still true after Critical 2's approval-side fix — that fix closes the *submit-then-approve* race, it doesn't change the grandfathering behavior for existing published listings.

### D3. Period-counters (AI quota, featured-listing allowance) — calendar-month scoped, not reset by a plan change mid-month

Unchanged. Both `ai.usage_events` and `commerce.subscription_usage` are scoped by wall-clock calendar month via `date_trunc`, independent of which plan was active when each unit of usage happened — a mid-month upgrade doesn't reset usage already counted against the new, larger quota. No explicit reset job exists or is needed; a new calendar month naturally excludes prior rows from the `WHERE` clause.

---

## Summary

| Area | Verdict |
|---|---|
| Registration → plan allocation | Solid. Only the dev-only demo seed script bypasses it. |
| Per-feature tracking/enforcement | Solid for every numeric limit, now including approval-side listing enforcement. Boolean feature gating is unused scaffolding; `verificationIncluded` remains unenforced. |
| Plan flexibility | Works via "buy a product" only — no admin override (still a gap), no self-service downgrade (by design). |
| Usage reset on plan change | **The lapsed-paid-plan gap (D1) is now fixed.** Live-count limits and period-counters behave as originally analyzed — both confirmed intentional/acceptable. |

**Still open, not addressed this session:** A7 (demo seed bypass, dev-only), B8 (`verificationIncluded` never enforced), C7 (no admin plan-assignment override).
