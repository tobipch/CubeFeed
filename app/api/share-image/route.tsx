export const runtime = "edge";

import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import type { PersonPRs, PR } from "@/lib/queries";
import { eventName, EVENT_ORDER, typeLabel } from "@/lib/events";
import { formatTime } from "@/lib/format";

// ---------- data helpers (mirrors PersonCard logic) ----------

interface DedupedPR {
  pr: PR;
  prevTime?: number;
}

function dedupePRs(prs: PR[]): DedupedPR[] {
  const byEventType = new Map<string, PR[]>();
  for (const pr of prs) {
    const key = `${pr.eventId}:${pr.type}`;
    if (!byEventType.has(key)) byEventType.set(key, []);
    byEventType.get(key)!.push(pr);
  }
  const result: DedupedPR[] = [];
  for (const group of byEventType.values()) {
    const sorted = [...group].sort((a, b) => {
      const d = b.endDate.localeCompare(a.endDate);
      return d !== 0 ? d : a.time - b.time;
    });
    const current = sorted[0];
    const prevTime =
      sorted.length > 1 && sorted[1].competitionId !== sorted[0].competitionId
        ? sorted[1].time
        : current.prevTime;
    result.push({ pr: current, prevTime });
  }
  return result;
}

function groupAndSort(dedupedPRs: DedupedPR[]): Array<[string, DedupedPR[]]> {
  const byEvent = new Map<string, DedupedPR[]>();
  for (const item of dedupedPRs) {
    if (!byEvent.has(item.pr.eventId)) byEvent.set(item.pr.eventId, []);
    byEvent.get(item.pr.eventId)!.push(item);
  }
  return Array.from(byEvent.entries()).sort(([aId, aItems], [bId, bItems]) => {
    const minRank = (items: DedupedPR[], k: "nr" | "cr" | "wr") =>
      Math.min(...items.map((i) => i.pr[k] ?? Infinity));
    const diff =
      minRank(aItems, "nr") - minRank(bItems, "nr") ||
      minRank(aItems, "cr") - minRank(bItems, "cr") ||
      minRank(aItems, "wr") - minRank(bItems, "wr");
    if (diff !== 0) return diff;
    return (
      (EVENT_ORDER.indexOf(aId) === -1 ? 99 : EVENT_ORDER.indexOf(aId)) -
      (EVENT_ORDER.indexOf(bId) === -1 ? 99 : EVENT_ORDER.indexOf(bId))
    );
  });
}

function getRecord(pr: PR): "WR" | "CR" | "NR" | string | null {
  if (pr.wr === 1 || pr.regionalRecord === "WR") return "WR";
  if (pr.cr === 1 || pr.regionalRecord === "CR") return "CR";
  if (pr.nr === 1 || pr.regionalRecord === "NR") return "NR";
  if (pr.regionalRecord && pr.regionalRecord !== "PR") return pr.regionalRecord;
  return null;
}

function recordColor(record: string) {
  if (record === "WR") return { bg: "#f44336", text: "#fff" };
  if (record === "CR") return { bg: "#fdd835", text: "#333" };
  return { bg: "#00c853", text: "#fff" };
}

function stripeColor(record: string) {
  if (record === "WR") return "#f44336";
  if (record === "CR") return "#fdd835";
  return "#00c853";
}

// ---------- image dimensions ----------

const S = 2; // scale factor — multiply all pixel values for 2× resolution
const IMG_WIDTH = 800 * S;
const OUTER_PAD = 18 * S;
const HEADER_H = 66 * S;
const BADGE_H = 70 * S;
const BADGE_GAP = 6 * S;
const BADGE_AREA_PAD = 20 * S;
const FOOTER_H = 36 * S;

// ---------- route ----------

export async function POST(req: NextRequest) {
  const { person, bravos, avatarUrl } = (await req.json()) as {
    person: PersonPRs;
    bravos?: Record<string, number>;
    avatarUrl?: string;
  };

  // Fetch fonts from jsDelivr CDN — public, no auth, works in all Vercel environments
  const CDN = "https://cdn.jsdelivr.net/npm";
  const [geistRegular, geistSemiBold, dmMono400, dmMono500] = await Promise.all([
    fetch(`${CDN}/geist@1.7.0/dist/fonts/geist-sans/Geist-Regular.ttf`).then((r) => r.arrayBuffer()),
    fetch(`${CDN}/geist@1.7.0/dist/fonts/geist-sans/Geist-SemiBold.ttf`).then((r) => r.arrayBuffer()),
    fetch(`${CDN}/@fontsource/dm-mono@5.2.7/files/dm-mono-latin-400-normal.woff`).then((r) => r.arrayBuffer()),
    fetch(`${CDN}/@fontsource/dm-mono@5.2.7/files/dm-mono-latin-500-normal.woff`).then((r) => r.arrayBuffer()),
  ]);

  // Pre-fetch avatar as base64 data URL so Satori doesn't do its own external fetch
  let avatarSrc: string | null = null;
  if (avatarUrl) {
    try {
      const res = await fetch(avatarUrl);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        const mime = res.headers.get("content-type") ?? "image/jpeg";
        let binary = "";
        for (let i = 0; i < buf.length; i += 1024) {
          binary += String.fromCharCode(...buf.subarray(i, i + 1024));
        }
        avatarSrc = `data:${mime};base64,${btoa(binary)}`;
      }
    } catch {
      // proceed without avatar
    }
  }

  const dedupedPRs = dedupePRs(person.prs);
  const eventGroups = groupAndSort(dedupedPRs);
  const totalBadges = dedupedPRs.length;

  const badgeAreaH =
    BADGE_AREA_PAD + totalBadges * BADGE_H + Math.max(0, totalBadges - 1) * BADGE_GAP;
  const imgHeight = OUTER_PAD * 2 + HEADER_H + badgeAreaH + FOOTER_H;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // Flatten badge list — Satori does not handle nested arrays from .map inside .map
  const badges = eventGroups.flatMap(([eventId, items]) =>
    items.map((item, i) => {
      const pr = item.pr;
      const isSingle = pr.type === "single";
      const record = getRecord(pr);
      const bravoKey = `${person.personId}:${pr.eventId}:${pr.type}:${pr.time}`;
      const bravoCount = bravos?.[bravoKey] ?? 0;
      const bgColor = isSingle ? "#eff6ff" : "#fff7ed";
      const borderCol = record ? stripeColor(record) : isSingle ? "#bfdbfe" : "#fed7aa";
      const borderW = record ? 2 : 1;
      const typeColor = isSingle ? "#3b82f6" : "#f97316";
      return { key: `${eventId}-${pr.type}-${i}`, pr, item, isSingle, record, bravoCount, bgColor, borderCol, borderW, typeColor };
    })
  );

  try {
    const imgResponse = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: IMG_WIDTH,
          height: imgHeight,
          padding: OUTER_PAD,
          background: "#f3f4f6",
          fontFamily: '"Geist", sans-serif',
        }}
      >
        {/* Card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            background: "#ffffff",
            borderRadius: 14 * S,
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8 * S,
              padding: `${12 * S}px ${16 * S}px`,
              borderBottom: "1px solid #f3f4f6",
              height: HEADER_H,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 18 * S, color: "#111827" }}>
              {person.personName}
            </span>
            <span style={{ fontSize: 12 * S, color: "#9ca3af", fontFamily: "DM Mono" }}>
              {person.personId}
            </span>
            {avatarSrc && (
              <img
                src={avatarSrc}
                alt=""
                width={40 * S}
                height={40 * S}
                style={{ borderRadius: 20 * S, marginLeft: "auto", border: "1px solid #e5e7eb" }}
              />
            )}
          </div>

          {/* Badge list */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: BADGE_GAP,
              padding: `${10 * S}px ${14 * S}px`,
              flex: 1,
            }}
          >
            {badges.map(({ key, pr, item, isSingle, record, bravoCount, bgColor, borderCol, borderW, typeColor }) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  height: BADGE_H,
                  borderRadius: 9 * S,
                  border: `${borderW}px solid ${borderCol}`,
                  backgroundColor: bgColor,
                }}
              >
                {/* Record stripe */}
                {record && (
                  <div style={{ width: 9 * S, background: stripeColor(record), flexShrink: 0 }} />
                )}

                {/* Main content */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    flex: 1,
                    padding: `0 ${13 * S}px`,
                    gap: 5 * S,
                  }}
                >
                  {/* Row 1: event + type + competition */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 * S }}>
                    <span style={{ fontSize: 12 * S, fontWeight: 600, color: "#374151" }}>
                      {eventName(pr.eventId)}
                    </span>
                    <span style={{ fontSize: 11 * S, fontWeight: 600, color: typeColor }}>
                      {typeLabel(pr.eventId, pr.type)}
                    </span>
                    <span style={{ fontSize: 11 * S, color: "#9ca3af" }}>
                      {pr.competitionName}
                    </span>
                  </div>

                  {/* Row 2: time + before + rank badges */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 * S }}>
                    <span
                      style={{
                        fontSize: 20 * S,
                        fontWeight: 500,
                        color: "#111827",
                        fontFamily: "DM Mono",
                        lineHeight: 1,
                      }}
                    >
                      {formatTime(pr.time, pr.eventId, pr.type)}
                    </span>
                    {item.prevTime !== undefined && (
                      <span style={{ fontSize: 11 * S, color: "#9ca3af", fontFamily: "DM Mono" }}>
                        {"(before " + formatTime(item.prevTime, pr.eventId, pr.type) + ")"}
                      </span>
                    )}
                    {/* Rank badges */}
                    <div style={{ display: "flex", gap: 4 * S, marginLeft: "auto" }}>
                      {record && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: `${2 * S}px ${7 * S}px`,
                            borderRadius: 9999,
                            fontSize: 11 * S,
                            fontWeight: 600,
                            lineHeight: 1,
                            backgroundColor: recordColor(record).bg,
                            color: recordColor(record).text,
                          }}
                        >
                          {record}
                        </span>
                      )}
                      {(pr.nr ?? 0) > 0 && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: `${2 * S}px ${6 * S}px`,
                            borderRadius: 5 * S,
                            fontSize: 11 * S,
                            fontWeight: 400,
                            lineHeight: 1,
                            backgroundColor: "#f3f4f6",
                            color: "#374151",
                            fontFamily: "DM Mono",
                          }}
                        >
                          {"NR " + pr.nr}
                        </span>
                      )}
                      {(pr.cr ?? 0) > 0 && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: `${2 * S}px ${6 * S}px`,
                            borderRadius: 5 * S,
                            fontSize: 11 * S,
                            fontWeight: 400,
                            lineHeight: 1,
                            backgroundColor: "#f3f4f6",
                            color: "#374151",
                            fontFamily: "DM Mono",
                          }}
                        >
                          {"CR " + pr.cr}
                        </span>
                      )}
                      {(pr.wr ?? 0) > 0 && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: `${2 * S}px ${6 * S}px`,
                            borderRadius: 5 * S,
                            fontSize: 11 * S,
                            fontWeight: 400,
                            lineHeight: 1,
                            backgroundColor: "#f3f4f6",
                            color: "#374151",
                            fontFamily: "DM Mono",
                          }}
                        >
                          {"WR " + pr.wr}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bravo count */}
                {bravoCount > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2 * S,
                      padding: `0 ${13 * S}px`,
                      borderLeft: `1px solid ${isSingle ? "#bfdbfe" : "#fed7aa"}`,
                      flexShrink: 0,
                      color: "#f87171",
                    }}
                  >
                    <span style={{ fontSize: 13 * S, lineHeight: 1, color: "#f87171" }}>{"♡"}</span>
                    <span style={{ fontSize: 11 * S, lineHeight: 1 }}>{bravoCount}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: `0 ${16 * S}px`,
              height: FOOTER_H,
              borderTop: "1px solid #f3f4f6",
              background: "#f9fafb",
            }}
          >
            <span style={{ fontSize: 11 * S, color: "#9ca3af" }}>
              CubeFeed · cubefeed.tobip.ch
            </span>
            <span style={{ fontSize: 11 * S, color: "#9ca3af", fontFamily: "DM Mono" }}>
              {dateStr} · {timeStr}
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: IMG_WIDTH,
      height: imgHeight,
      fonts: [
        { name: "Geist", data: geistRegular, weight: 400, style: "normal" },
        { name: "Geist", data: geistSemiBold, weight: 600, style: "normal" },
        { name: "DM Mono", data: dmMono400, weight: 400, style: "normal" },
        { name: "DM Mono", data: dmMono500, weight: 500, style: "normal" },
      ],
    });

    // Materialize the stream — catches silent empty renders
    const pngBuffer = await imgResponse.arrayBuffer();
    if (pngBuffer.byteLength === 0) {
      return new Response(JSON.stringify({ error: "Satori produced empty output" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(pngBuffer, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message + "\n" + (err.stack ?? "") : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
