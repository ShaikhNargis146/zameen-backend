export const TEMPLATE_FILE_NAME = "zameen-property-listing-bulk-upload-template.csv";
export const MAX_ROWS_PER_UPLOAD = 500;
export const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024;
// Browsers/OS report wildly inconsistent mimetypes for .csv (text/csv,
// application/vnd.ms-excel from Excel-on-Windows, application/octet-stream,
// even text/plain), so the route filter checks the file extension first and
// only falls back to this set as a secondary signal.
export const UPLOAD_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
  "application/octet-stream"
]);

export const TRANSACTION_TYPES = new Set(["SALE", "LEASE"]);
export const LANGUAGES = new Set(["en", "hi", "mr", "gu", "pa", "te", "ta"]);
export const DIMENSION_UNITS = new Set(["FT", "M"]);
export const ROAD_TYPES = new Set(["PUCCA", "KUTCHA", "HIGHWAY", "OTHER"]);
export const FACINGS = new Set(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
export const TERRAINS = new Set(["FLAT", "SLOPED", "UNEVEN", "OTHER"]);
export const ROAD_ACCESS_TYPES = new Set([
  "DIRECT",
  "SHARED",
  "NO_DIRECT",
  "OTHER"
]);
export const LOCATION_PRECISIONS = new Set(["EXACT", "APPROXIMATE"]);

// Column order doubles as the CSV template's header row, so every
// row-parsing lookup and the downloadable sample stay driven by this single
// list. Full format/allowed-value documentation lives in
// docs/Zameen_API_PLAN_FULL.md (Listing Creation & Management).
export const COLUMNS = [
  { key: "title", required: true, example: "2 Acre Agricultural Land near Panvel Highway" },
  { key: "description", required: true, example: "Well-connected agricultural land with borewell and approach road, close to the highway." },
  { key: "transactionType", required: true, example: "SALE" },
  { key: "priceAmountINR", required: true, example: 4250000 },
  { key: "isNegotiable", required: false, example: "FALSE" },
  { key: "canonicalLanguage", required: false, example: "en" },
  { key: "propertyTypeCode", required: true, example: "AGRICULTURAL_LAND" },
  { key: "landUseTypeCode", required: false, example: "AGRICULTURAL" },
  { key: "ownershipTypeCode", required: false, example: "FREEHOLD" },
  { key: "organizationId", required: false, example: "" },
  { key: "areaValue", required: true, example: 2 },
  { key: "areaUnitCode", required: true, example: "ACRE" },
  { key: "lengthValue", required: false, example: "" },
  { key: "widthValue", required: false, example: "" },
  { key: "dimensionUnit", required: false, example: "" },
  { key: "frontageM", required: false, example: "" },
  { key: "roadWidthM", required: false, example: 12 },
  { key: "roadType", required: false, example: "PUCCA" },
  { key: "facing", required: false, example: "E" },
  { key: "openSides", required: false, example: 2 },
  { key: "isCornerPlot", required: false, example: "FALSE" },
  { key: "hasBoundaryWall", required: false, example: "" },
  { key: "terrain", required: false, example: "FLAT" },
  { key: "roadAccessType", required: false, example: "DIRECT" },
  { key: "locationId", required: true, example: "00000000-0000-0000-0000-000000000000" },
  { key: "pincode", required: false, example: "410206" },
  { key: "addressLine", required: false, example: "" },
  { key: "landmark", required: false, example: "" },
  { key: "latitude", required: false, example: "" },
  { key: "longitude", required: false, example: "" },
  { key: "locationPrecision", required: false, example: "APPROXIMATE" },
  { key: "showExactLocation", required: false, example: "FALSE" },
  { key: "amenityCodes", required: false, example: "WATER;ELECTRICITY" }
];
