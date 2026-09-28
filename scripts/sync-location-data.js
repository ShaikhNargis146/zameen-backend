import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: rootDirectory, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
};

try {
  // This is the standard, non-destructive operational command. Import identity
  // is the LGD code encoded in each slug, so it safely creates new records and
  // reconciles names/state codes without creating a second hierarchy.
  run("python3", [
    "scripts/prepare-location-data.py",
    "--input-dir",
    "locations_data",
    "--output-dir",
    ".location-import"
  ]);
  run(process.execPath, [
    "scripts/import-locations.js",
    "--input-dir",
    ".location-import",
    "--check"
  ]);
  run(process.execPath, [
    "scripts/import-locations.js",
    "--input-dir",
    ".location-import",
    "--apply"
  ]);
  run(process.execPath, ["scripts/seed-state-masters.js"]);
} catch (error) {
  console.error(`Location sync failed: ${error.message}`);
  process.exitCode = 1;
}
