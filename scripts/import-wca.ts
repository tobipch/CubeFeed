/**
 * Downloads the latest WCA developer export and imports data into MariaDB.
 *
 * Usage:
 *   npm run db:import
 *
 * Required env:
 *   MYSQL_HOST      – MariaDB hostname
 *   MYSQL_USER      – Database user
 *   MYSQL_PASSWORD  – Database password
 *   MYSQL_DATABASE  – Database name
 *
 * Optional env:
 *   MYSQL_PORT      – Port (default: 3306)
 *   WCA_EXPORT_URL  – Override the default download URL
 */
import "dotenv/config";
import { runWcaImport } from "../lib/wca-import";

runWcaImport().catch((err) => {
  console.error(err);
  process.exit(1);
});
