import { query } from "./db";

export interface PRRow {
  person_id: string;
  person_name: string;
  event_id: string;
  competition_id: string;
  competition_name: string;
  city_name: string;
  end_date: string;
  best: number;
  average: number;
  regional_single_record: string | null;
  regional_average_record: string | null;
  single_wr: number | null;
  single_cr: number | null;
  single_nr: number | null;
  avg_wr: number | null;
  avg_cr: number | null;
  avg_nr: number | null;
  is_single_pr: number; // SQLite returns 0/1 for CASE WHEN
  is_avg_pr: number;
  prev_single_best: number | null;
  prev_avg_best: number | null;
}

export interface PersonPRs {
  personId: string;
  personName: string;
  prs: PR[];
}

export interface PR {
  eventId: string;
  competitionId: string;
  competitionName: string;
  cityName: string;
  endDate: string;
  type: "single" | "average";
  time: number;
  wr: number | null;
  cr: number | null;
  nr: number | null;
  regionalRecord: string | null;
  isLive?: boolean;
  liveUrl?: string;
  prevTime?: number;
}

// Read pre-computed results from pr_cache — populated by the import script.
// Falls back to a live SQL query if the cache doesn't have an entry for `days`.
export async function fetchPRs(days: number): Promise<PersonPRs[]> {
  const rows = await query<{ result: string }>(
    "SELECT result FROM pr_cache WHERE days = ?",
    [days]
  );
  if (rows[0]?.result) return JSON.parse(rows[0].result) as PersonPRs[];
  return fetchPRsImpl(days);
}

// Full SQL query used by the import script to build the cache
export async function fetchPRsImpl(days: number): Promise<PersonPRs[]> {
  // Calculate cutoff date in JS to avoid SQLite interval syntax
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const rows = await query<PRRow>(
    `SELECT
      r.person_id,
      r.person_name,
      r.event_id,
      r.competition_id,
      c.name            AS competition_name,
      c.city_name,
      c.end_date        AS end_date,
      r.best,
      r.average,
      r.regional_single_record,
      r.regional_average_record,
      rs.world_rank     AS single_wr,
      rs.continent_rank AS single_cr,
      rs.country_rank   AS single_nr,
      ra.world_rank     AS avg_wr,
      ra.continent_rank AS avg_cr,
      ra.country_rank   AS avg_nr,
      CASE WHEN r.best > 0 AND rs.best IS NOT NULL AND r.best = rs.best       THEN 1 ELSE 0 END AS is_single_pr,
      CASE WHEN r.average > 0 AND ra.best IS NOT NULL AND r.average = ra.best THEN 1 ELSE 0 END AS is_avg_pr,
      (
        SELECT MIN(r2.best) FROM results r2
        WHERE r2.person_id = r.person_id
          AND r2.event_id  = r.event_id
          AND r2.best > r.best AND r2.best > 0
      ) AS prev_single_best,
      (
        SELECT MIN(r2.average) FROM results r2
        WHERE r2.person_id = r.person_id
          AND r2.event_id  = r.event_id
          AND r2.average > r.average AND r2.average > 0
      ) AS prev_avg_best
    FROM results r
    JOIN competitions c ON r.competition_id = c.id
    LEFT JOIN ranks_single rs
           ON r.person_id = rs.person_id AND r.event_id = rs.event_id
    LEFT JOIN ranks_average ra
           ON r.person_id = ra.person_id AND r.event_id = ra.event_id
    WHERE
      c.end_date >= ?
      AND c.end_date <= ?
      AND (
        (r.best > 0 AND rs.best IS NOT NULL AND r.best = rs.best)
        OR
        (r.average > 0 AND ra.best IS NOT NULL AND r.average = ra.best)
      )
    ORDER BY c.end_date DESC, r.person_name, r.event_id`,
    [cutoff, tomorrow]
  );

  return groupByPerson(rows);
}

export async function getImportDate(): Promise<string | null> {
  try {
    const rows = await query<{ value: string }>(
      "SELECT value FROM import_metadata WHERE key = 'imported_at'"
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export interface RankMap {
  single: Map<string, number>;      // "personId:eventId" → current best
  average: Map<string, number>;
  prevSingle?: Map<string, number>; // "personId:eventId" → previous best (before last PR)
  prevAverage?: Map<string, number>;
}

export async function fetchPRsForPersons(personIds: string[], days: number): Promise<PersonPRs[]> {
  if (personIds.length === 0) return [];

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const placeholders = personIds.map(() => "?").join(", ");
  const rows = await query<PRRow>(
    `SELECT
      r.person_id,
      r.person_name,
      r.event_id,
      r.competition_id,
      c.name            AS competition_name,
      c.city_name,
      c.end_date        AS end_date,
      r.best,
      r.average,
      r.regional_single_record,
      r.regional_average_record,
      rs.world_rank     AS single_wr,
      rs.continent_rank AS single_cr,
      rs.country_rank   AS single_nr,
      ra.world_rank     AS avg_wr,
      ra.continent_rank AS avg_cr,
      ra.country_rank   AS avg_nr,
      CASE WHEN r.best > 0 AND rs.best IS NOT NULL AND r.best = rs.best       THEN 1 ELSE 0 END AS is_single_pr,
      CASE WHEN r.average > 0 AND ra.best IS NOT NULL AND r.average = ra.best THEN 1 ELSE 0 END AS is_avg_pr,
      (
        SELECT MIN(r2.best) FROM results r2
        WHERE r2.person_id = r.person_id
          AND r2.event_id  = r.event_id
          AND r2.best > r.best AND r2.best > 0
      ) AS prev_single_best,
      (
        SELECT MIN(r2.average) FROM results r2
        WHERE r2.person_id = r.person_id
          AND r2.event_id  = r.event_id
          AND r2.average > r.average AND r2.average > 0
      ) AS prev_avg_best
    FROM results r
    JOIN competitions c ON r.competition_id = c.id
    LEFT JOIN ranks_single rs
           ON r.person_id = rs.person_id AND r.event_id = rs.event_id
    LEFT JOIN ranks_average ra
           ON r.person_id = ra.person_id AND r.event_id = ra.event_id
    WHERE
      r.person_id IN (${placeholders})
      AND c.end_date >= ?
      AND c.end_date <= ?
      AND (
        (r.best > 0 AND rs.best IS NOT NULL AND r.best = rs.best)
        OR
        (r.average > 0 AND ra.best IS NOT NULL AND r.average = ra.best)
      )
    ORDER BY c.end_date DESC, r.person_name, r.event_id`,
    [...personIds, cutoff, tomorrow]
  );
  return groupByPerson(rows);
}

export async function getRanksForPersons(personIds: string[]): Promise<RankMap> {
  if (personIds.length === 0) return { single: new Map(), average: new Map() };
  const placeholders = personIds.map(() => "?").join(", ");
  const [singles, averages] = await Promise.all([
    query<{ person_id: string; event_id: string; best: number; prev_best: number | null }>(
      `SELECT person_id, event_id, best, prev_best FROM ranks_single WHERE person_id IN (${placeholders})`,
      personIds
    ),
    query<{ person_id: string; event_id: string; best: number; prev_best: number | null }>(
      `SELECT person_id, event_id, best, prev_best FROM ranks_average WHERE person_id IN (${placeholders})`,
      personIds
    ),
  ]);
  const single = new Map<string, number>();
  const average = new Map<string, number>();
  const prevSingle = new Map<string, number>();
  const prevAverage = new Map<string, number>();
  for (const r of singles) {
    single.set(`${r.person_id}:${r.event_id}`, r.best);
    if (r.prev_best) prevSingle.set(`${r.person_id}:${r.event_id}`, r.prev_best);
  }
  for (const r of averages) {
    average.set(`${r.person_id}:${r.event_id}`, r.best);
    if (r.prev_best) prevAverage.set(`${r.person_id}:${r.event_id}`, r.prev_best);
  }
  return { single, average, prevSingle, prevAverage };
}

export async function getDbCompetitionIds(): Promise<Set<string>> {
  const rows = await query<{ competition_id: string }>(
    "SELECT DISTINCT competition_id FROM results"
  );
  return new Set(rows.map((r) => r.competition_id));
}

export async function getKnownCompetitionsByPerson(
  personIds: string[]
): Promise<Map<string, Set<string>>> {
  if (personIds.length === 0) return new Map();
  const placeholders = personIds.map(() => "?").join(", ");
  const rows = await query<{ person_id: string; competition_id: string }>(
    `SELECT DISTINCT person_id, competition_id FROM results WHERE person_id IN (${placeholders})`,
    personIds
  );
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!map.has(row.person_id)) map.set(row.person_id, new Set());
    map.get(row.person_id)!.add(row.competition_id);
  }
  return map;
}

function nullStr(val: string | null): string | null {
  if (!val || val === "NULL") return null;
  return val;
}

function groupByPerson(rows: PRRow[]): PersonPRs[] {
  const map = new Map<string, PersonPRs>();

  for (const row of rows) {
    if (!map.has(row.person_id)) {
      map.set(row.person_id, {
        personId: row.person_id,
        personName: row.person_name,
        prs: [],
      });
    }
    const person = map.get(row.person_id)!;

    if (row.is_single_pr && row.best > 0) {
      person.prs.push({
        eventId: row.event_id,
        competitionId: row.competition_id,
        competitionName: row.competition_name,
        cityName: row.city_name,
        endDate: row.end_date,
        type: "single",
        time: row.best,
        wr: row.single_wr,
        cr: row.single_cr,
        nr: row.single_nr,
        regionalRecord: nullStr(row.regional_single_record),
        prevTime: row.prev_single_best ?? undefined,
      });
    }

    if (row.is_avg_pr && row.average > 0) {
      person.prs.push({
        eventId: row.event_id,
        competitionId: row.competition_id,
        competitionName: row.competition_name,
        cityName: row.city_name,
        endDate: row.end_date,
        type: "average",
        time: row.average,
        wr: row.avg_wr,
        cr: row.avg_cr,
        nr: row.avg_nr,
        regionalRecord: nullStr(row.regional_average_record),
        prevTime: row.prev_avg_best ?? undefined,
      });
    }
  }

  return [...map.values()]
    .filter((p) => p.prs.length > 0)
    .sort((a, b) => {
      const minNr = (p: PersonPRs) =>
        Math.min(...p.prs.map((pr) => pr.nr ?? Infinity));
      return minNr(a) - minNr(b);
    });
}

// ─── Virtual rankings ─────────────────────────────────────────────────────────

// WCA country IDs (_Europe continent)
const EUROPE_COUNTRY_IDS = [
  "Albania", "Andorra", "Armenia", "Austria", "Azerbaijan", "Belarus", "Belgium",
  "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Cyprus", "Czech Republic",
  "Denmark", "Estonia", "Finland", "France", "Georgia", "Germany", "Gibraltar",
  "Greece", "Hungary", "Iceland", "Ireland", "Israel", "Italy", "Kosovo",
  "Latvia", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Moldova",
  "Monaco", "Montenegro", "Netherlands", "North Macedonia", "Norway", "Poland",
  "Portugal", "Romania", "Russia", "San Marino", "Serbia", "Slovakia", "Slovenia",
  "Spain", "Sweden", "Switzerland", "Turkey", "Ukraine", "United Kingdom",
];

interface VirtualRanking { wr: number | null; cr: number | null }

/**
 * For each (eventId, type, time) triple in `prs`, returns the virtual world
 * rank and European continental rank that result would have in the WCA DB.
 * Uses the rank_brackets table (populated by the import script).
 * Returns an empty map on error (e.g. table not yet created).
 *
 * SQLite doesn't support unnest(), so each PR is queried individually.
 * This is fine in practice because the number of PRs per feed request is small.
 */
export async function getVirtualRankings(
  prs: Array<{ eventId: string; type: "single" | "average"; time: number }>
): Promise<Map<string, VirtualRanking>> {
  if (prs.length === 0) return new Map();

  const result = new Map<string, VirtualRanking>();
  const europePlaceholders = EUROPE_COUNTRY_IDS.map(() => "?").join(", ");

  for (const pr of prs) {
    try {
      const rankTable = pr.type === "single" ? "ranks_single" : "ranks_average";

      const [wrRows, crRows] = await Promise.all([
        query<{ virtual_wr: number | null }>(
          `SELECT MIN(world_rank) AS virtual_wr
           FROM rank_brackets
           WHERE event_id = ? AND type = ? AND best >= ?`,
          [pr.eventId, pr.type, pr.time]
        ),
        query<{ virtual_cr: number }>(
          `SELECT 1 + COUNT(*) AS virtual_cr
           FROM ${rankTable}
           WHERE event_id = ? AND country_id IN (${europePlaceholders}) AND best < ? AND best > 0`,
          [pr.eventId, ...EUROPE_COUNTRY_IDS, pr.time]
        ),
      ]);

      result.set(`${pr.eventId}:${pr.type}:${pr.time}`, {
        wr: wrRows[0]?.virtual_wr ?? null,
        cr: crRows[0]?.virtual_cr ?? null,
      });
    } catch {
      // Ignore individual failures (e.g. table not yet populated)
    }
  }

  return result;
}

export async function getPersonCountries(personIds: string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const placeholders = personIds.map(() => "?").join(", ");
  // GROUP BY picks an arbitrary country_id per person — fine since it's stable per person
  const rows = await query<{ person_id: string; country_id: string }>(
    `SELECT person_id, country_id FROM ranks_single
     WHERE person_id IN (${placeholders}) AND country_id IS NOT NULL
     GROUP BY person_id`,
    personIds
  );
  return new Map(rows.map((r) => [r.person_id, r.country_id]));
}

/**
 * For each (eventId, type, time, countryId) entry, returns the virtual national rank.
 * SQLite doesn't support unnest(), so each entry is queried individually.
 */
export async function getVirtualNRs(
  prs: Array<{ eventId: string; type: "single" | "average"; time: number; countryId: string }>
): Promise<Map<string, number>> {
  if (prs.length === 0) return new Map();

  const result = new Map<string, number>();

  for (const pr of prs) {
    try {
      const rankTable = pr.type === "single" ? "ranks_single" : "ranks_average";
      const rows = await query<{ nr: number }>(
        `SELECT 1 + COUNT(*) AS nr
         FROM ${rankTable}
         WHERE event_id = ? AND country_id = ? AND best < ? AND best > 0`,
        [pr.eventId, pr.countryId, pr.time]
      );
      result.set(`${pr.eventId}:${pr.type}:${pr.time}:${pr.countryId}`, rows[0]?.nr ?? 1);
    } catch {
      // Ignore individual failures
    }
  }

  return result;
}
