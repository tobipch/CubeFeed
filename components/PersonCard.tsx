"use client";

import { useState, useEffect } from "react";
import type { PersonPRs, PR } from "@/lib/queries";
import { EVENT_ORDER } from "@/lib/events";
import { effectivePRDate } from "@/lib/format";
import { deduplicatePRs, type DedupedPR } from "@/lib/deduplicate";
import PRBadge, { ShareIcon } from "./PRBadge";
import ShareModal from "./ShareModal";

interface Props {
  person: PersonPRs;
  highlightEvent?: string;
  bravos?: Record<string, number>;
  liked?: Set<string>;
  onBravo?: (personId: string, eventId: string, type: string, time: number) => void;
  lastVisitDate?: string | null;
}

export default function PersonCard({
  person,
  highlightEvent,
  bravos,
  liked,
  onBravo,
  lastVisitDate,
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

  const dedupedPRs = deduplicatePRs(person.prs);

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
        <ShareModal
          person={sharePersonData}
          bravos={bravos}
          avatarUrl={avatarUrl ?? undefined}
          onClose={closeShare}
        />
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
                const isNew = lastVisitDate ? effectivePRDate(item.pr) > lastVisitDate : false;
                return (
                  <PRBadge
                    key={`${item.pr.type}-${item.pr.competitionId}-${i}`}
                    pr={item.pr}
                    personId={person.personId}
                    prevTime={item.prevTime}
                    bravoCount={bravos?.[key] ?? 0}
                    isLiked={liked?.has(key) ?? false}
                    isNew={isNew}
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
