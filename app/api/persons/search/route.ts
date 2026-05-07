import { type NextRequest } from "next/server";
import { sql } from "@/lib/db";

export async function GET(req: NextRequest) {
  const query = new URL(req.url).searchParams.get("q") ?? "";
  if (query.length < 2) return Response.json([]);

  const pattern = `%${query}%`;
  const rows = await sql<{ wca_id: string; name: string; country_id: string }[]>`
    SELECT DISTINCT ON (wca_id) wca_id, name, country_id
    FROM persons
    WHERE name ILIKE ${pattern}
       OR wca_id ILIKE ${pattern}
    ORDER BY wca_id, sub_id
    LIMIT 20
  `.catch(() => []);

  return Response.json(
    rows.map((r) => ({
      wcaId: r.wca_id,
      name: r.name,
      countryIso2: r.country_id,
    }))
  );
}
