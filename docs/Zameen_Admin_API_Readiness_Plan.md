# ZAMEENS
## Admin Frontend Readiness — Gap Analysis & API Plan
Cross-checked against `src/**`, `README.md`, `cors.json`, and `postman/Zameens-Admin.postman_collection.json`

**Audience:** Backend Dev 1 • Backend Dev 2 • DevOps • Admin UI
**Version:** 1.0 | **Base doc:** `docs/Zameen_API_PLAN_FULL.md` (Phase 1 contract)

> **Purpose:** The admin frontend team reported 9 blockers. This document verifies each one against the current codebase (not assumptions), separates **infra/ops** work from **backend code** work, and specifies the exact endpoints/fields to add for the code gaps. Every "gap" claim below cites the file(s) that prove it.

---

## 0. Status at a glance

| # | Item | Verdict | Type |
|---|---|---|---|
| 1 | API reachable at `34.133.120.182:8080` | **Cannot verify/fix from this repo** — no infra-as-code checked in | Infra |
| 2 | HTTPS + production CORS | **Confirmed gap** — app serves plain HTTP; CORS is env-driven and allowlist is empty by default | Infra + config |
| 3 | Admin OTP login works end-to-end | **Confirmed gap in prod** — OTP delivery and admin provisioning both require manual setup that isn't done by the schema/seed | Infra + runbook |
| 4 | Admin ad list/detail reads | **Confirmed gap** — only create/update/delete exist | Backend code |
| 5 | Admin plans catalogue (incl. inactive) | **Confirmed gap** — public `/plans` filters `is_active = true`; no admin read | Backend code |
| 6 | Admin content list/detail (draft/archived) | **Confirmed gap** — public `/content` filters `status = 'PUBLISHED'`; no admin read | Backend code |
| 7 | Managed uploads for content covers / ad creatives | **Confirmed gap**; service-request report upload-ticket for admin is also missing | Backend code |
| 8 | Dashboard aggregate endpoint | **Confirmed gap** — only `/seller/dashboard` (seller-scoped) exists | Backend code |
| 9 | Contract verification (envelopes, field names, 409s) | **Confirmed gap** — the documented `error.details[]` shape is used in ~1 of 22 validation modules; 409s never return a resource snapshot | Backend code + doc |

---

## 1. Make the API reachable — Infra

**What the code shows:** `src/index.js` calls `app.listen(port, "0.0.0.0", ...)` — a plain Node HTTP listener, no reverse proxy, no process manager config checked into the repo. `package.json` references `deployment/Dockerfile`, but no `deployment/` directory exists in this checkout, so the production topology (Cloud Run / GCE / GKE / Nginx in front) isn't discoverable from source. `34.133.120.182` is a bare external IP typical of a GCE VM or an unfronted GKE `LoadBalancer` Service.

**This cannot be diagnosed or fixed from the codebase alone.** Hand this checklist to whoever owns the GCP project:

- [ ] Confirm the Node process is actually running on the target host (`pm2 status` / `systemctl status` / `docker ps`, whichever applies) and listening on port 8080.
- [ ] Confirm a firewall rule allows ingress on `tcp:8080` from the admin frontend's egress IP/range (GCP firewall rules are default-deny for custom ports).
- [ ] If a GCP Load Balancer or Cloud Run front-end is expected, confirm the backend service / NEG / URL map actually points at this instance and health checks are passing.
- [ ] Confirm `PORT`/`NODE_ENV` env vars on the box match what's expected (`src/config/env.js`).

## 2. Enable HTTPS + production CORS — Infra + config

**HTTPS:** Confirmed there is no TLS termination inside the app (`src/index.js`, `src/config/express.config.js` — plain `express()` + `helmet()`, no `https.createServer`). TLS must terminate in front of the app (Nginx, GCP Load Balancer w/ managed cert, Cloud Run, etc.) — this is an infra decision, not a code change.

**CORS is already implemented as an env var, but is closed by default.** From `src/config/cors.config.js`:

```js
const allowedOrigins = new Set(
  String(process.env.CORS_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean)
);
// requests from an origin not in this set get a 403 CORS_ORIGIN_DENIED
```

`cors.json` at the repo root only lists `http://localhost:3000` / `http://localhost:5173` — that file is not even the one `cors.config.js` reads (it reads `process.env.CORS_ORIGINS`, not `cors.json`); `cors.json` looks like a stale/unused GCS-bucket-CORS-style artifact and is worth deleting or clarifying so it doesn't mislead whoever configures prod.

**Action items:**
- [ ] Set `CORS_ORIGINS` in the production environment to a comma-separated list including the admin frontend's HTTPS origin (e.g. `https://admin.zameens.com`).
- [ ] Confirm `credentials: true` (already set) is compatible with how the admin frontend sends the bearer token — since auth here is `Authorization: Bearer`, not cookies, `credentials: true` is likely unnecessary but harmless; flag if the frontend expects cookie-based refresh (`RefreshRequest` in the base doc allows either).
- [ ] Delete or repurpose the root `cors.json` if it isn't consumed anywhere (grep confirms only GCS bucket tooling would read that filename convention; `cors.config.js` never imports it).

## 3. Validate admin authentication — Infra runbook + one thing to test

Two production gates block this today, both documented in `README.md` §"Production prerequisites" but easy to miss:

1. **OTP delivery is disabled in production until a provider is wired up.** `src/modules/auth/otp.provider.js`:
   ```js
   export const otpDeliveryConfigured = () =>
     (mode === "console" && nonProduction) ||
     (mode === "webhook" && Boolean(webhookUrl));
   ```
   `console` mode (which just logs the OTP) is hard-disabled outside `development`/`test`. In production, `OTP_DELIVERY_MODE=webhook` **and** `OTP_PROVIDER_WEBHOOK_URL` must point at a real SMS/email gateway, or every `/auth/otp/request` call 503s with `OTP_PROVIDER_UNCONFIGURED`.
   - [ ] Confirm `OTP_DELIVERY_MODE=webhook` and `OTP_PROVIDER_WEBHOOK_URL` are set in prod and the webhook actually delivers to `+919876511111`.

2. **There is no default administrator.** `README.md`: *"Provision the first administrator through a controlled database runbook after that user has completed verification; the schema does not create a default administrator."* `scripts/seed-demo-data.js` only inserts an `ADMIN`-sourced **property** row, not an admin **user** — there is no seed script that grants the `ADMIN` role to a phone number.
   - [ ] Have `+919876511111` complete one normal OTP login first (this creates/updates the `auth.users` row), then run the DB runbook to attach the `ADMIN` role via `auth.user_roles` (see `src/modules/users/users.repository.js` for the `ON CONFLICT DO NOTHING` insert pattern used elsewhere — the runbook should follow the same table).
   - [ ] After that, verify `GET /users/me/roles` returns `ADMIN` for that session before handing the token to the admin frontend.

3. **Refresh / logout / logout-all already exist and match the documented contract** (`src/modules/auth/auth.routes.js`: `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, all wired to `AuthService`). No code gap here — just confirm behavior once step 1–2 unblock a real admin session. Postman collection has no dedicated Auth folder; recommend adding one (see §7).

---

## 4. Advertisement administration reads — Backend code gap

**Evidence:** `src/modules/ads/ads.admin.routes.js` only registers `POST /ads`, `PATCH /ads/:adId`, `DELETE /ads/:adId`. The only read path is the public `GET /ads?placement=` (`ads.routes.js` → `ads.controller.js: list` → `service.listActive`), which is placement + active-window scoped and cannot return `INACTIVE`/`SCHEDULED`/`EXPIRED` rows for management screens.

**Existing precedent to copy:** `src/modules/channel-partners/channel-partners.admin.routes.js` already has exactly this shape (`GET /channel-partners`, `GET /channel-partners/:partnerId`, then action routes) — use it as the template.

### Proposed endpoints

| Method | Endpoint | Auth / Role | Request model | Response / UI use |
|---|---|---|---|---|
| GET | /admin/ads | ADMIN | AdminAdListQuery | AdAdmin[] + PaginationMeta |
| GET | /admin/ads/{adId} | ADMIN | path adId | AdAdmin |

**AdminAdListQuery**

| Field | Type | Required | Validation / enum | Description |
|---|---|---|---|---|
| page | integer | No | >=1 | Pagination. |
| limit | integer | No | 1-100 | Page size. |
| status | string\|null | No | ACTIVE/INACTIVE/SCHEDULED/EXPIRED | Lifecycle filter; omit = all. |
| placement | string\|null | No | HOME_TOP/SEARCH_TOP/PROPERTY_SIDEBAR/CONTENT | Placement filter. |
| search | string\|null | No | <=200 | Name search. |

**AdAdmin**

| Field | Type | Required | Validation / enum | Description |
|---|---|---|---|---|
| id | uuid | Yes | Read-only | Ad ID. |
| name | string | Yes | | Name. |
| placement | string | Yes | enum | Placement. |
| imageUrl | url | Yes | Read-only signed/public URL | Resolved from `imageStorageKey`. |
| imageStorageKey | string | Yes | Read-only | Raw storage key (admin-only field, not returned by the public endpoint). |
| targetUrl | url\|null | No | | Click-through target. |
| startsAt | datetime | Yes | | Window start. |
| endsAt | datetime | Yes | | Window end. |
| status | string | Yes | ACTIVE/INACTIVE/SCHEDULED/EXPIRED | Stored status (the value set on create/update, not a derived one). |
| createdAt | datetime | Yes | | Created. |
| updatedAt | datetime\|null | No | | Last updated. |

Note: `status` in the schema is admin-set, not auto-computed from `startsAt`/`endsAt` — `SCHEDULED`/`EXPIRED` only appear if an admin sets them. If the intent of "scheduled/expired" is date-derived, that's a separate product decision to raise with the team before building the filter — flagging so the query semantics aren't assumed silently.

---

## 5. Plan administration reads — Backend code gap

**Evidence:** `src/modules/commerce/commerce.repository.js`:
```js
export const listActivePlans = planType =>
  run("any", `... WHERE pr.is_active = true AND pr.type = 'PLAN' ...`, [planType]);
```
`GET /plans` (public) hard-filters `is_active = true`. There is no query path that returns inactive plans, and `commerce.admin.routes.js` only has `POST /plans`, `PATCH /plans/:planId`, `.../activate`, `.../deactivate` — all writes, no reads.

### Proposed endpoints

| Method | Endpoint | Auth / Role | Request model | Response / UI use |
|---|---|---|---|---|
| GET | /admin/plans | ADMIN | AdminPlanListQuery | PlanAdmin[] + PaginationMeta |
| GET | /admin/plans/{planId} | ADMIN | path planId | PlanAdmin |

**AdminPlanListQuery**

| Field | Type | Required | Validation / enum | Description |
|---|---|---|---|---|
| page | integer | No | >=1 | Pagination. |
| limit | integer | No | 1-100 | Page size. |
| planType | string\|null | No | FREE/PREMIUM/BROKER | Filter. |
| isActive | boolean\|null | No | | Omit = both active and inactive. |
| search | string\|null | No | <=200 | Code/name search. |

**PlanAdmin** — all fields from the base doc's `Plan` model (§5.6) plus:

| Field | Type | Required | Validation / enum | Description |
|---|---|---|---|---|
| productId | uuid | Yes | Read-only | Underlying `commerce.products` row (useful for order/report reconciliation). |
| createdAt | datetime | Yes | Read-only | Created. |
| updatedAt | datetime\|null | No | Read-only | Last updated. |

---

## 6. Content administration reads — Backend code gap

**Evidence:** `src/modules/content/content.repository.js`:
```sql
WHERE ci.deleted_at IS NULL AND ci.status = 'PUBLISHED'   -- list()
WHERE ci.deleted_at IS NULL AND ci.status = 'PUBLISHED' AND ct.slug = $1  -- findPublishedBySlug()
```
Both public read paths are hard-filtered to `PUBLISHED`. `content.admin.routes.js` only has create/update/delete/publish/archive — no list or detail, so an admin cannot see `DRAFT` content before publishing it, or `ARCHIVED` content after.

### Proposed endpoints

| Method | Endpoint | Auth / Role | Request model | Response / UI use |
|---|---|---|---|---|
| GET | /admin/content | ADMIN | AdminContentListQuery | ContentAdminCard[] + PaginationMeta |
| GET | /admin/content/{contentId} | ADMIN | path contentId | ContentAdminDetail |

**AdminContentListQuery**

| Field | Type | Required | Validation / enum | Description |
|---|---|---|---|---|
| page | integer | No | >=1 | Pagination. |
| limit | integer | No | 1-100 | Page size. |
| status | string\|null | No | DRAFT/PUBLISHED/ARCHIVED | Omit = all statuses. |
| type | string\|null | No | ContentType | Filter. |
| language | string\|null | No | supported language | Which translation to project into the card; default `en`. |
| search | string\|null | No | <=200 | Title/body search. |

**ContentAdminCard** — same as `ContentCard` (base doc §5.8) plus `status` (already conditionally present in `ContentDetail` for admin responses, but not on the card — promote it to always-present here since this is an admin-only list).

**ContentAdminDetail** — same as `ContentDetail`, but `translations: object[]` (every language row, not just the resolved one) instead of a single resolved `body`, so the admin UI can edit any language without a second call.

Note the DB already has everything needed (`content.content_translations` keyed by `content_id, language_code` with `ON CONFLICT ... DO UPDATE` upsert — `content.repository.js:97`), so this is a read-only addition, no schema change.

---

## 7. Managed file uploads — Backend code gap (partial)

**What already exists and is fine:**
- Property media/documents: `POST /properties/:propertyId/media/upload-url` + `/complete`, and the documents equivalent (`properties.routes.js`).
- Service-request files **from the requester side**: `POST /service-requests/:requestId/files/upload-url` + `/files/complete` (`commerce.routes.js`), backed by `createServiceRequestStorageKey` (`utils/storage.js`).

**What's missing:**

1. **Content cover images** — `content.admin.routes.js` create/update accept `coverStorageKey` directly (per the Postman body: `"coverStorageKey": null`), but there is no endpoint that hands the admin a signed upload URL for it. The admin has no way to obtain a valid `coverStorageKey` other than knowing the storage convention out-of-band.
2. **Advertisement creatives** — same issue: `ads.admin.routes.js` create takes `imageStorageKey` as a plain string with no upload-ticket step.
3. **Service-request reports (admin side)** — `POST /admin/service-requests/:requestId/report` (`commerce.admin.routes.js`) takes a raw `storageKey` in the body, but there is no `POST /admin/service-requests/:requestId/report/upload-url` for the admin to get a signed URL to actually put the report file there. Today only the *requester* has an upload-ticket flow (`files/upload-url`), not the admin producing the report.

**Fix — extend `src/utils/storage.js` with two more key-namespacing helpers** (mirroring `createStorageKey`/`createServiceRequestStorageKey`) and three new route pairs:

| Method | Endpoint | Auth / Role | Request model | Response / UI use |
|---|---|---|---|---|
| POST | /admin/content/media/upload-url | ADMIN | FileUploadInit | UploadTicket |
| POST | /admin/content/media/complete | ADMIN | MediaComplete-style (storageKey, mimeType, fileSizeBytes) | `{ coverStorageKey, coverUrl }` — feed `coverStorageKey` into create/update content |
| POST | /admin/ads/media/upload-url | ADMIN | FileUploadInit | UploadTicket |
| POST | /admin/ads/media/complete | ADMIN | storageKey, mimeType, fileSizeBytes | `{ imageStorageKey, imageUrl }` |
| POST | /admin/service-requests/{requestId}/report/upload-url | ADMIN | FileUploadInit | UploadTicket |

All three reuse `signedWriteUrl()` (already generic, keyed only by `storageKey`/`mimeType`) — the only new code is a `createContentStorageKey`/`createAdStorageKey`/`createServiceReportStorageKey` prefix function each, plus route + controller wiring identical to the existing property-media pattern. No new infra dependency (same GCS bucket, same signing mechanism).

---

## 8. Dashboard aggregate endpoint — Backend code gap

**Evidence:** `src/modules/seller-dashboard/` exists and is wired at `GET /seller/dashboard`, but it's role-gated to `SELLER, BROKER, DEVELOPER, ADMIN` and returns **seller-scoped** metrics (`activeListings`, `newEnquiries`, etc. — base doc §5.5). There is no admin-scoped aggregate. Today the admin frontend must be composing this from 5 separate calls, exactly as reported: `GET /admin/listings?reviewStatus=PENDING`, `GET /admin/verifications?status=PENDING`, `GET /admin/users?status=ACTIVE`, `GET /admin/service-requests?status=REQUESTED`, `GET /admin/channel-partners?status=PENDING` — all of which already exist individually, so this is purely an aggregation endpoint, not new data.

### Proposed endpoint

| Method | Endpoint | Auth / Role | Request model | Response / UI use |
|---|---|---|---|---|
| GET | /admin/dashboard | ADMIN | none | AdminDashboardSummary |

**AdminDashboardSummary**

| Field | Type | Required | Validation / enum | Description |
|---|---|---|---|---|
| pendingListings | integer | Yes | Read-only | Count of `admin.listings` with `reviewStatus = PENDING`. |
| pendingVerifications | integer | Yes | Read-only | Count of `admin.verifications` with `status = PENDING`. |
| activeUsers | integer | Yes | Read-only | Count of `auth.users` with `status = ACTIVE`. |
| requestedServices | integer | Yes | Read-only | Count of `commerce.service_requests` with `status = REQUESTED`. |
| pendingChannelPartners | integer | Yes | Read-only | Count of `channel_partners` with `status = PENDING`. |
| generatedAt | datetime | Yes | Read-only | Snapshot time; UI can show staleness/refresh affordance. |

**Implementation note:** each count already has a backing repository query used by the corresponding list endpoint's `total` (in `PaginationMeta`) — this endpoint can just run five `COUNT(*)` queries (ideally via `Promise.all`) rather than duplicating filter logic, or a single `UNION ALL` query if a DB round-trip matters more than readability. Either is a same-day change; no new tables.

---

## 9. Contract verification — Backend code + doc gap

### 9.1 Response envelope

`src/shared/http.js` (`ok`, `created`, `fail`) matches the documented `{ success, data, meta }` / `{ success, error }` shape consistently — **this part is fine** across the codebase.

### 9.2 Validation errors do not consistently populate `error.details[]`

The base doc (§1.3) specifies:
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...",
  "details": [{"field": "priceAmountMinor", "message": "Must be greater than zero"}] } }
```
In practice, **hand-rolled validators across the codebase throw a single `HttpError(status, code, message)` per bad field**, with no `details` array — e.g. `src/modules/ads/ads.validation.js`:
```js
throw new HttpError(400, `INVALID_${field}`, `${field} must be between ${min} and ${max} characters.`);
```
`src/middlewares/error.js` only attaches `details` when `err.details` or `err.errors?.details` is already an array — which almost nothing sets. Grepping the codebase, **only `catalog.validation.js`** builds a `{ field, message }` details array; the other 21 `*.validation.js` files (ads, commerce, content, listings, properties, users, verification, auctions, investment-opportunities, channel-partners, …) all throw single-field `HttpError`s with the field name folded into `code` (e.g. `INVALID_NAME`, `INVALID_STARTS_AT`) instead of a stable `field` property.

**Practical effect on the admin UI:** it cannot generically bind an error to a form field via `error.details[].field` for most endpoints today — it would need a code-to-field mapping table per endpoint, or parse `error.code`. Two ways to close this, pick one:

- **(a) Minimal:** standardize on returning `field` in every `HttpError`'s payload (`new HttpError(400, code, message, [{ field: "name", message }])`) — mechanical, touches every validator, no architecture change, and `error.js` already knows how to surface `details` once populated.
- **(b) Structural:** introduce one small validation helper (a thin wrapper, not full Joi/express-validation — that dependency is already imported in `error.js` but effectively unused/dead) that all `*.validation.js` files call through, so `field` is derived automatically from the value being checked. More consistent long-term, bigger diff.

Recommend (a) for Phase 1 — smaller, reversible, and doesn't block the admin frontend items above.

### 9.3 409 Conflict responses never include a resource snapshot

Every 409 in the codebase (`listings.service.js`, `content.service.js`, `commerce.service.js`, `verification.service.js`, `investment-opportunities.service.js`, `site-visits.service.js`, …) throws `HttpError(409, CODE, message)` with **no current-state payload** — e.g. `listings.service.js`:
```js
throw new HttpError(409, "LISTING_UPDATE_CONFLICT", "The listing changed before this update could be applied.");
```
The base doc doesn't specify a conflict-data shape either, so this matches "the contract" as written — but it does **not** satisfy the requester's actual goal ("enough information to refresh stale records"). Today, on a 409 the admin UI's only option is a **separate GET** to re-fetch the record before retrying.

**Recommendation:** don't change 409 semantics broadly (it's used in ~10 modules and changing payload shape is a contract change), but explicitly document in the base doc that **409 is always paired with a GET-to-refresh pattern**, and confirm every 409-capable resource (listings, content, plans, verifications, investment opportunities, channel partners, auctions) has a corresponding single-resource GET the UI can call immediately after a 409. Cross-checking against §4–§6 above: this is why the admin ads/plans/content GET-by-id endpoints proposed there aren't just "nice to have" — without them, a 409 on those resources is currently unrecoverable without re-listing.

### 9.4 Stable field names — everything else

Outside of validation `details` (9.2), field naming (`camelCase` in, `snake_case` in DB) is applied consistently across the modules reviewed — no additional gap found there.

---

## 10. Same-pattern gaps found while checking, not explicitly requested

Not in the original 9 items, but the same "write-only admin module" pattern also applies to:
- `investment-opportunities.admin.routes.js` — create/update/publish/close only, no list/detail.
- `auctions.admin.routes.js` — create/update/delete only, no list/detail.

Flagging for awareness; recommend the same fix pattern (§4–§6) be applied there in a follow-up pass so all admin domains are consistent, but scoping that decision to the team since it wasn't part of the reported blockers.

---

## 11. Postman collection updates needed

`postman/Zameens-Admin.postman_collection.json` currently mirrors the code 1:1 (including its gaps) — it has **no** requests for: admin ad list/detail, admin plan list/detail, admin content list/detail, any upload-ticket flow, or a dashboard endpoint, and no dedicated **Auth** folder (OTP request/verify/refresh/logout) even though the collection description says every admin endpoint requires a bearer token obtained via `/auth/otp/verify`. Once §4–§8 are implemented, add matching requests; in the meantime, add:

- [ ] An **Auth** folder: `POST {{baseUrl}}/auth/otp/request`, `POST {{baseUrl}}/auth/otp/verify` (writes `adminAccessToken` via a test script), `POST {{baseUrl}}/auth/refresh`, `POST {{baseUrl}}/auth/logout`, `POST {{baseUrl}}/auth/logout-all` — so the collection is actually runnable end-to-end instead of assuming the token is pasted in manually.
- [ ] `GET {{baseUrl}}/admin/ads` and `GET {{baseUrl}}/admin/ads/{{adId}}` (once built).
- [ ] `GET {{baseUrl}}/admin/plans` and `GET {{baseUrl}}/admin/plans/{{planId}}` (once built).
- [ ] `GET {{baseUrl}}/admin/content` and `GET {{baseUrl}}/admin/content/{{contentId}}` (once built).
- [ ] `GET {{baseUrl}}/admin/dashboard` (once built).
- [ ] Upload-ticket requests for content cover / ad creative / service-report (once built).
