import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { fetchPRsImpl } from "./queries";

const WCA_EXPORT_URL =
  process.env.WCA_EXPORT_URL ??
  "https://www.worldcubeassociation.org/export/results/v2/tsv";

const INSERT_BATCH = 100;

type SqlValue = string | number | null;

async function download(url: string, dest: string): Promise<void> {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "CubeFeed/1.0 (https://github.com/tobipch/cubefeed)" },
  });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const out = createWriteStream(dest);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, out);
  console.log(`Saved to ${dest}`);
}

async function* readTSV(filePath: string): AsyncGenerator<Record<string, string>> {
  const rl = readline.createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let headers: string[] = [];
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) { headers = line.split("\t"); isHeader = false; continue; }
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = cols[i] ?? "";
    yield row;
  }
}

async function bulkInsert(
  pool: Pool,
  table: string,
  columns: string[],
  rows: SqlValue[][],
  onDuplicate = ""
): Promise<void> {
  if (rows.length === 0) return;
  const colList = columns.join(", ");
  const rowPlaceholder = `(${columns.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH);
    await pool.execute(
      `INSERT INTO ${table} (${colList}) VALUES ${chunk.map(() => rowPlaceholder).join(", ")} ${onDuplicate}`,
      chunk.flat()
    );
  }
}

function deduplicateBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = keyFn(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function col(row: Record<string, string>, snake: string, camel?: string): string {
  return row[snake] ?? (camel ? row[camel] : undefined) ?? "";
}

function buildDate(year: string, month: string, day: string): string | null {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function importCompetitions(pool: Pool, filePath: string): Promise<void> {
  console.log("Importing competitions...");
  const columns = ["id", "name", "city_name", "country_id", "start_date", "end_date"];
  const rows: SqlValue[][] = [];
  for await (const row of readTSV(filePath)) {
    rows.push([
      row["id"], row["name"],
      col(row, "city_name", "cityName"),
      col(row, "country_id", "countryId"),
      buildDate(row["year"], row["month"], row["day"]),
      buildDate(row["end_year"], row["end_month"], row["end_day"]),
    ]);
  }
  await bulkInsert(pool, "competitions", columns, rows,
    `ON DUPLICATE KEY UPDATE name=VALUES(name), city_name=VALUES(city_name), country_id=VALUES(country_id), start_date=VALUES(start_date), end_date=VALUES(end_date)`);
  console.log(`  Imported ${rows.length} competitions`);
}

async function importPersons(
  pool: Pool,
  filePath: string
): Promise<{ personCountryMap: Map<string, string> }> {
  console.log("Importing all persons (worldwide)...");
  const personCountryMap = new Map<string, string>();
  const allRows: { key: string; values: SqlValue[] }[] = [];
  for await (const row of readTSV(filePath)) {
    const countryId = col(row, "country_id", "countryId");
    const id = row["id"] ?? row["wca_id"] ?? "";
    if (!id) continue;
    if (countryId) personCountryMap.set(id, countryId);
    const subId = Number(row["subid"]) || 0;
    allRows.push({ key: `${id}:${subId}`, values: [id, subId, row["name"], countryId] });
  }
  const deduped = deduplicateBy(allRows, (r) => r.key).map((r) => r.values);
  await bulkInsert(pool, "persons", ["wca_id", "sub_id", "name", "country_id"], deduped,
    `ON DUPLICATE KEY UPDATE name=VALUES(name), country_id=VALUES(country_id)`);
  console.log(`  Imported ${deduped.length} persons`);
  return { personCountryMap };
}

async function importResults(pool: Pool, filePath: string): Promise<void> {
  const [existingRows] = await pool.execute<RowDataPacket[]>(
    "SELECT DISTINCT competition_id FROM results"
  );
  const existingCompIds = new Set(existingRows.map((r) => r.competition_id as string));
  const isIncremental = existingCompIds.size > 0;
  console.log(
    isIncremental
      ? `Importing results — skipping ${existingCompIds.size} already-imported competitions...`
      : "Importing all results (first run, full import)..."
  );
  const columns = [
    "competition_id", "event_id", "round_type_id", "pos", "best", "average",
    "person_name", "person_id", "person_country_id", "format_id",
    "regional_single_record", "regional_average_record",
  ];
  const rows: SqlValue[][] = [];
  const newCompIds = new Set<string>();
  for await (const row of readTSV(filePath)) {
    const competitionId = col(row, "competition_id", "competitionId");
    if (existingCompIds.has(competitionId)) continue;
    newCompIds.add(competitionId);
    rows.push([
      competitionId,
      col(row, "event_id",                "eventId"),
      col(row, "round_type_id",           "roundTypeId"),
      Number(row["pos"]) || 0,
      Number(row["best"]) || 0,
      Number(row["average"]) || 0,
      col(row, "person_name",             "personName"),
      col(row, "person_id",               "personId"),
      col(row, "person_country_id",       "personCountryId"),
      col(row, "format_id",               "formatId"),
      col(row, "regional_single_record",  "regionalSingleRecord") || null,
      col(row, "regional_average_record", "regionalAverageRecord") || null,
    ]);
  }
  await bulkInsert(pool, "results", columns, rows);
  console.log(`  Imported ${rows.length} results from ${newCompIds.size} new competitions`);
}

async function importRanks(
  pool: Pool,
  filePath: string,
  table: "ranks_single" | "ranks_average",
  personCountryMap: Map<string, string>,
  personContinentMap: Map<string, string>
): Promise<void> {
  console.log(`Importing ${table}...`);
  const columns = [
    "person_id", "event_id", "best",
    "world_rank", "continent_rank", "country_rank",
    "country_id", "continent_id",
  ];
  const allRows: { key: string; values: SqlValue[] }[] = [];
  for await (const row of readTSV(filePath)) {
    const personId = col(row, "person_id", "personId");
    if (!personId) continue;
    allRows.push({
      key: `${personId}:${col(row, "event_id", "eventId")}`,
      values: [
        personId,
        col(row, "event_id",       "eventId"),
        Number(row["best"]) || 0,
        Number(col(row, "world_rank",     "worldRank"))     || null,
        Number(col(row, "continent_rank", "continentRank")) || null,
        Number(col(row, "country_rank",   "countryRank"))   || null,
        personCountryMap.get(personId) ?? null,
        personContinentMap.get(personId) ?? null,
      ],
    });
  }
  const deduped = deduplicateBy(allRows, (r) => r.key).map((r) => r.values);
  await bulkInsert(pool, table, columns, deduped,
    `ON DUPLICATE KEY UPDATE
      prev_best      = CASE WHEN best != VALUES(best) THEN best ELSE prev_best END,
      best           = VALUES(best),
      world_rank     = VALUES(world_rank),
      continent_rank = VALUES(continent_rank),
      country_rank   = VALUES(country_rank),
      country_id     = VALUES(country_id),
      continent_id   = VALUES(continent_id)`);
  console.log(`  Imported ${deduped.length} ${table} entries`);
}

async function importCountries(pool: Pool, filePath: string): Promise<void> {
  console.log("Importing countries...");
  const rows: SqlValue[][] = [];
  for await (const row of readTSV(filePath)) {
    const id = row["id"] ?? "";
    const continentId = col(row, "continent_id", "continentId");
    if (id && continentId) rows.push([id, continentId]);
  }
  await bulkInsert(pool, "countries", ["id", "continent_id"], rows,
    `ON DUPLICATE KEY UPDATE continent_id=VALUES(continent_id)`);
  console.log(`  Imported ${rows.length} countries`);
}

async function buildPersonContinentMap(personsFile: string, countriesFile: string): Promise<Map<string, string>> {
  const continentMap = new Map<string, string>();
  for await (const row of readTSV(countriesFile)) {
    const id = row["id"] ?? "";
    const continentId = col(row, "continent_id", "continentId");
    if (id && continentId) continentMap.set(id, continentId);
  }
  const personContinentMap = new Map<string, string>();
  for await (const row of readTSV(personsFile)) {
    const personId = row["id"] ?? "";
    const countryId = col(row, "country_id", "countryId");
    const continentId = continentMap.get(countryId) ?? "";
    if (personId) personContinentMap.set(personId, continentId);
  }
  return personContinentMap;
}

async function importRankBrackets(
  pool: Pool,
  singleFile: string,
  avgFile: string,
  personContinentMap: Map<string, string>
): Promise<void> {
  console.log("Importing rank brackets...");
  for (const [type, filePath] of [["single", singleFile], ["average", avgFile]] as const) {
    const brackets = new Map<string, { world_rank: number; europe_rank: number | null }>();
    for await (const row of readTSV(filePath)) {
      const worldRank = Number(col(row, "world_rank", "worldRank")) || 0;
      if (!worldRank) continue;
      const personId = col(row, "person_id", "personId");
      const eventId  = col(row, "event_id",  "eventId");
      const best     = Number(row["best"]) || 0;
      const contRank = Number(col(row, "continent_rank", "continentRank")) || 0;
      if (!best || !eventId) continue;
      const isEurope = personContinentMap.get(personId) === "_Europe";
      const key = `${eventId}:${best}`;
      const cur = brackets.get(key);
      if (!cur) {
        brackets.set(key, { world_rank: worldRank, europe_rank: isEurope && contRank > 0 ? contRank : null });
      } else {
        if (worldRank < cur.world_rank) cur.world_rank = worldRank;
        if (isEurope && contRank > 0) cur.europe_rank = cur.europe_rank === null ? contRank : Math.min(cur.europe_rank, contRank);
      }
    }
    const rows = Array.from(brackets.entries()).map(([key, val]) => {
      const colon = key.indexOf(":");
      return [key.slice(0, colon), type, Number(key.slice(colon + 1)), val.world_rank, val.europe_rank] as SqlValue[];
    });
    await bulkInsert(pool, "rank_brackets", ["event_id", "type", "best", "world_rank", "europe_rank"], rows,
      `ON DUPLICATE KEY UPDATE
        world_rank  = LEAST(world_rank,  VALUES(world_rank)),
        europe_rank = COALESCE(LEAST(europe_rank, VALUES(europe_rank)), europe_rank, VALUES(europe_rank))`);
    console.log(`  ${type}: ${rows.length} brackets`);
  }
}

const CACHE_DAYS = [3, 7, 14, 30, 60, 90];

async function buildPRCache(pool: Pool): Promise<void> {
  console.log("Building PR cache...");
  for (const days of CACHE_DAYS) {
    const persons = await fetchPRsImpl(days);
    await pool.execute(
      `INSERT INTO pr_cache (days, result, computed_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE result=VALUES(result), computed_at=VALUES(computed_at)`,
      [days, JSON.stringify(persons)]
    );
    console.log(`  ${days}d → ${persons.length} persons`);
  }
}

export async function runWcaImport(): Promise<void> {
  const host = process.env.MYSQL_HOST;
  if (!host) throw new Error("MYSQL_HOST is not set");

  const pool = mysql.createPool({
    host,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",
    ssl: { rejectUnauthorized: false },
  });

  const tmpDir = join(tmpdir(), `wca-import-${Date.now()}`);
  const zipPath = join(tmpDir, "WCA_export.zip");
  const extractDir = join(tmpDir, "extracted");

  await mkdir(tmpDir, { recursive: true });
  await mkdir(extractDir, { recursive: true });

  try {
    await download(WCA_EXPORT_URL, zipPath);

    console.log("Extracting ZIP...");
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    const entries = await readdir(extractDir, { recursive: true });
    const tsvFiles = entries.map(String).filter((f) => f.endsWith(".tsv"));
    console.log("Found TSV files:", tsvFiles);

    function findTsv(keyword: string): string {
      const match = tsvFiles.find((f) => f.toLowerCase().includes(keyword.toLowerCase()));
      if (!match) throw new Error(`No TSV file found for keyword: ${keyword}`);
      return join(extractDir, match);
    }

    const personsFile = findTsv("Persons");
    const countriesFile = findTsv("Countries");
    const { personCountryMap } = await importPersons(pool, personsFile);
    await importCompetitions(pool, findTsv("Competitions"));
    await importResults(pool, findTsv("Results"));

    try {
      await importCountries(pool, countriesFile);
    } catch (e) {
      console.warn("Could not import countries:", e);
    }

    let personContinentMap = new Map<string, string>();
    try {
      personContinentMap = await buildPersonContinentMap(personsFile, countriesFile);
    } catch (e) {
      console.warn("Could not build personContinentMap:", e);
    }

    await importRanks(pool, findTsv("ranks_single"),  "ranks_single",  personCountryMap, personContinentMap);
    await importRanks(pool, findTsv("ranks_average"), "ranks_average", personCountryMap, personContinentMap);

    // Fix any NULL or empty continent_id values by joining ranks with
    // persons + countries tables. This handles athletes missed by the
    // in-memory personContinentMap (e.g. new competitors) as well as rows
    // that got an empty string written during a previous import.
    console.log("Fixing NULL/empty continent_id in ranks tables...");
    for (const table of ["ranks_single", "ranks_average"] as const) {
      await pool.execute(
        `UPDATE ${table} r
         JOIN countries c ON r.country_id = c.id
         SET r.continent_id = c.continent_id
         WHERE r.continent_id IS NULL OR r.continent_id = ''`
      );
    }
    console.log("  Done");

    try {
      await importRankBrackets(pool, findTsv("ranks_single"), findTsv("ranks_average"), personContinentMap);
    } catch (e) {
      console.warn("Skipping rank_brackets import:", e);
    }

    await buildPRCache(pool);

    await pool.execute(
      `INSERT INTO import_metadata (\`key\`, value, updated_at)
       VALUES ('imported_at', NOW(), NOW())
       ON DUPLICATE KEY UPDATE value=NOW(), updated_at=NOW()`
    );
    console.log("\nImport complete!");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    await pool.end();
  }
}
