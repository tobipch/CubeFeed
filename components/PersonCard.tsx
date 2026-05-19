"use client";

import { useState, useEffect, lazy, Suspense } from "react";
import type { PersonPRs, PR } from "@/lib/queries";
import { eventName, EVENT_ORDER, typeLabel } from "@/lib/events";
import { formatTime } from "@/lib/format";

const ShareModal = lazy(() => import("./ShareModal"));

interface Props {
  person: PersonPRs;
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
  highlightEvent,
  bravos,
  liked,
  onBravo,
}: Props) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [sharePR, setSharePR] = useState<PR | null>(null);

  useEffect(() => {
    fetch(`https://www.worldcubeassociation.org/api/v0/persons/${person.personId}`)
      .then((r) => r.json())
      .then((data) => {
        const thumb = data?.person?.avatar?.thumb_url;
        if (thumb) setAvatarUrl(thumb);
      })
      .catch(() => {});
  }, [person.personId]);

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
    const prevTime =
      sorted.length > 1 && sorted[1].competitionId !== sorted[0].competitionId
        ? sorted[1].time
        : current.prevTime;
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

  // Build the person data to share — either all PRs or just the selected one
  const sharePersonData: PersonPRs = sharePR
    ? {
        ...person,
        prs: person.prs.filter(
          (p) =>
            p.eventId === sharePR.eventId &&
            p.type === sharePR.type &&
            p.time === sharePR.time &&
            p.competitionId === sharePR.competitionId,
        ),
      }
    : person;

  function openShare(pr: PR | null) {
    setSharePR(pr);
    setShowShare(true);
  }

  function closeShare() {
    setShowShare(false);
    setSharePR(null);
  }

  return (
    <div
      id={person.personId}
      className="bg-white rounded-xl border border-gray-200 scroll-mt-4 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <a
          href={`https://www.worldcubeassociation.org/persons/${person.personId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate"
        >
          {person.personName}
        </a>
        <span className="text-xs text-gray-400 font-mono shrink-0">
          {person.personId}
        </span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openShare(null)}
            className="text-gray-300 hover:text-gray-500 transition-colors shrink-0"
            aria-label="Share results"
          >
            <ShareIcon className="w-4 h-4" />
          </button>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={person.personName}
              className="w-10 h-10 rounded-full object-cover ring-1 ring-gray-200"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-100 animate-pulse" />
          )}
        </div>
      </div>

      {showShare && (
        <Suspense fallback={null}>
          <ShareModal
            person={sharePersonData}
            bravos={bravos}
            avatarUrl={avatarUrl ?? undefined}
            onClose={closeShare}
          />
        </Suspense>
      )}

      {/* Badge list */}
      <div className="px-3 py-2 flex flex-col gap-1.5">
        {eventGroups.map(([eventId, items]) => {
          const dimmed = highlightEvent != null && eventId !== highlightEvent;
          return (
            <div
              key={eventId}
              className={`flex flex-col gap-1 transition-opacity duration-200 ${dimmed ? "opacity-30" : ""}`}
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
                    onShare={() => openShare(item.pr)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
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
  if (record === "WR") return "linear-gradient(90deg,#f44336,#e53935,#f44336)";
  if (record === "CR") return "linear-gradient(90deg,#ffeb3b,#fdd835,#ffeb3b)";
  return "linear-gradient(90deg,#00e676,#00c853,#00e676)";
}

function badgeInlineStyle(
  isSingle: boolean,
  level: 0 | 1 | 2 | 3,
): React.CSSProperties {
  const shadows: string[] = [];
  const style: React.CSSProperties = {};

  if (level === 2) {
    style.background = isSingle
      ? "linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%)"
      : "linear-gradient(135deg,#fff7ed 0%,#fed7aa 100%)";
    shadows.push(isSingle ? "0 2px 8px rgba(59,130,246,.25)" : "0 2px 8px rgba(249,115,22,.25)");
  } else if (level === 3) {
    shadows.push(isSingle ? "0 2px 6px rgba(59,130,246,.2)" : "0 2px 6px rgba(249,115,22,.2)");
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
  onShare,
}: {
  pr: PR;
  personId: string;
  prevTime?: number;
  bravoCount?: number;
  isLiked?: boolean;
  onBravo?: () => void;
  onShare?: () => void;
}) {
  const href = pr.liveUrl
    ? pr.liveUrl
    : `https://www.worldcubeassociation.org/persons/${personId}?event=${pr.eventId}`;
  const isSingle = pr.type === "single";
  const level = bravoLevel(bravoCount);
  const record =
      (pr.wr === 1 || pr.regionalRecord === "WR") ? "WR"
    : (pr.cr === 1 || pr.regionalRecord === "CR") ? "CR"
    : (pr.nr === 1 || pr.regionalRecord === "NR") ? "NR"
    : pr.regionalRecord && pr.regionalRecord !== "PR" ? pr.regionalRecord
    : null;

  const typeColors = isSingle
    ? (["text-blue-500","text-blue-500","text-blue-600","text-blue-700"] as const)
    : (["text-orange-500","text-orange-500","text-orange-600","text-orange-700"] as const);
  const typeColor = typeColors[level];

  const dividerColor = isSingle ? "border-blue-200" : "border-orange-200";

  const heartColor = isLiked
    ? "text-red-500"
    : level > 0
    ? (isSingle ? "text-blue-300 hover:text-blue-500" : "text-orange-300 hover:text-orange-500")
    : "text-gray-300 hover:text-red-400";

  const recordBorderStyle: React.CSSProperties = record === "WR"
    ? { border: "2px solid #f44336" }
    : record === "CR"
    ? { border: "2px solid #ffeb3b" }
    : record === "NR"
    ? { border: "2px solid #00c853" }
    : {};

  return (
    <div
      className={`group flex items-stretch rounded-lg w-full transition-colors overflow-hidden ${record ? "relative z-10" : ""} ${badgeColorClasses(isSingle, level)}`}
      style={{ ...badgeInlineStyle(isSingle, level), ...recordBorderStyle }}
    >
      {/* Left record stripe */}
      {record && (
        <div className="w-[10px] self-stretch shrink-0" style={{ background: recordStripe(record) }} />
      )}

      {/* Main link */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 px-3 py-2 min-w-0"
      >
        {/* Row 1: icon + event + type (left) | competition name (right, truncated) */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`cubing-icon event-${pr.eventId} opacity-60 shrink-0`}
              aria-label={eventName(pr.eventId)}
              style={{ fontSize: 13 }}
            />
            <span className="text-xs font-medium text-gray-500">
              {eventName(pr.eventId)}
            </span>
            <span className={`text-xs font-medium ${typeColor}`}>
              {typeLabel(pr.eventId, pr.type)}
            </span>
          </div>
          <span className="text-xs text-gray-400 truncate min-w-0">
            {pr.competitionName}
          </span>
        </div>

        {/* Row 2: time + prev (left) | records (right, wraps to next line if no room) */}
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
      </a>

      {/* Right panel: share (optional) + heart */}
      <div className={`flex flex-col items-stretch border-l ${dividerColor} shrink-0 self-stretch`}>
        {onShare && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onShare(); }}
            className={`flex items-center justify-center flex-1 px-2.5 sm:px-3.5 text-gray-300 hover:text-gray-500 transition-colors border-b ${dividerColor}`}
            aria-label="Share this PR"
          >
            <ShareIcon className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onBravo?.(); }}
          className={`flex flex-col items-center justify-center gap-0.5 flex-1 px-2.5 sm:px-4 transition-colors ${heartColor}`}
          aria-label={isLiked ? "Remove bravo" : "Give bravo"}
        >
          <HeartIcon filled={isLiked} />
          {bravoCount > 0 && (
            <span className="text-xs leading-none">{bravoCount}</span>
          )}
        </button>
      </div>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5 shrink-0"
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

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "w-4 h-4"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function RankBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600 tabular-nums">
      {label} {value}
    </span>
  );
}
