import "../src/config/env.js";
import db from "../src/config/postgres.config.js";

const stateCode = "MH";
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
