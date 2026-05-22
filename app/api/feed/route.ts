import { type NextRequest } from "next/server";
import {
  fetchPRsForPersons,
  getRanksForPersons,
  getKnownCompetitionsByPerson,
  type PersonPRs,
} from "@/lib/queries";
import { fetchLivePRsForPersons } from "@/lib/wca-live";
import { execute, query } from "@/lib/db";

const VALID_DAYS = [3, 7, 14, 30];
const MAX_PERSONS = 100;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const idsParam = searchParams.get("ids") ?? "";
  const daysParam = Number(searchParams.get("days"));

  // Sort IDs so the same set in any order hits the same Vercel edge-cache entry.
  const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))].sort();
  if (ids.length === 0) return Response.json([]);
  if (ids.length > MAX_PERSONS) {
    return Response.json({ error: "Too many person IDs" }, { status: 400 });
  }

  const days = VALID_DAYS.includes(daysParam) ? daysParam : 7;

  const [dbPersons, ranks, knownCompsByPerson] = await Promise.all([
    fetchPRsForPersons(ids, days).catch(() => [] as PersonPRs[]),
    getRanksForPersons(ids).catch(() => ({
      single: new Map<string, number>(),
      average: new Map<string, number>(),
    })),
    getKnownCompetitionsByPerson(ids).catch(() => new Map<string, Set<string>>()),
  ]);

  const livePRs = await fetchLivePRsForPersons(ids, days, knownCompsByPerson, ranks).catch(
    () => [] as PersonPRs[]
  );

  const merged = mergeFeed(dbPersons, livePRs);
  await attachFirstSeen(merged, ids).catch(() => {});

  // Let Vercel's edge cache serve this response for up to 60 s, then
  // revalidate in the background for the next 5 minutes (stale-while-revalidate).
  return Response.json(merged, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

function mergeFeed(db: PersonPRs[], live: PersonPRs[]): PersonPRs[] {
  if (live.length === 0) return db;

  const result = db.map((p) => ({ ...p, prs: [...p.prs] }));
  const byId = new Map(result.map((p) => [p.personId, p]));

  for (const lp of live) {
    const existing = byId.get(lp.personId);
    if (existing) {
      existing.prs.push(...lp.prs);
    } else {
      result.push({ ...lp });
    }
  }

  return result;
}

function makeKey(personId: string, eventId: string, type: string, time: number, competitionId: string): string {
  return `${personId}:${eventId}:${type}:${time}:${competitionId}`;
}

/**
 * For each live PR, ensures a pr_first_seen row exists (INSERT IGNORE).
 * Then attaches `firstSeenAt` (ISO timestamp) to all PRs that have one — both
 * live ones (just inserted) and DB ones that were previously seen live.
 */
async function attachFirstSeen(persons: PersonPRs[], personIds: string[]): Promise<void> {
  if (persons.length === 0 || personIds.length === 0) return;

  // Collect all live PR keys for INSERT IGNORE
  const liveKeys: Array<[string, string, string, number, string]> = [];
  for (const p of persons) {
    for (const pr of p.prs) {
      if (pr.isLive) {
        liveKeys.push([p.personId, pr.eventId, pr.type, pr.time, pr.competitionId]);
      }
    }
  }

  if (liveKeys.length > 0) {
    const placeholders = liveKeys.map(() => "(?, ?, ?, ?, ?)").join(", ");
    await execute(
      `INSERT IGNORE INTO pr_first_seen (person_id, event_id, type, time, competition_id) VALUES ${placeholders}`,
      liveKeys.flat()
    );
  }

  // Fetch all first_seen_at rows for our followed persons. The result set is
  // small (only previously-seen-live PRs per person), so filter in JS.
  const personPlaceholders = personIds.map(() => "?").join(", ");
  const rows = await query<{
    person_id: string;
    event_id: string;
    type: string;
    time: number;
    competition_id: string;
    first_seen_at: string | Date;
  }>(
    `SELECT person_id, event_id, type, time, competition_id, first_seen_at
     FROM pr_first_seen
     WHERE person_id IN (${personPlaceholders})`,
    personIds
  );

  if (rows.length === 0) return;

  const seenMap = new Map<string, string>();
  for (const r of rows) {
    const ts = r.first_seen_at instanceof Date ? r.first_seen_at.toISOString() : String(r.first_seen_at);
    seenMap.set(makeKey(r.person_id, r.event_id, r.type, r.time, r.competition_id), ts);
  }

  for (const p of persons) {
    for (const pr of p.prs) {
      const key = makeKey(p.personId, pr.eventId, pr.type, pr.time, pr.competitionId);
      const seen = seenMap.get(key);
      if (seen) pr.firstSeenAt = seen;
    }
  }
}
