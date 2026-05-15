import { NextRequest, NextResponse } from "next/server";
import { fetchPRs, getDbCompetitionIds, type PersonPRs } from "@/lib/queries";
import { fetchLivePRs } from "@/lib/wca-live";

const VALID_DAYS = [7, 14, 30, 60, 90];

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days")) || 30;

  if (!VALID_DAYS.includes(days)) {
    return NextResponse.json({ error: "Invalid days parameter" }, { status: 400 });
  }

  try {
    const [dbPersons, knownCompIds] = await Promise.all([
      fetchPRs(days),
      getDbCompetitionIds(),
    ]);

    const livePRs = await fetchLivePRs(days, knownCompIds).catch(() => [] as PersonPRs[]);

    return NextResponse.json(mergeFeed(dbPersons, livePRs));
  } catch (err) {
    console.error("DB query failed:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
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
