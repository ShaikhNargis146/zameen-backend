import "../src/config/env.js";
import db from "../src/config/postgres.config.js";

const pincodeArgument = process.argv.find(argument =>
  argument.startsWith("--pincode=")
);
const pincode = pincodeArgument?.slice("--pincode=".length) || null;
const verbose = process.argv.includes("--verbose");

try {
  const schema = await db.one(
    "SELECT to_regclass('geo.locations') IS NOT NULL AS exists"
  );
  if (!schema.exists) {
    throw new Error("Canonical schema is missing. Run npm run db:schema first.");
  }

  if (pincode && !/^\d{6}$/.test(pincode)) {
    throw new Error("--pincode must contain exactly six digits.");
  }

  const [
    counts,
    duplicateKeys,
    duplicateNameCandidateCount,
    duplicateNameCandidates,
    pincodeStatus
  ] = await Promise.all([
    db.any(
      `SELECT 'locations' AS table_name, type AS category, count(*)::int AS count
       FROM geo.locations
       GROUP BY type
       UNION ALL
       SELECT 'location_aliases', 'TOTAL', count(*)::int FROM geo.location_aliases
       UNION ALL
       SELECT 'postal_codes', 'TOTAL', count(*)::int FROM geo.postal_codes
       UNION ALL
       SELECT 'postal_code_locations', 'TOTAL', count(*)::int FROM geo.postal_code_locations
       UNION ALL
       SELECT 'parcel_configurations', 'TOTAL', count(*)::int FROM land.parcel_configurations
       UNION ALL
       SELECT 'parcel_identifier_types', 'TOTAL', count(*)::int FROM land.parcel_identifier_types
       ORDER BY table_name, category`
    ),
    db.any(
      `SELECT type, COALESCE(parent_id::text, 'ROOT') AS parent_id, slug,
              count(*)::int AS count, array_agg(id ORDER BY id) AS location_ids
       FROM geo.locations
       GROUP BY type, parent_id, slug
       HAVING count(*) > 1
       ORDER BY count DESC, type, slug
       LIMIT 100`
    ),
    db.one(
      `SELECT count(*)::int AS count
       FROM (
         SELECT 1
         FROM geo.locations
         GROUP BY type, parent_id,
                  lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g'))
         HAVING count(*) > 1
       ) AS candidates`
    ),
    verbose
      ? db.any(
      `SELECT type, COALESCE(parent_id::text, 'ROOT') AS parent_id,
              lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) AS normalized_name,
              count(*)::int AS count,
              array_agg(json_build_object('id', id, 'slug', slug, 'name', name) ORDER BY id) AS locations
       FROM geo.locations
       GROUP BY type, parent_id, lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g'))
       HAVING count(*) > 1
       ORDER BY count DESC, type, normalized_name
       LIMIT 100`
      )
      : Promise.resolve([]),
    pincode
      ? db.oneOrNone(
          `SELECT postal_code.code, postal_code.state_code AS "stateCode",
                  coalesce(
                    json_agg(
                      json_build_object(
                        'id', location.id,
                        'name', location.name,
                        'type', location.type,
                        'stateCode', location.state_code
                      )
                      ORDER BY location.type, location.name
                    ) FILTER (WHERE location.id IS NOT NULL),
                    '[]'::json
                  ) AS locations
           FROM geo.postal_codes postal_code
           LEFT JOIN geo.postal_code_locations postal_code_location
             ON postal_code_location.postal_code_id = postal_code.id
           LEFT JOIN geo.locations location
             ON location.id = postal_code_location.location_id
           WHERE postal_code.code = $1
           GROUP BY postal_code.id, postal_code.code, postal_code.state_code`,
          [pincode]
        )
      : Promise.resolve(null)
  ]);

  console.log(
    JSON.stringify(
      {
        counts,
        duplicateExactKeys: duplicateKeys,
        duplicateNameCandidateCount: duplicateNameCandidateCount.count,
        ...(verbose ? { duplicateNameCandidates } : {}),
        ...(pincode ? { pincode: { code: pincode, configured: Boolean(pincodeStatus), details: pincodeStatus } } : {}),
        cleanupGuidance:
          "This command is read-only. Same-name candidates are normal in LGD data when different official codes share a label; only exact-key duplicates are import duplicates. Do not delete geo.locations until every referencing property, organization, content, partner, and postal-code link has been reviewed and reassigned."
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(`Location data status failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.$pool.end();
}
