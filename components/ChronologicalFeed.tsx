"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { PersonPRs, PR } from "@/lib/queries";
import { eventName, typeLabel } from "@/lib/events";
import { formatTime, formatPRDate, effectivePRDate } from "@/lib/format";
import { deduplicatePRs } from "@/lib/deduplicate";

interface FeedItem {
  personId: string;
  personName: string;
  pr: PR;
  prevTime?: number;
}

function bravoKey(personId: string, eventId: string, type: string, time: number) {
  return `${personId}:${eventId}:${type}:${time}`;
}

interface Props {
  persons: PersonPRs[];
  lastVisitDate?: string | null;
  isLoggedIn?: boolean;
  onLoginRequired?: () => void;
}

export default function ChronologicalFeed({
  persons,
  lastVisitDate,
  isLoggedIn,
  onLoginRequired,
}: Props) {
  const [bravos, setBravos] = useState<Record<string, number>>({});
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/bravos")
      .then((r) => r.json())
      .then((data: { counts: Record<string, number>; myVotes: string[] }) => {
        setBravos(data.counts ?? {});
        setLiked(new Set(data.myVotes ?? []));
      })
      .catch(() => {});
  }, []);

  const uniquePersonIds = useMemo(
    () => [...new Set(persons.map((p) => p.personId))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persons.map((p) => p.personId).join(",")]
  );

  useEffect(() => {
    for (const id of uniquePersonIds) {
      fetch(`https://www.worldcubeassociation.org/api/v0/persons/${id}`)
        .then((r) => r.json())
        .then((d) => {
          const thumb = d?.person?.avatar?.thumb_url;
          if (thumb) setAvatarMap((prev) => ({ ...prev, [id]: thumb }));
        })
        .catch(() => {});
    }
  }, [uniquePersonIds]);

  const feedItems: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];
    for (const person of persons) {
      const deduped = deduplicatePRs(person.prs);
      for (const { pr, prevTime } of deduped) {
        items.push({ personId: person.personId, personName: person.personName, pr, prevTime });
      }
    }
    return items.sort((a, b) => {
      const dateDiff = effectivePRDate(b.pr).localeCompare(effectivePRDate(a.pr));
      if (dateDiff !== 0) return dateDiff;
      return a.pr.time - b.pr.time;
    });
  }, [persons]);

  // Group by effective date (firstSeenAt if known, else endDate)
  const grouped = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const item of feedItems) {
      const date = effectivePRDate(item.pr);
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(item);
    }
    return Array.from(map.entries());
  }, [feedItems]);

  const handleBravo = async (personId: string, eventId: string, type: string, time: number) => {
    if (!isLoggedIn) {
      onLoginRequired?.();
      return;
    }
    const key = bravoKey(personId, eventId, type, time);
    const wasLiked = liked.has(key);

    setBravos((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + (wasLiked ? -1 : 1)) }));
    setLiked((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(key);
      else next.add(key);
      return next;
    });

    try {
      const res = await fetch("/api/bravos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, eventId, type, time }),
      });
      const data = (await res.json()) as { count: number; voted: boolean };
      setBravos((prev) => ({ ...prev, [key]: data.count }));
      setLiked((prev) => {
        const next = new Set(prev);
        if (data.voted) next.add(key);
        else next.delete(key);
        return next;
      });
    } catch {
      setBravos((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + (wasLiked ? 1 : -1)) }));
      setLiked((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(key);
        else next.delete(key);
        return next;
      });
    }
  };

  if (feedItems.length === 0) return null;

  return (
    <div className="space-y-6">
      {grouped.map(([date, items]) => (
        <div key={date}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm font-semibold text-gray-500 whitespace-nowrap">
              {formatPRDate(date)}
            </span>
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400 font-mono whitespace-nowrap">{date}</span>
          </div>
          <div className="space-y-2">
            {items.map((item, i) => {
              const key = bravoKey(item.personId, item.pr.eventId, item.pr.type, item.pr.time);
              const isNew = lastVisitDate ? effectivePRDate(item.pr) > lastVisitDate : false;
              return (
                <FeedCard
                  key={`${item.personId}-${item.pr.eventId}-${item.pr.type}-${item.pr.time}-${i}`}
                  item={item}
                  avatarUrl={avatarMap[item.personId] ?? null}
                  bravoCount={bravos[key] ?? 0}
                  isLiked={liked.has(key)}
                  isNew={isNew}
                  onBravo={() => handleBravo(item.personId, item.pr.eventId, item.pr.type, item.pr.time)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedCard({
  item,
  avatarUrl,
  bravoCount,
  isLiked,
  isNew,
  onBravo,
}: {
  item: FeedItem;
  avatarUrl: string | null;
  bravoCount: number;
  isLiked: boolean;
  isNew: boolean;
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  onBravo: () => void | Promise<void>;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [seenInView, setSeenInView] = useState(false);

  useEffect(() => {
    if (!isNew || !cardRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setSeenInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.8 }
    );
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [isNew]);

  const showNewBadge = isNew && !seenInView;
  const { pr, prevTime, personId, personName } = item;
  const isSingle = pr.type === "single";
  const record =
      (pr.wr === 1 || pr.regionalRecord === "WR") ? "WR"
    : (pr.cr === 1 || pr.regionalRecord === "CR") ? "CR"
    : (pr.nr === 1 || pr.regionalRecord === "NR") ? "NR"
    : pr.regionalRecord && pr.regionalRecord !== "PR" ? pr.regionalRecord
    : null;

  const prLink = pr.liveUrl
    ?? `https://www.worldcubeassociation.org/persons/${personId}?event=${pr.eventId}`;
  const personLink = `https://www.worldcubeassociation.org/persons/${personId}`;

  const borderColor = isSingle ? "border-blue-200" : "border-orange-200";
  const bgColor = isSingle ? "bg-blue-50 hover:bg-blue-100" : "bg-orange-50 hover:bg-orange-100";

  const recordBorderStyle: React.CSSProperties = record === "WR"
    ? { border: "2px solid #f44336" }
    : record === "CR"
    ? { border: "2px solid #ffeb3b" }
    : record === "NR"
    ? { border: "2px solid #00c853" }
    : {};

  function recordStripe(rec: string): string {
    if (rec === "WR") return "linear-gradient(90deg,#f44336,#e53935,#f44336)";
    if (rec === "CR") return "linear-gradient(90deg,#ffeb3b,#fdd835,#ffeb3b)";
    return "linear-gradient(90deg,#00e676,#00c853,#00e676)";
  }

  return (
    <div
      ref={cardRef}
      className={`relative flex items-stretch rounded-lg border overflow-hidden ${borderColor} ${bgColor} transition-colors`}
      style={recordBorderStyle}
    >
      {showNewBadge && (
        <span className="absolute top-1.5 left-1.5 text-[10px] font-bold text-white bg-green-500 rounded-full px-1.5 py-0.5 z-20 leading-none pointer-events-none">
          NEW
        </span>
      )}

      {record && (
        <div className="w-[10px] self-stretch shrink-0" style={{ background: recordStripe(record) }} />
      )}

      <div className="flex-1 min-w-0">
        {/* Person row */}
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={personName} className="w-5 h-5 rounded-full object-cover ring-1 ring-gray-200 shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-gray-200 shrink-0" />
          )}
          <a
            href={personLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-gray-700 hover:text-blue-600 transition-colors truncate"
          >
            {personName}
          </a>
        </div>

        {/* PR row */}
        <a
          href={prLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 pb-2"
        >
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`cubing-icon event-${pr.eventId} opacity-60 shrink-0`}
              aria-label={eventName(pr.eventId)}
              style={{ fontSize: 13 }}
            />
            <span className="text-xs font-medium text-gray-500">{eventName(pr.eventId)}</span>
            <span className={`text-xs font-medium ${isSingle ? "text-blue-500" : "text-orange-500"}`}>
              {typeLabel(pr.eventId, pr.type)}
            </span>
          </div>
          <span
            className="text-sm font-bold text-gray-900 tabular-nums"
            style={{ fontFamily: "var(--font-dm-mono)" }}
          >
            {formatTime(pr.time, pr.eventId, pr.type)}
          </span>
          {prevTime !== undefined && (
            <span className="text-xs text-gray-400 font-mono tabular-nums">
              (before {formatTime(prevTime, pr.eventId, pr.type)})
            </span>
          )}
          <span className="text-xs text-gray-400 truncate min-w-0">{pr.competitionName}</span>
          <div className="flex items-center gap-1 ml-auto shrink-0">
            {(pr.nr ?? 0) > 0 && <RankBadge label="NR" value={pr.nr!} />}
            {(pr.cr ?? 0) > 0 && <RankBadge label="CR" value={pr.cr!} />}
            {(pr.wr ?? 0) > 0 && <RankBadge label="WR" value={pr.wr!} />}
          </div>
        </a>
      </div>

      {/* Bravo button */}
      <div className={`flex items-center border-l ${borderColor} shrink-0`}>
        <button
          type="button"
          onClick={onBravo}
          className={`flex flex-col items-center justify-center gap-0.5 px-3 py-2 h-full transition-colors ${
            isLiked ? "text-red-500" : "text-gray-300 hover:text-red-400"
          }`}
          aria-label={isLiked ? "Remove bravo" : "Give bravo"}
        >
          <HeartIcon filled={isLiked} />
          {bravoCount > 0 && <span className="text-xs leading-none">{bravoCount}</span>}
        </button>
      </div>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4 shrink-0"
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

function RankBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600 tabular-nums leading-none">
      {label} {value}
    </span>
  );
}
