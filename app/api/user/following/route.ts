import { getCurrentUser } from "@/lib/auth";
import { db, query } from "@/lib/db";

interface FollowedPerson {
  wcaId: string;
  name: string;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Nicht eingeloggt." }, { status: 401 });

    const rows = await query<{ wca_id: string; name: string }>(
      "SELECT wca_id, name FROM user_following WHERE user_id = ? ORDER BY added_at ASC",
      [user.id]
    );
    return Response.json(rows.map((r) => ({ wcaId: r.wca_id, name: r.name })));
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

    const tx = await db.transaction("write");
    try {
      await tx.execute({
        sql: "DELETE FROM user_following WHERE user_id = ?",
        args: [user.id],
      });
      for (const p of persons) {
        await tx.execute({
          sql: `INSERT INTO user_following (user_id, wca_id, name)
                VALUES (?, ?, ?)
                ON CONFLICT (user_id, wca_id) DO UPDATE SET name = EXCLUDED.name`,
          args: [user.id, p.wcaId, p.name],
        });
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
