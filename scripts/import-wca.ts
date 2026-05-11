/**
 * Downloads the latest WCA developer export and imports Swiss data into PostgreSQL.
 *
 * Usage:
 *   npm run db:import
 */
import "dotenv/config";
import { runWcaImport } from "../lib/wca-import.js";

runWcaImport().catch((err) => {
  console.error(err);
  process.exit(1);
});
