import { type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db, query } from "@/lib/db";
import { createSession, cookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.trim().length < 3 ||
      password.length < 6
    ) {
      return Response.json(
        { error: "Benutzername (min. 3 Zeichen) und Passwort (min. 6 Zeichen) erforderlich." },
        { status: 400 }
      );
    }

    const trimmedUsername = username.trim();
    const existing = await query(
      "SELECT id FROM users WHERE username = ?",
      [trimmedUsername]
    );
    if (existing.length > 0) {
      return Response.json(
        { error: "Benutzername bereits vergeben." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.execute({
      sql: "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      args: [trimmedUsername, passwordHash],
    });
    const userId = Number(result.lastInsertRowid);
    const token = await createSession(userId);

    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, cookieOptions(30 * 24 * 60 * 60));

    return Response.json({ id: userId, username: trimmedUsername });
  } catch {
    return Response.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
