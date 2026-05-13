import { NextRequest, NextResponse } from "next/server";
import { db, query } from "@/lib/db";

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
    // MAX(0, n) in SQLite acts as the scalar maximum — equivalent to PostgreSQL's GREATEST
    const result = await db.execute({
      sql: `INSERT INTO bravos (person_id, event_id, type, time, count)
            VALUES (?, ?, ?, ?, MAX(0, ?))
            ON CONFLICT (person_id, event_id, type, time) DO UPDATE
            SET count = MAX(0, bravos.count + ?)
            RETURNING count`,
      args: [personId, eventId, type, time, delta, delta],
    });
    const count = result.rows[0]?.[0] ?? 0;
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
