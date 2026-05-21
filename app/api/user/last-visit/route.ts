import { getCurrentUser } from "@/lib/auth";
import { execute } from "@/lib/db";

export async function PUT() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await execute("UPDATE users SET last_feed_visit = NOW() WHERE id = ?", [user.id]);
  return Response.json({ ok: true });
}
