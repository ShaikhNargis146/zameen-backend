# Zameens backend

Start with [the backend development guide](docs/backend-development.md). It is the practical source of truth for contributors; [the architecture](docs/architecture.md) contains the wider platform plan.

## First run after cloning or pulling

Use this sequence when setting up the backend on a machine for the first time.
It deliberately keeps database changes out of `npm start`.

```bash
# 1. Install the locked Node dependencies.
npm ci

# 2. Create your private environment file; never commit it.
cp .env.example .env

# 3. Edit .env with a reachable PostgreSQL database and unique local secrets.
#    At minimum set DB_HOST, DB_PORT, DB, DB_USER, DB_PASSWORD,
#    JWT_SECRET, and TOKEN_PEPPER. DATABASE_URL may be used instead of DB_*.

# 4a. Brand-new, empty database only.
npm run db:schema

# 4b. Existing canonical Zameens database only. Do not run both 4a and 4b.
# npm run db:migrate

# 5. Start the API and verify it in another terminal.
npm start
curl http://localhost:8080/api/v1/status
```

`db:schema` creates PostGIS and the application schemas, so the database user
must be the database owner or otherwise be permitted to create the required
extensions. If that is not possible, have a database administrator provision an
empty PostgreSQL 14+ database with `pgcrypto`, `citext`, `postgis`, and
`pg_trgm` enabled, then run `npm run db:schema` again.

For a local UI, `OTP_DELIVERY_MODE=console` in `.env` prints development OTPs
to the API log. AI and direct file uploads need their respective OpenAI and
Google Cloud Storage settings; the rest of the API can be developed without
them. See the [first-run troubleshooting guide](docs/backend-development.md#first-run-database-troubleshooting).

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
