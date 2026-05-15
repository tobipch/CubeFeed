import { getCurrentUser } from "@/lib/auth";
import { pool, query } from "@/lib/db";

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

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("DELETE FROM user_following WHERE user_id = ?", [user.id]);
      for (const p of persons) {
        await conn.execute(
          `INSERT INTO user_following (user_id, wca_id, name)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name)`,
          [user.id, p.wcaId, p.name]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
