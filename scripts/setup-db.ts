/**
 * Creates all required tables in the Turso/LibSQL database.
 * Run once before the first import: npm run db:setup
 */
import "dotenv/config";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL is not set");

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

async function exec(sql: string): Promise<void> {
  await db.execute(sql);
}

async function tryExec(sql: string): Promise<void> {
  try {
    await db.execute(sql);
  } catch {
    // Ignore errors (e.g. column already exists)
  }
}

async function main() {
  console.log("Creating tables...");

  // Enable foreign key enforcement
  await exec("PRAGMA foreign_keys = ON");

  await exec(`
    CREATE TABLE IF NOT EXISTS competitions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      city_name  TEXT,
      country_id TEXT,
      start_date TEXT,
      end_date   TEXT
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS results (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id           TEXT NOT NULL,
      event_id                 TEXT NOT NULL,
      round_type_id            TEXT,
      pos                      INTEGER,
      best                     INTEGER DEFAULT 0,
      average                  INTEGER DEFAULT 0,
      person_name              TEXT,
      person_id                TEXT,
      person_country_id        TEXT,
      format_id                TEXT,
      regional_single_record   TEXT,
      regional_average_record  TEXT
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_results_competition ON results (competition_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_results_person ON results (person_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_results_country_event ON results (person_country_id, event_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS persons (
      wca_id     TEXT NOT NULL,
      sub_id     INTEGER NOT NULL,
      name       TEXT NOT NULL,
      country_id TEXT,
      PRIMARY KEY (wca_id, sub_id)
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS ranks_single (
      person_id      TEXT NOT NULL,
      event_id       TEXT NOT NULL,
      best           INTEGER NOT NULL,
      world_rank     INTEGER,
      continent_rank INTEGER,
      country_rank   INTEGER,
      country_id     TEXT,
      continent_id   TEXT,
      PRIMARY KEY (person_id, event_id)
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS ranks_average (
      person_id      TEXT NOT NULL,
      event_id       TEXT NOT NULL,
      best           INTEGER NOT NULL,
      world_rank     INTEGER,
      continent_rank INTEGER,
      country_rank   INTEGER,
      country_id     TEXT,
      continent_id   TEXT,
      PRIMARY KEY (person_id, event_id)
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS import_metadata (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // pr_cache stores JSON as TEXT (SQLite has no native JSONB)
  await exec(`
    CREATE TABLE IF NOT EXISTS pr_cache (
      days        INTEGER PRIMARY KEY,
      result      TEXT NOT NULL,
      computed_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await exec(`
    CREATE INDEX IF NOT EXISTS idx_results_person_event_best
      ON results (person_id, event_id, best)
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS rank_brackets (
      event_id      TEXT NOT NULL,
      type          TEXT NOT NULL,
      best          INTEGER NOT NULL,
      world_rank    INTEGER NOT NULL,
      europe_rank   INTEGER,
      PRIMARY KEY (event_id, type, best)
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_competitions_end_date ON competitions (end_date)`);

  // Add columns to existing tables if upgrading from an older schema
  await tryExec("ALTER TABLE ranks_single  ADD COLUMN country_id   TEXT");
  await tryExec("ALTER TABLE ranks_average ADD COLUMN country_id   TEXT");
  await tryExec("ALTER TABLE ranks_single  ADD COLUMN continent_id TEXT");
  await tryExec("ALTER TABLE ranks_average ADD COLUMN continent_id TEXT");

  await exec(`
    CREATE INDEX IF NOT EXISTS idx_ranks_single_event_country_best
      ON ranks_single (event_id, country_id, best)
  `);
  await exec(`
    CREATE INDEX IF NOT EXISTS idx_ranks_average_event_country_best
      ON ranks_average (event_id, country_id, best)
  `);
  await exec(`
    CREATE INDEX IF NOT EXISTS idx_ranks_single_event_continent_best
      ON ranks_single (event_id, continent_id, best)
  `);
  await exec(`
    CREATE INDEX IF NOT EXISTS idx_ranks_average_event_continent_best
      ON ranks_average (event_id, continent_id, best)
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_persons_wca_id ON persons (wca_id)`);

  // Drop old bravos table if it's missing the event_id column (schema upgrade)
  const bravosInfo = await db.execute("PRAGMA table_info(bravos)");
  const hasEventId = bravosInfo.rows.some((r) => r[1] === "event_id");
  if (bravosInfo.rows.length > 0 && !hasEventId) {
    console.log("  Dropping old bravos table (missing event_id column)...");
    await exec("DROP TABLE bravos");
  }

  await exec(`
    CREATE TABLE IF NOT EXISTS bravos (
      person_id TEXT    NOT NULL,
      event_id  TEXT    NOT NULL,
      type      TEXT    NOT NULL,
      time      INTEGER NOT NULL,
      count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (person_id, event_id, type, time)
    )
  `);

  // ── Auth tables ──────────────────────────────────────────────────────────────
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    )
  `);

  await exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS user_following (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wca_id   TEXT NOT NULL,
      name     TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, wca_id)
    )
  `);

  console.log("All tables created successfully.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
