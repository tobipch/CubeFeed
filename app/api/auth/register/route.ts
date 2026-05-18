import { type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { execute, query } from "@/lib/db";
import { createSession, cookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? req.headers.get("x-real-ip")
      ?? "unknown";
    const rl = checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
    if (!rl.allowed) {
      return Response.json(
        { error: `Zu viele Registrierungen. Bitte in ${rl.retryAfterSecs} Sekunden erneut versuchen.` },
        { status: 429 }
      );
    }

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

    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(trimmedUsername)) {
      return Response.json(
        { error: "Benutzername darf nur Buchstaben, Zahlen, _ und - enthalten (3–30 Zeichen)." },
        { status: 400 }
      );
    }
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
    const result = await execute(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [trimmedUsername, passwordHash]
    );
    const userId = result.insertId;
    const token = await createSession(userId);

    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, cookieOptions(30 * 24 * 60 * 60));

    return Response.json({ id: userId, username: trimmedUsername });
  } catch {
    return Response.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
