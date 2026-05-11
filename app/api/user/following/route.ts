import { getCurrentUser } from "@/lib/auth";
import { sql } from "@/lib/db";

interface FollowedPerson {
  wcaId: string;
  name: string;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Nicht eingeloggt." }, { status: 401 });

    const rows = await sql<{ wca_id: string; name: string; country_id: string | null }[]>`
      SELECT uf.wca_id, uf.name,
        (SELECT p.country_id FROM persons p WHERE p.wca_id = uf.wca_id ORDER BY p.sub_id DESC LIMIT 1) as country_id
      FROM user_following uf
      WHERE user_id = ${user.id}
      ORDER BY added_at ASC
    `;
    return Response.json(rows.map((r) => ({ wcaId: r.wca_id, name: r.name, countryIso2: r.country_id ?? "" })));
  } catch {
    return Response.json({ error: "Interner Fehler." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Nicht eingeloggt." }, { status: 401 });

    const body = await req.json();
    if (!Array.isArray(body)) {
      return Response.json({ error: "Ungültige Eingabe." }, { status: 400 });
    }
    const persons = body as FollowedPerson[];

    // Replace the user's following list inside a transaction
    await sql.begin(async (tx) => {
      await tx`DELETE FROM user_following WHERE user_id = ${user.id}`;
      if (persons.length > 0) {
        const values = persons.map((p) => ({
          user_id: user.id,
          wca_id: p.wcaId,
          name: p.name,
        }));
        await tx`
          INSERT INTO user_following ${tx(values, "user_id", "wca_id", "name")}
          ON CONFLICT (user_id, wca_id) DO UPDATE SET name = EXCLUDED.name
        `;
      }
    });

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
