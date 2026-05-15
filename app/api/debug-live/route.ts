/**
 * Debug endpoint for WCA Live integration.
 * Visit /api/debug-live?days=30 (or ?days=90 etc.)
 * Optional: &comp=<WCA Live internal numeric id> to inspect a specific competition.
 */

import { NextResponse } from "next/server";
import { getDbCompetitionIds } from "@/lib/queries";

const WCA_LIVE_API = "https://live.worldcubeassociation.org/api";

function isoDateMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(WCA_LIVE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  return res.json();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(Number(searchParams.get("days") ?? "30"), 90);
  const compId = searchParams.get("comp"); // optional: specific WCA Live internal ID
  const from = isoDateMinus(days);

  const out: Record<string, unknown> = { days, from };

  // 1. Load DB competition IDs
  let dbIds = new Set<string>();
  try {
    dbIds = await getDbCompetitionIds();
    out.db_competition_count = dbIds.size;
    out.db_id_sample = Array.from(dbIds).slice(0, 5);
  } catch (e) {
    out.db_error = String(e);
  }

  // 2. Fetch competitions from WCA Live
  const compQuery = `
    query($from: Date) {
      competitions(from: $from) {
        id
        wca_id
        name
        start_date
        end_date
      }
    }
  `;
  const compJson = await gql(compQuery, { from });
  out.competitions_errors = compJson?.errors ?? null;

  const competitions: {
    id: string;
    wca_id: string;
    name: string;
    start_date: string;
    end_date: string | null;
  }[] = compJson?.data?.competitions ?? [];
  out.competition_count = competitions.length;

  // Classify each competition as "in DB" or "live (not in DB)"
  const inDb = competitions.filter((c) => c.wca_id && dbIds.has(c.wca_id));
  const notInDb = competitions.filter((c) => c.wca_id && !dbIds.has(c.wca_id));
  const noWcaId = competitions.filter((c) => !c.wca_id);

  out.live_competitions = notInDb; // these would be processed by fetchLivePRs
  out.db_competitions_in_list = inDb.map((c) => ({
    id: c.id,
    wca_id: c.wca_id,
    name: c.name,
    start_date: c.start_date,
  }));
  out.no_wca_id_competitions = noWcaId;

  // 3. Check whether the target competition is in the list and in the DB
  const targetId = compId ?? competitions[0]?.id;
  const targetComp = competitions.find((c) => c.id === targetId);
  out.target_comp_in_competitions_list = targetComp ?? null;
  out.target_wca_id_in_db = targetComp?.wca_id
    ? dbIds.has(targetComp.wca_id)
    : "unknown (competition not found in list)";

  if (targetId) {
    out.fetching_competitors_for = targetId;

    const competitorsQuery = `
      query($id: ID!) {
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
    const competitorsJson = await gql(competitorsQuery, { id: targetId });
    out.competitors_errors = competitorsJson?.errors ?? null;

    const comp = competitorsJson?.data?.competition;
    if (comp) {
      out.competition_detail = {
        id: comp.id,
        wca_id: comp.wca_id,
        name: comp.name,
        start_date: comp.start_date,
        end_date: comp.end_date,
        total_competitors: comp.competitors?.length ?? 0,
      };

      const allCompetitors = comp.competitors ?? [];
      const withWcaId = allCompetitors.filter(
        (c: { wca_id: string | null }) => c.wca_id != null
      );
      const withoutWcaId = allCompetitors.filter(
        (c: { wca_id: string | null }) => c.wca_id == null
      );

      out.competitor_count = allCompetitors.length;
      out.with_wca_id = withWcaId.length;
      out.without_wca_id_names = withoutWcaId.slice(0, 10).map(
        (c: { name: string }) => c.name
      );

      // Batch-query results for first 5 competitors with wca_id
      const sample: { id: string; wca_id: string | null; name: string }[] =
        withWcaId.slice(0, 5);
      if (sample.length > 0) {
        const aliases = sample
          .map(
            (c, i) => `
          p${i}: person(id: "${c.id}") {
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
        const batchQuery = `query PersonBatch {${aliases}\n}`;
        const batchJson = await gql(batchQuery);
        out.person_batch_errors = batchJson?.errors ?? null;
        out.person_batch = batchJson?.data ?? null;
      }
    }
  }

  return NextResponse.json(out, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
