"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, useEffect, useState } from "react";

interface Props {
  current: number;
  options: number[];
}

const TIMEOUT_MS = 15_000;

export default function DaysSelector({ current, options }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [timedOut, setTimedOut] = useState(false);

  // Safety net: stop showing spinner after TIMEOUT_MS even if transition stalls
  useEffect(() => {
    if (!isPending) {
      setTimedOut(false);
      return;
    }
    const id = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [isPending]);

  function select(days: number) {
    if (timedOut) setTimedOut(false);
    const next = new URLSearchParams(params.toString());
    next.set("days", String(days));
    startTransition(() => {
      router.push(`?${next.toString()}`);
    });
  }

  const showSpinner = isPending && !timedOut;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500 shrink-0">Last</span>
      <div className="flex gap-1">
        {options.map((d) => (
          <button
            key={d}
            onClick={() => select(d)}
            disabled={showSpinner}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
              d === current
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {d} days
          </button>
        ))}
      </div>
      {showSpinner && (
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  );
}
