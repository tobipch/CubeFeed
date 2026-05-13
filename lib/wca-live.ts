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

import { getVirtualRankings, getVirtualNRs, getPersonCountries, getRanksForPersons, getPrevBestsFromResults } from "./queries";
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
  knownCompetitionIds: Set<string>
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
  const liveComps = competitions.filter(
    (c) => !c.wca_id || !knownCompetitionIds.has(c.wca_id)
  );

  if (liveComps.length === 0) return [];

  const personMap = new Map<string, PersonPRs>();

  await Promise.all(
    liveComps.map((comp) => processCompetition(comp, personMap))
  );

  const personIds = Array.from(personMap.keys());
  const allPRs = Array.from(personMap.values()).flatMap((p) => p.prs);

  const [rankings, personCountries, ranks] = await Promise.all([
    getVirtualRankings(
      allPRs.map((pr) => ({ eventId: pr.eventId, type: pr.type, time: pr.time }))
    ),
    getPersonCountries(personIds).catch(() => new Map<string, string>()),
    getRanksForPersons(personIds).catch(() => ({
      single: new Map<string, number>(),
      average: new Map<string, number>(),
      prevSingle: new Map<string, number>(),
      prevAverage: new Map<string, number>(),
    })),
  ]);

  const nrs = await getVirtualNRs(
    Array.from(personMap.entries()).flatMap(([wcaId, p]) => {
      const countryId = personCountries.get(wcaId);
      if (!countryId) return [];
      return p.prs.map((pr) => ({ eventId: pr.eventId, type: pr.type, time: pr.time, countryId }));
    })
  );

  for (const [wcaId, p] of personMap.entries()) {
    const countryId = personCountries.get(wcaId);
    for (const pr of p.prs) {
      const r = rankings.get(`${pr.eventId}:${pr.type}:${pr.time}`);
      if (r) { pr.wr = r.wr; pr.cr = r.cr; }
      if (countryId) {
        const nr = nrs.get(`${pr.eventId}:${pr.type}:${pr.time}:${countryId}`);
        if (nr != null) pr.nr = nr;
      }
      const key = `${wcaId}:${pr.eventId}`;
      const dbBest = pr.type === "single" ? ranks.single.get(key) : ranks.average.get(key);
      const dbPrev = pr.type === "single" ? ranks.prevSingle?.get(key) : ranks.prevAverage?.get(key);
      if (dbBest && dbBest > pr.time) {
        pr.prevTime = dbBest;
      } else if (dbPrev) {
        pr.prevTime = dbPrev;
      }
    }
  }

  // Fallback: PRs still missing prevTime (e.g. prev_best NULL after first import)
  const missingPrevTime = Array.from(personMap.entries()).flatMap(([wcaId, p]) =>
    p.prs
      .filter((pr) => pr.prevTime === undefined)
      .map((pr) => ({ personId: wcaId, eventId: pr.eventId, currentBest: pr.time, type: pr.type }))
  );
  if (missingPrevTime.length > 0) {
    const prevBests = await getPrevBestsFromResults(missingPrevTime).catch(() => new Map<string, number>());
    for (const [wcaId, p] of personMap.entries()) {
      for (const pr of p.prs) {
        if (pr.prevTime === undefined) {
          const prev = prevBests.get(`${wcaId}:${pr.eventId}:${pr.type}`);
          if (prev) pr.prevTime = prev;
        }
      }
    }
  }

  return Array.from(personMap.values()).filter((p) => p.prs.length > 0);
}

// ─── Custom following variant ─────────────────────────────────────────────────

export async function fetchLivePRsForPersons(
  personIds: string[],
  days: number,
  knownCompsByPerson: Map<string, Set<string>>,
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

  // Include a competition if it has no wca_id (never in DB) OR if at least one
  // followed person doesn't yet have DB results for it.
  const liveComps = competitions.filter(
    (c) =>
      !c.wca_id ||
      personIds.some((id) => !knownCompsByPerson.get(id)?.has(c.wca_id!))
  );
  if (liveComps.length === 0) return [];

  const personMap = new Map<string, PersonPRs>();

  await Promise.all(
    liveComps.map((comp) =>
      processCompetitionForPersons(comp, followedIds, knownCompsByPerson, ranks, personMap)
    )
  );

  const personCountries = await getPersonCountries(personIds).catch(() => new Map<string, string>());

  const allPRs = Array.from(personMap.values()).flatMap((p) => p.prs);
  const [rankings, nrs] = await Promise.all([
    getVirtualRankings(
      allPRs.map((pr) => ({ eventId: pr.eventId, type: pr.type, time: pr.time }))
    ),
    getVirtualNRs(
      Array.from(personMap.entries()).flatMap(([wcaId, p]) => {
        const countryId = personCountries.get(wcaId);
        if (!countryId) return [];
        return p.prs.map((pr) => ({ eventId: pr.eventId, type: pr.type, time: pr.time, countryId }));
      })
    ),
  ]);

  // Collect PRs that still have no prevTime — happens when ranks.prevSingle
  // is NULL (first import never fires ON CONFLICT). Fall back to results table.
  const missingPrevTime = Array.from(personMap.entries()).flatMap(([wcaId, p]) =>
    p.prs
      .filter((pr) => pr.prevTime === undefined)
      .map((pr) => ({ personId: wcaId, eventId: pr.eventId, currentBest: pr.time, type: pr.type }))
  );
  const prevBests = await getPrevBestsFromResults(missingPrevTime).catch(() => new Map<string, number>());

  for (const [wcaId, p] of personMap.entries()) {
    const countryId = personCountries.get(wcaId);
    for (const pr of p.prs) {
      const r = rankings.get(`${pr.eventId}:${pr.type}:${pr.time}`);
      if (r) { pr.wr = r.wr; pr.cr = r.cr; }
      if (countryId) {
        const nr = nrs.get(`${pr.eventId}:${pr.type}:${pr.time}:${countryId}`);
        if (nr != null) pr.nr = nr;
      }
      if (pr.prevTime === undefined) {
        const prev = prevBests.get(`${wcaId}:${pr.eventId}:${pr.type}`);
        if (prev) pr.prevTime = prev;
      }
    }
  }

  return Array.from(personMap.values()).filter((p) => p.prs.length > 0);
}

async function processCompetitionForPersons(
  comp: GqlCompetition,
  followedIds: Set<string>,
  knownCompsByPerson: Map<string, Set<string>>,
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

  const wcaCompId = detail.wca_id ?? `live-${comp.id}`;

  // Only fetch persons who are followed AND don't already have DB results for this competition.
  const followedCompetitors = detail.competitors.filter(
    (c) =>
      c.wca_id &&
      followedIds.has(c.wca_id) &&
      !knownCompsByPerson.get(c.wca_id)?.has(wcaCompId)
  );
  if (followedCompetitors.length === 0) return;

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
        // Use WCA Live's own record tag as the authoritative PR indicator.
        // This avoids showing non-PR results when the person has no DB entry.
        if (entry.best > 0 && entry.singleRecord) {
          const key = `${wcaId}:${entry.eventId}`;
          const dbBest = ranks.single.get(key);
          // If dbBest > entry.best: rank not yet updated → use as prev.
          // If dbBest === entry.best: import already ran → fall back to prev_best column.
          const prevTime = dbBest && dbBest > entry.best
            ? dbBest
            : (ranks.prevSingle?.get(key) ?? undefined);
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
            prevTime,
          });
        }

        if (entry.average > 0 && entry.averageRecord) {
          const key = `${wcaId}:${entry.eventId}`;
          const dbAvgBest = ranks.average.get(key);
          const prevTime = dbAvgBest && dbAvgBest > entry.average
            ? dbAvgBest
            : (ranks.prevAverage?.get(key) ?? undefined);
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
            prevTime,
          });
        }
      }
    }
  }
}

async function processCompetition(
  comp: GqlCompetition,
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

  const competitors = detail.competitors.filter((c) => c.wca_id);
  if (competitors.length === 0) return;

  const wcaCompId = detail.wca_id ?? `live-${comp.id}`;
  const endDate = detail.end_date ?? detail.start_date;
  const compName = detail.name;

  for (let i = 0; i < competitors.length; i += PERSON_BATCH_SIZE) {
    const batch = competitors.slice(i, i + PERSON_BATCH_SIZE);
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
        if (entry.best > 0 && entry.singleRecord) {
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
          });
        }

        if (entry.average > 0 && entry.averageRecord) {
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
          });
        }
      }
    }
  }
}
