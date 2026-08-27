# Zameens Backend Development Guide

This is the working guide for backend contributors. It describes the running
codebase. [architecture.md](./architecture.md) remains the wider product and
platform plan.

## Runtime and setup

- Node.js, Express, ES modules, PostgreSQL 14+, and PostGIS.
- `src/index.js` starts the server.
- `src/routes/v1/index.js` composes the `/api/v1` API.
- `src/database/schema.sql` is the canonical clean-install schema.

The current implementation is Express and JavaScript. Do not introduce NestJS,
TypeScript, or another server framework without an approved migration plan.

1. Create `.env` from `.env.example` and set database credentials, `JWT_SECRET`,
   and a different `TOKEN_PEPPER`. Set either the individual `DB_HOST`, `DB_PORT`,
   `DB`, `DB_USER`, and `DB_PASSWORD` values, or use `DATABASE_URL` for Cloud SQL;
   `DATABASE_URL` takes precedence when present. Set `DB_SSL=true` when your
   Cloud SQL connection requires TLS. `DB_SSL_REJECT_UNAUTHORIZED=false` is a
   local-development fallback only; never use it for staging or production.
2. Create a new PostgreSQL database with privileges for `pgcrypto`, `citext`,
   `postgis`, and `pg_trgm`.
3. During initial development, recreate an existing development database and run
   `npm run db:schema` once.
4. Run `npm start`, then call `GET /api/v1/status`.

`npm run db:schema` is a clean-install command. It refuses to run when
`auth.users` already exists, so it cannot overwrite an existing canonical
database. Never use it as a migration command.

`npm start` never creates or migrates database objects. This is intentional:
application instances must not race to mutate a shared production database at
boot. Run the appropriate database command as an explicit deployment step:

```bash
# Brand-new database only
npm run db:schema

# Future shared/staging database only: apply forward-only migrations
npm run db:migrate

# Then start the API
npm start
```

### Loading the India location hierarchy

The location hierarchy is operational data, not schema seed data. The
canonical schema is created first; LGD data is then loaded explicitly. Do not
put a national data dump in `schema.sql`, do not load it on application startup,
and do not commit downloaded source workbooks or generated CSV files.

Download the four LGD exports (states, districts, sub-districts and villages)
into the ignored `locations_data/` directory, then run:

```bash
npm run locations:prepare
npm run locations:check
npm run locations:import
```

`locations:prepare` uses Python 3 with `openpyxl` to stream the LGD `.xlsx`
workbooks into ignored CSV files. `locations:check` validates every hierarchy
reference and makes no database change. `locations:import` repeats that
preflight and writes only when given its explicit `--apply` flag. It is
idempotent: LGD code-based reserved slugs preserve the import identity, and a
new LGD download updates the matching names instead of duplicating locations.
Install the one data-tool dependency with `python3 -m pip install openpyxl` if
it is not already available on the machine that runs `locations:prepare`.

The API contract uses two-letter state/UT codes such as `MH`; the loader maps
the numeric LGD state code to that value and propagates it to every imported
descendant, so `GET /locations/search?stateCode=MH` works. The LGD exports do
not contain PIN-to-location relationships, city/locality curation, or map
coordinates. Load those through separately verified India Post and geocoding
data processes; do not infer them from village records.

When supplied, the same preparation command also normalizes
`locations_data/pincode.csv`.
Use `npm run pincodes:check` before `npm run pincodes:import` when only the
PIN data changes. Each PIN is stored once and linked only to an exact,
normalized state-and-district match in the LGD hierarchy. A PIN that appears
under more than one valid state is retained with a null `stateCode`; unmatched
or incomplete source labels are retained as PINs but are not linked to a
location. Post-office latitude/longitude is intentionally not assigned to a
district, because it describes one office rather than the whole district.

## Source layout

```text
src/
  config/       application, environment, CORS, and database setup
  database/     canonical clean-install schema
  middlewares/  cross-cutting Express middleware only
  modules/      business features
  routes/v1/    versioned route composition only
  shared/       shared HTTP, database, and authorization helpers
  utils/        low-level infrastructure helpers
```

Each feature belongs in `src/modules/<feature>/`:

```text
<feature>/
  <feature>.routes.js       endpoint path and middleware declaration only
  <feature>.controller.js   HTTP request/response mapping only
  <feature>.service.js      business rules, workflows, authorization rules
  <feature>.repository.js   SQL and database calls only
  <feature>.validation.js   request parsing and validation only
```

Rules:

- Do not add endpoint logic to `src/routes/v1/index.js`; it only mounts modules.
- Only a repository may import `src/shared/db.js`; only that helper imports
  `src/utils/postgres_store.js`.
- Controllers use `asyncRoute` and the helpers in `src/shared/http.js`.
- Services throw `HttpError(status, code, message)` for expected business errors.
- Do not expose SQL errors, tokens, OTPs, stacks, or secrets in responses.

`auth`, `users`, `catalog`, `properties`, `listings`, `discovery`,
`verification`, and `ai` follow this structure.
Every new Developer 1 module must use the same five-layer pattern from its
first endpoint; do not add compatibility route files or bypass a repository.

Discovery owns listing search, map pins, similarity and comparison. The `ai`
module uses the OpenAI Responses API for structured natural-language filter
extraction, grounded conversation replies, and listing-copy drafts. The service
resolves every extracted filter against Zameens master data and then uses the
normal discovery service; the model never queries the database or decides
authorization. An anonymous AI conversation returns a `guestAccessToken`;
clients must send it as `X-AI-Conversation-Token` on later message/detail
requests. Do not put that token in a URL or log it. Chat replies are streamed
from the existing `POST /ai/conversations/:conversationId/messages` endpoint as
SSE: `message.delta` events are transient UI text and `message.completed`
contains the persisted `AiMessage`; an SSE `error` is not a saved answer. The
full event contract is in `Zameens_Phase1_UI_API_Integration_Specification.txt`.
Signed-in users load their retained chat history through paginated `GET
/ai/conversations`; anonymous conversations remain accessible only with their
guest conversation token.

AI setup is explicit: set `OPENAI_API_KEY` as a server-side secret, then restart the
API process so it receives the changed environment. `OPENAI_MODEL`
defaults to `gpt-5-mini` and may be changed per environment. Model responses use
`store: false`; requests are rate-limited and provider failures return
`AI_PROVIDER_UNCONFIGURED` or `AI_PROVIDER_UNAVAILABLE` without exposing model
or provider details. The assistant can answer property, land/area, market-trend
and published investment-opportunity questions from published listing, master,
content and trend data. Do not add private property documents or account data;
financial, legal and valuation guidance must remain clearly general and direct
the user to a qualified professional.

## API contract

All endpoints are under `/api/v1`. JSON endpoints use the envelope below; the
documented AI chat message endpoint is the intentional SSE exception.

```json
{ "success": true, "data": {}, "meta": {} }
```

```json
{ "success": false, "error": { "code": "PROPERTY_NOT_FOUND", "message": "Property was not found." } }
```

Keep existing URL, HTTP method, response envelope, and authorization behavior
unless an API-contract change is explicitly approved.

| Module | Mount | Responsibility |
| --- | --- | --- |
| Auth | `/auth` | OTP, access/refresh tokens, logout, authorization middleware |
| Users | `/users`, `/admin/users` | profile, roles, account status, audit trail |
| Catalog | `/` | property masters, location hierarchy, PIN lookup |
| Properties | `/properties` | drafts, land details, location, amenities, identifiers, verification, Scanner Lite, Land Passport |
| Listings | `/properties/:propertyId/listings`, `/listings`, `/seller/listings`, `/admin/listings` | draft, review, publishing lifecycle, public detail |
| Discovery | `/search`, `/listings/:listingId/similar`, `/listings/compare` | listing search, suggestions, map pins, similarity, comparison |
| Verification | `/admin/verifications` | verification review queue and admin decisions |
| AI | `/ai` | OpenAI-backed structured search parsing, grounded conversation records, and listing-copy drafts. |

## Authentication and authorization

- Access tokens are short-lived signed JWTs.
- Refresh tokens are opaque, hashed, stored in `auth.refresh_sessions`, and rotated.
- A user may have multiple roles through `auth.user_roles`.
- A newly verified user receives both `BUYER` and `SELLER`. A user may enable the `BROKER`, `DEVELOPER` or `CORPORATE` capability through `/users/me/roles`, as defined in the UI contract. `CHANNEL_PARTNER` remains approval-workflow-only and `ADMIN` cannot be self-assigned. These capabilities are not verification badges; public verification is represented by the listing verification workflow.
- `requireAuth` requires an active user; `requireAdmin` additionally requires `ADMIN`.
- OTP codes are generated per challenge, hashed with the token pepper, and expire after the configured TTL. Configure `OTP_DELIVERY_MODE=webhook` and `OTP_PROVIDER_WEBHOOK_URL` for production. `OTP_DELIVERY_MODE=console` is opt-in and allowed only outside production.

Provision the first administrator through a controlled database runbook after
the user verifies their contact method. Never seed default admin credentials.

### OTP delivery environments

| Environment | Required configuration | Expected behavior |
| --- | --- | --- |
| Local development | `OTP_DELIVERY_MODE=console` | Each OTP request generates a new six-digit code and writes it to the API server log. Copy that code into the verify request. |
| Staging / production | `OTP_DELIVERY_MODE=webhook` and `OTP_PROVIDER_WEBHOOK_URL` | The API sends `{ destination, channel, purpose, code }` as JSON to the configured provider webhook. A non-2xx provider response fails the OTP request safely. |

After changing `.env`, restart `npm start`; configuration is loaded when the process starts. Do not add `AUTH_STATIC_OTP`: static OTPs are intentionally unsupported.

## Database rules

| Schema | Purpose |
| --- | --- |
| `auth` | users, roles, sessions, OTP, user verification |
| `account` | organizations and memberships |
| `geo` | location hierarchy, aliases, PIN codes |
| `land` | property masters, property data, documents, verification |
| `marketplace` | listings, promotions, discovery data |
| `commerce` | plans, orders, payments, refunds |
| `content` | news, trends, e-books, opportunities |
| `ops` | audit and operational data |
| `ai` | AI requests, generated content, search support |

Do not create generic public tables such as `users`, `listing`, or
`property_data`. Use the correct domain schema, foreign keys, and indexes.

For every database change:

1. Send the requested change, owning module, and rollout/backfill impact to
   Developer 1 for review.
2. Add a reviewed forward-only SQL file under `migrations/`.
3. Test it on a fresh database and staging before production.
4. Update `src/database/schema.sql` so a new installation has the final state.

Initial development has no migrations: `src/database/schema.sql` is the single
database baseline. Once a shared/staging environment exists, `npm run db:migrate`
will apply every forward-only SQL file in `migrations/` and record it in
`ops.schema_migrations`. Never edit or delete a migration that has been applied
to a shared environment.

## Media and document uploads

Uploads are direct to object storage, not base64 payloads sent through Express.
The API intentionally keeps JSON and urlencoded bodies at 1 MB because they
contain metadata only. The client flow is: request `upload-url`, upload the
file to the returned signed URL, then call `complete` with the returned storage
key and metadata. Do not raise the global body limit to accommodate files.

## Testing and verification

Run these checks before handing work to another developer:

```bash
git diff --check
find src -type f -name '*.js' -exec node --check {} \;
```

Run the configured unit suite with `npm test`. It uses `cross-env` to set the
test environment and must pass before a Developer 1 change is handed off.

## Ownership

### Developer 1 — platform and land domain

- database architecture, schema review, and migrations
- auth, users, roles, and permission standards
- locations, property masters, properties, land details, parcel data
- media/documents, listings/pricing, search/maps, verification, Land Passport,
  Scanner Lite, and AI

### Developer 2 — people, commerce, and operations around property

- organizations, favourites, buyer requirements, enquiries, and site visits
- plans, orders, payments, and service requests
- CMS, news, e-books, trends, opportunities, auctions, ads, and partners
- notifications and operational workflows

Developer 2 owns behavior in these modules; Developer 1 reviews every database
change.

## Contribution workflow

1. Confirm module ownership and API contract.
2. Build validation, repository, service, controller, then route.
3. Add focused service and database tests where a test database is available.
4. Run syntax checks, relevant tests, and `git diff --check`.
5. Document every new endpoint, environment variable, database change, and
   external integration in the pull request.

Never write another module's tables directly from your module. Call the owning
service, or define an explicit internal service contract.
