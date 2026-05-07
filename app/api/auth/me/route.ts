import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json(null);
    return Response.json({ id: user.id, username: user.username });
  } catch {
    return Response.json(null);
  }
}
