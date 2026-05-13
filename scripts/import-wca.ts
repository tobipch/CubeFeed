/**
 * Downloads the latest WCA developer export and imports data into Turso/LibSQL.
 *
 * Usage:
 *   npm run db:import
 *
 * Required env:
 *   TURSO_DATABASE_URL  – libsql URL (e.g. libsql://db.turso.io or file:local.db)
 *   TURSO_AUTH_TOKEN    – Turso auth token (not needed for file: URLs)
 *
 * Optional env:
 *   WCA_EXPORT_URL – Override the default download URL
 */
import "dotenv/config";
import { runWcaImport } from "../lib/wca-import.js";

runWcaImport().catch((err) => {
  console.error(err);
  process.exit(1);
});
