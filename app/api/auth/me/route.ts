import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json(null);
    return Response.json({
      id: user.id,
      username: user.username,
      wca_id: user.wca_id ?? null,
      wca_name: user.wca_name ?? null,
      wca_avatar_url: user.wca_avatar_url ?? null,
    });
  } catch {
    return Response.json(null);
  }
}
