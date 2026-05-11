/**
 * Creates all required tables in the database.
 * Run once before the first import: npm run db:setup
 */
import "dotenv/config";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = postgres(DATABASE_URL, { ssl: "require", onnotice: () => {} });

async function main() {
  console.log("Creating tables...");

  await sql`
    CREATE TABLE IF NOT EXISTS competitions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      city_name  TEXT,
      country_id TEXT,
      start_date DATE,
      end_date   DATE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS results (
      id                       SERIAL PRIMARY KEY,
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
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_results_competition
      ON results (competition_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_results_person
      ON results (person_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_results_country_event
      ON results (person_country_id, event_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS persons (
      wca_id     TEXT,
      sub_id     INTEGER,
      name       TEXT NOT NULL,
      country_id TEXT,
      PRIMARY KEY (wca_id, sub_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ranks_single (
      person_id      TEXT NOT NULL,
      event_id       TEXT NOT NULL,
      best           INTEGER NOT NULL,
      world_rank     INTEGER,
      continent_rank INTEGER,
      country_rank   INTEGER,
      country_id     TEXT,
      PRIMARY KEY (person_id, event_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ranks_average (
      person_id      TEXT NOT NULL,
      event_id       TEXT NOT NULL,
      best           INTEGER NOT NULL,
      world_rank     INTEGER,
      continent_rank INTEGER,
      country_rank   INTEGER,
      country_id     TEXT,
      PRIMARY KEY (person_id, event_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS import_metadata (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pr_cache (
      days        INTEGER PRIMARY KEY,
      result      JSONB NOT NULL,
      computed_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_results_person_event_best
      ON results (person_id, event_id, best)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rank_brackets (
      event_id      TEXT NOT NULL,
      type          TEXT NOT NULL,
      best          INTEGER NOT NULL,
      world_rank    INTEGER NOT NULL,
      europe_rank   INTEGER,
      PRIMARY KEY (event_id, type, best)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_competitions_end_date
      ON competitions (end_date)
  `;

  // Migrate: add country_id and continent_id columns to existing ranks tables if not present
  await sql`ALTER TABLE ranks_single  ADD COLUMN IF NOT EXISTS country_id TEXT`;
  await sql`ALTER TABLE ranks_average ADD COLUMN IF NOT EXISTS country_id TEXT`;
  await sql`ALTER TABLE ranks_single  ADD COLUMN IF NOT EXISTS continent_id TEXT`;
  await sql`ALTER TABLE ranks_average ADD COLUMN IF NOT EXISTS continent_id TEXT`;

  // Indexes for virtual NR/CR lookup (event_id, country_id/continent_id, best)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ranks_single_event_country_best
      ON ranks_single (event_id, country_id, best)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ranks_average_event_country_best
      ON ranks_average (event_id, country_id, best)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ranks_single_event_continent_best
      ON ranks_single (event_id, continent_id, best)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ranks_average_event_continent_best
      ON ranks_average (event_id, continent_id, best)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_persons_wca_id
      ON persons (wca_id)
  `;

  // Migration: drop old single-column bravos table (person_id only) if it exists
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'bravos'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bravos' AND column_name = 'event_id'
      ) THEN
        DROP TABLE bravos;
      END IF;
    END $$
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS bravos (
      person_id TEXT    NOT NULL,
      event_id  TEXT    NOT NULL,
      type      TEXT    NOT NULL,
      time      INTEGER NOT NULL,
      count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (person_id, event_id, type, time)
    )
  `;

  // ── Auth tables ──────────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMP NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user
      ON user_sessions (user_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_following (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wca_id   TEXT NOT NULL,
      name     TEXT NOT NULL,
      added_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, wca_id)
    )
  `;

  // WCA OAuth support
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wca_id TEXT UNIQUE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wca_account_id INTEGER UNIQUE`;
  await sql`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`;

  console.log("All tables created successfully.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
