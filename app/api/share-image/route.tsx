export const runtime = "nodejs";

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

const IMG_WIDTH = 800;
const OUTER_PAD = 18;
const HEADER_H = 66;
const BADGE_H = 70;
const BADGE_GAP = 6;
const BADGE_AREA_PAD = 20; // 10px top + 10px bottom
const FOOTER_H = 36;

// ---------- route ----------

export async function POST(req: NextRequest) {
  const { person, bravos, avatarUrl } = (await req.json()) as {
    person: PersonPRs;
    bravos?: Record<string, number>;
    avatarUrl?: string;
  };

  // Fetch fonts from jsDelivr CDN — public, no auth, works in all Vercel environments
  const CDN = "https://cdn.jsdelivr.net/npm";
  const [geistRegular, geistSemiBold, dmMono] = await Promise.all([
    fetch(`${CDN}/geist@1.7.0/dist/fonts/geist-sans/Geist-Regular.woff2`).then((r) => r.arrayBuffer()),
    fetch(`${CDN}/geist@1.7.0/dist/fonts/geist-sans/Geist-SemiBold.woff2`).then((r) => r.arrayBuffer()),
    fetch(`${CDN}/@fontsource/dm-mono@5.2.7/files/dm-mono-latin-400-normal.woff2`).then((r) => r.arrayBuffer()),
  ]);

  // Fetch avatar server-side → base64 data URL
  let avatarSrc: string | null = null;
  if (avatarUrl) {
    try {
      const res = await fetch(avatarUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const mime = res.headers.get("content-type") ?? "image/jpeg";
        avatarSrc = `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
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
  const dateStr = now.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return new ImageResponse(
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
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid #f3f4f6",
              height: HEADER_H,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 18, color: "#111827" }}>
              {person.personName}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "#9ca3af",
                fontFamily: '"DM Mono", monospace',
              }}
            >
              {person.personId}
            </span>
            {avatarSrc && (
              <img
                src={avatarSrc}
                width={40}
                height={40}
                style={{
                  borderRadius: 20,
                  marginLeft: "auto",
                  objectFit: "cover",
                  border: "1px solid #e5e7eb",
                }}
              />
            )}
          </div>

          {/* Badge list */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: BADGE_GAP,
              padding: "10px 14px",
              flex: 1,
            }}
          >
            {eventGroups.map(([eventId, items]) =>
              items.map((item, i) => {
                const pr = item.pr;
                const isSingle = pr.type === "single";
                const record = getRecord(pr);
                const bravoKey = `${person.personId}:${pr.eventId}:${pr.type}:${pr.time}`;
                const bravoCount = bravos?.[bravoKey] ?? 0;

                const bgColor = isSingle ? "#eff6ff" : "#fff7ed";
                const borderCol = record
                  ? stripeColor(record)
                  : isSingle
                  ? "#bfdbfe"
                  : "#fed7aa";
                const borderW = record ? 2 : 1;
                const typeColor = isSingle ? "#3b82f6" : "#f97316";

                return (
                  <div
                    key={`${eventId}-${pr.type}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      height: BADGE_H,
                      borderRadius: 9,
                      border: `${borderW}px solid ${borderCol}`,
                      backgroundColor: bgColor,
                      overflow: "hidden",
                    }}
                  >
                    {/* Record stripe */}
                    {record && (
                      <div
                        style={{
                          width: 9,
                          background: stripeColor(record),
                          flexShrink: 0,
                        }}
                      />
                    )}

                    {/* Main content */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        flex: 1,
                        padding: "0 13px",
                        gap: 5,
                        minWidth: 0,
                        overflow: "hidden",
                      }}
                    >
                      {/* Row 1: event + type + competition */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#374151",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {eventName(eventId)}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: typeColor,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {typeLabel(eventId, pr.type)}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "#9ca3af",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                          }}
                        >
                          {pr.competitionName}
                        </span>
                      </div>

                      {/* Row 2: time + before + rank badges */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 20,
                            fontWeight: 700,
                            color: "#111827",
                            fontFamily: '"DM Mono", monospace',
                            lineHeight: 1,
                          }}
                        >
                          {formatTime(pr.time, pr.eventId, pr.type)}
                        </span>
                        {item.prevTime !== undefined && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#9ca3af",
                              fontFamily: '"DM Mono", monospace',
                              whiteSpace: "nowrap",
                            }}
                          >
                            (before {formatTime(item.prevTime, pr.eventId, pr.type)})
                          </span>
                        )}
                        {/* Rank badges */}
                        <div
                          style={{
                            display: "flex",
                            gap: 4,
                            marginLeft: "auto",
                            flexShrink: 0,
                          }}
                        >
                          {record && (
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "2px 7px",
                                borderRadius: 9999,
                                fontSize: 11,
                                fontWeight: 700,
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
                                padding: "2px 6px",
                                borderRadius: 5,
                                fontSize: 11,
                                fontWeight: 500,
                                lineHeight: 1,
                                backgroundColor: "#f3f4f6",
                                color: "#374151",
                                fontFamily: '"DM Mono", monospace',
                              }}
                            >
                              NR {pr.nr}
                            </span>
                          )}
                          {(pr.cr ?? 0) > 0 && (
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "2px 6px",
                                borderRadius: 5,
                                fontSize: 11,
                                fontWeight: 500,
                                lineHeight: 1,
                                backgroundColor: "#f3f4f6",
                                color: "#374151",
                                fontFamily: '"DM Mono", monospace',
                              }}
                            >
                              CR {pr.cr}
                            </span>
                          )}
                          {(pr.wr ?? 0) > 0 && (
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "2px 6px",
                                borderRadius: 5,
                                fontSize: 11,
                                fontWeight: 500,
                                lineHeight: 1,
                                backgroundColor: "#f3f4f6",
                                color: "#374151",
                                fontFamily: '"DM Mono", monospace',
                              }}
                            >
                              WR {pr.wr}
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
                          gap: 2,
                          padding: "0 13px",
                          borderLeft: `1px solid ${isSingle ? "#bfdbfe" : "#fed7aa"}`,
                          flexShrink: 0,
                          color: "#f87171",
                        }}
                      >
                        <span style={{ fontSize: 15, lineHeight: 1 }}>♥</span>
                        <span style={{ fontSize: 11, lineHeight: 1 }}>{bravoCount}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0 16px",
              height: FOOTER_H,
              borderTop: "1px solid #f3f4f6",
              background: "#f9fafb",
            }}
          >
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              🏆 CubeFeed · cubefeed.tobip.ch
            </span>
            <span
              style={{
                fontSize: 11,
                color: "#9ca3af",
                fontFamily: '"DM Mono", monospace',
              }}
            >
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
        { name: "DM Mono", data: dmMono, weight: 400, style: "normal" },
      ],
    },
  );
}
