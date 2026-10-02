# Subscription Plans & Usage — Complete Reference

**Status (2026-09-25):** Reference document, branch `FWD-Payment-gateway`. Explains the plan/entitlement/usage system end to end: how a user or organization gets plan access, how each kind of limit is counted, and how usage resets. For the original design rationale and terminology mapping against the brief this was built from, see [`subscription-entitlements-implementation-plan.md`](./subscription-entitlements-implementation-plan.md). For the gap analysis and what's still open, see [`subscription-entitlements-audit-checklist.md`](./subscription-entitlements-audit-checklist.md).

---

## 1. The mental model

Three things, three tables, cleanly separated:

| Concept | Table | Question it answers |
|---|---|---|
| **Catalog** — what plans exist and what they include | `commerce.products` (price, code, name) + `commerce.plans` (limits, features) | "What does PLAN_PRO cost, and what does it include?" |
| **Entitlement** — who currently holds which plan | `commerce.plan_subscriptions` | "Does this user/org have an active paid plan right now, and until when?" |
| **Usage** — how much of a metered allowance has been consumed | `commerce.subscription_usage` (generic) + `ai.usage_events` (AI-specific) | "How many of this month's featured-listing slots has this owner already used?" |

A plan's numeric limits are **never** hardcoded in application code. Every enforcement check and every display (`GET /me/subscription`) re-reads whichever plan row is currently active for that owner. An admin can `PATCH /admin/plans/:planId` and the new numbers apply on the very next request — no deploy, no cache, no restart. The only hardcoded numbers that exist (`DEFAULT_FREE_LISTING_LIMIT`, `DEFAULT_FREE_AI_MONTHLY_QUOTA`, `DEFAULT_FREE_TEAM_MEMBERS`, `DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME` — all in `entitlements.service.js`/`ai.service.js`) are last-resort fallbacks for the one scenario where there's no database row to read at all (the `PLAN_FREE` catalog row itself has never been seeded).

---

## 2. The plan catalog today

Seeded by `migrations/016_subscription_entitlements.sql` (limits) and `migrations/019_contact_unlock_entitlements.sql` (contact unlocks); `migrations/020_consolidate_contact_unlock_feature.sql` upgrades every database, including a clean one, to the single `contactUnlocks` field. These are just data — any of them can be changed by an admin at any time via `PATCH /admin/plans/:planId`, which is the entire point of storing them in the database instead of as constants.

| Field | FREE (`PLAN_FREE`) | PRO (`PLAN_PRO`) | BUSINESS (`PLAN_BUSINESS`) |
|---|---|---|---|
| Price | ₹0 | ₹999/mo | ₹2,999/mo |
| `durationDays` | `NULL` (never expires) | 30 | 30 |
| `listingLimit` | 2 | 20 | `NULL` (unlimited) |
| `featuredDays` | `NULL` | 15 | 30 |
| `verificationIncluded` | false | true | true |
| `aiMonthlyQuota` | 5 | 100 | `NULL` (unlimited) |
| `features.imagesPerProperty` | 5 | 20 | 50 |
| `features.videosPerProperty` | 0 | 2 | 5 |
| `features.teamMembers` | 1 | 3 | 10 |
| `features.featuredListingsPerMonth` | 0 | 2 | 10 |
| `features.contactUnlocks` | 5 (lifetime, never resets) | 50 per renewal month | 250 per renewal month |
| `features.advancedAnalytics` / `verifiedBadge` / `bulkUpload` | false / false / false | true / true / false | true / true / true |

`features` is a free-form `jsonb` column (`commerce.plans.features`) — any key can be added without a schema migration; `optionalObject` in `commerce.validation.js` accepts whatever shape the admin sends.

---

## 3. How a user or organization gets plan access

### 3a. Individual self-registration
`auth.service.js:229`, inside `verifyOtp`'s new-user branch, right after the account and default roles are created:
```js
await entitlements.grantFreePlan({ userId });
```
This inserts a real, `ACTIVE`, never-expiring (`endsAt: null`) `commerce.plan_subscriptions` row pointing at whatever plan currently has `code = 'PLAN_FREE'`. It is a no-op if the user somehow already has an active plan (guards a narrow concurrent-registration race), and tolerates `PLAN_FREE` not being seeded at all (falls through silently — registration must never fail because of this).

### 3b. Organization creation
`organizations.service.js:63`, inside `create`, right after the organization and its owner membership are created — same call, `grantFreePlan({ organizationId })`. Symmetric with 3a: every org gets its own real FREE row on day one, distinct from any individual member's personal plan.

These are the **only two call sites** of `grantFreePlan` in the codebase.

### 3c. Buying, upgrading, or renewing a plan
All three are the exact same code path — there is no separate "renew" or "upgrade" endpoint, only "buy a plan product":

1. `POST /orders` with `items: [{ productId: <a PLAN product>, quantity: 1 }]`, optionally `organizationId` (membership-validated) to buy on an org's behalf.
2. `POST /payments/:orderId/create` — creates a Razorpay Payment Link.
3. Razorpay calls back (`GET /payments/callback`) or delivers a webhook (`POST /payments/webhook`) — both paths converge on `commerce.repository.js#capturePaymentAndApplyEntitlements`.

Inside that one transaction, for a PLAN order item:
- It looks for the owner's current `ACTIVE` `plan_subscriptions` row (personal or org-scoped, matching this purchase's owner exactly).
- If one exists, it's marked `EXPIRED`.
- A **brand-new row is always inserted** — `starts_at = now` (the purchase instant), `ends_at` computed by `computePlanEndsAt`:
  ```js
  ends_at = max(existingEndsAt, now) + durationDays
  ```
  i.e. a renewal *before* the old plan lapses extends from the **remaining time**, not from `now` — you don't lose days by renewing early. But note `starts_at` is still stamped at the purchase instant every time, even though `ends_at` may extend further — this is what makes usage reset on renewal work (§5).

This is true whether the purchase is a first-ever purchase, a renewal of the same plan, or an upgrade to a different plan — `capturePaymentAndApplyEntitlements` doesn't distinguish between the three.

### 3d. What "currently active" actually means
Enforcement never queries `plan_subscriptions` directly. Everything goes through `commerce.repository.js#resolveEffectivePlanForUser`/`ForOwner`, which layers three levels of fallback:

1. **A real, active, unexpired row** for this owner (`status = 'ACTIVE' AND (ends_at IS NULL OR ends_at > now())`) — checked lazily at read time; nothing flips `EXPIRED` in the background.
2. If none exists (never purchased, or a paid plan lapsed with nothing repurchased) → the **live** `PLAN_FREE` catalog row — a fresh query, not a constant, so an admin's edits to `PLAN_FREE` apply immediately even to owners with no subscription row at all.
3. If even `PLAN_FREE` itself isn't seeded (deploy-time gap) → the ambient `DEFAULT_FREE_*` JS constants, as the absolute last resort.

### 3e. Personal vs. organization ownership
Not every feature resolves ownership the same way:

| Feature | Resolved via | Notes |
|---|---|---|
| Listing limit, media limits, team members, featured listings | **Resource owner** (`{ userId, organizationId }` from the listing/property/org itself) | An org-owned listing draws from the org's plan regardless of which member is acting. |
| AI quota | **Explicit `organizationId` on the request**, validated against active membership | Never auto-detected from "which orgs am I in" — asking without one always draws from the caller's own personal plan, even if they belong to a generously-provisioned org. |
| Contact unlocks | **The acting buyer's own personal plan**, always | No org concept at all — every plan in this catalog is described in seller terms; unlocking a contact is a buyer action. |
| Boolean features (`advancedAnalytics`/`verifiedBadge`/`bulkUpload`) | Actor's own personal-or-org plan (`organizationId` if the actor names one) | Scaffolding only today — see §4c. |

---

## 4. How usage is counted and restricted

Two fundamentally different enforcement models, depending on whether the thing being limited is a **standing count** or a **metered event**.

### 4a. Live-count limits — always current, never retroactive

These don't use a usage ledger at all. At the moment of the action, the code counts current rows in the resource's own table and compares against the limit, inside a Postgres advisory-locked transaction (so two concurrent requests can't both pass a check that only one of them should).

| Limit | Enforced in | Lock key (scope) | What's counted | Where it's called from |
|---|---|---|---|---|
| `listingLimit` | `listings.repository.js#submitWithinLimit` (submit) **and** `#approveWithinLimit` (approve) | `ACTIVE_LISTINGS:{organizationId\|\|userId}` — same key for both, so submit and approve for one owner serialize against each other | `PUBLISHED` listings for that owner | `listings.service.js#submit` (→ `POST /listings/:listingId/submit`) and `#approve` (→ `POST /admin/listings/:listingId/approve`) |
| `features.imagesPerProperty` / `videosPerProperty` | `properties.repository.js#createMediaBatch` | `PROPERTY_MEDIA:{propertyId}` — **per property**, not per owner | `land.property_media` rows for that property, by category: `IMAGE`→images, `VIDEO`+`DRONE_VIDEO`→videos (share one count), `SITE_PLAN` is never counted. Batch-aware: `existing + addedInThisBatch > limit` rejects the *whole* batch, not just the overflow items. | `properties.service.js#completeMedia` (→ `POST /properties/:propertyId/media/complete`) |
| `features.teamMembers` | `organizations.repository.js#addMember` | `{organizationId}:organization-membership` (shared with the last-owner-count invariant) | `account.organization_members` rows with status `ACTIVE` or `INVITED`. A re-invited `REMOVED` member **consumes a new seat** (treated as not existing); a role change on an existing `ACTIVE`/`INVITED` member **never** consumes a seat (skips the count entirely). | `organizations.service.js#addMember` (→ `POST /organizations/:organizationId/members`) |

All three throw `HttpError(403, "PLAN_LIMIT_REACHED", ..., { feature, used, limit, upgradeRequired: true })` — one unified error code across every limit type, distinguished by the `feature` field in `details`.

**Grandfathering:** a plan downgrade is never retroactively enforced. If an org on BUSINESS (unlimited listings) downgrades to FREE (2 listings) while it has 15 published, those 15 stay published — the limit only blocks the *next* new submission/approval. This is deliberate (§D2 of the audit doc), not a gap.

### 4b. Periodic (metered) limits — a usage ledger, reset on renewal

These count *events over a window of time*, backed by a real ledger table, and — as of this session — that window is anchored to **the owner's current plan's `starts_at`**, not the calendar month. See §5 for the mechanism.

| Limit | Ledger | Consume pattern | Where |
|---|---|---|---|
| `aiMonthlyQuota` | `ai.usage_events` (one row per query attempt) | **Reserve → confirm/release**: a slot is reserved before the (possibly slow, possibly failing) LLM call starts; confirmed permanent on success, deleted on failure/abort — a rejected or failed question never costs quota. | `ai.service.js#reserveAiQuota`, called from `search`, `messageContext` (chat), `generateListing` |
| `features.featuredListingsPerMonth` | `commerce.subscription_usage` (`feature = 'FEATURED_LISTINGS'`) | **Consume-and-grant atomically**: the usage increment and the `marketplace.listing_promotions` insert happen in the same transaction, so a failure can never leave the allowance spent with nothing featured. An already-featured listing is a free no-op (`alreadyFeatured: true`), checked *before* touching the ledger. | `entitlements.service.js#grantFeaturedListing` → `listings.service.js#feature` (→ `POST /listings/:listingId/feature`) |
| `features.contactUnlocks` | `commerce.subscription_usage` (`feature = 'CONTACT_UNLOCKS'`) + `marketplace.contact_unlocks` (dedup table) | Same atomic pattern as featured listings: already-unlocked check, usage consume, and the unlock record insert all in one transaction. FREE plans use a lifetime period; paid plans reset on renewal. Re-viewing an already-unlocked listing is always free. | `entitlements.service.js#consumeContactUnlock` → `enquiries.service.js#contactReveal` (→ `POST /listings/:listingId/contact-reveal`) |

Every one of these is an **advisory-locked** transaction (`pg_advisory_xact_lock`, keyed per feature *and* per owner) — the same TOCTOU-safety as the live-count limits, so two concurrent requests against a quota of 1 can't both pass.

`aiMonthlyQuota: null` or `features.featuredListingsPerMonth: 0`/unset short-circuits before ever opening a transaction: `null` means unlimited (skip enforcement entirely), `0`/unset on featured listings means "no allowance, but still check if this exact listing is already featured" (a cheap read-only check, not a ledger write).

### 4c. Boolean feature flags — scaffolding, not yet wired up

`features.advancedAnalytics` / `verifiedBadge` / `bulkUpload` have a real gate — `entitlements.service.js#assertFeature` — throwing `HttpError(403, "FEATURE_NOT_AVAILABLE", ..., { feature, upgradeRequired: true })` when the flag isn't set on the actor's plan. It's unit-tested but has **zero call sites** anywhere else in `src/` — no route or service currently calls it. The gated capabilities (analytics dashboard, a verified badge, bulk CSV upload) don't have endpoints yet. Likewise `verificationIncluded` (a plan column, not a `features` key) is read only for catalog display — no verification endpoint checks it. Both are tracked as open gaps in the audit doc (B7, B8), not this session's concern.

---

## 5. Usage resets on renewal — the mechanism

**The problem this replaced:** every periodic counter used to be scoped to the plain wall-clock calendar month (`period_start = date_trunc('month', now())`), completely independent of when the plan was actually bought or renewed. A mid-month renewal never reset anything — the owner kept whatever they'd already used against the 1st-of-the-month bucket. That was a deliberate, previously-documented design choice, since revised.

**The fix — `src/shared/usageCycle.js#resolveUsageCycle`:** anchors the monthly window to the owner's (or, for a pooled feature, the *organization's*) current `plan_subscriptions.starts_at`, rolling forward one whole month at a time from that anchor:

```
cycle 0:  [starts_at,               starts_at + 1 month)
cycle 1:  [starts_at + 1 month,     starts_at + 2 months)
cycle n:  [starts_at + n months,    starts_at + (n+1) months)   ← "now" falls in exactly one of these
```

Month-end overflow is clamped, not carried: a plan that started on Jan 31st resets on Feb 28th, then **recovers** the 31st in March (computed fresh from the original anchor each cycle — never chained from a previously clamped date, so it never permanently drifts to "always the 28th").

**Why this makes renewal-based reset fall out for free, with no explicit reset job:** §3c established that `capturePaymentAndApplyEntitlements` inserts a **fresh row with `starts_at = now`** for every purchase, upgrade, *and* renewal — never mutating an existing row's `starts_at`. The instant that new row becomes the "currently active" plan, every subsequent `resolveUsageCycle` call for that owner anchors to the new `starts_at`. Cycle 0 of the new anchor doesn't match any `period_start` the old anchor's cycles ever wrote to `commerce.subscription_usage` (or any `reserved_at` window `ai.usage_events` was counting under) — so the counter simply starts fresh at 0 under the new key. Nothing is explicitly zeroed; the reset is a byproduct of the period key changing.

This also means a renewal **before** the natural cycle would have ended still resets immediately — the new anchor is "now," so the very next read opens a brand-new cycle starting at that instant, not "whenever the old cycle was going to end."

**Org-pooled features (AI quota, featured listings) inherit this correctly**: the anchor used is the organization's own active plan row, so a renewal by *any* member resets the shared pool for *every* member reading it — not just whoever happened to complete the purchase.

**The one exception:** `contactUnlocks` on a FREE plan is never period-scoped to begin with — it uses a fixed sentinel period (`LIFETIME_PERIOD`, epoch to year 9999) that never resets, on purpose, matching the pricing page's "5, for the lifetime of your free account" framing. The same key resets on each paid-plan renewal; the plan type selects the behavior.

**The one fallback that keeps calendar-month behavior:** when there's no real subscription instance to anchor to at all (the ambient last-resort case from §3d, step 3 — `PLAN_FREE` itself unseeded), `resolveUsageCycle` falls back to the plain calendar month, same as the pre-existing last-resort behavior everywhere else in this system.

---

## 6. Worked examples

**A new seller signs up.** They get a real `PLAN_FREE` row, `starts_at = registration instant`, `ends_at = null`. They publish 2 listings (their limit) and a 3rd submission is rejected with `PLAN_LIMIT_REACHED`. They buy PRO. `capturePaymentAndApplyEntitlements` expires the FREE row and inserts a new PRO row, `starts_at = purchase instant`. Their listing limit is now 20 (their 2 existing listings stay published — grandfathered, not retroactively checked), and **every metered counter — AI queries, featured listings, contact unlocks — starts at 0 under the new anchor**, even if they'd already used AI queries earlier that calendar month under FREE.

**A brokerage on BUSINESS renews early, mid-cycle, on day 20 of a 30-day plan.** Five agents share the org's AI quota and featured-listing pool. The moment the renewal payment captures, the org's `plan_subscriptions.starts_at` becomes "now." The next AI query from *any* of the five agents resolves the org's new anchor and finds no usage recorded yet under it — the shared pool is effectively full again for everyone, immediately, not just for whoever clicked "renew."

**A buyer on FREE reveals a seller's contact.** First reveal of a listing consumes 1 of their 5 lifetime contact unlocks. Viewing the same listing's contact again later is free (`alreadyUnlocked: true`, no ledger write). After 5 distinct listings, the 6th throws `PLAN_LIMIT_REACHED` with `{ feature: "CONTACT_UNLOCKS", used: 5, limit: 5 }`.

**An admin edits `PLAN_PRO`'s `contactUnlocks` from 50 to 100** via `PATCH /admin/plans/:planId`. There is no cache to invalidate and no deploy to run — the very next `resolveEffectivePlanForUser` call (whether from an enforcement check or `GET /me/subscription`) reads the updated `commerce.plans` row directly.

---

## 7. API surface

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /plans` | public | Plan catalog (active plans, optionally filtered by `planType`) |
| `GET /plans/me` | user | Billing-status indicator — "do I have a real active subscription row" |
| `GET /me/subscription` | user | Full entitlement view: plan, limits, and current usage in one response (§8) |
| `POST /orders` | user | Buy a plan (or promotion/service), optionally on behalf of an `organizationId` |
| `POST /payments/:orderId/create` | user | Create a Razorpay Payment Link for an order |
| `GET /payments/callback`, `POST /payments/webhook` | public / provider | Capture payment → `capturePaymentAndApplyEntitlements` |
| `POST /listings/:listingId/submit` | seller | Enforces `listingLimit` (submit-time) |
| `POST /admin/listings/:listingId/approve` | admin | Enforces `listingLimit` (approval-time, same lock key as submit) |
| `POST /properties/:propertyId/media/complete` | owner | Enforces `imagesPerProperty`/`videosPerProperty` |
| `POST /organizations/:organizationId/members` | org admin/owner | Enforces `teamMembers` |
| `POST /listings/:listingId/feature` | owner | Consumes `featuredListingsPerMonth` allowance |
| `POST /listings/:listingId/contact-reveal` | buyer | Consumes `contactUnlocks` |
| `GET/POST /admin/plans`, `PATCH /admin/plans/:planId`, `.../activate`, `.../deactivate` | admin | Catalog CRUD — this is the *only* way plan numbers change |

## 8. `GET /me/subscription` — example response

For a user on PRO who's used 8/20 listings, 42/100 AI queries this cycle, 1/2 featured-listing slots, and 12/50 contact unlocks:

```json
{
  "plan": { "code": "PLAN_PRO", "name": "Pro", "monthlyPrice": 999 },
  "status": "ACTIVE",
  "currentPeriodStart": "2026-09-05T08:15:00.000Z",
  "currentPeriodEnd": "2026-10-05T08:15:00.000Z",
  "features": { "imagesPerProperty": 20, "videosPerProperty": 2, "teamMembers": 3, "featuredListingsPerMonth": 2, "contactUnlocks": 50, "advancedAnalytics": true, "verifiedBadge": true, "bulkUpload": false },
  "limits": {
    "activeListings": { "used": 8, "limit": 20, "remaining": 12 },
    "imagesPerProperty": { "limit": 20 },
    "videosPerProperty": { "limit": 2 },
    "featuredListings": { "used": 1, "limit": 2, "remaining": 1 },
    "aiQueries": { "used": 42, "limit": 100, "remaining": 58 },
    "contactUnlocks": { "used": 12, "limit": 50, "remaining": 38 }
  }
}
```

`currentPeriodStart`/`currentPeriodEnd` here are the *subscription's* own `starts_at`/`ends_at` (when this plan instance was bought and when it lapses) — not to be confused with each metered feature's own usage cycle from §5, which isn't separately exposed in this response today.

---

## 9. Known gaps (not this document's concern, tracked in the audit doc)

- **No admin plan-assignment override** — an admin can edit the catalog but can't directly grant/force a specific plan onto one account (C7).
- **No self-service downgrade/cancel** — by design; nothing auto-renews, so there's no charge to stop (C6).
- **`verificationIncluded` and the boolean feature flags are unenforced scaffolding** (B7, B8) — see §4c.
- **The dev-only demo seed script bypasses `grantFreePlan`** — gated behind `DEMO_DATA=true`, never runs in production (A7).

Full detail and status on each: [`subscription-entitlements-audit-checklist.md`](./subscription-entitlements-audit-checklist.md).

## 10. File map

| Concern | File |
|---|---|
| Plan catalog CRUD, `GET /me/subscription` assembly | `src/modules/commerce/commerce.service.js` |
| Plan resolution, usage ledger writes, payment capture | `src/modules/commerce/commerce.repository.js` |
| Entitlement resolution/enforcement entry points | `src/modules/commerce/entitlements.service.js` |
| Renewal-anchored usage cycle (core mechanism, §5) | `src/shared/usageCycle.js` |
| AI quota reserve/confirm/release | `src/modules/ai/ai.service.js`, `src/modules/ai/ai.repository.js` |
| Listing-limit enforcement (submit + approve) | `src/modules/listings/listings.repository.js`, `listings.service.js` |
| Media-limit enforcement | `src/modules/properties/properties.repository.js`, `properties.service.js` |
| Team-member-limit enforcement | `src/modules/organizations/organizations.repository.js`, `organizations.service.js` |
| Contact-unlock enforcement | `src/modules/enquiries/enquiries.service.js` |
| Schema | `src/database/schema.sql` (`commerce.products`, `commerce.plans`, `commerce.plan_subscriptions`, `commerce.subscription_usage`, `marketplace.contact_unlocks`) |
