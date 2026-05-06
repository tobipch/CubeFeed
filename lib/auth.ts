import { cookies } from "next/headers";
import { sql } from "./db";
import crypto from "crypto";

export const SESSION_COOKIE = "wca_session";
const SESSION_DURATION_DAYS = 30;

export interface SessionUser {
  id: number;
  username: string;
}

/** Create a new session token, persist it, and return it. */
export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  );
  await sql`
    INSERT INTO user_sessions (token, user_id, expires_at)
    VALUES (${token}, ${userId}, ${expiresAt})
  `;
  return token;
}

/** Resolve a session token to the owning user, or null if invalid/expired. */
export async function getSessionUser(
  token: string | undefined
): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await sql<{ id: number; username: string }[]>`
    SELECT u.id, u.username
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
  `;
  return rows[0] ?? null;
}

/** Delete a session from the DB. */
export async function deleteSession(token: string): Promise<void> {
  await sql`DELETE FROM user_sessions WHERE token = ${token}`;
}

/** Read the current session user from the incoming request cookie. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return getSessionUser(token);
}

/** Cookie options for set/delete. */
export function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
