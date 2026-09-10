import "../src/config/env.js";
import db from "../src/config/postgres.config.js";

const stateCode = "MH";
const globalMasters = Object.freeze({
  propertyTypes: [
    ["RESIDENTIAL_PLOT", "Residential Plot", 10],
    ["AGRICULTURAL_LAND", "Agricultural Land", 20],
    ["INDUSTRIAL_LAND", "Industrial Land", 30],
    ["COMMERCIAL_LAND", "Commercial Land", 40],
    ["INSTITUTIONAL_LAND", "Institutional Land", 50],
    ["FARM_LAND", "Farm Land", 60],
    ["MIXED_USE", "Mixed Use", 70],
    ["OTHER", "Other", 99]
  ],
  landUseTypes: [
    ["RESIDENTIAL", "Residential", 10],
    ["AGRICULTURAL", "Agricultural", 20],
    ["INDUSTRIAL", "Industrial", 30],
    ["COMMERCIAL", "Commercial", 40],
    ["INSTITUTIONAL", "Institutional", 50],
    ["MIXED_USE", "Mixed Use", 60]
  ],
  ownershipTypes: [
    ["FREEHOLD", "Freehold", 10],
    ["LEASEHOLD", "Leasehold", 20],
    ["POWER_OF_ATTORNEY", "Power of Attorney", 30],
    ["OTHER", "Other", 99]
  ],
  areaUnits: [
    ["SQFT", "Square feet", 1],
    ["SQYD", "Square yards", 9],
    ["SQM", "Square metres", 10.76391042],
    ["ACRE", "Acre", 43560],
    ["HECTARE", "Hectare", 107639.1042],
    ["GUNTHA", "Guntha", 1089],
    ["KANAL", "Kanal", 5445],
    ["CENT", "Cent", 435.6]
  ],
  amenities: [
    ["WATER", "Water", "UTILITIES", 10],
    ["ELECTRICITY", "Electricity", "UTILITIES", 20],
    ["BOREWELL", "Borewell", "UTILITIES", 30],
    ["DRAINAGE", "Drainage", "UTILITIES", 40],
    ["APPROACH_ROAD", "Approach Road", "ACCESS", 50],
    ["STREET_LIGHT", "Street Light", "ACCESS", 60],
    ["BOUNDARY_WALL", "Boundary Wall", "SECURITY", 70]
  ],
  documentTypes: [
    ["SALE_DEED", "Sale Deed", 10],
    ["SEVEN_TWELVE", "7/12 Extract", 20],
    ["PROPERTY_CARD", "Property Card", 30],
    ["MUTATION", "Mutation", 40],
    ["NA_ORDER", "NA Order", 50],
    ["TITLE_REPORT", "Title Report", 60],
    ["TAX_RECEIPT", "Tax Receipt", 70],
    ["SURVEY_PLAN", "Survey Plan", 80],
    ["LAYOUT_APPROVAL", "Layout Approval", 90],
    ["RERA", "RERA", 100],
    ["OTHER", "Other", 999]
  ]
});
const parcelIdentifiers = Object.freeze([
  {
    code: "SURVEY_NUMBER",
    name: "Survey Number",
    placeholder: "e.g. 123/4",
    sortOrder: 10
  },
  {
    code: "GAT_NUMBER",
    name: "Gat Number",
    placeholder: "e.g. 123/4",
    sortOrder: 20
  },
  {
    code: "CTS_NUMBER",
    name: "CTS Number",
    placeholder: "e.g. CTS No. 123",
    sortOrder: 30
  },
  {
    code: "PLOT_NUMBER",
    name: "Plot Number",
    placeholder: "e.g. Plot No. 12",
    sortOrder: 40
  }
]);

const seedGlobalMasters = async transaction => {
  for (const [code, name, sortOrder] of globalMasters.propertyTypes)
    await transaction.none(
      `INSERT INTO land.property_types (code, name, sort_order)
       VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`,
      [code, name, sortOrder]
    );
  for (const [code, name, sortOrder] of globalMasters.landUseTypes)
    await transaction.none(
      `INSERT INTO land.land_use_types (code, name, sort_order)
       VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`,
      [code, name, sortOrder]
    );
  for (const [code, name, sortOrder] of globalMasters.ownershipTypes)
    await transaction.none(
      `INSERT INTO land.ownership_types (code, name, sort_order)
       VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`,
      [code, name, sortOrder]
    );
  for (const [code, name, sqftMultiplier] of globalMasters.areaUnits)
    await transaction.none(
      `INSERT INTO land.area_units (code, name, sqft_multiplier)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [code, name, sqftMultiplier]
    );
  for (const [code, name, category, sortOrder] of globalMasters.amenities)
    await transaction.none(
      `INSERT INTO land.amenities (code, name, category, sort_order)
       VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`,
      [code, name, category, sortOrder]
    );
  for (const [code, name, sortOrder] of globalMasters.documentTypes)
    await transaction.none(
      `INSERT INTO land.document_types (code, name, sort_order)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [code, name, sortOrder]
    );
};

try {
  const states = await db.any(
    `SELECT id FROM geo.locations
     WHERE type = 'STATE' AND state_code = $1`,
    [stateCode]
  );
  if (!states.length)
    throw new Error(
      "Maharashtra is not loaded. Run npm run locations:import before seeding state masters."
    );
  if (states.length > 1)
    throw new Error(
      "Maharashtra has duplicate state records. Reconcile them before seeding state masters."
    );

  await db.tx(async transaction => {
    await seedGlobalMasters(transaction);
    await transaction.none(
      `INSERT INTO land.parcel_configurations (state_location_id, notes)
       VALUES ($1,$2)
       ON CONFLICT (state_location_id) DO UPDATE SET notes = EXCLUDED.notes`,
      [
        states[0].id,
        "Enter at least one applicable Maharashtra land-record identifier. Use Survey or Gat Number for revenue land; use CTS Number or Plot Number where applicable."
      ]
    );
    for (const identifier of parcelIdentifiers)
      await transaction.none(
        `INSERT INTO land.parcel_identifier_types
         (state_location_id, code, name, is_required, placeholder, is_active, sort_order)
         VALUES ($1,$2,$3,false,$4,true,$5)
         ON CONFLICT (state_location_id, code) DO UPDATE SET
           name = EXCLUDED.name,
           is_required = EXCLUDED.is_required,
           placeholder = EXCLUDED.placeholder,
           is_active = true,
           sort_order = EXCLUDED.sort_order`,
        [
          states[0].id,
          identifier.code,
          identifier.name,
          identifier.placeholder,
          identifier.sortOrder
        ]
      );
  });
  console.log(
    JSON.stringify(
      { stateCode, supportedIdentifiers: parcelIdentifiers.map(item => item.code) },
      null,
      2
    )
  );
} catch (error) {
  console.error(`State master seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.$pool.end();
}
