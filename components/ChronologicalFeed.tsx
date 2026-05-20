"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { PersonPRs, PR } from "@/lib/queries";
import { formatPRDate, effectivePRDate } from "@/lib/format";
import { deduplicatePRs } from "@/lib/deduplicate";
import PRBadge from "./PRBadge";
import ShareModal from "./ShareModal";

const PAGE_SIZE = 20;

interface FeedItem {
  personId: string;
  personName: string;
  pr: PR;
  prevTime?: number;
}

function bravoKey(personId: string, eventId: string, type: string, time: number) {
  return `${personId}:${eventId}:${type}:${time}`;
}

function groupConsecutive(items: FeedItem[]): FeedItem[][] {
  const runs: FeedItem[][] = [];
  for (const item of items) {
    if (runs.length === 0 || runs[runs.length - 1][0].personId !== item.personId) {
      runs.push([item]);
    } else {
      runs[runs.length - 1].push(item);
    }
  }
  return runs;
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
  const [shareItem, setShareItem] = useState<FeedItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

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

  // Reset paging when the underlying data changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [persons]);

  const visibleItems = useMemo(
    () => feedItems.slice(0, visibleCount),
    [feedItems, visibleCount],
  );

  // Group by effective date (firstSeenAt if known, else endDate)
  const grouped = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const item of visibleItems) {
      const date = effectivePRDate(item.pr);
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(item);
    }
    return Array.from(map.entries());
  }, [visibleItems]);

  const hasMore = visibleCount < feedItems.length;

  useEffect(() => {
    if (!hasMore || !loadMoreRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, feedItems.length));
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, feedItems.length]);

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

  const sharePersonData: PersonPRs | null = shareItem
    ? {
        personId: shareItem.personId,
        personName: shareItem.personName,
        prs: [shareItem.pr],
      }
    : null;

  return (
    <div className="space-y-6">
      {grouped.map(([date, items]) => {
        const runs = groupConsecutive(items);
        return (
          <div key={date}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm font-semibold text-gray-500 whitespace-nowrap">
                {formatPRDate(date)}
              </span>
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-400 font-mono whitespace-nowrap">{date}</span>
            </div>
            <div className="space-y-3">
              {runs.map((runItems, runIdx) => (
                <FeedRow
                  key={`${runItems[0].personId}-${date}-${runIdx}`}
                  items={runItems}
                  avatarUrl={avatarMap[runItems[0].personId] ?? null}
                  bravos={bravos}
                  liked={liked}
                  lastVisitDate={lastVisitDate}
                  onBravo={handleBravo}
                  onShare={setShareItem}
                />
              ))}
            </div>
          </div>
        );
      })}

      {hasMore && (
        <div ref={loadMoreRef} className="py-6 flex justify-center">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {sharePersonData && (
        <ShareModal
          person={sharePersonData}
          bravos={bravos}
          avatarUrl={avatarMap[sharePersonData.personId] ?? undefined}
          onClose={() => setShareItem(null)}
        />
      )}
    </div>
  );
}

function FeedRow({
  items,
  avatarUrl,
  bravos,
  liked,
  lastVisitDate,
  onBravo,
  onShare,
}: {
  items: FeedItem[];
  avatarUrl: string | null;
  bravos: Record<string, number>;
  liked: Set<string>;
  lastVisitDate?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  onBravo: (personId: string, eventId: string, type: string, time: number) => void | Promise<void>;
  onShare: (item: FeedItem) => void;
}) {
  const { personId, personName } = items[0];
  const personLink = `https://www.worldcubeassociation.org/persons/${personId}`;
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Person header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={personName}
            className="w-7 h-7 rounded-full object-cover ring-1 ring-gray-200 shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gray-100 shrink-0" />
        )}
        <a
          href={personLink}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate"
        >
          {personName}
        </a>
        <span className="text-xs text-gray-400 font-mono shrink-0">{personId}</span>
      </div>

      {/* PRBadges */}
      <div className="px-3 py-2 flex flex-col gap-1.5">
        {items.map((item) => {
          const key = bravoKey(item.personId, item.pr.eventId, item.pr.type, item.pr.time);
          const isNew = lastVisitDate ? effectivePRDate(item.pr) > lastVisitDate : false;
          return (
            <PRBadge
              key={`${item.pr.eventId}-${item.pr.type}-${item.pr.time}`}
              pr={item.pr}
              personId={item.personId}
              prevTime={item.prevTime}
              bravoCount={bravos[key] ?? 0}
              isLiked={liked.has(key)}
              isNew={isNew}
              onBravo={() => onBravo(item.personId, item.pr.eventId, item.pr.type, item.pr.time)}
              onShare={() => onShare(item)}
            />
          );
        })}
      </div>
    </div>
  );
}
