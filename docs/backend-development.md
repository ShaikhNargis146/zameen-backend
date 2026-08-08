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
   and a different `TOKEN_PEPPER`.
2. Create a new PostgreSQL database with privileges for `pgcrypto`, `citext`,
   `postgis`, and `pg_trgm`.
3. Run `npm run db:schema` once for that new database.
4. Run `npm start`, then call `GET /api/v1/status`.

`npm run db:schema` is a clean-install command. It refuses to run when
`auth.users` already exists, so it cannot overwrite an existing canonical
database. Never use it as a migration command.

## Source layout

```text
src/
  config/       application, environment, CORS, and database setup
  database/     canonical clean-install schema
  middlewares/  cross-cutting Express middleware only
  modules/      business features
  routes/v1/    versioned route composition only
  shared/       shared HTTP helpers
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
- Only a repository may import `src/utils/postgres_store.js`.
- Controllers use `asyncRoute` and the helpers in `src/shared/http.js`.
- Services throw `HttpError(status, code, message)` for expected business errors.
- Do not expose SQL errors, tokens, OTPs, stacks, or secrets in responses.

`auth`, `users`, and `catalog` follow this structure. `properties` and
`listings` are transitional: they are mounted from `src/modules`, but their
existing route files still contain workflow and database code. Refactor them
into this five-layer pattern before adding substantial new behavior.

## API contract

All endpoints are under `/api/v1`.

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

## Authentication and authorization

- Access tokens are short-lived signed JWTs.
- Refresh tokens are opaque, hashed, stored in `auth.refresh_sessions`, and rotated.
- A user may have multiple roles through `auth.user_roles`.
- `requireAuth` requires an active user; `requireAdmin` additionally requires `ADMIN`.
- `AUTH_STATIC_OTP` is development-only. Production OTP delivery remains disabled
  until an SMS/email provider is integrated.

Provision the first administrator through a controlled database runbook after
the user verifies their contact method. Never seed default admin credentials.

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

The project currently has a clean-install runner only. Add a versioned migration
runner before making database changes to shared environments.

## Testing and verification

Run these checks before handing work to another developer:

```bash
git diff --check
find src -type f -name '*.js' -exec node --check {} \;
```

The configured `npm test` command currently cannot run because `cross-env` is
missing from the installed development dependencies. Restore that dependency
and add module-level tests before making it a merge requirement.

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
