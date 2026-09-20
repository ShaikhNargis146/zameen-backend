# Razorpay Payment Flow — Implementation Reference

**Status (2026-09-20):** Implemented in `src/modules/commerce/`. For full design detail, edge cases, and unbuilt work (subscriptions, refunds), see [`razorpay-integration-plan.md`](./razorpay-integration-plan.md). For the frontend API contract, see [`razorpay-client-integration-guide.md`](./razorpay-client-integration-guide.md).

## Flow

```text
POST /orders
  → Create Zameen order

POST /payments/{orderId}/create
  → Backend creates Razorpay Payment Link

Frontend redirects to redirectUrl
  → Razorpay collects payment

POST /payments/webhook
  → Razorpay tells backend payment succeeded
  → Backend marks Order PAID
  → Backend activates plan/service/promotion

/payments/result
  → Frontend checks GET /orders/{orderId}
  → Shows success / pending / failed
```

## POST /orders

`commerce.routes.js` → `commerce.controller.createOrder` → `commerce.service.createOrder`.

Backend validates the product, checks it's active, fetches its price from the DB, creates the `Order` + `OrderItem` rows, and returns the order. The frontend never sends price.

```json
{ "items": [{ "productId": "a0000000-...", "quantity": 1 }] }
```

```json
{ "id": "order-uuid", "orderNumber": "ZMN-100023", "status": "CREATED", "totalMinor": 99900, "currency": "INR" }
```

## POST /payments/{orderId}/create

`commerce.controller.createPayment` → `commerce.service.createPaymentIntent`.

Backend loads the order, confirms it belongs to the user and is `CREATED`/`PAYMENT_PENDING`, creates a Razorpay Payment Link for the server-held amount, stores a `commerce.payments` row, moves the order to `PAYMENT_PENDING`, and returns only the redirect URL.

```json
{ "paymentId": "payment-uuid", "provider": "RAZORPAY", "redirectUrl": "https://rzp.io/rzp/xxxxxx" }
```

## Frontend redirect

```js
window.location.href = data.redirectUrl;
```

That's the entire client-side integration — no key, no SDK, no signature, no amount.

## POST /payments/webhook

`commerce.controller.webhook` → `commerce.service.handleWebhook`.

```text
Verify x-razorpay-signature
  → already processed (dedupe by provider event id) → return 200
  → resolve payment via notes.internalPaymentId
  → re-check amount/currency/status against Razorpay's own record
  → mark Payment CAPTURED + Order PAID + activate entitlement, in one transaction
  → return 200
```

Entitlement by product type:

- **Plan** → upsert `commerce.plan_subscriptions` (`starts_at`/`ends_at`, extends an existing active row rather than duplicating it)
- **Promotion** → insert `marketplace.listing_promotions` (`ends_at`)
- **Service** → `service_requests.status = 'IN_PROGRESS'` (there is no separate payment-status field — `status` alone tracks `REQUESTED → PAYMENT_PENDING → IN_PROGRESS`)

Order status is only ever set from this verified backend path — never from a frontend query parameter.

A public `GET /payments/callback` also exists (Razorpay redirects the browser here after payment) as a fast UX path, but it re-verifies against Razorpay the same way and shares the same capture logic as the webhook — it can never mark something paid that the webhook wouldn't also mark paid on its own.

## /payments/result

Frontend route reads `orderId` from the query string and calls `GET /orders/{orderId}` as the source of truth — never trusts `status` in the URL alone.

| `order.status` | UI |
|---|---|
| `PAID` | "Payment Successful — your plan/promotion/service is active" |
| `PAYMENT_PENDING` | "Confirming your payment…" — poll again for ~20–30s |
| `CREATED` | "Payment was not completed" — [Try Again] |

`order.status` never becomes `CANCELLED`/`FAILED`/`REFUNDED` in the current implementation — only `CREATED`/`PAYMENT_PENDING`/`PAID` are ever actually set, so a `PAYMENT_PENDING` order stays retryable rather than dead-ending. That means `PAYMENT_PENDING` alone is ambiguous between "still waiting on this attempt" and "the last attempt already failed" — check the order's `latestPaymentStatus` field (`CREATED`/`FAILED`/`CAPTURED`) to tell them apart: `FAILED` should show [Try Again] immediately instead of polling.

[Try Again] calls `POST /payments/{orderId}/create` again on the same order.

## GET /plans/me — knowing a plan is expiring or expired

`commerce.routes.js` → `commerce.controller.myPlan` → `commerce.service.myPlanSubscription`. Auth required.

There is no server-side push for this (no background sweep, no notification) — the client is expected to call this endpoint (e.g. on app load, or on an account/billing screen) and decide for itself when to show an "expiring soon" banner from `endsAt`.

```json
// has an active plan
{ "hasActivePlan": true, "plan": { "id": "...", "productId": "...", "code": "PLAN_PRO_MONTHLY", "name": "Pro", "...": "..." }, "status": "ACTIVE", "startsAt": "2026-09-01T00:00:00.000Z", "endsAt": "2026-10-01T00:00:00.000Z" }
```
```json
// no active plan (never purchased, or already lapsed)
{ "hasActivePlan": false, "plan": null, "status": null, "startsAt": null, "endsAt": null }
```

Backed by `commerce.repository.findActiveSubscriptionForUser`, which filters `status = 'ACTIVE' AND (ends_at IS NULL OR ends_at > now())` at read time — since nothing proactively flips a lapsed row's `status` to `EXPIRED`, a plan past its `endsAt` simply stops being returned here (`hasActivePlan: false`) rather than relying on a background job to have already caught up with it. Personal plans only (`organization_id IS NULL`) — no organization equivalent yet.

Suggested client logic: `hasActivePlan && endsAt within N days` → "expiring soon" banner; `!hasActivePlan` (where the user is known to have purchased before) → "expired" messaging.
