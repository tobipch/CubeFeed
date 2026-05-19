"use client";

import type { PersonPRs, PR } from "@/lib/queries";
import { eventName, EVENT_ORDER, typeLabel } from "@/lib/events";
import { formatTime } from "@/lib/format";

interface Props {
  person: PersonPRs;
  bravos?: Record<string, number>;
  /** Pre-fetched blob URL or data URL — avoids CORS issues in html2canvas */
  avatarDataUrl?: string | null;
}

interface DedupedPR {
  pr: PR;
  prevTime?: number;
}

// ---------- utilities (mirrors PersonCard) ----------

function bravoLevel(count: number): 0 | 1 | 2 | 3 {
  if (count >= 20) return 3;
  if (count >= 10) return 2;
  if (count >= 5) return 1;
  return 0;
}

function badgeColorClasses(isSingle: boolean, level: 0 | 1 | 2 | 3): string {
  if (isSingle)
    return [
      "bg-blue-50 border border-blue-200",
      "bg-blue-100 border-2 border-blue-400",
      "border-2 border-blue-500",
      "bravo-shimmer-blue border-2 border-blue-600",
    ][level];
  return [
    "bg-orange-50 border border-orange-200",
    "bg-orange-100 border-2 border-orange-400",
    "border-2 border-orange-500",
    "bravo-shimmer-orange border-2 border-orange-600",
  ][level];
}

function recordStripe(record: string): string {
  if (record === "WR") return "linear-gradient(90deg,#f44336,#e53935,#f44336)";
  if (record === "CR") return "linear-gradient(90deg,#ffeb3b,#fdd835,#ffeb3b)";
  return "linear-gradient(90deg,#00e676,#00c853,#00e676)";
}

function badgeInlineStyle(isSingle: boolean, level: 0 | 1 | 2 | 3): React.CSSProperties {
  const style: React.CSSProperties = {};
  const shadows: string[] = [];
  if (level === 2) {
    style.background = isSingle
      ? "linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%)"
      : "linear-gradient(135deg,#fff7ed 0%,#fed7aa 100%)";
    shadows.push(
      isSingle ? "0 2px 8px rgba(59,130,246,.25)" : "0 2px 8px rgba(249,115,22,.25)"
    );
  } else if (level === 3) {
    shadows.push(
      isSingle ? "0 2px 6px rgba(59,130,246,.2)" : "0 2px 6px rgba(249,115,22,.2)"
    );
  }
  if (shadows.length) style.boxShadow = shadows.join(", ");
  return style;
}

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

// ---------- non-interactive PR badge ----------

function SharePRBadge({
  pr,
  prevTime,
  bravoCount = 0,
}: {
  pr: PR;
  prevTime?: number;
  bravoCount?: number;
}) {
  const isSingle = pr.type === "single";
  const level = bravoLevel(bravoCount);
  const record =
    pr.wr === 1 || pr.regionalRecord === "WR"
      ? "WR"
      : pr.cr === 1 || pr.regionalRecord === "CR"
      ? "CR"
      : pr.nr === 1 || pr.regionalRecord === "NR"
      ? "NR"
      : pr.regionalRecord && pr.regionalRecord !== "PR"
      ? pr.regionalRecord
      : null;

  const typeColors = isSingle
    ? (["text-blue-500", "text-blue-500", "text-blue-600", "text-blue-700"] as const)
    : (["text-orange-500", "text-orange-500", "text-orange-600", "text-orange-700"] as const);
  const typeColor = typeColors[level];

  const dividerColor = isSingle ? "border-blue-200" : "border-orange-200";

  const recordBorderStyle: React.CSSProperties =
    record === "WR"
      ? { border: "2px solid #f44336" }
      : record === "CR"
      ? { border: "2px solid #ffeb3b" }
      : record === "NR"
      ? { border: "2px solid #00c853" }
      : {};

  return (
    <div
      className={`flex items-stretch rounded-lg w-full overflow-hidden ${
        record ? "relative z-10" : ""
      } ${badgeColorClasses(isSingle, level)}`}
      style={{ ...badgeInlineStyle(isSingle, level), ...recordBorderStyle }}
    >
      {/* Left record stripe */}
      {record && (
        <div
          className="w-[10px] self-stretch shrink-0"
          style={{ background: recordStripe(record) }}
        />
      )}

      {/* Content (non-interactive div instead of <a>) */}
      <div className="flex-1 px-3 py-2 min-w-0">
        {/* Row 1 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`cubing-icon event-${pr.eventId} opacity-60 shrink-0`}
              aria-hidden="true"
              style={{ fontSize: 13 }}
            />
            <span className="text-xs font-medium text-gray-500">{eventName(pr.eventId)}</span>
            <span className={`text-xs font-medium ${typeColor}`}>
              {typeLabel(pr.eventId, pr.type)}
            </span>
          </div>
          <span className="text-xs text-gray-400 min-w-0">{pr.competitionName}</span>
        </div>

        {/* Row 2 */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 min-w-0 max-w-full">
            <span
              className="text-base font-bold text-gray-900 tabular-nums"
              style={{ fontFamily: "var(--font-dm-mono)" }}
            >
              {formatTime(pr.time, pr.eventId, pr.type)}
            </span>
            {prevTime !== undefined && (
              <span className="text-xs text-gray-400 font-mono tabular-nums">
                (before {formatTime(prevTime, pr.eventId, pr.type)})
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 ml-auto shrink-0">
            {(pr.nr ?? 0) > 0 && <RankBadge label="NR" value={pr.nr!} />}
            {(pr.cr ?? 0) > 0 && <RankBadge label="CR" value={pr.cr!} />}
            {(pr.wr ?? 0) > 0 && <RankBadge label="WR" value={pr.wr!} />}
          </div>
        </div>
      </div>

      {/* Bravo count display (non-interactive) */}
      {bravoCount > 0 && (
        <div
          className={`flex flex-col items-center justify-center gap-0.5 border-l ${dividerColor} px-2 sm:px-4 shrink-0 self-stretch text-red-400`}
        >
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5 shrink-0"
            fill="currentColor"
            stroke="none"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <span className="text-xs leading-none">{bravoCount}</span>
        </div>
      )}
    </div>
  );
}

function RankBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600 tabular-nums">
      {label} {value}
    </span>
  );
}

// ---------- main export ----------

export default function ShareCard({ person, bravos, avatarDataUrl }: Props) {
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

  const now = new Date();
  // No locale argument → uses the browser's locale (DD.MM.YYYY in Europe, MM/DD/YYYY in US, etc.)
  const dateStr = now.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    // Outer wrapper sets a fixed width so the screenshot is always desktop-sized
    <div style={{ width: 720, background: "#f3f4f6", padding: 16 }}>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header — identical layout to PersonCard */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
          <span className="font-semibold text-gray-900">{person.personName}</span>
          <span className="text-xs text-gray-400 font-mono shrink-0">{person.personId}</span>
          {avatarDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarDataUrl}
              alt={person.personName}
              className="ml-auto w-10 h-10 rounded-full object-cover ring-1 ring-gray-200"
            />
          ) : (
            <div className="ml-auto w-10 h-10 rounded-full bg-gray-100" />
          )}
        </div>

        {/* Badge list — identical layout to PersonCard */}
        <div className="px-3 py-2 flex flex-col gap-1.5">
          {eventGroups.map(([eventId, items]) =>
            items.map((item, i) => {
              const key = `${person.personId}:${item.pr.eventId}:${item.pr.type}:${item.pr.time}`;
              return (
                <SharePRBadge
                  key={`${eventId}-${item.pr.type}-${i}`}
                  pr={item.pr}
                  prevTime={item.prevTime}
                  bravoCount={bravos?.[key] ?? 0}
                />
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50">
          <span className="text-xs font-bold text-gray-500 tracking-wide leading-none">
            🏆 CubeFeed · cubefeed.tobip.ch
          </span>
          <span className="text-xs text-gray-400 font-mono leading-none">
            {dateStr} · {timeStr}
          </span>
        </div>
      </div>
    </div>
  );
}
