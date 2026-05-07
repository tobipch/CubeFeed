import { type NextRequest } from "next/server";
import {
  fetchPRsForPersons,
  getRanksForPersons,
  getKnownCompetitionsByPerson,
  type PersonPRs,
} from "@/lib/queries";
import { fetchLivePRsForPersons } from "@/lib/wca-live";

const VALID_DAYS = [3, 7, 14, 30];
const MAX_PERSONS = 50;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const idsParam = searchParams.get("ids") ?? "";
  const daysParam = Number(searchParams.get("days"));

  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
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

  return Response.json(mergeFeed(dbPersons, livePRs));
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
