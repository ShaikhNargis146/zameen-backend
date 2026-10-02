import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { HttpError } from "../../shared/http.js";
import logger from "../../utils/logger.js";
import { COLUMNS, MAX_ROWS_PER_UPLOAD } from "./listings.bulk-upload.constants.js";
import * as repository from "./listings.bulk-upload.repository.js";
import { buildTemplateCsv } from "./listings.bulk-upload.template.js";
import { parseRow } from "./listings.bulk-upload.validation.js";

export const sampleTemplate = async () => buildTemplateCsv();

const parseCsv = buffer => {
  try {
    // Raw arrays (not `columns: true`) so header matching can stay
    // case-insensitive, same as a spreadsheet header lookup would be.
    return parse(buffer, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true
    });
  } catch (error) {
    throw new HttpError(
      400,
      "INVALID_FILE",
      "The uploaded file is not a valid CSV file."
    );
  }
};
const requiredColumnKeys = COLUMNS.filter(column => column.required).map(
  column => column.key
);
const headerIndex = headerRow => {
  const byKey = new Map();
  headerRow.forEach((text, columnIndex) => {
    const key = String(text ?? "").trim().toLowerCase();
    if (key) byKey.set(key, columnIndex);
  });
  const columnIndexByKey = new Map();
  for (const column of COLUMNS) {
    const columnIndex = byKey.get(column.key.toLowerCase());
    if (columnIndex !== undefined) columnIndexByKey.set(column.key, columnIndex);
  }
  const missing = requiredColumnKeys.filter(key => !columnIndexByKey.has(key));
  if (missing.length)
    throw new HttpError(
      400,
      "TEMPLATE_INVALID",
      "The uploaded file is missing required columns. Please use the provided sample template.",
      missing.map(field => ({ field, message: `Column "${field}" was not found.` }))
    );
  return columnIndexByKey;
};

const priceToMinor = amountINR => {
  const minor = Math.round(amountINR * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};

const resolveRow = (data, masters, locationsById, postalCodesByCode, existingOrgIds) => {
  const errors = [];
  const propertyTypeId = masters.propertyTypesByCode.get(data.propertyTypeCode);
  if (!propertyTypeId)
    errors.push({
      field: "propertyTypeCode",
      message: `propertyTypeCode "${data.propertyTypeCode}" was not found.`
    });
  let landUseTypeId = null;
  if (data.landUseTypeCode) {
    landUseTypeId = masters.landUseTypesByCode.get(data.landUseTypeCode);
    if (!landUseTypeId)
      errors.push({
        field: "landUseTypeCode",
        message: `landUseTypeCode "${data.landUseTypeCode}" was not found.`
      });
  }
  let ownershipTypeId = null;
  if (data.ownershipTypeCode) {
    ownershipTypeId = masters.ownershipTypesByCode.get(data.ownershipTypeCode);
    if (!ownershipTypeId)
      errors.push({
        field: "ownershipTypeCode",
        message: `ownershipTypeCode "${data.ownershipTypeCode}" was not found.`
      });
  }
  if (data.organizationId && !existingOrgIds.has(data.organizationId))
    errors.push({
      field: "organizationId",
      message: "organizationId does not exist."
    });
  const location = locationsById.get(data.locationId);
  if (!location)
    errors.push({
      field: "locationId",
      message: "locationId does not exist or is inactive."
    });
  let postalCodeId = null;
  if (data.pincode) {
    postalCodeId = postalCodesByCode.get(data.pincode);
    if (!postalCodeId)
      errors.push({ field: "pincode", message: "pincode is not configured." });
  }
  const areaUnitCandidates = masters.areaUnitsByCode.get(data.areaUnitCode) || [];
  let areaUnit = null;
  if (!areaUnitCandidates.length)
    errors.push({
      field: "areaUnitCode",
      message: `areaUnitCode "${data.areaUnitCode}" was not found.`
    });
  else if (areaUnitCandidates.length === 1) areaUnit = areaUnitCandidates[0];
  else {
    areaUnit =
      areaUnitCandidates.find(candidate => !candidate.stateCode) ||
      (location &&
        areaUnitCandidates.find(candidate => candidate.stateCode === location.stateCode));
    if (!areaUnit)
      errors.push({
        field: "areaUnitCode",
        message: `areaUnitCode "${data.areaUnitCode}" is not available for the selected location's state.`
      });
  }
  const amenities = [];
  for (const entry of data.amenityCodes) {
    const amenityId = masters.amenitiesByCode.get(entry.code);
    if (!amenityId)
      errors.push({
        field: "amenityCodes",
        message: `amenityCodes "${entry.code}" was not found.`
      });
    else amenities.push({ amenityId, valueText: entry.valueText });
  }
  const priceAmountMinor = priceToMinor(data.priceAmountINR);
  if (priceAmountMinor == null)
    errors.push({ field: "priceAmountINR", message: "priceAmountINR is out of range." });
  if (errors.length) return { errors };
  return {
    errors: [],
    row: {
      title: data.title,
      description: data.description,
      transactionType: data.transactionType,
      priceAmountMinor,
      isNegotiable: data.isNegotiable,
      canonicalLanguage: data.canonicalLanguage,
      propertyTypeId,
      landUseTypeId,
      ownershipTypeId,
      organizationId: data.organizationId,
      areaValue: data.areaValue,
      areaUnitId: areaUnit.id,
      areaSqft: data.areaValue * Number(areaUnit.sqftMultiplier),
      lengthValue: data.lengthValue,
      widthValue: data.widthValue,
      dimensionUnit: data.dimensionUnit,
      frontageM: data.frontageM,
      roadWidthM: data.roadWidthM,
      roadType: data.roadType,
      facing: data.facing,
      openSides: data.openSides,
      isCornerPlot: data.isCornerPlot,
      hasBoundaryWall: data.hasBoundaryWall,
      terrain: data.terrain,
      roadAccessType: data.roadAccessType,
      locationId: data.locationId,
      postalCodeId,
      addressLine: data.addressLine,
      landmark: data.landmark,
      latitude: data.latitude,
      longitude: data.longitude,
      locationPrecision: data.locationPrecision,
      showExactLocation: data.showExactLocation,
      amenities
    }
  };
};

const dbErrorMessage = error => {
  if (error?.code === "23503")
    return "One or more referenced values (organisation, property type, land use, ownership, area unit, or location) no longer exist.";
  if (error?.code === "23514")
    return "One or more values violate a database constraint. Please check numeric ranges and enum values.";
  return "This row could not be saved due to a server error.";
};

const insertWithRetry = async ({ actorId, row }) => {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await repository.createPropertyListing({ actorId, row, randomUUID });
    } catch (error) {
      lastError = error;
      if (error?.code !== "23505") break;
    }
  }
  throw lastError;
};

export const processUpload = async ({ file, actorId }) => {
  if (!file)
    throw new HttpError(400, "FILE_REQUIRED", "A CSV (.csv) file is required.");
  const records = parseCsv(file.buffer);
  if (!records.length)
    throw new HttpError(400, "TEMPLATE_INVALID", "The uploaded file has no header row.");
  const columnIndexByKey = headerIndex(records[0]);

  const parsedByRow = new Map();
  let rowCount = 0;
  for (let i = 1; i < records.length; i += 1) {
    const record = records[i];
    const rowNumber = i + 1; // 1-based, matching the file's own line numbers
    const valuesByColumn = {};
    for (const [key, columnIndex] of columnIndexByKey)
      valuesByColumn[key] = record[columnIndex];
    const parsed = parseRow(valuesByColumn);
    if (parsed.blank) continue;
    rowCount += 1;
    if (rowCount > MAX_ROWS_PER_UPLOAD)
      throw new HttpError(
        400,
        "TOO_MANY_ROWS",
        `A single upload can contain at most ${MAX_ROWS_PER_UPLOAD} rows.`
      );
    parsedByRow.set(rowNumber, parsed);
  }
  if (!parsedByRow.size)
    throw new HttpError(400, "NO_ROWS", "The uploaded file has no data rows.");

  const mastersRaw = await repository.activeMasters();
  const masters = {
    propertyTypesByCode: new Map(mastersRaw.propertyTypes.map(row => [row.code, row.id])),
    landUseTypesByCode: new Map(mastersRaw.landUseTypes.map(row => [row.code, row.id])),
    ownershipTypesByCode: new Map(mastersRaw.ownershipTypes.map(row => [row.code, row.id])),
    amenitiesByCode: new Map(mastersRaw.amenities.map(row => [row.code, row.id])),
    areaUnitsByCode: mastersRaw.areaUnits.reduce((map, row) => {
      if (!map.has(row.code)) map.set(row.code, []);
      map.get(row.code).push(row);
      return map;
    }, new Map())
  };

  const locationIds = [
    ...new Set(
      [...parsedByRow.values()]
        .filter(parsed => !parsed.errors.length && parsed.data.locationId)
        .map(parsed => parsed.data.locationId)
    )
  ];
  const pincodes = [
    ...new Set(
      [...parsedByRow.values()]
        .filter(parsed => !parsed.errors.length && parsed.data.pincode)
        .map(parsed => parsed.data.pincode)
    )
  ];
  const organizationIds = [
    ...new Set(
      [...parsedByRow.values()]
        .filter(parsed => !parsed.errors.length && parsed.data.organizationId)
        .map(parsed => parsed.data.organizationId)
    )
  ];
  const [locations, postalCodes, existingOrgIds] = await Promise.all([
    repository.locationsByIds(locationIds),
    repository.postalCodesByCodes(pincodes),
    repository.existingOrganizationIds(organizationIds)
  ]);
  const locationsById = new Map(locations.map(row => [row.id, row]));
  const postalCodesByCode = new Map(postalCodes.map(row => [row.code, row.id]));

  const created = [];
  const failed = [];
  for (const [rowNumber, parsed] of parsedByRow) {
    if (parsed.errors.length) {
      failed.push({ rowNumber, errors: parsed.errors });
      continue;
    }
    const resolved = resolveRow(
      parsed.data,
      masters,
      locationsById,
      postalCodesByCode,
      existingOrgIds
    );
    if (resolved.errors.length) {
      failed.push({ rowNumber, errors: resolved.errors });
      continue;
    }
    try {
      // Rows are inserted one at a time (not in one big transaction) so a
      // single bad row never rolls back the rows that already succeeded —
      // the whole point of returning per-row success/error counts.
      const saved = await insertWithRetry({ actorId, row: resolved.row });
      created.push({
        rowNumber,
        propertyId: saved.propertyId,
        listingId: saved.listingId,
        listingCode: saved.listingCode
      });
    } catch (error) {
      logger.error(`Bulk listing upload row ${rowNumber} failed: ${error?.message}`);
      failed.push({
        rowNumber,
        errors: [{ field: null, message: dbErrorMessage(error) }]
      });
    }
  }

  return {
    totalRows: parsedByRow.size,
    successCount: created.length,
    errorCount: failed.length,
    created,
    errors: failed
  };
};
