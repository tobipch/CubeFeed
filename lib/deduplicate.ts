import type { PR } from "@/lib/queries";
import { effectivePRDate } from "@/lib/format";

export interface DedupedPR {
  pr: PR;
  prevTime?: number;
}

export function deduplicatePRs(prs: PR[]): DedupedPR[] {
  const byEventType = new Map<string, PR[]>();
  for (const pr of prs) {
    const key = `${pr.eventId}:${pr.type}`;
    if (!byEventType.has(key)) byEventType.set(key, []);
    byEventType.get(key)!.push(pr);
  }

  const result: DedupedPR[] = [];
  for (const group of Array.from(byEventType.values())) {
    const sorted = [...group].sort((a, b) => {
      const dateDiff = effectivePRDate(b).localeCompare(effectivePRDate(a));
      if (dateDiff !== 0) return dateDiff;
      return a.time - b.time;
    });
    const current = sorted[0];
    const prevTime =
      sorted.length > 1 && sorted[1].competitionId !== sorted[0].competitionId
        ? sorted[1].time
        : current.prevTime;
    result.push({ pr: current, prevTime });
  }
  return result;
}
