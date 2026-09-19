# Razorpay Checkout — Client Integration Guide

**Audience:** Web/UI team integrating plan, promotion, and paid-service checkout.
**Status:** One-time purchases (plans, promotions, services) are implemented and verified live against Razorpay's test API. Recurring subscriptions are **not** available yet — see Section 6.

## 1. What changed

The checkout model is **server-driven redirect, not an embedded SDK**. Concretely:

- The client never loads Razorpay's Checkout.js or any Razorpay SDK.
- The client never sees a Razorpay key, order ID, or signature.
- The client's only job after starting a payment is: **take the `redirectUrl` the server gives you and send the browser there with a full-page redirect** (`window.location.href = redirectUrl`), not a popup/modal.
- The client never verifies a payment itself. There is no `POST /payments/verify` — that endpoint has been removed entirely.

If you have any existing Razorpay Checkout.js integration (a `<script src="checkout.razorpay.com/...">`, a `new Razorpay(options).open()` call, or a client-side "verify payment" call), **remove it**. None of it is used by this flow.

## 2. The flow, end to end

```
1. Client: GET /plans or GET /services  →  pick a product, note its productId
2. Client: POST /orders                 →  server validates + prices the order
3. Client: POST /payments/{orderId}/create  →  server creates a Razorpay Payment Link
4. Client: window.location.href = redirectUrl   (full-page redirect, not a modal)
5. Customer pays on Razorpay's hosted page
6. Razorpay redirects the browser to our server, which redirects again to:
     {frontend}/payments/result?orderId=...&status=...
7. Client: render /payments/result based on the status query param (Section 5)
```

Step 6 is **not** something the client calls — it's the server's callback endpoint (`GET /api/v1/payments/callback`) redirecting the browser onward. The only thing the client needs to build for that step is the landing page itself, at whatever route you configure as `COMMERCE_RETURN_BASE_URL` + `/payments/result` on the backend.

A webhook (server-to-server, invisible to the client) is the authoritative confirmation and can complete the payment even if the browser never makes it back to step 6 (closed tab, flaky connection, etc.) — the client's UI should account for that possibility (Section 5).

## 3. API reference

All endpoints are under `/api/v1`. Authenticated ones need `Authorization: Bearer <accessToken>`.

### 3.1 `GET /plans` — public

Query: `?audience=FREE|PREMIUM|BROKER` (optional).

```json
{
  "success": true,
  "data": [
    {
      "id": "b0000000-...",
      "productId": "a0000000-...",
      "code": "PREMIUM_30",
      "name": "Premium 30 Days",
      "planType": "PREMIUM",
      "amountMinor": 99900,
      "currency": "INR",
      "durationDays": 30,
      "listingLimit": 5,
      "featuredDays": 7,
      "verificationIncluded": true,
      "features": { "badge": "PREMIUM" },
      "isActive": true,
      "billingMode": "ONE_TIME"
    }
  ]
}
```

**Use `productId`, not `id`, when placing an order** — `id` is the plan's own catalog row, `productId` is what `POST /orders` needs. (This field was missing from the public response until today; if you're reading an older capture of this endpoint's shape, re-check against a live call.)

**Only show a "Buy" action for `billingMode: "ONE_TIME"` plans right now.** A `RECURRING` plan will be rejected by `POST /orders` (Section 6) — there's no purchase path for it yet.

### 3.2 `GET /services` / `GET /services/{serviceId}` — public

Query on the list: `?type=LEGAL_REVIEW|TITLE_SEARCH|VALUATION|LOAN_ASSISTANCE|REGISTRATION`.

```json
{
  "id": "d0000000-...",
  "productId": "a0000000-...",
  "code": "TITLE_SEARCH_STD",
  "serviceType": "TITLE_SEARCH",
  "name": "Standard Title Search",
  "amountMinor": 499900,
  "requiresProperty": true,
  "requiresDocuments": false,
  "isActive": true
}
```

Same rule: **use `productId` for ordering, not `id`.**

### 3.3 `POST /service-requests` — auth required (services only)

A paid service is a two-step purchase: create the (unpaid) service request first, then order it.

```json
// Request
{
  "serviceId": "d0000000-...",       // the ServiceItem's own id, NOT productId
  "propertyId": "uuid|null",          // required if the service's requiresProperty is true
  "listingId": "uuid|null",
  "customerNotes": "string|null",
  "contactPhone": "+91...|null",
  "contactEmail": "string|null"
}
```

Response is a `ServiceRequest` with `status: "REQUESTED"` and `orderId: null`. Keep its `id` — that's the `targetId` for the order in the next step.

### 3.4 `POST /orders` — auth required

```json
// Request
{
  "items": [
    { "productId": "uuid", "quantity": 1 }
  ],
  "organizationId": "uuid|null"
}
```

`items[].quantity` defaults to `1` if omitted. Per product type:

| Buying a... | `targetType` | `targetId` |
|---|---|---|
| Plan | omit both | omit both |
| Promotion (boost a listing) | `"LISTING"` | the listing's id — **must be a listing you own**, or a 409 `TARGET_NOT_OWNED` comes back |
| Paid service | `"SERVICE_REQUEST"` | the `ServiceRequest.id` from step 3.3 — **must belong to you and be unpaid**, or a 409 `SERVICE_REQUEST_NOT_PAYABLE` comes back |

`targetType` and `targetId` must be sent together or not at all — sending one without the other is a 400.

Response is the `Order` (id, orderNumber, status `CREATED`, items, subtotalMinor/taxMinor/totalMinor, currency, createdAt, paidAt). The server computes every amount — nothing about price is client-controlled.

Notable rejections:
- `400 INVALID_PRODUCT` — productId doesn't exist or isn't active.
- `409 PLAN_REQUIRES_SUBSCRIPTION` — you tried to order a `RECURRING` plan through this endpoint (Section 6).
- `409 TARGET_NOT_OWNED` / `409 SERVICE_REQUEST_NOT_PAYABLE` — ownership checks above.
- `403 ORGANIZATION_ACCESS_DENIED` — `organizationId` sent but you're not an active member.

### 3.5 `POST /payments/{orderId}/create` — auth required, order owner only

```json
// Request
{ "provider": "RAZORPAY" }   // optional, RAZORPAY is the only supported value and the default
```

```json
// Response
{
  "paymentId": "uuid",
  "provider": "RAZORPAY",
  "redirectUrl": "https://rzp.io/rzp/xxxxxxx"
}
```

**This is the only field you act on: redirect the browser to `redirectUrl`.** There is no key, no checkout payload, nothing else to configure client-side.

```js
const { data } = await createPayment(orderId);
window.location.href = data.redirectUrl; // full page navigation — do not open in a popup/iframe
```

Calling this endpoint again for the same order (e.g. the customer went back and retried) is safe — the previous attempt is invalidated server-side and a fresh Payment Link is issued.

Rejections: `409 ORDER_ALREADY_PAID`, `409 ORDER_NOT_PAYABLE` (order isn't in `CREATED`/`PAYMENT_PENDING`).

### 3.6 The result page — you build this, nothing calls it as an "API"

After payment, the browser eventually lands on:
```
{your frontend}/payments/result?orderId=<uuid>&status=<value>
```
Build a route at `/payments/result` that reads these two query params. See Section 5 for what to render per `status`.

### 3.7 Endpoints that exist but the client never calls

- `GET /api/v1/payments/callback` — Razorpay/the browser hits this, not you.
- `POST /api/v1/payments/webhook` — server-to-server only.

## 4. Checking order/payment status directly

Useful for the `pending` case (Section 5) or a "my orders" screen:

- `GET /orders/{orderId}` — auth, owner or admin.
- `GET /orders/me?status=PAID` — auth, paginated (`page`, `limit`).

`Order.status` becomes `PAID` once capture completes, whether that happened via the redirect or via the webhook racing ahead of it.

## 5. Handling `/payments/result?status=...`

| `status` value | Meaning | Suggested UI |
|---|---|---|
| `success` | Captured, entitlement applied | Show success, link to "My Orders" / the promoted listing / the service request |
| `pending` | Signature/lookup was fine but capture didn't finish synchronously (rare — e.g. a transient DB hiccup). The webhook will complete it shortly. | "Confirming your payment…" — poll `GET /orders/{orderId}` every few seconds until `status: "PAID"`, with a reasonable timeout (e.g. give up after ~30s and tell the user to check "My Orders" later) |
| `invalid` | Signature didn't verify, or the payment reference is unknown | Treat as failed — do **not** imply the payment succeeded. Offer to retry from the order. |
| anything else (e.g. `cancelled`, `expired`) | Razorpay's own Payment Link status, passed through as-is | Treat as not-paid; offer to retry (`POST /payments/{orderId}/create` again) |

Never trust the query string alone to mean "paid" in your own business logic beyond driving which screen to show — always treat `GET /orders/{orderId}` as the source of truth if you need to gate anything (e.g. don't unlock a UI feature just because `status=success` was in the URL; confirm the order is `PAID` first).

## 6. Not available yet — don't build against these

- **Recurring/auto-charge plan subscriptions.** A plan's `billingMode` can be `RECURRING`, but there is no `POST /subscriptions` endpoint yet — ordering a `RECURRING` plan is rejected with `409 PLAN_REQUIRES_SUBSCRIPTION`. Only show `ONE_TIME` plans as purchasable for now.
- **Refunds.** No client-facing refund endpoints exist yet.
- **A "list promotions" endpoint.** There's currently no public API to discover promotion products (their `productId`, price, or which listing-boost types exist) — the checkout mechanics for promotions work (Section 3.4's table), but the catalog discovery endpoint doesn't exist yet. Confirm with backend how promotion product IDs will be surfaced before building that screen.

## 7. Quick reference: full example (buying a plan)

```js
// 1. Discover
const plans = await api.get("/plans?audience=PREMIUM");
const plan = plans.data[0];

// 2. Order
const order = await api.post("/orders", {
  items: [{ productId: plan.productId, quantity: 1 }]
});

// 3. Payment
const payment = await api.post(`/payments/${order.data.id}/create`, {});

// 4. Redirect — this is the entire "integrate with Razorpay" step on the client
window.location.href = payment.data.redirectUrl;

// 5. On /payments/result, read ?orderId & ?status and render per Section 5
```

A working Postman collection with all of these calls (including the promotion/service target examples) is in `postman/Zameens-Dev2.postman_collection.json` under **Commerce**.
