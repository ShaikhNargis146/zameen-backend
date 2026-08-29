# DigiPIN Integration Plan

Status: proposed (not yet implemented)
Author: drafted with Claude Code, 2026-08-29

## Context

DigiPIN is India Post's open geocoding standard: a deterministic, offline-computable algorithm that converts a lat/lng pair (within India's bounding box) into a 10-character alphanumeric code (e.g. `39J-49L-L8T4`), and back again, with ~3.8m precision. It needs no external API, network call, or API key. The goal is to let this real-estate backend *use* DigiPIN for location purposes — as a **new, additive capability only**. No existing endpoint, validation rule, DB column, or response field should change behavior.

The codebase already has a natural home for this: the `catalog` module hosts stateless geo utilities (`GET /geo/geocode`, `GET /geo/reverse-geocode`), which today do a PostGIS nearest-neighbor lookup against `geo.locations` (there is no third-party maps provider wired in anywhere). Property-specific coordinates live only as a PostGIS `geography(Point,4326)` on `land.property_locations` — there are no stored decimal lat/lng columns anywhere; the API always derives them on the fly via `ST_Y`/`ST_X`.

Because DigiPIN is a pure function of lat/lng, the lowest-risk design computes it in JavaScript on the fly wherever coordinates are already available, instead of persisting a new column. This avoids any migration, backfill, or drift risk for v1, and keeps the write path (`PUT /properties/:propertyId/location`) completely untouched.

## Scope

**In scope (v1, purely additive):**

1. A new pure utility for encode/decode.
2. Two new endpoints on the existing `catalog` module: `GET /geo/digipin/encode` and `GET /geo/digipin/decode`.
3. A new derived, read-only `digipin` field on the existing `GET /properties/:propertyId/location` response (the owner's own edit view).

**Explicitly out of scope for v1 (noted, not built):**

- Accepting DigiPIN as an input on `PUT /properties/:propertyId/location` (would touch the required-fields validation contract of an existing write path — skip for now; a client can call the new decode endpoint first, then call the existing save endpoint with the resulting lat/lng, with zero changes to that endpoint).
- Persisting a `digipin` column, migration, or index (only worth it if/when SQL-level search-by-DigiPIN is needed).
- Extending the derived-field pattern to `listings` (buyer-facing detail) or `discovery` (map pins) — both already gate exact coordinates behind `show_exact_location`; any future extension there must reuse that existing gate, not bypass it.

## Design decisions

- **No DB/schema change.** Zero migration risk; single source of truth stays `land.property_locations.coordinates`.
- **No feature flag/env var.** DigiPIN needs no external service or secret, so there's no operational reason to gate it (the codebase's only precedent for a flag, `ai.provider.js`, gates on a missing API key — not applicable here).
- **Error layering:** `src/utils/digipin.js` is pure and dependency-free (like `src/utils/crypto.js`) and throws plain `Error` — it does not know about HTTP. All request-facing validation (bounding-box check for encode, format check for decode) happens in `catalog.validation.js`, exactly like the existing `coordinates(query)` validator, and throws `HttpError` with request-facing codes. The one place that intentionally *swallows* a throw is the derived property-location field, which must never break an existing response just because a coordinate falls outside DigiPIN's India-only bounding box.
- **Auth:** new `/geo/digipin/*` endpoints use `requireAuth`, matching the existing sibling `/geo/geocode` and `/geo/reverse-geocode`.

## Files to add/change

### 1. New: `src/utils/digipin.js`

Pure, dependency-free module (no imports from `shared/` or Express), named exports only, mirroring `src/utils/crypto.js`'s style:

- `DIGIPIN_GRID` — the 4x4 symbol-table constant (16-symbol alphabet, row = latitude band north-to-south, column = longitude band west-to-east).
- `DIGIPIN_BOUNDS` — `{ minLatitude: 2.5, maxLatitude: 38.5, minLongitude: 63.5, maxLongitude: 99.5 }`.
- `encodeDigiPin(latitude, longitude)` → 10-char code formatted as `XXX-XXX-XXXX`. Throws a plain `Error` if input is non-finite or outside `DIGIPIN_BOUNDS`.
- `decodeDigiPin(digipin)` → `{ latitude, longitude }` (center of the resolved grid cell, rounded to 6 decimals). Normalizes input first (strip dashes/whitespace, uppercase). Throws a plain `Error` if the normalized value isn't exactly 10 characters from the grid alphabet.
- `isValidDigiPin(value)` → boolean, never throws; used by request validation.

**Algorithm** (recursive 4×4 quad subdivision, 10 levels):

- Encode: start with the full bounding box; each level splits the current lat/lng box into a 4×4 grid, picks the `(row, col)` cell containing the point (row counted from the north edge, col from the west edge, both clamped to `[0,3]` for exact-boundary points), appends `DIGIPIN_GRID[row][col]`, and narrows the box to that sub-cell for the next level. Insert a `-` after the 3rd and 6th characters.
- Decode: same bounding box, but for each of the 10 input characters look up its `(row, col)` in the grid and apply the identical narrowing step; after 10 levels, return the center of the final ~3.8m cell.
- **Verify the exact grid symbol table and bounding-box decimals against India Post's published DigiPIN reference/spec while implementing** — treat the values above as "best available, needs a final cross-check," not gospel. For that reason, the test suite (below) is built around round-trip correctness and structural checks rather than hardcoded "official" example codes, so correctness doesn't depend on memorized values.

### 2. `src/modules/catalog/catalog.validation.js` — add only, nothing existing edited

- `digipinEncodeQuery(query)` — reuses the existing `coordinates(query)` for the base finite/world-range check, then additionally rejects points outside `DIGIPIN_BOUNDS` with `HttpError(400, "DIGIPIN_OUT_OF_BOUNDS", ...)`.
- `digipinDecodeQuery(query)` — trims `query.digipin`, throws `HttpError(400, "INVALID_DIGIPIN", ...)` if `isValidDigiPin` returns false; otherwise returns the normalized string.

### 3. `src/modules/catalog/catalog.service.js` — add only

- `digipinEncode({ latitude, longitude })` → `{ digipin: encodeDigiPin(latitude, longitude) }`.
- `digipinDecode(digipin)` → `decodeDigiPin(digipin)`.

### 4. `src/modules/catalog/catalog.controller.js` — add only

- `digipinEncode`/`digipinDecode` controllers, same thin `ok(res, ...)` pattern as existing `geocode`/`reverseGeocode`.

### 5. `src/modules/catalog/catalog.routes.js` — add only, placed right after the existing `/geo/reverse-geocode` route

```js
router.get("/geo/digipin/encode", requireAuth, asyncRoute(controller.digipinEncode));
router.get("/geo/digipin/decode", requireAuth, asyncRoute(controller.digipinDecode));
```

Resolves automatically to `GET /api/v1/geo/digipin/encode?lat=&lng=` and `GET /api/v1/geo/digipin/decode?digipin=` — no changes needed to `src/routes/v1/index.js` or `src/config/express.config.js` since the `catalog` router is already mounted.

### 6. `src/modules/properties/properties.service.js` — one line changed, one line added

Current (line 117): `export const getLocation = repository.location;`

Becomes:

```js
import { encodeDigiPin } from "../../utils/digipin.js";

export const attachDigipin = location => {
  if (!location) return location;
  let digipin = null;
  try {
    if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
      digipin = encodeDigiPin(location.latitude, location.longitude);
    }
  } catch {
    digipin = null;
  }
  return { ...location, digipin };
};
export const getLocation = async propertyId => attachDigipin(await repository.location(propertyId));
```

`saveLocation`, `properties.repository.js`, `properties.routes.js`, `properties.controller.js`, and `properties.validation.js` are **not touched**. `attachDigipin` is exported separately so it's independently unit-testable with plain object literals (no DB).

### No changes to

`src/routes/v1/index.js`, `src/config/express.config.js`, `src/shared/http.js`, `src/middlewares/error.js` (verified: it already forwards any `err.status < 500` with its own `code`/`message` unchanged, so the new `HttpError`s need no new wiring), `src/database/schema.sql`, `migrations/*`.

## Tests

- **New `test/unit/digipin.util.test.js`** (node:test, following existing convention): round-trip tests for several known in-bounds coordinates (Delhi, Mumbai, Chennai, Guwahati, near each bounding-box edge) asserting `decodeDigiPin(encodeDigiPin(lat,lng))` is within ~0.0001° of the original; output format regex check; determinism check; out-of-bounds rejection on all four edges plus non-finite input; malformed-decode rejection (wrong length, bad character, empty/non-string); decode accepts dashed/undashed/lowercase forms equivalently; `isValidDigiPin` never throws; a grid-table sanity check (16 unique non-empty symbols).
- **Append to existing `test/unit/catalog.validation.test.js`** (do not edit existing tests): `digipinEncodeQuery` happy path + `DIGIPIN_OUT_OF_BOUNDS` case + fallthrough to `VALIDATION_ERROR` for garbage input; `digipinDecodeQuery` happy path + `INVALID_DIGIPIN` case.
- **New `test/unit/properties.location.test.js`**: import `attachDigipin` directly and assert — adds a `digipin` string when lat/lng present and in-bounds; returns `digipin: null` (all other fields unchanged) when out-of-bounds or when lat/lng are null; returns `null` untouched when passed `null` (property has no saved location); never throws.

## Verification

1. `npm test` — run the full suite (`node --test test/unit/*.test.js`); confirm the three new/updated test files pass and nothing existing regresses.
2. Manually exercise the new endpoints against a running dev server: `GET /api/v1/geo/digipin/encode?lat=28.6139&lng=77.2090` → `{ digipin }`; feed that code into `GET /api/v1/geo/digipin/decode?digipin=...` → coordinates close to the original; try an out-of-India coordinate and a malformed code to confirm `DIGIPIN_OUT_OF_BOUNDS`/`INVALID_DIGIPIN` responses.
3. `GET /api/v1/properties/:propertyId/location` (as the owning user) on a property that already has saved coordinates — confirm the response now includes a `digipin` field alongside all previously-existing fields, unchanged.
4. Diff-review that `properties.repository.js`, `properties.routes.js`, `properties.controller.js`, `properties.validation.js`, and the `saveLocation` path in `properties.service.js` are byte-identical to before.
