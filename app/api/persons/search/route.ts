import { type NextRequest } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length < 2) return Response.json([]);

  const pattern = `%${q}%`;
  // SQLite doesn't support DISTINCT ON — use ROW_NUMBER() window function instead
  const rows = await query<{ wca_id: string; name: string; country_id: string }>(
    `SELECT wca_id, name, country_id
     FROM (
       SELECT wca_id, name, country_id,
         ROW_NUMBER() OVER (PARTITION BY wca_id ORDER BY sub_id) AS rn
       FROM persons
       WHERE name LIKE ? OR wca_id LIKE ?
     )
     WHERE rn = 1
     ORDER BY wca_id
     LIMIT 20`,
    [pattern, pattern]
  ).catch(() => []);

  return Response.json(
    rows.map((r) => ({
      wcaId: r.wca_id,
      name: r.name,
      countryIso2: r.country_id,
    }))
  );
}
