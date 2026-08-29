# Zameens backend

Start with [the backend development guide](docs/backend-development.md). It is the practical source of truth for contributors; [the architecture](docs/architecture.md) contains the wider platform plan.

## Database

The prior database design has been replaced with the clean-install schema in
[`src/database/schema.sql`](src/database/schema.sql). It creates the
`auth`, `account`, `geo`, `land`, `marketplace`, `commerce`, `content`, `ops`,
and `ai` PostgreSQL schemas.

For a new database, run `npm run db:schema` once. The SQL is a clean-install
script; it must not be run on an existing database as a migration. Existing
canonical databases created from the earlier baseline must run
`npm run db:migrate` before this version is deployed. During the current
development phase this applies one idempotent canonical-upgrade script. Once a
shared staging/production schema is frozen, migrations become forward-only and
must never be rewritten.

## Implemented API modules

The new API is mounted at `/api/v1`. The first implemented vertical slice is:

* `/auth` — OTP request/verify, refresh, logout and logout-all
* `/users/me` and `/users/me/roles` — profile and self-service buyer/seller capability
* `/admin/users` — user status and role operations, protected by the `ADMIN` role
* master and location read APIs — property/land/document masters, parcel config, location search and PIN lookup
* `/properties` — draft property, land details, parcel identifiers, location, amenities, verification, Scanner Lite and Land Passport
* `/properties/:propertyId/listings`, `/listings`, `/seller/listings` and `/admin/listings` — listing draft/review/publish lifecycle and public aggregate detail

These endpoints require the canonical schema, not the retired `listing` and `app_user` tables.

## Production prerequisites

Before deploying, apply the schema to a new PostgreSQL 14+ database with PostGIS,
set a strong `JWT_SECRET` and `TOKEN_PEPPER`, configure `CORS_ORIGINS`, and connect
an SMS/email provider for OTP delivery. OTP delivery is deliberately disabled in
production until a provider is configured. Provision the first administrator through
a controlled database runbook after that user has completed verification; the schema
does not create a default administrator.

The AI endpoints use the OpenAI Responses API. Set `OPENAI_API_KEY` as a deployment
secret; `OPENAI_MODEL` defaults to `gpt-5-mini`. AI conversation messages stream as
SSE from the existing POST message endpoint; search and listing drafts remain JSON.
Without the key, AI requests return `AI_PROVIDER_UNCONFIGURED` rather than falling
back to generated or rule-based data.
