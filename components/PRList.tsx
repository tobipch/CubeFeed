"use client";

import { useState, useEffect } from "react";
import type { PersonPRs } from "@/lib/queries";
import { eventName, EVENT_ORDER } from "@/lib/events";
import PersonCard from "./PersonCard";
import JumpNav from "./JumpNav";

const LIKED_KEY = "wca-bravos-liked";

function bravoKey(personId: string, eventId: string, type: string, time: number) {
  return `${personId}:${eventId}:${type}:${time}`;
}

interface Props {
  persons: PersonPRs[];
}

export default function PRList({ persons }: Props) {
  const [selectedEvent, setSelectedEvent] = useState<string>("all");
  const [bravos, setBravos] = useState<Record<string, number>>({});
  const [liked, setLiked] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(LIKED_KEY) ?? "[]");
      setLiked(new Set(stored as string[]));
    } catch {}
    fetch("/api/bravos")
      .then((r) => r.json())
      .then((data: Record<string, number>) => setBravos(data))
      .catch(() => {});
  }, []);

  const handleBravo = async (
    personId: string,
    eventId: string,
    type: string,
    time: number
  ) => {
    const key = bravoKey(personId, eventId, type, time);
    const isLiked = liked.has(key);
    const delta = isLiked ? -1 : 1;

    // Optimistic update
    setBravos((prev) => ({
      ...prev,
      [key]: Math.max(0, (prev[key] ?? 0) + delta),
    }));
    setLiked((prev) => {
      const next = new Set(prev);
      if (isLiked) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(LIKED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });

    try {
      const res = await fetch("/api/bravos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, eventId, type, time, delta }),
      });
      const data = (await res.json()) as { count: number };
      setBravos((prev) => ({ ...prev, [key]: data.count }));
    } catch {
      // Revert optimistic update
      setBravos((prev) => ({
        ...prev,
        [key]: Math.max(0, (prev[key] ?? 0) - delta),
      }));
      setLiked((prev) => {
        const next = new Set(prev);
        if (isLiked) next.add(key);
        else next.delete(key);
        try {
          localStorage.setItem(LIKED_KEY, JSON.stringify([...next]));
        } catch {}
        return next;
      });
    }
  };

  // Collect all event IDs that appear in any PR, sorted by EVENT_ORDER
  const eventIds = Array.from(
    new Set(persons.flatMap((p) => p.prs.map((pr) => pr.eventId)))
  ).sort((a, b) => {
    const ai = EVENT_ORDER.indexOf(a);
    const bi = EVENT_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const filtered =
    selectedEvent === "all"
      ? persons
      : persons.filter((p) =>
          p.prs.some((pr) => pr.eventId === selectedEvent)
        );

  return (
    <div>
      {eventIds.length > 1 && (
        <div className="flex items-center gap-2 mb-5">
          <label htmlFor="event-filter" className="text-sm text-gray-500 shrink-0">
            Event
          </label>
          <select
            id="event-filter"
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value)}
            className="font-sans text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="all">All events</option>
            {eventIds.map((id) => (
              <option key={id} value={id}>
                {eventName(id)}
              </option>
            ))}
          </select>
          {selectedEvent !== "all" && (
            <span className="text-xs text-gray-400">
              {filtered.length} cuber{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
      <JumpNav persons={filtered} />
      <div className="space-y-4">
        {filtered.map((person) => (
          <PersonCard
            key={person.personId}
            person={person}
            highlightEvent={selectedEvent === "all" ? undefined : selectedEvent}
            bravos={bravos}
            liked={liked}
            onBravo={handleBravo}
          />
        ))}
      </div>
    </div>
  );
}
