"use client";

import { useState } from "react";

interface Props {
  persons: { personId: string; personName: string }[];
}

const INITIAL_VISIBLE = 8;

export default function JumpNav({ persons }: Props) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? persons : persons.slice(0, INITIAL_VISIBLE);
  const hasMore = persons.length > INITIAL_VISIBLE;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 mb-6">
      <div className="flex flex-wrap gap-1.5">
        {visible.map((p) => (
          <a
            key={p.personId}
            href={`#${p.personId}`}
            className="px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700 transition-colors whitespace-nowrap"
          >
            {p.personName}
          </a>
        ))}
        {hasMore && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="px-2.5 py-1 rounded-full text-xs bg-gray-200 text-gray-500 hover:bg-gray-300 transition-colors"
          >
            {expanded ? "Less ▲" : `+${persons.length - INITIAL_VISIBLE} more ▼`}
          </button>
        )}
      </div>
    </div>
  );
}
