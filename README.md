# Zameens backend

Start with [the backend development guide](docs/backend-development.md). It is the practical source of truth for contributors; [the architecture](docs/architecture.md) contains the wider platform plan.

## Database

The prior database design has been replaced with the clean-install schema in
[`src/database/schema.sql`](src/database/schema.sql). It creates the
`auth`, `account`, `geo`, `land`, `marketplace`, `commerce`, `content`, `ops`,
and `ai` PostgreSQL schemas.

During initial development, recreate a development database and run `npm run db:schema` once. The SQL is a clean-install script; it must not be run on an existing database as a migration.

There are intentionally no migration scripts yet. Once a shared/staging database exists, future schema changes will be added as forward-only migrations and applied with `npm run db:migrate`.

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
