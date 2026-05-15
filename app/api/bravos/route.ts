import { NextRequest, NextResponse } from "next/server";
import { execute, query } from "@/lib/db";

export async function GET() {
  try {
    const rows = await query<{
      person_id: string;
      event_id: string;
      type: string;
      time: number;
      count: number;
    }>("SELECT person_id, event_id, type, time, count FROM bravos WHERE count > 0");
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[`${row.person_id}:${row.event_id}:${row.type}:${row.time}`] = row.count;
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({});
  }
}

export async function POST(req: NextRequest) {
  try {
    const { personId, eventId, type, time, delta } = (await req.json()) as {
      personId: string;
      eventId: string;
      type: string;
      time: number;
      delta: number;
    };
    if (!personId || !eventId || !type || !time || (delta !== 1 && delta !== -1)) {
      return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }
    await execute(
      `INSERT INTO bravos (person_id, event_id, type, time, count)
       VALUES (?, ?, ?, ?, GREATEST(0, ?))
       ON DUPLICATE KEY UPDATE count = GREATEST(0, count + ?)`,
      [personId, eventId, type, time, delta, delta]
    );
    const rows = await query<{ count: number }>(
      "SELECT count FROM bravos WHERE person_id = ? AND event_id = ? AND type = ? AND time = ?",
      [personId, eventId, type, time]
    );
    const count = rows[0]?.count ?? 0;
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
