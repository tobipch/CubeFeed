"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, useEffect, useState, useRef } from "react";

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
  const [tooltip, setTooltip] = useState<number | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleTouchStart(d: number) {
    touchTimer.current = setTimeout(() => setTooltip(d), 500);
  }

  function handleTouchEnd() {
    if (touchTimer.current) clearTimeout(touchTimer.current);
    setTooltip(null);
  }

  const showSpinner = isPending && !timedOut;

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {options.map((d) => (
          <button
            key={d}
            onClick={() => select(d)}
            disabled={showSpinner}
            title={`${d} days`}
            onTouchStart={() => handleTouchStart(d)}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            className={`relative px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
              d === current
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {d}d
            {tooltip === d && (
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none z-50">
                {d} days
              </span>
            )}
          </button>
        ))}
      </div>
      {showSpinner && (
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  );
}
