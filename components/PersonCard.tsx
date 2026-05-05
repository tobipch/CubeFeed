"use client";

import { useState } from "react";
import type { PersonPRs, PR } from "@/lib/queries";
import { eventName, eventIconUrl, EVENT_ORDER, typeLabel } from "@/lib/events";
import { formatTime } from "@/lib/format";

interface Props {
  person: PersonPRs;
  initialOpen?: boolean;
  highlightEvent?: string;
  bravos?: Record<string, number>;
  liked?: Set<string>;
  onBravo?: (personId: string, eventId: string, type: string, time: number) => void;
}

interface DedupedPR {
  pr: PR;
  prevTime?: number;
}

export default function PersonCard({
  person,
  initialOpen = true,
  highlightEvent,
  bravos,
  liked,
  onBravo,
}: Props) {
  const [open, setOpen] = useState(initialOpen);

  // Deduplicate: for each (eventId, type) keep the most recent PR; if same
  // date, keep the better (lower) time. The displaced entry becomes prevTime.
  const byEventType = new Map<string, PR[]>();
  for (const pr of person.prs) {
    const key = `${pr.eventId}:${pr.type}`;
    if (!byEventType.has(key)) byEventType.set(key, []);
    byEventType.get(key)!.push(pr);
  }

  const dedupedPRs: DedupedPR[] = [];
  for (const prs of Array.from(byEventType.values())) {
    const sorted = [...prs].sort((a, b) => {
      const dateDiff = b.endDate.localeCompare(a.endDate);
      if (dateDiff !== 0) return dateDiff;
      return a.time - b.time;
    });
    const current = sorted[0];
    const prevTime = sorted.length > 1 ? sorted[1].time : current.prevTime;
    dedupedPRs.push({ pr: current, prevTime });
  }

  // Re-group by eventId for row display
  const byEvent = new Map<string, DedupedPR[]>();
  for (const item of dedupedPRs) {
    if (!byEvent.has(item.pr.eventId)) byEvent.set(item.pr.eventId, []);
    byEvent.get(item.pr.eventId)!.push(item);
  }

  const eventGroups = Array.from(byEvent.entries()).sort(([aId, aItems], [bId, bItems]) => {
    const minRank = (items: DedupedPR[], key: "nr" | "cr" | "wr") =>
      Math.min(...items.map((i) => i.pr[key] ?? Infinity));
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

  return (
    <div
      id={person.personId}
      className="bg-white rounded-xl border border-gray-200 scroll-mt-4 overflow-hidden"
    >
      {/* Accordion header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer select-none hover:bg-gray-50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <a
            href={`https://www.worldcubeassociation.org/persons/${person.personId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate"
            onClick={(e) => e.stopPropagation()}
          >
            {person.personName}
          </a>
          <span className="text-xs text-gray-400 font-mono shrink-0">
            {person.personId}
          </span>
        </div>
        <ChevronIcon open={open} />
      </div>

      {/* Collapsible body */}
      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <div className="flex flex-col gap-2 pt-3">
            {eventGroups.map(([eventId, items]) => {
              const dimmed = highlightEvent != null && eventId !== highlightEvent;
              return (
                <div
                  key={eventId}
                  className={`flex gap-2 flex-wrap transition-opacity duration-200 ${dimmed ? "opacity-30" : ""}`}
                >
                  {items.map((item, i) => {
                    const key = `${person.personId}:${item.pr.eventId}:${item.pr.type}:${item.pr.time}`;
                    return (
                      <PRBadge
                        key={`${item.pr.type}-${item.pr.competitionId}-${i}`}
                        pr={item.pr}
                        personId={person.personId}
                        prevTime={item.prevTime}
                        bravoCount={bravos?.[key] ?? 0}
                        isLiked={liked?.has(key) ?? false}
                        onBravo={
                          onBravo
                            ? () => onBravo(person.personId, item.pr.eventId, item.pr.type, item.pr.time)
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ml-2 ${open ? "" : "-rotate-90"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function bravoLevel(count: number): 0 | 1 | 2 | 3 {
  if (count >= 20) return 3;
  if (count >= 10) return 2;
  if (count >= 5)  return 1;
  return 0;
}

function badgeColorClasses(isSingle: boolean, level: 0 | 1 | 2 | 3): string {
  if (isSingle) return [
    "bg-blue-50   hover:bg-blue-100  border   border-blue-200  hover:border-blue-300",
    "bg-blue-100  hover:bg-blue-200  border-2 border-blue-400  hover:border-blue-500",
    "             border-2 border-blue-500  hover:border-blue-600",
    "bravo-shimmer-blue border-2 border-blue-600 hover:border-blue-700",
  ][level];
  return [
    "bg-orange-50  hover:bg-orange-100 border   border-orange-200 hover:border-orange-300",
    "bg-orange-100 hover:bg-orange-200 border-2 border-orange-400 hover:border-orange-500",
    "              border-2 border-orange-500 hover:border-orange-600",
    "bravo-shimmer-orange border-2 border-orange-600 hover:border-orange-700",
  ][level];
}

function recordStripe(record: string): string {
  if (record === "WR") return "linear-gradient(90deg,#fbbf24,#f59e0b,#fbbf24)";
  if (record === "CR") return "linear-gradient(90deg,#60a5fa,#3b82f6,#60a5fa)";
  return "linear-gradient(90deg,#4ade80,#22c55e,#4ade80)";
}

function badgeInlineStyle(
  isSingle: boolean,
  level: 0 | 1 | 2 | 3,
  hasRecord: boolean
): React.CSSProperties {
  const shadows: string[] = [];
  const style: React.CSSProperties = {};

  if (hasRecord) {
    style.transform = "translateY(-4px)";
  }

  if (level === 2) {
    style.background = isSingle
      ? "linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%)"
      : "linear-gradient(135deg,#fff7ed 0%,#fed7aa 100%)";
    shadows.push(isSingle ? "0 4px 14px rgba(59,130,246,.3)" : "0 4px 14px rgba(249,115,22,.3)");
  } else if (level === 3) {
    shadows.push(isSingle ? "0 4px 12px rgba(59,130,246,.2)" : "0 4px 12px rgba(249,115,22,.2)");
  }

  if (shadows.length) style.boxShadow = shadows.join(", ");
  return style;
}

function PRBadge({
  pr,
  personId,
  prevTime,
  bravoCount = 0,
  isLiked = false,
  onBravo,
}: {
  pr: PR;
  personId: string;
  prevTime?: number;
  bravoCount?: number;
  isLiked?: boolean;
  onBravo?: () => void;
}) {
  const href = pr.liveUrl
    ? pr.liveUrl
    : `https://www.worldcubeassociation.org/persons/${personId}?event=${pr.eventId}`;
  const isSingle = pr.type === "single";
  const level = bravoLevel(bravoCount);
  const record = pr.regionalRecord && pr.regionalRecord !== "PR" ? pr.regionalRecord : null;

  const typeColors = ["text-blue-500","text-blue-500","text-blue-600","text-blue-700"];
  const typeColorOrange = ["text-orange-500","text-orange-500","text-orange-600","text-orange-700"];
  const typeColor = isSingle ? typeColors[level] : typeColorOrange[level];

  const heartColor = isLiked
    ? "text-red-500"
    : level > 0
    ? (isSingle ? "text-blue-300 hover:text-blue-500" : "text-orange-300 hover:text-orange-500")
    : "text-gray-300 hover:text-red-400";

  return (
    <div
      className={`group flex flex-col rounded-lg min-w-[9rem] flex-1 max-w-[14rem] transition-colors overflow-hidden ${record ? "relative z-10" : ""} ${badgeColorClasses(isSingle, level)}`}
      style={badgeInlineStyle(isSingle, level, !!record)}
    >
      {record && (
        <div className="h-[5px] shrink-0" style={{ background: recordStripe(record) }} />
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col gap-1 px-3 pt-2 pb-1.5"
      >
        {/* Event header */}
        <div className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={eventIconUrl(pr.eventId)}
            alt={eventName(pr.eventId)}
            width={16}
            height={16}
            className="opacity-60"
          />
          <span className="text-xs font-medium text-gray-500 truncate">
            {eventName(pr.eventId)}
          </span>
          <span className={`text-xs ml-auto font-medium shrink-0 ${typeColor}`}>
            {typeLabel(pr.eventId, pr.type)}
          </span>
        </div>

        {/* Time */}
        <span className="text-lg font-bold font-mono text-gray-900">
          {formatTime(pr.time, pr.eventId, pr.type)}
        </span>

        {/* Previous PR */}
        <span className="text-xs text-gray-400 -mt-0.5">
          {prevTime !== undefined
            ? <>vorher <span className="font-mono">{formatTime(prevTime, pr.eventId, pr.type)}</span></>
            : "vorher noch kein Resultat"}
        </span>

        {/* Rankings / record badges */}
        <div className="flex gap-1 flex-wrap">
          {pr.regionalRecord && pr.regionalRecord !== "PR" && (
            <RecordHighlight record={pr.regionalRecord} />
          )}
          {pr.wr && <RankBadge label="WR" value={pr.wr} />}
          {pr.cr && <RankBadge label="CR" value={pr.cr} />}
          {pr.nr && <RankBadge label="NR" value={pr.nr} />}
        </div>

        {/* Competition */}
        <span className="text-xs text-gray-400 group-hover:text-gray-600 truncate transition-colors">
          {pr.competitionName}
        </span>
      </a>

      {/* Bravo button row */}
      <div className="flex justify-end px-2 pb-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBravo?.();
          }}
          className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full transition-colors ${heartColor}`}
          aria-label={isLiked ? "Bravo entfernen" : "Bravo geben"}
        >
          <HeartIcon filled={isLiked} />
          {bravoCount > 0 && <span>{bravoCount}</span>}
        </button>
      </div>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3 shrink-0"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function RecordHighlight({ record }: { record: string }) {
  const styles: Record<string, string> = {
    WR: "bg-yellow-400 text-yellow-900 ring-1 ring-yellow-500",
    CR: "bg-blue-500 text-white ring-1 ring-blue-600",
    NR: "bg-green-500 text-white ring-1 ring-green-600",
  };
  const style =
    styles[record] ?? "bg-amber-100 text-amber-800 ring-1 ring-amber-300";

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${style}`}>
      {record}
    </span>
  );
}

function RankBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-white/80 text-gray-600 border border-gray-200">
      {label} {value}
    </span>
  );
}
