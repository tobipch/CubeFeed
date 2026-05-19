"use client";

import type { PersonPRs, PR } from "@/lib/queries";
import { eventName, EVENT_ORDER, typeLabel, MEAN_EVENTS } from "@/lib/events";
import { formatTime } from "@/lib/format";

interface Props {
  person: PersonPRs;
  bravos?: Record<string, number>;
  avatarProxyUrl?: string;
}

interface DedupedPR {
  pr: PR;
  prevTime?: number;
}

function recordLabel(pr: PR): string | null {
  if (pr.wr === 1 || pr.regionalRecord === "WR") return "WR";
  if (pr.cr === 1 || pr.regionalRecord === "CR") return "CR";
  if (pr.nr === 1 || pr.regionalRecord === "NR") return "NR";
  if (pr.regionalRecord && pr.regionalRecord !== "PR") return pr.regionalRecord;
  return null;
}

function recordStripeColor(record: string): string {
  if (record === "WR") return "#f44336";
  if (record === "CR") return "#fdd835";
  return "#00c853";
}

function rankBadgeStyle(label: string): React.CSSProperties {
  if (label === "WR") return { background: "#f44336", color: "#fff" };
  if (label === "CR") return { background: "#fdd835", color: "#333" };
  if (label === "NR") return { background: "#00c853", color: "#fff" };
  return { background: "#e5e7eb", color: "#374151" };
}

// Deduplicate PRs same as PersonCard
function dedupePRs(prs: PR[]): DedupedPR[] {
  const byEventType = new Map<string, PR[]>();
  for (const pr of prs) {
    const key = `${pr.eventId}:${pr.type}`;
    if (!byEventType.has(key)) byEventType.set(key, []);
    byEventType.get(key)!.push(pr);
  }
  const result: DedupedPR[] = [];
  for (const group of Array.from(byEventType.values())) {
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

export default function ShareCard({ person, bravos, avatarProxyUrl }: Props) {
  const dedupedPRs = dedupePRs(person.prs);

  const byEvent = new Map<string, DedupedPR[]>();
  for (const item of dedupedPRs) {
    if (!byEvent.has(item.pr.eventId)) byEvent.set(item.pr.eventId, []);
    byEvent.get(item.pr.eventId)!.push(item);
  }

  const eventGroups = Array.from(byEvent.entries()).sort(([aId, aItems], [bId, bItems]) => {
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

  const today = new Date().toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div
      style={{
        width: 800,
        background: "#f9fafb",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Card */}
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #e5e7eb",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 17, color: "#111827", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {person.personName}
          </span>
          <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace", flexShrink: 0 }}>
            {person.personId}
          </span>
          {avatarProxyUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarProxyUrl}
              alt={person.personName}
              crossOrigin="anonymous"
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                objectFit: "cover",
                border: "1px solid #e5e7eb",
                flexShrink: 0,
              }}
            />
          )}
        </div>

        {/* PR rows */}
        <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {eventGroups.map(([eventId, items]) =>
            items.map((item, i) => {
              const pr = item.pr;
              const isSingle = pr.type === "single";
              const record = recordLabel(pr);
              const bravoKey = `${person.personId}:${pr.eventId}:${pr.type}:${pr.time}`;
              const bravoCount = bravos?.[bravoKey] ?? 0;

              const bgColor = isSingle ? "#eff6ff" : "#fff7ed";
              const borderColor = isSingle ? "#bfdbfe" : "#fed7aa";
              const timeColor = isSingle ? "#1d4ed8" : "#c2410c";

              return (
                <div
                  key={`${eventId}-${pr.type}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    borderRadius: 8,
                    border: record
                      ? `2px solid ${recordStripeColor(record)}`
                      : `1px solid ${borderColor}`,
                    background: bgColor,
                    overflow: "hidden",
                  }}
                >
                  {/* Record stripe */}
                  {record && (
                    <div
                      style={{
                        width: 8,
                        flexShrink: 0,
                        background: recordStripeColor(record),
                      }}
                    />
                  )}

                  {/* Content */}
                  <div style={{ flex: 1, padding: "8px 12px", minWidth: 0 }}>
                    {/* Row 1 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", flexShrink: 0 }}>
                        {eventName(eventId)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: isSingle ? "#3b82f6" : "#f97316", flexShrink: 0 }}>
                        {typeLabel(eventId, pr.type)}
                      </span>
                      <span style={{ fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pr.competitionName}
                      </span>
                    </div>

                    {/* Row 2 */}
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}>
                        {formatTime(pr.time, pr.eventId, pr.type)}
                      </span>
                      {item.prevTime !== undefined && (
                        <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>
                          (vorher {formatTime(item.prevTime, pr.eventId, pr.type)})
                        </span>
                      )}
                      <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexShrink: 0, flexWrap: "wrap" }}>
                        {record && (
                          <span
                            style={{
                              ...rankBadgeStyle(record),
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "1px 7px",
                              borderRadius: 9999,
                            }}
                          >
                            {record}
                          </span>
                        )}
                        {(pr.nr ?? 0) > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 6px", borderRadius: 4, background: "#f3f4f6", color: "#374151" }}>
                            NR {pr.nr}
                          </span>
                        )}
                        {(pr.cr ?? 0) > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 6px", borderRadius: 4, background: "#f3f4f6", color: "#374151" }}>
                            CR {pr.cr}
                          </span>
                        )}
                        {(pr.wr ?? 0) > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 6px", borderRadius: 4, background: "#f3f4f6", color: "#374151" }}>
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
                        padding: "0 14px",
                        borderLeft: `1px solid ${borderColor}`,
                        flexShrink: 0,
                        color: "#f87171",
                      }}
                    >
                      <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="currentColor" stroke="none">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      <span style={{ fontSize: 11, color: "#f87171" }}>{bravoCount}</span>
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
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px",
            borderTop: "1px solid #f3f4f6",
            background: "#f9fafb",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", letterSpacing: "0.05em" }}>
            cubefeed.app
          </span>
          <span style={{ fontSize: 11, color: "#d1d5db" }}>
            {today}
          </span>
        </div>
      </div>
    </div>
  );
}
