import { sql } from "./db";

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
  is_single_pr: boolean;
  is_avg_pr: boolean;
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
  liveUrl?: string;  // WCA Live competitor page, e.g. /competitions/10400/competitors/905132
  prevTime?: number; // previous best for this (event, type) before this competition
}

// Read pre-computed results from pr_cache — populated by the import script.
// Falls back to a live SQL query if the cache doesn't have an entry for `days`
// (e.g. a new day value added before the next import has run).
export async function fetchPRs(days: number): Promise<PersonPRs[]> {
  const rows = await sql<{ result: PersonPRs[] }[]>`
    SELECT result FROM pr_cache WHERE days = ${days}
  `;
  if (rows[0]?.result) return rows[0].result;
  return fetchPRsImpl(days);
}

// Full SQL query used by the import script to build the cache
export async function fetchPRsImpl(days: number): Promise<PersonPRs[]> {
  const rows = await sql<PRRow[]>`
    SELECT
      r.person_id,
      r.person_name,
      r.event_id,
      r.competition_id,
      c.name            AS competition_name,
      c.city_name,
      c.end_date::text  AS end_date,
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
      (r.best > 0 AND rs.best IS NOT NULL AND r.best = rs.best)       AS is_single_pr,
      (r.average > 0 AND ra.best IS NOT NULL AND r.average = ra.best) AS is_avg_pr,
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
      r.person_country_id = 'Switzerland'
      AND c.end_date >= CURRENT_DATE - (${days} * interval '1 day')
      AND c.end_date <= CURRENT_DATE + interval '1 day'
      AND (
        (r.best > 0 AND rs.best IS NOT NULL AND r.best = rs.best)
        OR
        (r.average > 0 AND ra.best IS NOT NULL AND r.average = ra.best)
      )
    ORDER BY c.end_date DESC, r.person_name, r.event_id
  `;

  return groupByPerson(rows);
}

export async function getImportDate(): Promise<string | null> {
  try {
    const rows = await sql<{ value: string }[]>`
      SELECT value FROM import_metadata WHERE key = 'imported_at'
    `;
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export interface RankMap {
  single: Map<string, number>;   // "personId:eventId" → best
  average: Map<string, number>;
}

export async function getAllSwissRanks(): Promise<RankMap> {
  const [singles, averages] = await Promise.all([
    sql<{ person_id: string; event_id: string; best: number }[]>`
      SELECT person_id, event_id, best FROM ranks_single
    `,
    sql<{ person_id: string; event_id: string; best: number }[]>`
      SELECT person_id, event_id, best FROM ranks_average
    `,
  ]);
  const single = new Map<string, number>();
  const average = new Map<string, number>();
  for (const r of singles) single.set(`${r.person_id}:${r.event_id}`, r.best);
  for (const r of averages) average.set(`${r.person_id}:${r.event_id}`, r.best);
  return { single, average };
}

export async function fetchPRsForPersons(personIds: string[], days: number): Promise<PersonPRs[]> {
  if (personIds.length === 0) return [];
  const rows = await sql<PRRow[]>`
    SELECT
      r.person_id,
      r.person_name,
      r.event_id,
      r.competition_id,
      c.name            AS competition_name,
      c.city_name,
      c.end_date::text  AS end_date,
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
      (r.best > 0 AND rs.best IS NOT NULL AND r.best = rs.best)       AS is_single_pr,
      (r.average > 0 AND ra.best IS NOT NULL AND r.average = ra.best) AS is_avg_pr,
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
      r.person_id = ANY(${sql.array(personIds)}::text[])
      AND c.end_date >= CURRENT_DATE - (${days} * interval '1 day')
      AND c.end_date <= CURRENT_DATE + interval '1 day'
      AND (
        (r.best > 0 AND rs.best IS NOT NULL AND r.best = rs.best)
        OR
        (r.average > 0 AND ra.best IS NOT NULL AND r.average = ra.best)
      )
    ORDER BY c.end_date DESC, r.person_name, r.event_id
  `;
  return groupByPerson(rows);
}

export async function getRanksForPersons(personIds: string[]): Promise<RankMap> {
  if (personIds.length === 0) return { single: new Map(), average: new Map() };
  const [singles, averages] = await Promise.all([
    sql<{ person_id: string; event_id: string; best: number }[]>`
      SELECT person_id, event_id, best FROM ranks_single
      WHERE person_id = ANY(${sql.array(personIds)}::text[])
    `,
    sql<{ person_id: string; event_id: string; best: number }[]>`
      SELECT person_id, event_id, best FROM ranks_average
      WHERE person_id = ANY(${sql.array(personIds)}::text[])
    `,
  ]);
  const single = new Map<string, number>();
  const average = new Map<string, number>();
  for (const r of singles) single.set(`${r.person_id}:${r.event_id}`, r.best);
  for (const r of averages) average.set(`${r.person_id}:${r.event_id}`, r.best);
  return { single, average };
}

export async function getDbCompetitionIds(): Promise<Set<string>> {
  // Only competitions with actual results are considered "in the DB".
  // A competition row may exist before results are imported, so filtering
  // by the results table prevents us from skipping live data for competitions
  // that are registered but not yet fully exported.
  const rows = await sql<{ competition_id: string }[]>`
    SELECT DISTINCT competition_id FROM results
  `;
  return new Set(rows.map((r) => r.competition_id));
}

// Builds a per-person map of competition IDs that are already in the DB.
// Used by the feed to ensure a competition is only skipped for a specific
// person if THAT person's results are already imported — non-Swiss cubers
// (whose results are never imported) always get an empty set.
export async function getKnownCompetitionsByPerson(
  personIds: string[]
): Promise<Map<string, Set<string>>> {
  if (personIds.length === 0) return new Map();
  const rows = await sql<{ person_id: string; competition_id: string }[]>`
    SELECT DISTINCT person_id, competition_id FROM results
    WHERE person_id = ANY(${sql.array(personIds)}::text[])
  `;
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

interface VirtualRanking { wr: number | null; cr: number | null }

/**
 * For each (eventId, type, time) triple in `prs`, returns the virtual world
 * rank and European continental rank that result would have in the WCA DB.
 * Uses the rank_brackets table (populated by the import script).
 * Returns an empty map on error (e.g. table not yet created).
 */
export async function getVirtualRankings(
  prs: Array<{ eventId: string; type: "single" | "average"; time: number }>
): Promise<Map<string, VirtualRanking>> {
  if (prs.length === 0) return new Map();
  try {
    const eventIds = prs.map((p) => p.eventId);
    const types    = prs.map((p) => p.type);
    const times    = prs.map((p) => p.time);

    const rows = await sql<
      { event_id: string; type: string; time: number; virtual_wr: number | null; virtual_cr: number | null }[]
    >`
      SELECT v.event_id, v.type, v.time::int,
        MIN(rb.world_rank)  AS virtual_wr,
        MIN(rb.europe_rank) AS virtual_cr
      FROM unnest(
        ${sql.array(eventIds)}::text[],
        ${sql.array(types)}::text[],
        ${sql.array(times)}::int[]
      ) AS v(event_id, type, time)
      LEFT JOIN rank_brackets rb
        ON rb.event_id = v.event_id
       AND rb.type     = v.type
       AND rb.best    >= v.time
      GROUP BY v.event_id, v.type, v.time
    `;

    return new Map(
      rows.map((r) => [
        `${r.event_id}:${r.type}:${r.time}`,
        { wr: r.virtual_wr, cr: r.virtual_cr },
      ])
    );
  } catch {
    return new Map();
  }
}

export async function getPersonCountries(personIds: string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  // Query from ranks_single (which now stores country_id) — avoids any persons sub_id issues.
  const rows = await sql<{ person_id: string; country_id: string }[]>`
    SELECT DISTINCT ON (person_id) person_id, country_id
    FROM ranks_single
    WHERE person_id = ANY(${sql.array(personIds)}::text[]) AND country_id IS NOT NULL
  `;
  return new Map(rows.map((r) => [r.person_id, r.country_id]));
}

/**
 * For each (eventId, type, time, countryId) entry, returns the virtual national
 * rank: 1 + count of persons from the same country with a strictly better time
 * in ranks_single / ranks_average.
 * Key format: "eventId:type:time:countryId"
 * Requires indexes on ranks_single(event_id, best) and ranks_average(event_id, best).
 */
export async function getVirtualNRs(
  prs: Array<{ eventId: string; type: "single" | "average"; time: number; countryId: string }>
): Promise<Map<string, number>> {
  if (prs.length === 0) return new Map();

  const eventIds   = prs.map((p) => p.eventId);
  const types      = prs.map((p) => p.type);
  const times      = prs.map((p) => p.time);
  const countryIds = prs.map((p) => p.countryId);

  try {
    // Bracket approach: MIN(country_rank) among entries with best >= new_time
    // gives the virtual NR (same logic as rank_brackets for WR/CR).
    // ranks_single/ranks_average now carry country_id directly — no persons JOIN needed.
    const rows = await sql<{ event_id: string; type: string; time: number; country_id: string; nr: number }[]>`
      SELECT v.event_id, v.type, v.time::int, v.country_id,
        1 + CASE WHEN v.type = 'single' THEN (
          SELECT COUNT(*)
          FROM ranks_single rs
          WHERE rs.event_id   = v.event_id
            AND rs.country_id = v.country_id
            AND rs.best        < v.time
            AND rs.best        > 0
        ) ELSE (
          SELECT COUNT(*)
          FROM ranks_average ra
          WHERE ra.event_id   = v.event_id
            AND ra.country_id = v.country_id
            AND ra.best        < v.time
            AND ra.best        > 0
        ) END AS nr
      FROM unnest(
        ${sql.array(eventIds)}::text[],
        ${sql.array(types)}::text[],
        ${sql.array(times)}::int[],
        ${sql.array(countryIds)}::text[]
      ) AS v(event_id, type, time, country_id)
    `;

    return new Map(
      rows.map((r) => [`${r.event_id}:${r.type}:${r.time}:${r.country_id}`, r.nr])
    );
  } catch {
    return new Map();
  }
}
