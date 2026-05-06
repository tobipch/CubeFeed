/**
 * Fetches personal records from WCA Live for ongoing competitions
 * (competitions that have not yet been exported to the official WCA database).
 *
 * WCA Live enforces a GraphQL complexity limit of 5000. We stay under it by
 * using a 2-step approach per competition:
 *   1. Fetch the competitor list (country only) — low complexity.
 *   2. Batch-query results for Swiss competitors using aliased `person(id: …)`
 *      queries (small batches).
 *
 * All errors are caught and return an empty array so the page degrades
 * gracefully when WCA Live is unavailable.
 */

import { getVirtualRankings } from "./queries";
import type { PersonPRs, PR, RankMap } from "./queries";

const WCA_LIVE_API = "https://live.worldcubeassociation.org/api";
const FETCH_TIMEOUT_MS = 8_000;
const PERSON_BATCH_SIZE = 10;

async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(WCA_LIVE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      next: { revalidate: 300 }, // cache 5 minutes
    });
    if (!res.ok) throw new Error(`WCA Live HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── GraphQL types ─────────────────────────────────────────────────────────

interface GqlCompetition {
  id: string;           // WCA Live internal numeric ID — used for API queries
  wca_id: string | null; // WCA string ID — null if not yet officially registered
  name: string;
  start_date: string;
  end_date: string | null;
}

interface GqlCompetitor {
  id: string;         // internal person id (numeric)
  wca_id: string | null;
  name: string;
  country: { iso2: string } | null;
}

interface GqlCompetitionWithCompetitors extends GqlCompetition {
  competitors: GqlCompetitor[];
}

interface GqlPersonResult {
  best: number;
  average: number;
  single_record_tag: string | null;
  average_record_tag: string | null;
  round: {
    id: string;
    competition_event: {
      event: { id: string };
    };
  };
}

interface GqlPersonResults {
  id: string;
  wca_id: string | null;
  name: string;
  results: GqlPersonResult[];
}

// ─── Queries ───────────────────────────────────────────────────────────────

const COMPETITIONS_QUERY = `
  query RecentCompetitions($from: Date) {
    competitions(from: $from) {
      id
      wca_id
      name
      start_date
      end_date
    }
  }
`;

const COMPETITION_COMPETITORS_QUERY = `
  query CompetitionCompetitors($id: ID!) {
    competition(id: $id) {
      id
      wca_id
      name
      start_date
      end_date
      competitors {
        id
        wca_id
        name
        country { iso2 }
      }
    }
  }
`;

function buildPersonBatchQuery(personIds: string[]): string {
  const aliases = personIds
    .map(
      (pid, i) => `
    p${i}: person(id: "${pid}") {
      id
      wca_id
      name
      results {
        best
        average
        single_record_tag
        average_record_tag
        round {
          id
          competition_event {
            event { id }
          }
        }
      }
    }`
    )
    .join("\n");
  return `query PersonBatch {${aliases}\n}`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isoDateMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function computeVirtualNr(
  ranks: RankMap,
  type: "single" | "average",
  eventId: string,
  time: number
): number {
  const table = type === "single" ? ranks.single : ranks.average;
  let better = 0;
  for (const [key, best] of Array.from(table.entries())) {
    if (key.endsWith(`:${eventId}`) && best < time) better++;
  }
  return better + 1;
}

function addLivePR(
  map: Map<string, PersonPRs>,
  wcaId: string,
  name: string,
  pr: PR
): void {
  if (!map.has(wcaId)) {
    map.set(wcaId, { personId: wcaId, personName: name, prs: [] });
  }
  map.get(wcaId)!.prs.push(pr);
}

// For each (event, type) pick only the best result of the person in this competition
interface BestByEvent {
  eventId: string;
  best: number;
  average: number;
  singleRecord: string | null;
  averageRecord: string | null;
}

function reducePersonResults(results: GqlPersonResult[]): BestByEvent[] {
  const byEvent = new Map<string, BestByEvent>();
  for (const r of results) {
    const eventId = r.round?.competition_event?.event?.id;
    if (!eventId) continue;
    const cur = byEvent.get(eventId);
    if (!cur) {
      byEvent.set(eventId, {
        eventId,
        best: r.best,
        average: r.average,
        singleRecord: r.single_record_tag,
        averageRecord: r.average_record_tag,
      });
      continue;
    }
    if (r.best > 0 && (cur.best <= 0 || r.best < cur.best)) {
      cur.best = r.best;
      cur.singleRecord = r.single_record_tag ?? cur.singleRecord;
    }
    if (r.average > 0 && (cur.average <= 0 || r.average < cur.average)) {
      cur.average = r.average;
      cur.averageRecord = r.average_record_tag ?? cur.averageRecord;
    }
  }
  return Array.from(byEvent.values());
}

// ─── Main export ───────────────────────────────────────────────────────────

export async function fetchLivePRs(
  days: number,
  knownCompetitionIds: Set<string>,
  ranks: RankMap
): Promise<PersonPRs[]> {
  // Extra buffer so multi-day competitions that started before the window
  // but ended within it are still fetched (WCA Live filters by start_date).
  const from = isoDateMinus(days + 3);

  let competitions: GqlCompetition[];
  try {
    const data = await graphql<{ competitions: GqlCompetition[] }>(
      COMPETITIONS_QUERY,
      { from }
    );
    competitions = data.competitions ?? [];
  } catch {
    return [];
  }

  // Skip competitions already fully imported into our DB (matched by wca_id).
  // Competitions without a wca_id are not yet officially registered and can
  // never be in the DB, so they are always included.
  const liveComps = competitions.filter(
    (c) => !c.wca_id || !knownCompetitionIds.has(c.wca_id)
  );

  if (liveComps.length === 0) return [];

  const personMap = new Map<string, PersonPRs>();

  await Promise.all(
    liveComps.map((comp) => processCompetition(comp, ranks, personMap))
  );

  // Batch-compute virtual WR/CR from the rank_brackets DB table
  const allPRs = Array.from(personMap.values()).flatMap((p) => p.prs);
  const rankings = await getVirtualRankings(
    allPRs.map((pr) => ({ eventId: pr.eventId, type: pr.type, time: pr.time }))
  );
  for (const pr of allPRs) {
    const r = rankings.get(`${pr.eventId}:${pr.type}:${pr.time}`);
    if (r) { pr.wr = r.wr; pr.cr = r.cr; }
  }

  return Array.from(personMap.values()).filter((p) => p.prs.length > 0);
}

// ─── Custom following variant ─────────────────────────────────────────────────

export async function fetchLivePRsForPersons(
  personIds: string[],
  days: number,
  knownCompetitionIds: Set<string>,
  ranks: RankMap
): Promise<PersonPRs[]> {
  if (personIds.length === 0) return [];
  const followedIds = new Set(personIds);
  const from = isoDateMinus(days + 3);

  let competitions: GqlCompetition[];
  try {
    const data = await graphql<{ competitions: GqlCompetition[] }>(
      COMPETITIONS_QUERY,
      { from }
    );
    competitions = data.competitions ?? [];
  } catch {
    return [];
  }

  const liveComps = competitions.filter(
    (c) => !c.wca_id || !knownCompetitionIds.has(c.wca_id)
  );
  if (liveComps.length === 0) return [];

  const personMap = new Map<string, PersonPRs>();

  await Promise.all(
    liveComps.map((comp) =>
      processCompetitionForPersons(comp, followedIds, ranks, personMap)
    )
  );

  const allPRs = Array.from(personMap.values()).flatMap((p) => p.prs);
  const rankings = await getVirtualRankings(
    allPRs.map((pr) => ({ eventId: pr.eventId, type: pr.type, time: pr.time }))
  );
  for (const pr of allPRs) {
    const r = rankings.get(`${pr.eventId}:${pr.type}:${pr.time}`);
    if (r) { pr.wr = r.wr; pr.cr = r.cr; }
  }

  return Array.from(personMap.values()).filter((p) => p.prs.length > 0);
}

async function processCompetitionForPersons(
  comp: GqlCompetition,
  followedIds: Set<string>,
  ranks: RankMap,
  personMap: Map<string, PersonPRs>
): Promise<void> {
  let detail: GqlCompetitionWithCompetitors | undefined;
  try {
    const data = await graphql<{ competition: GqlCompetitionWithCompetitors }>(
      COMPETITION_COMPETITORS_QUERY,
      { id: comp.id }
    );
    detail = data.competition;
  } catch {
    return;
  }
  if (!detail) return;

  const followedCompetitors = detail.competitors.filter(
    (c) => c.wca_id && followedIds.has(c.wca_id)
  );
  if (followedCompetitors.length === 0) return;

  const wcaCompId = detail.wca_id ?? `live-${comp.id}`;
  const endDate = detail.end_date ?? detail.start_date;
  const compName = detail.name;

  for (let i = 0; i < followedCompetitors.length; i += PERSON_BATCH_SIZE) {
    const batch = followedCompetitors.slice(i, i + PERSON_BATCH_SIZE);
    const query = buildPersonBatchQuery(batch.map((c) => c.id));

    let batchData: Record<string, GqlPersonResults | null>;
    try {
      batchData = await graphql<Record<string, GqlPersonResults | null>>(query);
    } catch {
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const person = batchData[`p${j}`];
      if (!person) continue;
      const wcaId = person.wca_id ?? batch[j].wca_id;
      if (!wcaId) continue;

      const liveUrl = `https://live.worldcubeassociation.org/competitions/${comp.id}/competitors/${batch[j].id}`;
      const perEvent = reducePersonResults(person.results ?? []);

      for (const entry of perEvent) {
        if (entry.best > 0) {
          const key = `${wcaId}:${entry.eventId}`;
          const dbBest = ranks.single.get(key);
          if (!dbBest || entry.best <= dbBest) {
            addLivePR(personMap, wcaId, person.name, {
              eventId: entry.eventId,
              competitionId: wcaCompId,
              competitionName: compName,
              cityName: "",
              endDate,
              type: "single",
              time: entry.best,
              wr: null,
              cr: null,
              nr: null,
              regionalRecord: entry.singleRecord !== "PR" ? entry.singleRecord : null,
              isLive: true,
              liveUrl,
              prevTime: dbBest ?? undefined,
            });
          }
        }

        if (entry.average > 0) {
          const key = `${wcaId}:${entry.eventId}`;
          const dbAvgBest = ranks.average.get(key);
          if (!dbAvgBest || entry.average <= dbAvgBest) {
            addLivePR(personMap, wcaId, person.name, {
              eventId: entry.eventId,
              competitionId: wcaCompId,
              competitionName: compName,
              cityName: "",
              endDate,
              type: "average",
              time: entry.average,
              wr: null,
              cr: null,
              nr: null,
              regionalRecord: entry.averageRecord !== "PR" ? entry.averageRecord : null,
              isLive: true,
              liveUrl,
              prevTime: dbAvgBest ?? undefined,
            });
          }
        }
      }
    }
  }
}

// ─── Swiss-only variant (original) ────────────────────────────────────────────

async function processCompetition(
  comp: GqlCompetition,
  ranks: RankMap,
  personMap: Map<string, PersonPRs>
): Promise<void> {
  let detail: GqlCompetitionWithCompetitors | undefined;
  try {
    const data = await graphql<{ competition: GqlCompetitionWithCompetitors }>(
      COMPETITION_COMPETITORS_QUERY,
      { id: comp.id }
    );
    detail = data.competition;
  } catch {
    return;
  }
  if (!detail) return;

  const swissCompetitors = detail.competitors.filter(
    (c) => c.country?.iso2 === "CH" && c.wca_id
  );
  if (swissCompetitors.length === 0) return;

  const wcaCompId = detail.wca_id ?? `live-${comp.id}`;
  const endDate = detail.end_date ?? detail.start_date;
  const compName = detail.name;

  // Batch person queries to stay under the complexity limit
  for (let i = 0; i < swissCompetitors.length; i += PERSON_BATCH_SIZE) {
    const batch = swissCompetitors.slice(i, i + PERSON_BATCH_SIZE);
    const query = buildPersonBatchQuery(batch.map((c) => c.id));

    let batchData: Record<string, GqlPersonResults | null>;
    try {
      batchData = await graphql<Record<string, GqlPersonResults | null>>(query);
    } catch {
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const person = batchData[`p${j}`];
      if (!person) continue;
      const wcaId = person.wca_id ?? batch[j].wca_id;
      if (!wcaId) continue;

      const liveUrl = `https://live.worldcubeassociation.org/competitions/${comp.id}/competitors/${batch[j].id}`;

      const perEvent = reducePersonResults(person.results ?? []);
      for (const entry of perEvent) {
        // Single PR check
        if (entry.best > 0) {
          const key = `${wcaId}:${entry.eventId}`;
          const dbBest = ranks.single.get(key);
          if (!dbBest || entry.best <= dbBest) {
            addLivePR(personMap, wcaId, person.name, {
              eventId: entry.eventId,
              competitionId: wcaCompId,
              competitionName: compName,
              cityName: "",
              endDate,
              type: "single",
              time: entry.best,
              wr: null,
              cr: null,
              nr: computeVirtualNr(ranks, "single", entry.eventId, entry.best),
              regionalRecord: entry.singleRecord !== "PR" ? entry.singleRecord : null,
              isLive: true,
              liveUrl,
              prevTime: dbBest ?? undefined,
            });
          }
        }

        // Average PR check
        if (entry.average > 0) {
          const key = `${wcaId}:${entry.eventId}`;
          const dbAvgBest = ranks.average.get(key);
          if (!dbAvgBest || entry.average <= dbAvgBest) {
            addLivePR(personMap, wcaId, person.name, {
              eventId: entry.eventId,
              competitionId: wcaCompId,
              competitionName: compName,
              cityName: "",
              endDate,
              type: "average",
              time: entry.average,
              wr: null,
              cr: null,
              nr: computeVirtualNr(ranks, "average", entry.eventId, entry.average),
              regionalRecord: entry.averageRecord !== "PR" ? entry.averageRecord : null,
              isLive: true,
              liveUrl,
              prevTime: dbAvgBest ?? undefined,
            });
          }
        }
      }
    }
  }
}
