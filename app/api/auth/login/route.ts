import { type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { createSession, cookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (typeof username !== "string" || typeof password !== "string") {
      return Response.json({ error: "Ungültige Eingabe." }, { status: 400 });
    }

    const rows = await sql<{ id: number; password_hash: string }[]>`
      SELECT id, password_hash FROM users WHERE username = ${username.trim()}
    `;
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return Response.json(
        { error: "Benutzername oder Passwort falsch." },
        { status: 401 }
      );
    }

    const token = await createSession(user.id);
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, cookieOptions(30 * 24 * 60 * 60));

    return Response.json({ id: user.id, username: username.trim() });
  } catch {
    return Response.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
