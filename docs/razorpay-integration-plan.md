# Razorpay Integration Implementation Plan

## 1. Objective

Integrate Razorpay for Zameens plan subscriptions, promotions, and paid services using a **server-driven redirect flow**: the client sends only a purchase intent (product/plan selection), the server does all Razorpay API interaction, and the API response the client acts on is a redirect URL to a Razorpay-hosted payment page — never an embedded Razorpay Checkout.js modal, and the client never receives or submits a Razorpay signature directly.

Plans are subscription tiers (Free/Pro/Business) that grant features (listing quota, featured slots, verification, etc.). Each plan supports **either** billing mode, chosen per-plan by an admin flag:

- **ONE_TIME** — customer pays once, gets the plan's features for a fixed duration, and must manually repurchase to renew.
- **RECURRING** — Razorpay auto-charges the customer every billing cycle via a Subscriptions mandate, until cancelled.

Promotions and paid services are always one-time purchases and use the same redirect mechanism as ONE_TIME plans.

The server remains authoritative for order totals, payment state, webhook processing, refunds, and product entitlements. The browser redirect back from Razorpay is a fast-path UX signal only; the webhook is the authoritative confirmation for every state change.

## 2. Existing Foundation

The repository already provides:

- `commerce.orders`, `commerce.payments`, `commerce.payment_webhook_events`, and `commerce.payment_refunds` tables.
- Internal order creation and payment intent endpoints (`POST /orders`, `POST /payments/{orderId}/create`).
- An HMAC signature-verification helper (`hmacSha256Hex`/`safeEqualHex` in `src/utils/crypto.js`), reusable for the new callback/webhook signature checks even though its current call site (`commerce.service.verifyPayment`, a client-submitted-signature endpoint) is being removed.
- Raw request-body preservation for webhook signature validation (`req.rawBody`, set globally in `src/config/express.config.js`).
- Webhook event deduplication by `(provider, event_id)`.
- `INR` amounts represented as minor units, suitable for Razorpay paise.

The current implementation self-generates a `provider_order_id` and expects the client to run Razorpay Checkout.js with it. Both of these are being replaced — provider order/payment-link/subscription creation must be a real Razorpay API call, and the client-facing contract changes from "open this checkout modal" to "redirect the browser to this URL."

### 2.1 Gaps verified against the current codebase

Independent of the flow change, four gaps exist today and must be closed as part of this plan:

- **No entitlement storage for plans.** `commerce.plans` is only a product catalog. There is no table anywhere recording that a specific user or organization currently holds an active plan, its expiry, or its remaining listing quota. Nothing in the codebase reads such a table either — plan purchase today has no observable effect after payment.
- **No linkage between orders and service requests.** `commerce.service_requests.order_id` exists as a column but no code path ever sets it. `commerce.service_requests` and `commerce.orders` are created through entirely separate, currently unconnected flows.
- **No ownership validation on order item targets.** `POST /orders` accepts `items[].targetType`/`targetId` as opaque client-supplied values (`commerce.validation.js`) with no check that the target belongs to the requesting user. Any authenticated buyer can currently submit an arbitrary UUID as `targetId`.
- **Product type is not loaded during order creation.** `commerce.repository.findProductsByIds` selects `id, code, name, amountMinor, currency, isActive` only — `type` (`PLAN`/`PROMOTION`/`SERVICE`) is not fetched, so nothing in `createOrder` can branch on it today.

Sections 7, 8, 9, and 12 below close all four gaps.

## 3. Target Payment Flows

### 3.1 One-time purchase (ONE_TIME plans, promotions, services) — Razorpay Payment Links

```text
Client selects product (plan/promotion/service)
        |
        v
POST /orders                         (server computes total, validates item targets)
        |
        v
POST /payments/{orderId}/create      (server creates a Razorpay Payment Link)
        |
        v
Server responds { redirectUrl }      <-- no checkout payload, no public key, no client SDK
        |
        v
Client does a full-page redirect to redirectUrl
        |
        v
Customer pays on Razorpay's hosted page
        |
        +-------------------------------+
        |                                |
        v                                v
Browser GET /payments/callback      Razorpay webhook (payment.captured)
(Razorpay redirects the browser          |
 here with signed query params)          |
        |                                |
        v                                v
Server verifies callback signature, capture/mark-paid/entitlement (idempotent — same
                                     transaction whichever path reaches it first)
        |
        v
Server responds with an HTTP redirect (302) to the frontend result page
```

The callback redirect is a UX fast path only. If the customer closes the tab before the redirect completes, the webhook still captures the payment and applies the entitlement — the flow must work correctly with the callback step entirely absent.

### 3.2 Recurring subscription (RECURRING plans) — Razorpay Subscriptions

```text
Client selects a RECURRING plan
        |
        v
POST /subscriptions               (server creates the internal order + a PENDING_AUTHORIZATION
        |                          plan_subscriptions row, then a Razorpay Subscription)
        v
Server responds { subscriptionId, redirectUrl }
        |
        v
Client does a full-page redirect to redirectUrl (Razorpay-hosted mandate authorization page)
        |
        v
Customer authorizes the mandate (UPI Autopay / card) — first cycle is charged immediately
        |
        v
Razorpay webhook: subscription.activated (first charge) -> capture + activate entitlement
        |
        v
... on each renewal ...
        |
        v
Razorpay webhook: subscription.charged -> extend entitlement, record subscription_charges row
        |
        v
Eventually: subscription.cancelled / subscription.halted / subscription.completed
        |
        v
Server marks plan_subscriptions accordingly; entitlement is not renewed further
```

Unlike Payment Links, Razorpay's hosted subscription-authorization page's browser-redirect-back behavior is less consistently documented across API versions (see Section 19). Do not depend on it for correctness — the webhook events above are authoritative. The frontend should treat the return from redirect as "pending confirmation" and poll `GET /subscriptions/{id}` (or `GET /orders/{orderId}`) until it observes `ACTIVE`, rather than trusting a query parameter on return.

## 4. Scope and File Ownership

### Existing files to extend

- `src/modules/commerce/commerce.service.js`
  - Replace mock provider order creation with Payment Links / Subscriptions calls.
  - Remove the client-submitted-signature `verifyPayment` flow; replace with the callback-handler logic described in Section 10.
  - Add order-item target/ownership validation (Section 7).
  - Add refund orchestration.
  - Add subscription lifecycle handlers (create, cancel, webhook-driven state transitions).
- `src/modules/commerce/commerce.repository.js`
  - `findProductsByIds` must additionally select `type` (and, for plans, `billingMode` + `providerPlanId`) so `createOrder`/`createSubscription` can branch per item.
  - Add active-payment/payment-link lookup, refund persistence, subscription persistence, and entitlement transactions.
  - Add `findOwnedListingForPromotion` / `findPayableServiceRequest` lookups used by order-item target validation (Section 7).
- `src/modules/commerce/commerce.controller.js`
  - Replace `verifyPayment` controller with a `paymentCallback` controller that issues an HTTP redirect instead of a JSON response.
  - Add subscription create/get/cancel handlers and refund/admin payment handlers.
- `src/modules/commerce/commerce.routes.js`
  - Remove `POST /payments/verify`; add `GET /payments/callback` (public — Razorpay/browser redirects here, no auth header available) and `POST /subscriptions`, `GET /subscriptions/me`, `GET /subscriptions/{id}`, `POST /subscriptions/{id}/cancel`.
- `src/modules/commerce/commerce.admin.routes.js`
  - Add admin payment/refund inspection and refund commands.
  - `PATCH /admin/plans/{planId}` gains the `billingMode` field (Section 5.1 of the API contract, Section 12 schema).
- `src/modules/commerce/commerce.validation.js`
  - Remove `verifyPayment` body validation (no longer a client-submitted call).
  - Add validation for the Payment Link callback query params, refund amount/reason, and `billingMode`.
- `.env.example`
  - Document Razorpay configuration, including the frontend return-URL base used to build callback/redirect targets.
- `src/database/schema.sql`
  - Add `commerce.plans.billing_mode`/`provider_plan_id`, the expanded `commerce.plan_subscriptions`, `commerce.subscription_charges`, and the constraints from Section 12.

### New files recommended

- `src/modules/commerce/providers/razorpay.provider.js`
  - Encapsulate Razorpay HTTP calls (Payment Links, Subscriptions, Plans, Refunds) and signature helpers.
- `src/modules/commerce/commerce.entitlements.js`
  - Apply paid product effects idempotently (plan grant/extend, promotion insert, service status transition).
- `test/unit/commerce.payments.test.js`
  - Unit and contract coverage for the one-time payment lifecycle.
- `test/unit/commerce.subscriptions.test.js`
  - Unit and contract coverage for the recurring subscription lifecycle.
- `test/unit/razorpay.provider.test.js`
  - Provider request mapping, signature handling, and error normalization.

## 5. Configuration

Add the following variables to `.env.example` and deployment secrets:

```text
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_API_TIMEOUT_MS=10000
API_PUBLIC_BASE_URL=
COMMERCE_RETURN_BASE_URL=
```

Rules:

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` are mandatory outside development/test environments — unlike the Checkout.js design, `RAZORPAY_KEY_ID` is now needed operationally (Basic Auth against the Razorpay API) even though it is never sent to the client.
- Never expose `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` to the client. The client never runs Razorpay's JS SDK in this design, so `RAZORPAY_KEY_ID` is not returned to the client either.
- `API_PUBLIC_BASE_URL` is this server's own publicly reachable base URL, used to build the Payment Link `callback_url` Razorpay redirects the browser back to. Must be an HTTPS origin Razorpay can actually reach — never `localhost` outside local development. Required outside development.
- `COMMERCE_RETURN_BASE_URL` is the frontend base URL the server redirects the browser to after handling a Payment Link callback (e.g. `{COMMERCE_RETURN_BASE_URL}/payments/result?orderId=...&status=...`). Required outside development.
- Use separate Razorpay test and live credentials per environment.

## 6. Provider Adapter

Implement a narrow provider interface so the commerce service does not depend directly on Razorpay's HTTP conventions:

```text
createPaymentLink({ amountMinor, currency, referenceId, description, callbackUrl, notes })
verifyPaymentLinkCallbackSignature({ query })
createProviderPlan({ amountMinor, currency, interval, period, name })     // Razorpay's own Plan resource, distinct from commerce.plans
createSubscription({ providerPlanId, totalCount, customerNotify, notes })
cancelSubscription(providerSubscriptionId, { cancelAtCycleEnd })
fetchSubscription(providerSubscriptionId)
verifyWebhookSignature({ rawBody, signature })
fetchPayment(providerPaymentId)
createRefund(providerPaymentId, { amountMinor, notes })
```

The adapter must:

- Convert internal minor units directly to Razorpay `amount`.
- Normalize provider errors into stable application errors.
- Apply a timeout.
- Avoid retrying non-idempotent calls unless the request is protected by a provider-supported idempotency strategy.
- Return only the fields needed by the commerce service.

### 6.1 HTTP client

Use Node's built-in global `fetch` (available unconditionally on the Node 24 runtime this service targets) with HTTP Basic Auth (`Authorization: Basic base64(RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET)`) against `https://api.razorpay.com/v1/*`. Do not add the `razorpay` npm package: the repository has no existing HTTP client dependency (no `axios`, no `node-fetch`), and the REST surface needed here (`payment_links`, `subscriptions`, `plans`, `payments`, `refunds`) is small enough that a thin adapter over `fetch` keeps the dependency footprint consistent with the rest of the codebase.

Razorpay's Orders/Payment Links APIs have no dedicated idempotency-key header. Uniqueness is instead enforced application-side: `reference_id`/`receipt` must be set to the internal `order_number`, and retry-safety comes from the "reuse an existing active payment attempt" rule in Section 8, not from a provider-side idempotency guarantee.

## 7. Internal Order and Target Validation

Keep `POST /orders` as the source of the payable amount. Do not accept price, tax, or total from the client.

`commerce.repository.findProductsByIds` must additionally select `type` (and, for `PLAN` products, `billingMode`) so `createOrder` can branch per item. For every order item, validate `targetType`/`targetId` against the resolved product's `type` before the order is persisted — this is the only point where the buyer's identity and the target are both known ahead of any payment, so it cannot be deferred to capture/webhook time:

| Product type | `targetType` | Required `targetId` reference | Ownership check |
|---|---|---|---|
| `PLAN` | `null` | none (applies to the buyer or `input.organizationId`) | If `organizationId` is set, the active-membership check already run in `createOrder` covers it. |
| `PROMOTION` | `LISTING` | `marketplace.listings.id` | `listings.seller_user_id = actorId` OR `listings.seller_organization_id = input.organizationId` (membership already verified). Reject with `409 TARGET_NOT_OWNED` otherwise. |
| `SERVICE` | `SERVICE_REQUEST` | `commerce.service_requests.id` | `service_requests.user_id = actorId` AND `service_requests.status = 'REQUESTED'` AND `service_requests.order_id IS NULL`. Reject with `409 SERVICE_REQUEST_NOT_PAYABLE` otherwise. On successful order creation, immediately set `service_requests.status = 'PAYMENT_PENDING'` in the same transaction as `createOrder`. |

Free-text `targetType` must be rejected in `commerce.validation.js` in favor of a fixed enum (`LISTING`, `SERVICE_REQUEST`) — it is currently accepted as an arbitrary string up to 50 characters.

**Routing by billing mode:** if an order contains a `PLAN` item whose product has `billingMode = 'RECURRING'`, reject it from the plain order/payment-link path (`409 PLAN_REQUIRES_SUBSCRIPTION`) and direct the client to `POST /subscriptions` instead (Section 9). A single order must not mix a `RECURRING` plan with other items, since the two paths create different provider entities.

## 8. Payment Creation — One-Time (Payment Links)

For `POST /payments/{orderId}/create` (used for `ONE_TIME` plans, promotions, and services):

1. Load the order for the authenticated owner.
2. Require status `CREATED` or `PAYMENT_PENDING`. Reject already paid, cancelled, failed, or refunded orders.
3. Reuse an existing active payment attempt when its payment link is still usable (not expired/paid/cancelled on Razorpay's side), or explicitly mark the previous attempt failed before creating a new one.
4. Call the Razorpay Payment Links API with:
   - `amount`: `order.total_minor`
   - `currency`: `order.currency`
   - `reference_id`: internal `order_number`
   - `callback_url`: `{API_BASE_URL}/api/v1/payments/callback`
   - `callback_method`: `get`
   - `notes.internalOrderId` / `notes.internalPaymentId`
5. Store the returned Payment Link `id` as `commerce.payments.provider_order_id` (this column now holds a `plink_...` id for this flow rather than a Razorpay Order id — document this repurposing inline in the code, since the column name otherwise implies the older Orders-API flow) and the full provider response payload.
6. Move the internal order to `PAYMENT_PENDING`.
7. Return only `{ paymentId, provider, redirectUrl }` — no public key, no checkout payload. The client performs a full-page redirect (`window.location.href = redirectUrl`), not an SDK call.

The operation must not create a second internal payment on a client retry without an explicit retry policy.

## 9. Payment Creation — Recurring (Subscriptions)

For `POST /subscriptions` (used only for `RECURRING` plans):

1. Validate the plan exists, is active, and has `billingMode = 'RECURRING'`.
2. If `commerce.plans.provider_plan_id` is null, lazily create the corresponding Razorpay Plan resource (`createProviderPlan`) from the plan's `amountMinor`/`currency`/`durationDays`-derived interval, and persist `provider_plan_id` on the row so subsequent subscriptions reuse it.
3. Create the internal order + single order item (same validation/ownership path as Section 7; a subscription is still "one order" for reporting purposes in `GET /orders/me`).
4. Insert a `commerce.plan_subscriptions` row with `status = 'PENDING_AUTHORIZATION'`, `billing_mode = 'RECURRING'`, `order_item_id` set (unique — this is the idempotency key for the first cycle).
5. Call the Razorpay Subscriptions API with `plan_id` (the provider plan id), `total_count` (billing cycles; use a large bound rather than infinite, per Razorpay's requirement), `customer_notify: 1`, `notes.internalSubscriptionId`.
6. Store the returned Subscription `id` as `provider_subscription_id`.
7. Return `{ orderId, subscriptionId, redirectUrl }` where `redirectUrl` is the Subscription's hosted authorization page.

`GET /subscriptions/{id}` and `GET /subscriptions/me` expose current status (`PENDING_AUTHORIZATION`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `CANCELLED`, `EXPIRED`, `COMPLETED`) for the frontend to poll after the redirect-back, per the caveat in Section 3.2.

`POST /subscriptions/{id}/cancel` (owner-only) calls `cancelSubscription` and marks the row `CANCELLED`; support `cancelAtCycleEnd` so the customer keeps access through the already-paid period rather than losing it immediately.

## 10. Callback Handling (redirect-back from Payment Links)

`GET /payments/callback` is public (Razorpay redirects the customer's browser here directly — there is no `Authorization` header available). Razorpay appends `razorpay_payment_id`, `razorpay_payment_link_id`, `razorpay_payment_link_reference_id`, `razorpay_payment_link_status`, and `razorpay_signature` as query parameters.

1. Verify `razorpay_signature` via `verifyPaymentLinkCallbackSignature` (HMAC of the documented field concatenation — confirm exact field order against current Razorpay docs at implementation time; see Section 19).
2. Resolve the internal payment via `provider_order_id = razorpay_payment_link_id`.
3. If the signature is invalid or the payment link id is unknown, redirect to `{COMMERCE_RETURN_BASE_URL}/payments/result?status=invalid` — do not change any state.
4. If valid and `razorpay_payment_link_status = 'paid'`, capture the payment and mark the order paid + apply the entitlement in one transaction (same logic as the webhook path in Section 11 — factor this into one shared function so the callback and the webhook cannot diverge). If already captured (webhook won the race), this is a no-op read.
5. Respond with an HTTP redirect (302, `Location` header) to `{COMMERCE_RETURN_BASE_URL}/payments/result?orderId=...&status=...` — never a JSON body. This is the "page redirected as response from server" requirement: the browser lands on our callback URL and leaves with a redirect, not a page our server renders itself.

This endpoint must be safe to call with a stale, replayed, or manipulated query string — it can only ever reach the same state the webhook would independently reach, never bypass a check the webhook enforces.

## 11. Webhooks

Configure Razorpay to send webhooks to:

```text
POST /api/v1/payments/webhook
```

Required events for the first release:

- `payment.captured`
- `payment.failed`
- `payment_link.paid`
- `subscription.activated`
- `subscription.charged`
- `subscription.cancelled`
- `subscription.halted`
- `subscription.completed`
- `refund.processed`
- `refund.failed`

Processing sequence:

1. Read the exact raw request body.
2. Verify `x-razorpay-signature` with `RAZORPAY_WEBHOOK_SECRET`.
3. Derive and persist the provider event ID before side effects.
4. Return success for an already processed duplicate.
5. Resolve the internal payment via `notes.internalPaymentId` on the event's payment entity, not via the provider's order id / payment link id fields — those are named and nested differently across event types (a `payment.captured` event for a Payment-Link-originated payment carries Razorpay's auto-created Order id, not the Payment Link id we stored as `provider_order_id`), while `notes` are ours and echoed back verbatim on every event regardless of type. Resolve subscription events via `provider_subscription_id` instead, since there is no order/payment-link id involved.
6. Validate amount and currency before changing state.
7. Apply the state transition and entitlement transactionally, sharing the exact capture/entitlement function used by the callback handler (Section 10) so the two paths cannot disagree.
8. Mark the event processed only after all side effects succeed.
9. Store processing errors for retry/operations visibility.

Unknown but valid events should be persisted and acknowledged without changing payment state.

`subscription.charged` handling specifically: insert a row into `commerce.subscription_charges` keyed by `UNIQUE(provider_payment_id)` (duplicate delivery is then a harmless conflict), then extend `plan_subscriptions.ends_at` by one billing cycle. `subscription.cancelled` / `subscription.halted` / `subscription.completed` set `plan_subscriptions.status` accordingly and stop further renewal — do not delete the row, since it is the audit record of what the customer had access to and when.

## 12. Database Changes

- Unique `(provider, provider_order_id)` for non-null values on `commerce.payments` — note that for the one-time flow this column now holds a Payment Link id, not a Razorpay Order id (Section 8).
- A constraint or application guard preventing captured payments with a missing provider payment ID.
- An index for payment lookup by `provider_payment_id`.
- Refund amount accounting so total processed refunds cannot exceed the captured amount.
- **`UNIQUE (order_item_id)` on `marketplace.listing_promotions`** where `order_item_id IS NOT NULL`. Today this column has no uniqueness constraint at all, so "idempotent, tied to the order item" is not actually enforced at the database level.
- **`commerce.plans` gains two columns:**

  ```sql
  ALTER TABLE commerce.plans
    ADD COLUMN billing_mode varchar(20) NOT NULL DEFAULT 'ONE_TIME'
      CHECK (billing_mode IN ('ONE_TIME','RECURRING')),
    ADD COLUMN provider_plan_id varchar(255);
  ```

  `billing_mode` is the admin-facing toggle (exposed via `PATCH /admin/plans/{planId}`). Changing it only affects purchases made after the change — existing `plan_subscriptions` rows keep the mode they were created under (denormalized below), so an admin flipping a plan's mode does not retroactively alter entitlements already granted.

- **New table `commerce.plan_subscriptions`** — there is currently no table anywhere that records a user's or organization's active plan. Required before any plan entitlement (Section 13) can be implemented, one-time or recurring:

  ```sql
  CREATE TABLE commerce.plan_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
    organization_id uuid REFERENCES account.organizations(id) ON DELETE RESTRICT,
    plan_id uuid NOT NULL REFERENCES commerce.plans(id) ON DELETE RESTRICT,
    order_item_id uuid NOT NULL UNIQUE REFERENCES commerce.order_items(id) ON DELETE RESTRICT,
    billing_mode varchar(20) NOT NULL CHECK (billing_mode IN ('ONE_TIME','RECURRING')),
    provider_subscription_id varchar(255),
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    status varchar(30) NOT NULL DEFAULT 'ACTIVE'
      CHECK (status IN ('PENDING_AUTHORIZATION','ACTIVE','PAST_DUE','PAUSED','CANCELLED','EXPIRED','COMPLETED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_plan_subscription_owner CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL),
    CONSTRAINT chk_plan_subscription_provider_id
      CHECK (billing_mode = 'ONE_TIME' OR provider_subscription_id IS NOT NULL)
  );
  CREATE UNIQUE INDEX uq_commerce_plan_subscriptions_provider
    ON commerce.plan_subscriptions(provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
  CREATE INDEX idx_commerce_plan_subscriptions_user_active
    ON commerce.plan_subscriptions(user_id, ends_at) WHERE status = 'ACTIVE';
  CREATE INDEX idx_commerce_plan_subscriptions_org_active
    ON commerce.plan_subscriptions(organization_id, ends_at) WHERE status = 'ACTIVE';
  ```

  "Does this user/org currently have an active plan" queries must filter `status = 'ACTIVE' AND (ends_at IS NULL OR ends_at > now())`, not `status = 'ACTIVE'` alone — a `ONE_TIME` row's status is not proactively flipped to `EXPIRED` the moment `ends_at` passes. A periodic sweep (or lazy check-and-update on read) should transition stale `ACTIVE` rows to `EXPIRED` so the partial index stays representative.

- **New table `commerce.subscription_charges`** — records each individual renewal charge for a recurring subscription (cycle 1's charge is captured through the normal `commerce.payments` row created alongside the order; cycles 2+ have no corresponding order and are recorded here instead):

  ```sql
  CREATE TABLE commerce.subscription_charges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_subscription_id uuid NOT NULL REFERENCES commerce.plan_subscriptions(id) ON DELETE RESTRICT,
    provider_payment_id varchar(255) NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    currency char(3) NOT NULL DEFAULT 'INR',
    billing_cycle_number integer NOT NULL CHECK (billing_cycle_number > 0),
    charged_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX uq_commerce_subscription_charges_payment
    ON commerce.subscription_charges(provider_payment_id);
  CREATE INDEX idx_commerce_subscription_charges_subscription
    ON commerce.subscription_charges(plan_subscription_id, charged_at DESC);
  ```

Per `Zameen_API_PLAN_FULL.md`'s ownership note ("Schema changes still go through Dev 1" — Dev 2 owns commerce/services), this migration touches shared schema and needs Dev 1 sign-off even though the feature is Dev 2-owned.

Do not store card, UPI, or bank account data. Store only provider IDs, status, amounts, timestamps, and the minimum payload needed for reconciliation and audit.

## 13. Entitlements

Payment capture must trigger the product effect appropriate to the order item, in the same database transaction as the capture (shared between the callback handler and the webhook handler, per Sections 10–11). Loop over the order's items and dispatch by `product.type`:

- **Plan, first grant/cycle** (`ONE_TIME` capture, or `RECURRING`'s `subscription.activated`): upsert into `commerce.plan_subscriptions` keyed by `order_item_id` (unique, so a repeat capture is a no-op). If the user/organization already has a row with `status = 'ACTIVE'` for the same scope, **extend** rather than replace: `new_ends_at = GREATEST(existing.ends_at, now()) + plan.duration_days`. Otherwise insert a fresh row with `starts_at = now()`, `ends_at = now() + plan.duration_days` (`NULL` if the plan has no `duration_days`). Mark any other `ACTIVE` row for the same user/org `EXPIRED` so only one `ACTIVE` row exists per scope at a time.
- **Plan, renewal cycle** (`RECURRING`'s `subscription.charged`, cycle 2+): insert into `commerce.subscription_charges` keyed by `provider_payment_id` (unique — idempotent against redelivery), then extend the matching `plan_subscriptions.ends_at` by one billing cycle. There is no order item for this event; resolve the `plan_subscriptions` row via `provider_subscription_id` from the webhook payload.
- **Plan, cancellation/failure** (`subscription.cancelled`/`subscription.halted`/`subscription.completed`): set `plan_subscriptions.status` accordingly. Access continues until `ends_at` (already-paid period) rather than being revoked immediately, unless the product policy for that plan says otherwise.
- **Promotion** (`targetType = 'LISTING'`): insert into `marketplace.listing_promotions` with `order_item_id` set, `promotion_type` from the product's configuration, `starts_at = now()`, `ends_at = now() + <configured duration>`. Rely on the new `UNIQUE (order_item_id)` constraint (Section 12) to make a retried capture a harmless conflict rather than a duplicate row.
- **Service**: `UPDATE commerce.service_requests SET status = 'IN_PROGRESS' WHERE id = targetId AND order_id = orderId AND status = 'PAYMENT_PENDING'`. The `order_id = orderId` guard (set at order-creation time, Section 7) makes this naturally idempotent — a second capture attempt finds `status` already advanced and updates zero rows.

A failed entitlement transaction must roll back with the payment capture (same transaction) and leave the payment in a state visible for operational retry — `CAPTURED` with no corresponding entitlement effect is a detectable, alertable inconsistency. Do not mark the webhook event processed if this transaction fails.

## 14. Refunds

Add an admin-authorized refund workflow:

1. Validate the internal payment is captured.
2. Validate requested amount is positive and does not exceed the remaining refundable amount.
3. Insert a pending `commerce.payment_refunds` record.
4. Call the Razorpay Refunds API.
5. Store the provider refund ID and update the refund state.
6. Reconcile final state from refund webhooks.
7. Mark the order refunded only when the full captured amount has been processed.
8. Reverse or expire the corresponding entitlement according to product policy.

For a `RECURRING` plan subscription, a refund of a single cycle's charge is distinct from cancelling the subscription itself — refunding does not automatically call `cancelSubscription`, and cancelling does not automatically refund the current period. Handle these as two independent admin actions.

Partial refunds must remain separately auditable.

## 15. API Contract Changes

- `POST /orders` — unchanged request/response shape; now additionally validates item targets (Section 7) and rejects `RECURRING` plan items (routes to `POST /subscriptions` instead).
- `POST /payments/{orderId}/create` — response changes from `PaymentIntent` (`checkoutPayload`, `providerPublicKey`) to `{ paymentId, provider, redirectUrl }`.
- `GET /payments/callback` — **new**, public, browser-redirect target, responds with an HTTP redirect (Section 10).
- `POST /payments/verify` — **removed**. There is no client-submitted signature in this design.
- `POST /payments/webhook` — unchanged endpoint, expanded event list (Section 11).
- `POST /subscriptions` — **new**, creates a `RECURRING` plan subscription, returns `{ orderId, subscriptionId, redirectUrl }`.
- `GET /subscriptions/me`, `GET /subscriptions/{id}` — **new**, status inspection for the polling fallback described in Section 3.2.
- `POST /subscriptions/{id}/cancel` — **new**, owner-only.
- `GET /plans` — `Plan` response gains `billingMode` (`ONE_TIME`/`RECURRING`) so the frontend knows which purchase endpoint to call.
- `PATCH /admin/plans/{planId}` — gains `billingMode`.

Recommended admin endpoints:

- `GET /admin/payments/{paymentId}`
- `GET /admin/orders/{orderId}/payments`
- `POST /admin/payments/{paymentId}/refunds`
- `GET /admin/refunds/{refundId}`
- `GET /admin/subscriptions/{subscriptionId}`

## 16. Testing Plan

Add tests for:

- Exact paise and INR mapping to Payment Link / Subscription creation.
- Provider API failure and timeout normalization.
- Duplicate payment-create requests.
- Payment Link callback signature: valid, invalid, and replayed.
- Amount, currency, and provider-reference mismatches.
- Repeated callback/webhook delivery for the same payment (both orderings: callback-then-webhook and webhook-then-callback).
- Invalid webhook signatures.
- Duplicate and concurrent webhook delivery for one event.
- `payment.captured`, `payment.failed`, `payment_link.paid` transitions.
- `subscription.activated`, `subscription.charged` (multiple cycles), `subscription.cancelled`, `subscription.halted`, `subscription.completed`.
- Unknown valid webhook events.
- Entitlement activation exactly once, for each product type independently (plan grant + extension math for both billing modes, promotion insert, service status transition).
- Order-item target ownership rejection: a `PROMOTION` item targeting a listing the buyer does not own, and a `SERVICE` item targeting another user's service request, both rejected at `POST /orders` with `409`.
- A `RECURRING` plan rejected from `POST /payments/{orderId}/create` and only accepted via `POST /subscriptions`.
- Plan purchase while an existing active plan subscription is present (extension math, not duplication) — for both billing modes.
- Admin toggling a plan's `billingMode` does not alter already-existing `plan_subscriptions` rows.
- Full and partial refunds.
- Refund webhook reconciliation.
- Missing production secrets.

Use mocked provider calls in unit tests. Reserve sandbox tests for an environment-backed integration suite; never put live credentials in the repository or normal CI.

## 17. Rollout Sequence

### Phase 1: One-time redirect flow

- Add provider adapter, configuration, and the Payment Links integration.
- Load `product.type` in `findProductsByIds` and add order-item target/ownership validation (Section 7) with the fixed `targetType` enum.
- Replace `POST /payments/{orderId}/create`'s response with `{ redirectUrl }`; add `GET /payments/callback`; remove `POST /payments/verify`.
- Add provider and callback unit tests.

### Phase 2: Reconciliation hardening

- Validate amount, currency, and captured state on both the callback and webhook paths, sharing one capture function.
- Make callback and webhook handling fully idempotent.
- Add payment lifecycle tests.
- Configure Razorpay test-mode webhooks and Payment Links.

### Phase 3: Product activation (one-time)

- Migrate `commerce.plan_subscriptions`, `commerce.plans.billing_mode`/`provider_plan_id`, and the `listing_promotions.order_item_id` uniqueness constraint (Section 12) — coordinate with Dev 1.
- Implement one-time plan, promotion, and service entitlements (Section 13).
- Test the complete one-time purchase flow in sandbox mode for all three product types.

### Phase 4: Recurring subscriptions

- Implement `commerce.subscription_charges`, the Subscriptions provider adapter methods, and `POST/GET /subscriptions*`.
- Implement the `subscription.*` webhook handlers and renewal entitlement extension.
- Add the admin `billingMode` toggle on plans.
- Test the complete recurring purchase, renewal, and cancellation flow in sandbox mode.
- Confirm the exact hosted-page redirect-back behavior for Subscriptions against current Razorpay docs (Section 19) and adjust the frontend polling fallback accordingly.

### Phase 5: Refunds and operations

- Implement refund APIs, admin controls, and refund webhooks.
- Add audit and monitoring fields.
- Exercise partial-refund scenarios and subscription-cancellation-vs-refund scenarios independently.

### Phase 6: Production release

- Configure live credentials and HTTPS callback/webhook URLs.
- Verify webhook delivery and alerting.
- Run a low-value live one-time transaction and refund it, and a low-value live subscription cycle and cancel it.
- Enable production traffic gradually.

## 18. Acceptance Criteria

The integration is ready when:

- No Razorpay JS SDK or client-submitted signature exists anywhere in the client-facing contract; every purchase flow's success path is "client redirects to a server-provided URL."
- Every Payment Link / Subscription is created by Razorpay and linked to exactly one internal payment / plan subscription.
- No client-controlled amount can be charged or marked paid.
- Duplicate callback and webhook delivery are harmless, in either arrival order.
- A payment cannot be marked captured unless provider reference, payment, amount, currency, and signature checks pass.
- Entitlements are activated exactly once after capture, for every product type and both plan billing modes (`commerce.plan_subscriptions` exists and is populated and extended correctly for both `ONE_TIME` and `RECURRING`; `service_requests.order_id` is populated for services; no order item type is left without a persisted, queryable entitlement effect).
- No order item can target a resource (`listing`, `service_request`) the buyer does not own.
- An admin can toggle a plan between `ONE_TIME` and `RECURRING` without corrupting already-issued entitlements.
- Refunds support partial amounts and remain auditable; subscription cancellation and refunds are independent actions.
- Production startup fails when required Razorpay secrets are missing.
- Sandbox end-to-end tests and focused automated tests pass for both billing modes.
- Operations can trace an event from internal order to Razorpay reference (payment link or subscription), payment, webhook, entitlement, and refund.

## 19. Open items to verify against current Razorpay documentation

These two mechanics are described above at the level of "this is how the pattern works," but exact field names/behavior should be confirmed against Razorpay's current API reference before implementation, since API details can shift between versions:

- **Payment Links callback signature.** The documented scheme is `HMAC-SHA256(payment_link_id + "|" + payment_link_reference_id + "|" + payment_link_status + "|" + razorpay_payment_id, key_secret)`. Confirm the exact field order and parameter names against the live Payment Links API reference.
- **Subscriptions hosted-page redirect-back.** Confirm whether the current Subscriptions API supports a `callback_url`/`redirect_url`-style parameter on the hosted authorization page equivalent to Payment Links, or whether redirect-back must instead be configured account-wide / handled purely via webhook + client-side polling as designed in Section 3.2. Do not build the recurring flow's correctness around an assumed redirect parameter until this is confirmed.
