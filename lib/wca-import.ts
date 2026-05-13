import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { createClient, type Client } from "@libsql/client";
import { fetchPRsImpl } from "./queries.js";

const WCA_EXPORT_URL =
  process.env.WCA_EXPORT_URL ??
  "https://www.worldcubeassociation.org/export/results/v2/tsv";

const INSERT_BATCH = 100;

type SqlValue = string | number | null;

async function download(url: string, dest: string): Promise<void> {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url, { redirect: "follow" });
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
  db: Client,
  table: string,
  columns: string[],
  rows: SqlValue[][],
  onConflict = ""
): Promise<void> {
  if (rows.length === 0) return;
  const colList = columns.join(", ");
  const rowPlaceholder = `(${columns.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH);
    await db.execute({
      sql: `INSERT INTO ${table} (${colList}) VALUES ${chunk.map(() => rowPlaceholder).join(", ")} ${onConflict}`,
      args: chunk.flat(),
    });
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

async function importCompetitions(db: Client, filePath: string): Promise<void> {
  console.log("Importing competitions...");
  await db.execute("DELETE FROM competitions");
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
  await bulkInsert(db, "competitions", columns, rows,
    `ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, city_name=EXCLUDED.city_name, country_id=EXCLUDED.country_id, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date`);
  console.log(`  Imported ${rows.length} competitions`);
}

async function importPersons(
  db: Client,
  filePath: string
): Promise<{ personCountryMap: Map<string, string> }> {
  console.log("Importing all persons (worldwide)...");
  await db.execute("DELETE FROM persons");
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
  await bulkInsert(db, "persons", ["wca_id", "sub_id", "name", "country_id"], deduped,
    `ON CONFLICT (wca_id, sub_id) DO UPDATE SET name=EXCLUDED.name, country_id=EXCLUDED.country_id`);
  console.log(`  Imported ${deduped.length} persons`);
  return { personCountryMap };
}

async function importResults(db: Client, filePath: string): Promise<void> {
  const existingRes = await db.execute("SELECT DISTINCT competition_id FROM results");
  const existingCompIds = new Set(existingRes.rows.map((r) => r[0] as string));
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
  await bulkInsert(db, "results", columns, rows);
  console.log(`  Imported ${rows.length} results from ${newCompIds.size} new competitions`);
}

async function importRanks(
  db: Client,
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
        Number(col(row, "world_rank",     "worldRank"))     || 0,
        Number(col(row, "continent_rank", "continentRank")) || 0,
        Number(col(row, "country_rank",   "countryRank"))   || 0,
        personCountryMap.get(personId) ?? null,
        personContinentMap.get(personId) ?? null,
      ],
    });
  }
  const deduped = deduplicateBy(allRows, (r) => r.key).map((r) => r.values);
  await bulkInsert(db, table, columns, deduped,
    `ON CONFLICT (person_id, event_id) DO UPDATE SET
      prev_best      = CASE WHEN ${table}.best != EXCLUDED.best THEN ${table}.best ELSE ${table}.prev_best END,
      best           = EXCLUDED.best,
      world_rank     = EXCLUDED.world_rank,
      continent_rank = EXCLUDED.continent_rank,
      country_rank   = EXCLUDED.country_rank,
      country_id     = EXCLUDED.country_id,
      continent_id   = EXCLUDED.continent_id`);
  console.log(`  Imported ${deduped.length} ${table} entries`);
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
  db: Client,
  singleFile: string,
  avgFile: string,
  personContinentMap: Map<string, string>
): Promise<void> {
  console.log("Importing rank brackets...");
  await db.execute("DELETE FROM rank_brackets");
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
    await bulkInsert(db, "rank_brackets", ["event_id", "type", "best", "world_rank", "europe_rank"], rows,
      `ON CONFLICT (event_id, type, best) DO UPDATE SET
        world_rank  = MIN(rank_brackets.world_rank,  EXCLUDED.world_rank),
        europe_rank = COALESCE(MIN(rank_brackets.europe_rank, EXCLUDED.europe_rank), rank_brackets.europe_rank, EXCLUDED.europe_rank)`);
    console.log(`  ${type}: ${rows.length} brackets`);
  }
}

const CACHE_DAYS = [3, 7, 14, 30, 60, 90];

async function buildPRCache(db: Client): Promise<void> {
  console.log("Building PR cache...");
  for (const days of CACHE_DAYS) {
    const persons = await fetchPRsImpl(days);
    await db.execute({
      sql: `INSERT INTO pr_cache (days, result, computed_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT (days) DO UPDATE SET result=EXCLUDED.result, computed_at=EXCLUDED.computed_at`,
      args: [days, JSON.stringify(persons)],
    });
    console.log(`  ${days}d → ${persons.length} persons`);
  }
}

export async function runWcaImport(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");

  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
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
    const { personCountryMap } = await importPersons(db, personsFile);
    await importCompetitions(db, findTsv("Competitions"));
    await importResults(db, findTsv("Results"));

    let personContinentMap = new Map<string, string>();
    try {
      personContinentMap = await buildPersonContinentMap(personsFile, findTsv("Countries"));
    } catch (e) {
      console.warn("Could not build personContinentMap:", e);
    }

    await importRanks(db, findTsv("ranks_single"),  "ranks_single",  personCountryMap, personContinentMap);
    await importRanks(db, findTsv("ranks_average"), "ranks_average", personCountryMap, personContinentMap);

    try {
      await importRankBrackets(db, findTsv("ranks_single"), findTsv("ranks_average"), personContinentMap);
    } catch (e) {
      console.warn("Skipping rank_brackets import:", e);
    }

    await buildPRCache(db);

    await db.execute({
      sql: `INSERT INTO import_metadata (key, value, updated_at)
            VALUES ('imported_at', datetime('now'), datetime('now'))
            ON CONFLICT (key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
      args: [],
    });
    console.log("\nImport complete!");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    db.close();
  }
}
