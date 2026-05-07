/**
 * Downloads the latest WCA developer export and imports Swiss data into PostgreSQL.
 *
 * Usage:
 *   npm run db:import
 *
 * Required env:
 *   DATABASE_URL  – PostgreSQL connection string
 *
 * Optional env:
 *   WCA_EXPORT_URL – Override the default download URL
 *                    Default: https://www.worldcubeassociation.org/export/results/WCA_export.tsv.zip
 */

import "dotenv/config";
import { createWriteStream, createReadStream } from "node:fs";
// Import the query logic so we can pre-compute and cache the results
import { fetchPRsImpl } from "../lib/queries.js";
import { mkdir, unlink, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const WCA_EXPORT_URL =
  process.env.WCA_EXPORT_URL ??
  "https://www.worldcubeassociation.org/export/results/v2/tsv";

const COUNTRY = "Switzerland";
const BATCH_SIZE = 500;

const sql = postgres(DATABASE_URL, { ssl: "require", max: 5 });

// ─── Download ─────────────────────────────────────────────────────────────────

async function download(url: string, dest: string): Promise<void> {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const out = createWriteStream(dest);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, out);
  console.log(`Saved to ${dest}`);
}

// ─── TSV parsing ──────────────────────────────────────────────────────────────

async function* readTSV(
  filePath: string
): AsyncGenerator<Record<string, string>> {
  const rl = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      headers = line.split("\t");
      isHeader = false;
      continue;
    }
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cols[i] ?? "";
    }
    yield row;
  }
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

async function batchInsert<T>(
  items: T[],
  insertFn: (batch: T[]) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await insertFn(items.slice(i, i + BATCH_SIZE));
  }
}

function deduplicateBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Import functions ─────────────────────────────────────────────────────────

// Helper: returns value from row, checking snake_case first then camelCase fallback
function col(row: Record<string, string>, snake: string, camel?: string): string {
  return row[snake] ?? (camel ? row[camel] : undefined) ?? "";
}

function dateOrNull(val: string): string | null {
  return val && val.trim() ? val.trim() : null;
}

function buildDate(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function importCompetitions(filePath: string): Promise<void> {
  console.log("Importing competitions...");
  await sql`TRUNCATE competitions CASCADE`;

  const rows: {
    id: string; name: string; city_name: string;
    country_id: string; start_date: string | null; end_date: string | null;
  }[] = [];

  for await (const row of readTSV(filePath)) {
    rows.push({
      id: row["id"],
      name: row["name"],
      city_name: col(row, "city_name", "cityName"),
      country_id: col(row, "country_id", "countryId"),
      start_date: buildDate(row["year"], row["month"], row["day"]),
      end_date:   buildDate(row["end_year"], row["end_month"], row["end_day"]),
    });
  }

  await batchInsert(rows, async (batch) => {
    await sql`
      INSERT INTO competitions ${sql(batch)}
      ON CONFLICT (id) DO UPDATE SET
        name       = EXCLUDED.name,
        city_name  = EXCLUDED.city_name,
        country_id = EXCLUDED.country_id,
        start_date = EXCLUDED.start_date,
        end_date   = EXCLUDED.end_date
    `;
  });

  console.log(`  Imported ${rows.length} competitions`);
}

async function importPersons(
  filePath: string
): Promise<{ swissIds: Set<string>; personCountryMap: Map<string, string> }> {
  console.log("Importing all persons (worldwide)...");
  await sql`TRUNCATE persons`;

  const swissIds = new Set<string>();
  const personCountryMap = new Map<string, string>(); // wca_id → country_id (latest sub_id wins)
  const rows: { wca_id: string; sub_id: number; name: string; country_id: string }[] = [];

  for await (const row of readTSV(filePath)) {
    const countryId = col(row, "country_id", "countryId");
    const id = row["id"] ?? row["wca_id"] ?? "";
    if (!id) continue;
    if (countryId === COUNTRY) swissIds.add(id);
    if (countryId) personCountryMap.set(id, countryId);
    rows.push({
      wca_id: id,
      sub_id: Number(row["subid"]) || 0,
      name: row["name"],
      country_id: countryId,
    });
  }

  const deduped = deduplicateBy(rows, (r) => `${r.wca_id}:${r.sub_id}`);
  await batchInsert(deduped, async (batch) => {
    await sql`
      INSERT INTO persons ${sql(batch)}
      ON CONFLICT (wca_id, sub_id) DO UPDATE SET
        name       = EXCLUDED.name,
        country_id = EXCLUDED.country_id
    `;
  });

  console.log(`  Imported ${deduped.length} persons (${swissIds.size} Swiss)`);
  return { swissIds, personCountryMap };
}

async function importResults(filePath: string): Promise<void> {
  console.log("Importing Swiss results...");
  await sql`DELETE FROM results WHERE person_country_id = ${COUNTRY}`;

  const rows: {
    competition_id: string; event_id: string; round_type_id: string;
    pos: number; best: number; average: number; person_name: string;
    person_id: string; person_country_id: string; format_id: string;
    regional_single_record: string | null; regional_average_record: string | null;
  }[] = [];

  for await (const row of readTSV(filePath)) {
    const personCountryId = col(row, "person_country_id", "personCountryId");
    if (personCountryId !== COUNTRY) continue;

    rows.push({
      competition_id:          col(row, "competition_id",          "competitionId"),
      event_id:                col(row, "event_id",                "eventId"),
      round_type_id:           col(row, "round_type_id",           "roundTypeId"),
      pos:                     Number(row["pos"]) || 0,
      best:                    Number(row["best"]) || 0,
      average:                 Number(row["average"]) || 0,
      person_name:             col(row, "person_name",             "personName"),
      person_id:               col(row, "person_id",               "personId"),
      person_country_id:       personCountryId,
      format_id:               col(row, "format_id",               "formatId"),
      regional_single_record:  col(row, "regional_single_record",  "regionalSingleRecord") || null,
      regional_average_record: col(row, "regional_average_record", "regionalAverageRecord") || null,
    });
  }

  await batchInsert(rows, async (batch) => {
    await sql`INSERT INTO results ${sql(batch)}`;
  });

  console.log(`  Imported ${rows.length} results`);
}

async function importRanks(
  filePath: string,
  table: "ranks_single" | "ranks_average",
  personCountryMap: Map<string, string>,
  personContinentMap: Map<string, string>
): Promise<void> {
  console.log(`Importing ${table} (worldwide)...`);
  await sql`TRUNCATE ${sql(table)}`;

  const rows: {
    person_id: string; event_id: string; best: number;
    world_rank: number; continent_rank: number; country_rank: number;
    country_id: string | null; continent_id: string | null;
  }[] = [];

  for await (const row of readTSV(filePath)) {
    const personId = col(row, "person_id", "personId");
    if (!personId) continue;
    rows.push({
      person_id:      personId,
      event_id:       col(row, "event_id",       "eventId"),
      best:           Number(row["best"]) || 0,
      world_rank:     Number(col(row, "world_rank",     "worldRank"))     || 0,
      continent_rank: Number(col(row, "continent_rank", "continentRank")) || 0,
      country_rank:   Number(col(row, "country_rank",   "countryRank"))   || 0,
      country_id:     personCountryMap.get(personId) ?? null,
      continent_id:   personContinentMap.get(personId) || null,
    });
  }

  const deduped = deduplicateBy(rows, (r) => `${r.person_id}:${r.event_id}`);
  await batchInsert(deduped, async (batch) => {
    await sql`
      INSERT INTO ${sql(table)} ${sql(batch)}
      ON CONFLICT (person_id, event_id) DO UPDATE SET
        best           = EXCLUDED.best,
        world_rank     = EXCLUDED.world_rank,
        continent_rank = EXCLUDED.continent_rank,
        country_rank   = EXCLUDED.country_rank,
        country_id     = EXCLUDED.country_id,
        continent_id   = EXCLUDED.continent_id
    `;
  });

  console.log(`  Imported ${deduped.length} ${table} entries`);
}

// Import all global results into the rank_brackets table (no artificial cutoff).
// The table stores one row per unique (event_id, type, best_time) which compresses
// well — even with millions of competitors, unique times per event are far fewer.
const RANK_BRACKETS_LIMIT = Infinity;

async function buildPersonContinentMap(
  personsFile: string,
  countriesFile: string
): Promise<Map<string, string>> {
  // countryId → continentId
  const continentMap = new Map<string, string>();
  for await (const row of readTSV(countriesFile)) {
    const id = row["id"] ?? "";
    const continentId = col(row, "continent_id", "continentId");
    if (id && continentId) continentMap.set(id, continentId);
  }

  // personId → continentId
  const personContinentMap = new Map<string, string>();
  for await (const row of readTSV(personsFile)) {
    const personId = row["id"] ?? "";
    const countryId = col(row, "country_id", "countryId");
    const continentId = continentMap.get(countryId) ?? "";
    if (personId) personContinentMap.set(personId, continentId);
  }
  return personContinentMap;
}

async function importRankBracketsForType(
  filePath: string,
  type: "single" | "average",
  personContinentMap: Map<string, string>
): Promise<number> {
  interface Bracket {
    world_rank: number;
    europe_rank: number | null;
  }
  const brackets = new Map<string, Bracket>(); // key = `${eventId}:${best}`

  for await (const row of readTSV(filePath)) {
    const worldRank = Number(col(row, "world_rank", "worldRank")) || 0;
    if (!worldRank || worldRank > RANK_BRACKETS_LIMIT) continue;

    const personId = col(row, "person_id", "personId");
    const eventId  = col(row, "event_id",  "eventId");
    const best     = Number(row["best"]) || 0;
    const contRank = Number(col(row, "continent_rank", "continentRank")) || 0;
    if (!best || !eventId) continue;

    const isEurope = personContinentMap.get(personId) === "_Europe";
    const key = `${eventId}:${best}`;
    const cur = brackets.get(key);
    if (!cur) {
      brackets.set(key, {
        world_rank:  worldRank,
        europe_rank: isEurope && contRank > 0 ? contRank : null,
      });
    } else {
      if (worldRank < cur.world_rank) cur.world_rank = worldRank;
      if (isEurope && contRank > 0) {
        cur.europe_rank =
          cur.europe_rank === null ? contRank : Math.min(cur.europe_rank, contRank);
      }
    }
  }

  const rows = Array.from(brackets.entries()).map(([key, val]) => {
    const colon = key.indexOf(":");
    return {
      event_id:    key.slice(0, colon),
      type,
      best:        Number(key.slice(colon + 1)),
      world_rank:  val.world_rank,
      europe_rank: val.europe_rank,
    };
  });

  await batchInsert(rows, async (batch) => {
    await sql`
      INSERT INTO rank_brackets ${sql(batch)}
      ON CONFLICT (event_id, type, best) DO UPDATE SET
        world_rank  = LEAST(rank_brackets.world_rank,  EXCLUDED.world_rank),
        europe_rank = COALESCE(
          LEAST(rank_brackets.europe_rank, EXCLUDED.europe_rank),
          rank_brackets.europe_rank,
          EXCLUDED.europe_rank
        )
    `;
  });

  return rows.length;
}

async function importRankBrackets(
  singleFile: string,
  avgFile: string,
  personContinentMap: Map<string, string>
): Promise<void> {
  console.log("Importing rank brackets (global top-10k)...");
  await sql`TRUNCATE rank_brackets`;

  const ns = await importRankBracketsForType(singleFile, "single", personContinentMap);
  const na = await importRankBracketsForType(avgFile,    "average", personContinentMap);
  console.log(`  single: ${ns} brackets, average: ${na} brackets`);
}

// ─── Cache builder ────────────────────────────────────────────────────────────

const CACHE_DAYS = [3, 7, 14, 30, 60, 90];

async function buildPRCache(): Promise<void> {
  console.log("Building PR cache...");
  for (const days of CACHE_DAYS) {
    const persons = await fetchPRsImpl(days);
    // Round-trip through JSON to get a plain object tree that satisfies sql.json()
    const personsJson = JSON.parse(JSON.stringify(persons));
    await sql`
      INSERT INTO pr_cache (days, result, computed_at)
      VALUES (${days}, ${sql.json(personsJson)}, NOW())
      ON CONFLICT (days) DO UPDATE SET
        result      = EXCLUDED.result,
        computed_at = EXCLUDED.computed_at
    `;
    console.log(`  ${days}d → ${persons.length} persons`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
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
      const match = tsvFiles.find((f) =>
        f.toLowerCase().includes(keyword.toLowerCase())
      );
      if (!match) throw new Error(`No TSV file found for keyword: ${keyword}`);
      return join(extractDir, match);
    }

    const personsFile = findTsv("Persons");
    const { swissIds, personCountryMap } = await importPersons(personsFile);
    await importCompetitions(findTsv("Competitions"));
    await importResults(findTsv("Results"));

    let personContinentMap = new Map<string, string>();
    try {
      personContinentMap = await buildPersonContinentMap(personsFile, findTsv("Countries"));
    } catch (e) {
      console.warn("Could not build personContinentMap:", e);
    }

    await importRanks(findTsv("ranks_single"),  "ranks_single",  personCountryMap, personContinentMap);
    await importRanks(findTsv("ranks_average"), "ranks_average", personCountryMap, personContinentMap);

    try {
      await importRankBrackets(
        findTsv("ranks_single"),
        findTsv("ranks_average"),
        personContinentMap
      );
    } catch (e) {
      console.warn("Skipping rank_brackets import:", e);
    }

    await buildPRCache();

    await sql`
      INSERT INTO import_metadata (key, value, updated_at)
      VALUES ('imported_at', NOW()::text, NOW())
      ON CONFLICT (key) DO UPDATE SET value = NOW()::text, updated_at = NOW()
    `;

    console.log("\nImport complete!");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
