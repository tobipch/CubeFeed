import { type NextRequest } from "next/server";
import { runWcaImport } from "@/lib/wca-import";

// Allow up to 5 minutes (Vercel Pro); Hobby plan is capped at 60s
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runWcaImport();
    return Response.json({ ok: true, importedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Cron import failed:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
