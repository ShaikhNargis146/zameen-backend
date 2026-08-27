> Implementation note: this document is the product and platform architecture.
> For the current Express codebase, module structure, local setup, database
> workflow, and team contribution rules, follow
> [backend-development.md](./backend-development.md).

Yes. Based on everything we have finalized so far, I would make this the **master architecture for Zameens**.

The main architectural decision is to **avoid microservices initially**. With two backend developers, Zameens should start as a **well-structured modular monolith**, but with clean domain boundaries so any heavy module can later become a separate service.

# Zameens — Complete Architecture Plan

## 1. Overall Platform

Zameens will effectively have four applications:

```text
                         ZAMEENS PLATFORM
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
     Public Website       User Web App         Admin Portal
       zameens.in          app.zameens.in       admin.zameens.in
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                               ▼
                     Zameens Backend API
                        api.zameens.in
                               │
        ┌──────────────────────┼────────────────────────┐
        ▼                      ▼                        ▼
    PostgreSQL              Redis                    GCS
    + PostGIS             Cache/Queue             Files/Media
        │
        ├──────── AI / LLM
        ├──────── Maps
        ├──────── Payment Gateway
        ├──────── SMS / WhatsApp / Email
        └──────── External Data Sources
```

Phase 2 adds:

```text
Android App
iOS App
Government Data Integrations
Advanced Land Intelligence
AI Document Scanner
OpenSearch
Loan Integrations
```

---

# 2. Recommended Technology Stack

## Frontend

### Public Website + Web Application

**Next.js + TypeScript + React**

I strongly recommend Next.js because we need both:

* SEO-heavy public marketplace pages
* authenticated web application

The same frontend can handle:

```text
zameens.in/
zameens.in/property/...
zameens.in/search/...
zameens.in/market-trends/...
zameens.in/news/...

app.zameens.in/
```

Or initially even keep everything under one domain.

### UI

Recommended:

* Tailwind CSS
* Component library such as shadcn/ui
* React Query/TanStack Query
* React Hook Form
* Zod validation
* i18next / Next.js internationalization

---

# 3. Mobile Application

Don't build this independently in Phase 1.

Build the website fully responsive first.

### Phase 2

Use:

**React Native**

for:

* Android
* iOS

The same APIs are used by:

```text
Web
Admin
Android
iOS
```

No separate mobile backend.

---

# 4. Backend Technology

I recommend:

## Node.js + Express + JavaScript

The running backend is an Express modular monolith. It applies the same
discipline through feature modules, controllers, services, repositories, and
validation files:

* strongly modular
* explicit dependency boundaries
* middleware for authentication and authorization
* request validation
* documented HTTP contracts
* queues
* scheduled jobs
* SSE for streamed AI chat replies; WebSockets if a future feature needs two-way realtime events
* easier to keep two developers from mixing business logic

Architecture:

```text
Zameens Express Application

src/
  modules/

    auth/
    users/
    accounts/

    locations/

    property-masters/
    properties/
    listings/
    media/
    documents/

    search/
    verification/

    favorites/
    requirements/
    enquiries/
    site-visits/

    plans/
    payments/
    services/

    content/
    market-trends/
    auctions/
    investments/
    ads/

    channel-partners/
    notifications/

    ai/

  routes/
  shared/
  database/
```

---

# 5. Do Not Start With Microservices

This is important.

Don't create:

```text
Auth Service
Property Service
Payment Service
Search Service
Notification Service
AI Service
```

as separately deployed services yet.

That creates unnecessary:

* DevOps
* networking
* distributed debugging
* deployment
* authentication
* API contracts
* database consistency issues

Instead:

## Modular Monolith

```text
                    Express Application
                            │
 ┌───────────┬──────────────┼─────────────┬──────────────┐
 │           │              │             │              │
Auth     Properties       Search       Commerce         AI
 │           │              │             │              │
 └───────────┴──────────────┴─────────────┴──────────────┘
                            │
                        PostgreSQL
```

Modules don't directly modify each other's data.

Later, a module such as AI or Search can be extracted if needed.

---

# 6. Database

## PostgreSQL + PostGIS

This should be the primary database.

PostGIS is particularly important for Zameens because land is inherently spatial.

It gives us:

* radius search
* map-bound search
* nearby properties
* distances
* location-based opportunities
* future parcel polygons
* highway proximity
* development-plan overlays

---

# 7. Database Domain Structure

We already established the clean structure:

```text
PostgreSQL

auth
account
geo
land
marketplace
commerce
content
ops
ai
```

### `auth`

```text
users
roles
user_roles
otp_challenges
refresh_sessions
user_verification_checks
```

### `account`

```text
organizations
organization_members
channel_partner_profiles
channel_partner_locations
```

### `geo`

```text
locations
location_aliases
postal_codes
postal_code_locations
```

### `land`

```text
property_types
land_use_types
ownership_types
area_units
amenities
document_types
parcel_identifier_types

properties
property_land_details
property_parcel_identifiers
property_locations
property_amenities
property_media
property_documents
property_document_access_grants
property_verification_checks

v_property_scanner
v_land_passports
```

### `marketplace`

```text
listings
listing_promotions
favorites
listing_events
buyer_requirements
enquiries
enquiry_notes
site_visits
```

### `commerce`

```text
products
plans
orders
order_items
payments
payment_webhook_events
payment_refunds
service_catalog
service_requests
service_request_files
```

### `content`

```text
content_items
content_translations

market_trend_series
market_trend_points

auctions

investment_opportunities
investment_interests

ads
```

### `ops`

```text
notifications
notification_deliveries
notification_preferences
audit_logs
analytics_events
```

### `ai`

```text
conversations
messages
```

---

# 8. The Most Important Data Relationship

Keep these concepts separate:

```text
LAND PROPERTY
Physical land parcel
        │
        ▼
LISTING
Commercial offer
        │
        ▼
ENQUIRY / BUYER INTERACTION
```

For example:

### Property

```text
2 acres
Survey 127/2
Panvel
18m road
Industrial land
Coordinates
Documents
```

### Listing

```text
₹4.25 crore
For Sale
Description
Seller
Published date
Premium
```

### Lead

```text
Buyer A
Interested
Called seller
Site visit
```

That separation is fundamental.

---

# 9. Authentication Architecture

Since you are taking auth, I would build:

## Login

Primarily:

**Mobile OTP**

Optional:

**Email OTP**

No password required initially unless the business asks for it.

Flow:

```text
POST OTP request
        │
        ▼
Generate OTP
        │
        ▼
Store hashed OTP
        │
        ▼
Send SMS
        │
        ▼
POST OTP verify
        │
        ▼
Create / identify user
        │
        ▼
Access Token + Refresh Token
```

---

# 10. Token Architecture

Use:

### Access token

Short lived.

Example:

```text
15 minutes
```

JWT containing:

```text
user_id
roles
session_id
```

### Refresh token

Longer lived.

Store only hash in:

```text
auth.refresh_sessions
```

Allow:

* token rotation
* logout current device
* logout all devices
* session revocation

---

# 11. Role Architecture

Don't make separate buyer and seller accounts.

One user:

```text
User
 ├ Buyer
 ├ Seller
 ├ Broker
 ├ Channel Partner
 └ Corporate
```

RBAC:

```text
BUYER
SELLER
BROKER
DEVELOPER
CHANNEL_PARTNER
CORPORATE
ADMIN
```

Express middleware chain:

```text
JwtAuthGuard
      ↓
RolesGuard
      ↓
Controller
```

---

# 12. Property Architecture

Property creation should happen incrementally.

Example:

```text
Create Draft
    │
    ▼
Basic Information
    │
    ▼
Location
    │
    ▼
Land Details
    │
    ▼
Parcel Information
    │
    ▼
Media
    │
    ▼
Documents
    │
    ▼
Pricing / Listing
    │
    ▼
Submit for Review
```

Don't force the frontend to submit a giant object in one API.

This makes:

* autosave
* draft support
* validations
* UI steps

much easier.

---

# 13. Listing Workflow

```text
DRAFT
   │
   ▼
PENDING REVIEW
   │
   ├──────────────► REJECTED
   │
   ▼
APPROVED
   │
   ▼
PUBLISHED
   │
   ├── PAUSED
   ├── EXPIRED
   ├── WITHDRAWN
   └── SOLD

`SUSPENDED` is an admin-only moderation state; it is not a seller workflow
action and every transition into it must be audited.
```

Property continues to exist even when a listing expires.

---

# 14. Search Architecture

### Phase 1

Do not introduce Elasticsearch immediately.

Use:

**PostgreSQL**

with:

* indexed fields
* PostGIS
* `pg_trgm`
* full-text GIN indexes for listing and CMS copy

Search query:

```text
Property Type
      +
Location
      +
Area
      +
Price
      +
Road Width
      +
Verification
      +
PostGIS
```

---

# 15. Geo Search

PostGIS query gives:

> properties within 10 km of Panvel

or:

> properties inside current map window

Use:

```text
GEOGRAPHY(Point, 4326)
```

and GIST spatial indexes.

Map search should only return:

```text
listing_id
lat
lng
price
area
property_type
thumbnail
```

not full property payload.

The main result query may join normalised property tables in Phase 1. Keep the
map payload deliberately small and fetch the full listing only after a user
opens it.

---

# 16. Phase 2 Search

When inventory becomes large:

```text
PostgreSQL
     │
     ▼
Search Synchronization
     │
     ▼
OpenSearch
```

OpenSearch handles:

* autocomplete
* fuzzy search
* ranking
* advanced filters
* geographical search
* synonyms

PostgreSQL remains the source of truth.

---

# 17. Maps Architecture

Create an abstraction:

```text
MapProvider
```

Rather than hardcoding Google Maps everywhere.

Backend only needs normalized:

```text
latitude
longitude
formatted address
location hierarchy
```

Frontend provider can initially be:

* Google Maps
  or
* Mapbox

Capabilities Phase 1:

* show pin
* map search
* geocoding
* reverse geocoding

Phase 2:

* parcel polygon
* satellite layers
* master plan
* infrastructure
* zoning

---

# 18. Object/File Storage

Use:

## Google Cloud Storage

Buckets:

```text
zameens-public-media
zameens-private-documents
zameens-reports
```

### Public media

* listing images
* thumbnails
* public content images

### Private

* ownership documents
* sale deed
* title documents
* service-request documents

---

# 19. File Upload Flow

Never upload large files through Node backend.

Use:

```text
Frontend
    │
    ▼
Request upload URL
    │
    ▼
Backend generates signed URL
    │
    ▼
Frontend uploads directly to GCS
    │
    ▼
Frontend calls upload-complete
    │
    ▼
Backend stores metadata
```

This massively reduces backend bandwidth.

---

# 20. Image Processing

Use a background job for:

* thumbnails
* compression
* metadata
* image size validation

Flow:

```text
Image Uploaded
      │
      ▼
Queue Job
      │
      ▼
Image Processor
      │
      ├ Thumbnail
      ├ Web optimized image
      └ Metadata
```

---

# 21. Redis

Introduce Redis from the beginning, but only for specific purposes.

Use:

### Cache

```text
location lists
masters
popular search
content
```

### Rate limits

```text
OTP
login
AI requests
```

### Background queue

Using:

**BullMQ**

Tasks:

```text
email
SMS
WhatsApp
image processing
AI jobs
report generation
notifications
```

---

# 22. Notification Architecture

One centralized notification system.

```text
Business Module
      │
      ▼
Notification Service
      │
      ├── In App
      ├── Email
      ├── SMS
      └── WhatsApp
```

Example:

```text
New enquiry created

        ↓

Notification Event

        ↓

Seller receives:
In-app
WhatsApp
Email
```

Provider adapters:

```text
SmsProvider
EmailProvider
WhatsAppProvider
```

So vendors can change later.

---

# 23. Payments Architecture

Use an abstraction around provider.

For India I would likely start with:

**Razorpay**

Flow:

```text
Select Plan
     │
     ▼
Create Internal Order
     │
     ▼
Create Razorpay Order
     │
     ▼
Frontend Payment
     │
     ▼
Webhook
     │
     ▼
Verify Signature
     │
     ▼
Mark Payment Captured
     │
     ▼
Activate Premium / Service
```

Critical:

> Never trust frontend payment success.

Webhook is authoritative.

Persist every provider event in `commerce.payment_webhook_events` with a unique
`(provider, event_id)` before it is processed. The handler must be idempotent:
a provider retry can never create a second payment, promotion, or entitlement.
Refunds are separate `commerce.payment_refunds` records so partial refunds
remain auditable.

---

# 24. AI Architecture

Phase 1 AI should remain deliberately simple.

```text
Frontend AI Assistant
        │
        ▼
      AI API
        │
        ▼
   AI Orchestrator
   │       │       │
   ▼       ▼       ▼
Property Search  Property Data  Content
        │
        ▼
       LLM
```

Create one:

```text
AiService
```

with provider abstraction:

```text
LLMProvider
  ├ OpenAI
  └ Gemini
```

That prevents vendor lock-in.

---

# 25. Phase 1 AI Capabilities

Only three initially.

## AI Smart Search

```text
"I want 2 acres industrial land
near Panvel under 5 crore"
```

LLM converts to structured JSON:

```json
{
  "propertyType": "INDUSTRIAL_LAND",
  "location": "Panvel",
  "minArea": 2,
  "areaUnit": "ACRE",
  "maxPrice": 50000000
}
```

Then normal database search runs.

The LLM itself should **not search database records**.

---

# 26. Property AI Assistant

When user is viewing property:

```text
Property DB Data
      +
Available Documents Metadata
      +
Verification
      +
Listing
      ↓
      LLM
```

Question:

> Is road access available?

AI answers from structured property data.

---

# 27. AI Listing Generator

Input:

```text
Industrial
2 acres
Panvel
₹4 crore
18m road
```

Output:

```text
Title
Description
Highlights
```

This is inexpensive and visually valuable.

---

# 28. AI Guardrail

For legal/investment questions AI should say things like:

> Based on information available on Zameens...

rather than:

> This title is legally clear.

AI must not turn Property Scanner Lite into an automated legal certification.

---

# 29. Future RAG Architecture

Phase 2:

```text
Government Regulations
Legal Guides
Development Plans
Zameens Content
Property Documents
       │
       ▼
Document Processing
       │
       ▼
Chunking + Embeddings
       │
       ▼
     pgvector
       │
       ▼
 AI Retrieval
       │
       ▼
Answer + Sources
```

Because we're already on PostgreSQL, **pgvector** is a sensible initial vector database.

No need for a separate Pinecone/vector DB at the beginning.

---

# 30. Property Scanner Architecture

### Phase 1

Rule engine.

```text
Property
  │
  ├── Details completeness
  ├── Seller verification
  ├── Documents available
  ├── Location available
  └── Parcel identifiers
          │
          ▼
     Scanner Rules
          │
          ▼
     Readiness Score
```

Example:

```text
Property details       30
Location               20
Seller verification    15
Documents              25
Parcel information     10
                       ──
                       100
```

Frontend can show:

**78/100 Property Readiness**

`land.v_property_scanner` scores the physical property. The user-facing
`marketplace.v_listing_scanner` also evaluates the actual listing seller's
verification. Neither is a legal opinion.

---

# 31. Phase 2 Property Scanner

```text
Documents
    │
    ▼
OCR / Document AI
    │
    ▼
Field Extraction
    │
    ▼
Cross-document Validation
    │
    ▼
Legal Rules
    │
    ▼
AI Preliminary Assessment
    │
    ▼
Professional Review
```

Much stronger but deliberately postponed.

---

# 32. Market Trends Architecture

Phase 1:

Admin uploads/manages:

```text
Location
Year
Metric
Value
Source
```

Frontend draws charts.

AI optionally summarizes the trend.

Phase 2:

```text
Government rates
Transactions
Zameens listings
External market datasets
       │
       ▼
Data Pipeline
       │
       ▼
Market Intelligence DB
```

---

# 33. Content Architecture

One CMS powers:

* Hot News
* Land Opportunities
* E-books
* Property Laws
* Guides
* Government Development News

```text
content_items
       │
       ▼
content_translations
```

That handles seven languages without building seven CMS systems.

---

# 34. Multilingual Architecture

Three different layers.

### UI

Frontend translation JSON:

```text
en
hi
mr
gu
pa
te
ta
```

### CMS

Database translations.

### AI

User can interact in their chosen language.

Do not translate every seller-generated property record seven times manually in Phase 1.

---

# 35. Admin Architecture

Admin is just another frontend.

```text
Admin Portal
      │
      ▼
Same Backend
```

Don't build:

```text
admin-backend
```

separately.

Admin APIs are domain based:

```text
/admin/properties
/admin/users
/admin/payments
/admin/content
/admin/services
```

but use the same services internally.

For example:

```text
AdminPropertyController
          │
          ▼
     PropertyService
```

not a duplicated AdminPropertyService.

---

# 36. Audit Architecture

Any important admin action:

```text
Property approved
Property rejected
Verification changed
User suspended
Payment refunded
Service completed
```

should generate:

```text
ops.audit_logs
```

Store:

* actor
* action
* entity
* before
* after
* IP
* timestamp

---

# 37. API Architecture

Base:

```text
/api/v1/
```

Example:

```text
/api/v1/auth
/api/v1/users
/api/v1/properties
/api/v1/listings
/api/v1/search
/api/v1/enquiries
/api/v1/payments
/api/v1/services
/api/v1/ai
```

---

# 38. API Response Standard

Success:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "PROPERTY_NOT_FOUND",
    "message": "Property not found"
  }
}
```

Pagination:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 245,
    "totalPages": 13
  }
}
```

Freeze this before development.

---

# 39. Background Processing

Anything not required to return immediately should go through queue.

Examples:

```text
Notification
AI report
Image thumbnail
Email
WhatsApp
PDF generation
Market data import
```

Architecture:

```text
API
 │
 ├── Immediate Response
 │
 └── Redis Queue
       │
       ▼
     Worker
```

A dedicated worker can initially run in the same repository as a separate process.

## Reliability requirements

Every queue handler must be idempotent and use a stable job key. Configure
retries with exponential backoff, a maximum attempt count, and a dead-letter
queue/dashboard. Redis/BullMQ is the delivery mechanism; PostgreSQL remains
the source of truth.

For payment webhooks, persist the unique provider event first, then execute or
queue the business action inside a transaction. This prevents duplicate webhook
delivery from creating duplicate entitlements.

---

# 40. Infrastructure — Recommended GCP Architecture

Because Zameens already fits well into your existing GCP experience:

```text
                         Internet
                            │
                            ▼
                    Cloud Load Balancer
                            │
                    Cloud Armor / SSL
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
   Next.js Frontend                    Express Backend
      Cloud Run                          Cloud Run
                                              │
                        ┌─────────────────────┼────────────────┐
                        ▼                     ▼                ▼
                   Cloud SQL             Memorystore          GCS
                  PostgreSQL              Redis              Storage
                  + PostGIS
                                              │
                                              ▼
                                            Worker
                                           Cloud Run
```

---

# 41. Why Cloud Run

Instead of manually maintaining multiple VMs:

* automatic scaling
* revisions
* easy rollback
* HTTPS
* container deployments
* lower operational effort
* independent frontend/backend scaling

You can still use a VM for initial development/staging if needed.

For production, I'd prefer Cloud Run.

---

# 42. Deployment Components

Recommended production resources:

```text
Cloud Run
  zameens-web
  zameens-api
  zameens-worker

Cloud SQL
  PostgreSQL + PostGIS

Memorystore
  Redis

Cloud Storage
  public media
  private documents
  reports

Artifact Registry
  Docker images

Secret Manager
  DB passwords
  API keys
  JWT secrets

Cloud Logging
Cloud Monitoring
```

---

# 43. Environments

Have three from the beginning:

```text
DEV
STAGING
PRODUCTION
```

Prefer separate databases.

At minimum:

```text
zameens_dev
zameens_stage
zameens_prod
```

Never let developers test against production.

---

# 44. CI/CD

GitHub:

```text
Feature Branch
     │
     ▼
Pull Request
     │
     ├── Lint
     ├── Unit tests
     ├── Build
     └── Migration validation
            │
            ▼
          Merge
            │
            ▼
       Docker Build
            │
            ▼
     Artifact Registry
            │
            ▼
        Cloud Run
```

GitHub Actions can manage this.

---

# 45. Database Migration Process

Because you own the database:

```text
Dev 2
  │
  ▼
DB Change Request
  │
  ▼
You Review Schema
  │
  ▼
Migration Created
  │
  ▼
Staging
  │
  ▼
Production
```

Only one migration authority.

This is an excellent decision with a small team.

---

# 46. Security Architecture

At minimum:

### API

* JWT
* RBAC
* rate limiting
* request validation
* CORS restrictions
* maximum upload size
* security headers

### Authentication

* hashed OTP
* rotating refresh tokens
* OTP throttling
* session revocation

### Documents

* private GCS
* signed temporary URLs
* permission checks
* no permanent public URLs

### Payments

* webhook signature verification
* idempotency
* server-side amount validation

### Admin

* strong role restrictions
* audit logging
* ideally MFA later

### Authorization

RBAC is necessary but not sufficient. Every property/listing/document endpoint
must apply a resource policy:

* a user edits a property only when they created it or have the required active
  membership in its `owner_organization_id`;
* a seller edits or withdraws only their own listing;
* an `APPROVED_BUYERS` document needs an unrevoked
  `land.property_document_access_grants` record;
* an administrator has an explicit audited override, not implicit access;
* signed document download URLs are created only after this check.

---

# 47. Sensitive Data

Never store unnecessarily:

* Aadhaar image
* full CIBIL information
* bank credentials

Sensitive records that are required should be:

* encrypted at rest
* restricted
* audited

Use Google Secret Manager/KMS for infrastructure secrets.

---

# 48. Observability

At minimum:

```text
Structured logs
Request ID
User ID where safe
API latency
Error stack
Provider response status
```

Use:

* Google Cloud Logging
* Cloud Error Reporting
* Cloud Monitoring

Every request should have:

```text
request_id
```

so a frontend error can be traced end-to-end.

## Backup and recovery

Enable Cloud SQL point-in-time recovery and automated backups from the first
production deployment. Perform a scheduled restore test into a non-production
project, document the restore owner, and alert on backup failures. A backup
that has never been restored is not a recovery plan.

---

# 49. Analytics Architecture

Separate operational analytics from raw event data.

Track:

```text
PROPERTY_VIEW
SEARCH
FAVORITE
CONTACT
SITE_VISIT
PREMIUM_PURCHASE
AI_SEARCH
```

Phase 1 can use PostgreSQL event tables.

Use `ops.analytics_events` for cross-product events such as `SEARCH`,
`AI_SEARCH`, and `PREMIUM_PURCHASE`; retain `marketplace.listing_events` for
listing-specific seller analytics. Do not put raw document text, OTPs, or full
personal search prompts in analytics metadata.

Later send events to:

```text
BigQuery
```

for serious analytics.

---

# 50. Developer Ownership

Since you're taking **complete DB + auth**, I'd revise our final ownership to:

## Developer 1 — You

### Architecture/Foundation

* complete database architecture
* migrations
* auth
* users
* roles/permissions
* common backend standards

### Land Platform

* location
* property masters
* properties
* land details
* parcel data
* property location
* media
* documents
* listings
* pricing
* search
* map search
* verification
* Land Passport
* Scanner Lite
* AI

This is the **core technology/domain side**.

---

# 51. Developer 2

Own:

### Marketplace Operations

* organizations
* favorites
* buyer requirements
* enquiries
* site visits
* seller lead dashboard

### Commerce

* plans
* orders
* payments
* service requests

### Business Content

* CMS
* news
* e-books
* market trends
* investment opportunities
* auctions
* advertisements
* channel partners

### Platform Operations

* notifications

But any new table/migration goes through you.

---

# 52. Inter-module Communication

Even inside one monolith:

Don't do this:

```text
PaymentService
   ↓
UPDATE marketplace.listings ...
```

Do:

```text
PaymentService
      │
      ▼
ListingService.activatePromotion()
```

Same codebase but clean ownership.

This is what makes eventual service extraction possible.

---

# 53. Complete Phase 1 Runtime Architecture

Putting everything together:

```text
                        USERS
                          │
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
     WEB               ADMIN            MOBILE WEB
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                          ▼
                   API LOAD BALANCER
                          │
                          ▼
                 ZAMEENS NESTJS API
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
      AUTH             MARKETPLACE          AI
        │                 │                 │
        ├──────┬──────────┼─────────┬───────┤
        ▼      ▼          ▼         ▼       ▼
      USERS  PROPERTY   LEADS    COMMERCE CONTENT
        │      │          │         │       │
        └──────┴──────────┴─────────┴───────┘
                          │
                          ▼
              POSTGRESQL + POSTGIS
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
            REDIS        GCS       EXTERNAL
             │            │
             ▼            │
           WORKER         │
             │            │
     ┌───────┼───────┐    │
     ▼       ▼       ▼    ▼
    SMS    EMAIL     AI   FILES
```

---

# 54. Phase 1 User Journey Architecture

### Buyer

```text
Login
 ↓
Search / AI Search
 ↓
Property Results
 ↓
Property Detail
 ↓
Land Passport / Scanner
 ↓
Favourite / Compare
 ↓
Contact Seller
 ↓
Site Visit
 ↓
Legal / Valuation Service
```

### Seller

```text
Login
 ↓
Create Property
 ↓
Add Location
 ↓
Land Details
 ↓
Images
 ↓
Create Listing
 ↓
Submit
 ↓
Admin Approval
 ↓
Published
 ↓
Receive Leads
 ↓
Premium Upgrade
```

### Admin

```text
Login
 ↓
Review Listings
 ↓
Verify Properties
 ↓
Manage Users
 ↓
Process Services
 ↓
Manage News / Trends
 ↓
Manage Auctions / Opportunities
 ↓
Payments / Reports
```

---

# 55. Phase 2 Architecture Expansion

Once Phase 1 is stable, build on top of it.

## Advanced AI

* RAG
* property document analysis
* regulation assistant
* AI comparison
* risk extraction

## Advanced Geo

* parcel polygons
* government survey boundaries
* zoning
* development plans
* infrastructure layers

## Search

* OpenSearch

## Data Platform

* Government data ingestion
* market transaction data
* automated price trends

## Mobile

* iOS
* Android
* push notifications

## Channel Partners

* lead allocation
* commission
* payouts
* territory

## Loans

* lenders
* application flow
* eligibility
* consent-based credit integrations

## Corporate

* deal room
* NDA
* restricted documents
* investor workflow

---

# 56. What We Should Deliberately Not Build in Phase 1

This is equally important for architecture discipline:

* microservices
* Kubernetes
* Kafka
* Elasticsearch/OpenSearch unless needed
* complex event sourcing
* separate AI service
* separate payment service
* nationwide government integrations
* automated legal certification
* cadastral land mapping
* Land Bond transaction platform
* fractional ownership
* internal auction bidding
* direct CIBIL integration
* bank-loan origination engine

None is required to create a strong first release.

---

# 57. Final Architecture Principle

If I had to summarize the entire architecture into one approach:

> **Modular monolith + PostgreSQL/PostGIS + Redis + GCS + Next.js + Express + managed GCP infrastructure.**

And the internal model revolves around:

```text
USER
 │
 ▼
PROPERTY
 │
 ▼
LISTING
 │
 ├──── SEARCH
 │
 ├──── VERIFICATION
 │
 ├──── AI
 │
 └──── LEAD
          │
          ▼
       SERVICE
          │
          ▼
       PAYMENT
```

This gives us a **very manageable Phase 1 for two backend developers**, while the architecture is already ready for the much more ambitious vision the client keeps discussing: AI land intelligence, legal scanning, government development plans, corporate investment, sophisticated maps and eventually mobile apps.
