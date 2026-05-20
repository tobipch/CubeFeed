/**
 * Creates all required tables in the MariaDB database.
 * Run once before the first import: npm run db:setup
 */
import "dotenv/config";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

const host = process.env.MYSQL_HOST;
if (!host) throw new Error("MYSQL_HOST is not set");

const pool: Pool = mysql.createPool({
  host,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  waitForConnections: true,
  connectionLimit: 5,
  charset: "utf8mb4",
  ssl: { rejectUnauthorized: false },
});

async function exec(sql: string): Promise<void> {
  await pool.execute(sql);
}

async function tryExec(sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch {
    // Ignore errors (e.g. column already exists)
  }
}

async function main() {
  console.log("Creating tables...");

  await exec(`
    CREATE TABLE IF NOT EXISTS competitions (
      id         VARCHAR(255) NOT NULL,
      name       TEXT NOT NULL,
      city_name  TEXT,
      country_id VARCHAR(255),
      start_date VARCHAR(10),
      end_date   VARCHAR(10),
      PRIMARY KEY (id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS results (
      id                       INT NOT NULL AUTO_INCREMENT,
      competition_id           VARCHAR(255) NOT NULL,
      event_id                 VARCHAR(255) NOT NULL,
      round_type_id            VARCHAR(50),
      pos                      INT,
      best                     INT DEFAULT 0,
      average                  INT DEFAULT 0,
      person_name              TEXT,
      person_id                VARCHAR(255),
      person_country_id        VARCHAR(255),
      format_id                VARCHAR(50),
      regional_single_record   VARCHAR(50),
      regional_average_record  VARCHAR(50),
      PRIMARY KEY (id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await tryExec(`CREATE INDEX idx_results_competition    ON results (competition_id)`);
  await tryExec(`CREATE INDEX idx_results_person         ON results (person_id)`);
  await tryExec(`CREATE INDEX idx_results_country_event  ON results (person_country_id, event_id)`);
  await tryExec(`CREATE INDEX idx_results_person_event_best ON results (person_id, event_id, best)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS persons (
      wca_id     VARCHAR(255) NOT NULL,
      sub_id     INT NOT NULL,
      name       TEXT NOT NULL,
      country_id VARCHAR(255),
      PRIMARY KEY (wca_id, sub_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await tryExec(`CREATE INDEX idx_persons_wca_id ON persons (wca_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS ranks_single (
      person_id      VARCHAR(255) NOT NULL,
      event_id       VARCHAR(255) NOT NULL,
      best           INT NOT NULL,
      world_rank     INT,
      continent_rank INT,
      country_rank   INT,
      country_id     VARCHAR(255),
      continent_id   VARCHAR(255),
      prev_best      INT,
      PRIMARY KEY (person_id, event_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS ranks_average (
      person_id      VARCHAR(255) NOT NULL,
      event_id       VARCHAR(255) NOT NULL,
      best           INT NOT NULL,
      world_rank     INT,
      continent_rank INT,
      country_rank   INT,
      country_id     VARCHAR(255),
      continent_id   VARCHAR(255),
      prev_best      INT,
      PRIMARY KEY (person_id, event_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await tryExec(`CREATE INDEX idx_ranks_single_event_country_best   ON ranks_single  (event_id, country_id, best)`);
  await tryExec(`CREATE INDEX idx_ranks_average_event_country_best  ON ranks_average (event_id, country_id, best)`);
  await tryExec(`CREATE INDEX idx_ranks_single_event_continent_best ON ranks_single  (event_id, continent_id, best)`);
  await tryExec(`CREATE INDEX idx_ranks_average_event_continent_best ON ranks_average (event_id, continent_id, best)`);
  await tryExec(`CREATE INDEX idx_ranks_single_event_best           ON ranks_single  (event_id, best)`);
  await tryExec(`CREATE INDEX idx_ranks_average_event_best          ON ranks_average (event_id, best)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS import_metadata (
      \`key\`     VARCHAR(255) NOT NULL,
      value      TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`key\`)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS pr_cache (
      days        INT NOT NULL,
      result      LONGTEXT NOT NULL,
      computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (days)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS countries (
      id           VARCHAR(255) NOT NULL,
      continent_id VARCHAR(255),
      PRIMARY KEY (id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS rank_brackets (
      event_id      VARCHAR(255) NOT NULL,
      type          VARCHAR(50) NOT NULL,
      best          INT NOT NULL,
      world_rank    INT NOT NULL,
      europe_rank   INT,
      PRIMARY KEY (event_id, type, best)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await tryExec(`CREATE INDEX idx_competitions_end_date ON competitions (end_date)`);

  // Drop old bravos table if it's missing the event_id column (schema upgrade)
  const [bravosInfo] = await pool.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_NAME = 'bravos' AND TABLE_SCHEMA = DATABASE()`
  );
  const hasEventId = bravosInfo.some((r) => r.COLUMN_NAME === "event_id");
  if (bravosInfo.length > 0 && !hasEventId) {
    console.log("  Dropping old bravos table (missing event_id column)...");
    await exec("DROP TABLE bravos");
  }

  await exec(`
    CREATE TABLE IF NOT EXISTS bravos (
      person_id VARCHAR(255) NOT NULL,
      event_id  VARCHAR(255) NOT NULL,
      type      VARCHAR(50) NOT NULL,
      time      INT NOT NULL,
      count     INT NOT NULL DEFAULT 0,
      PRIMARY KEY (person_id, event_id, type, time)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS bravo_votes (
      user_id   INT NOT NULL,
      person_id VARCHAR(255) NOT NULL,
      event_id  VARCHAR(255) NOT NULL,
      type      VARCHAR(50)  NOT NULL,
      time      INT          NOT NULL,
      PRIMARY KEY (user_id, person_id, event_id, type, time)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // ── Auth tables ──────────────────────────────────────────────────────────────
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              INT NOT NULL AUTO_INCREMENT,
      username        VARCHAR(255) UNIQUE NOT NULL,
      password_hash   TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      wca_id          VARCHAR(255) UNIQUE,
      wca_account_id  INT UNIQUE,
      wca_name        TEXT,
      wca_avatar_url  TEXT,
      PRIMARY KEY (id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token      VARCHAR(255) NOT NULL,
      user_id    INT NOT NULL,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (token),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await tryExec(`CREATE INDEX idx_user_sessions_user ON user_sessions (user_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS user_following (
      user_id  INT NOT NULL,
      wca_id   VARCHAR(255) NOT NULL,
      name     TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, wca_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await tryExec(`ALTER TABLE users ADD COLUMN last_feed_visit DATETIME DEFAULT NULL`);

  console.log("All tables created successfully.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
