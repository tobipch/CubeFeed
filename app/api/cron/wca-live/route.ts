import { type NextRequest } from "next/server";
import { populateLiveCache } from "@/lib/wca-live";

// Vercel injects CRON_SECRET automatically and sends it in the Authorization
// header when triggering scheduled cron jobs.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const result = await populateLiveCache();
    return Response.json({ ok: true, ...result, ms: Date.now() - start });
  } catch (err) {
    console.error("[cron/wca-live]", err);
    return Response.json({ ok: false, error: String(err), ms: Date.now() - start }, { status: 500 });
  }
}
