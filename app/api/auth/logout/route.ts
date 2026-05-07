import { deleteSession, SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST() {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) {
      await deleteSession(token);
      jar.set(SESSION_COOKIE, "", cookieOptions(0));
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Interner Fehler." }, { status: 500 });
  }
}
