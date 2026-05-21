export function formatPRDate(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 6) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The date to treat as the PR's "actual" day. Prefers `firstSeenAt` (precise
 * day from live detection) over `endDate` (only the last day of the comp).
 */
export function effectivePRDate(pr: { endDate: string; firstSeenAt?: string }): string {
  return pr.firstSeenAt ? pr.firstSeenAt.slice(0, 10) : pr.endDate;
}

/**
 * Renders the date for a PR card.
 * Uses firstSeenAt only when it falls within the competition date range — this
 * gives precise "day 1 of a multi-day comp" when live, but ignores stale
 * firstSeenAt values that were recorded after the competition already ended.
 */
export function formatPRDateForDisplay(pr: {
  startDate?: string;
  endDate: string;
  firstSeenAt?: string;
}): string {
  const fsDate = pr.firstSeenAt?.slice(0, 10);
  const rangeStart = pr.startDate ?? pr.endDate;
  if (fsDate && fsDate >= rangeStart && fsDate <= pr.endDate) {
    return formatPRDate(fsDate);
  }
  if (!pr.startDate || pr.startDate === pr.endDate) return formatPRDate(pr.endDate);
  return formatDateRange(pr.startDate, pr.endDate);
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  if (startDate.slice(0, 7) === endDate.slice(0, 7)) {
    const month = start.toLocaleDateString("en-US", { month: "short" });
    return `${month} ${start.getDate()}–${end.getDate()}`;
  }
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startStr} – ${endStr}`;
}

export function formatTime(
  cs: number,
  eventId: string,
  type: "single" | "average" = "single"
): string {
  if (cs <= 0) return cs === -1 ? "DNF" : "DNS";

  if (eventId === "333fm") {
    // Singles are stored as raw move count; means/averages are stored as moves × 100
    if (type === "single") return `${cs} Moves`;
    return `${(cs / 100).toFixed(2)} Moves`;
  }

  if (eventId === "333mbf") {
    const missed = cs % 100;
    const timeSeconds = Math.floor(cs / 100) % 100000;
    const solved = 99 - Math.floor(cs / 10000000);
    return `${solved}/${solved + missed} ${formatCentiseconds(timeSeconds * 100)}`;
  }

  return formatCentiseconds(cs);
}

function formatCentiseconds(cs: number): string {
  const totalSeconds = Math.floor(cs / 100);
  const cents = cs % 100;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const cc = String(cents).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}.${cc}`;
  }
  if (minutes > 0) {
    return `${minutes}:${ss}.${cc}`;
  }
  return `${seconds}.${cc}`;
}
