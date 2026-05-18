import { NextRequest, NextResponse } from "next/server";
import { execute, query } from "@/lib/db";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const jar = await cookies();
    const user = await getSessionUser(jar.get(SESSION_COOKIE)?.value);

    const counts = await query<{
      person_id: string;
      event_id: string;
      type: string;
      time: number;
      count: number;
    }>("SELECT person_id, event_id, type, time, count FROM bravos WHERE count > 0");

    const countsMap: Record<string, number> = {};
    for (const row of counts) {
      countsMap[`${row.person_id}:${row.event_id}:${row.type}:${row.time}`] = row.count;
    }

    let myVotes: string[] = [];
    if (user) {
      const votes = await query<{
        person_id: string; event_id: string; type: string; time: number;
      }>("SELECT person_id, event_id, type, time FROM bravo_votes WHERE user_id = ?", [user.id]);
      myVotes = votes.map((v) => `${v.person_id}:${v.event_id}:${v.type}:${v.time}`);
    }

    return NextResponse.json({ counts: countsMap, myVotes });
  } catch {
    return NextResponse.json({ counts: {}, myVotes: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const user = await getSessionUser(jar.get(SESSION_COOKIE)?.value);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { personId, eventId, type, time } = (await req.json()) as {
      personId: string; eventId: string; type: string; time: number;
    };
    if (!personId || !eventId || !type || !time) {
      return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }

    const existing = await query<{ user_id: number }>(
      "SELECT user_id FROM bravo_votes WHERE user_id = ? AND person_id = ? AND event_id = ? AND type = ? AND time = ?",
      [user.id, personId, eventId, type, time]
    );

    let voted: boolean;
    if (existing.length > 0) {
      await execute(
        "DELETE FROM bravo_votes WHERE user_id = ? AND person_id = ? AND event_id = ? AND type = ? AND time = ?",
        [user.id, personId, eventId, type, time]
      );
      await execute(
        "UPDATE bravos SET count = GREATEST(0, count - 1) WHERE person_id = ? AND event_id = ? AND type = ? AND time = ?",
        [personId, eventId, type, time]
      );
      voted = false;
    } else {
      await execute(
        "INSERT INTO bravo_votes (user_id, person_id, event_id, type, time) VALUES (?, ?, ?, ?, ?)",
        [user.id, personId, eventId, type, time]
      );
      await execute(
        `INSERT INTO bravos (person_id, event_id, type, time, count) VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE count = count + 1`,
        [personId, eventId, type, time]
      );
      voted = true;
    }

    const rows = await query<{ count: number }>(
      "SELECT count FROM bravos WHERE person_id = ? AND event_id = ? AND type = ? AND time = ?",
      [personId, eventId, type, time]
    );
    return NextResponse.json({ count: rows[0]?.count ?? 0, voted });
  } catch {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
