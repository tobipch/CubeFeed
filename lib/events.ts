export const EVENT_NAMES: Record<string, string> = {
  "333": "3x3x3",
  "222": "2x2x2",
  "444": "4x4x4",
  "555": "5x5x5",
  "666": "6x6x6",
  "777": "7x7x7",
  "333bf": "3x3x3 Blindfolded",
  "333fm": "3x3x3 Fewest Moves",
  "333oh": "3x3x3 One-Handed",
  clock: "Clock",
  minx: "Megaminx",
  pyram: "Pyraminx",
  skewb: "Skewb",
  sq1: "Square-1",
  "444bf": "4x4x4 Blindfolded",
  "555bf": "5x5x5 Blindfolded",
  "333mbf": "3x3x3 Multi-Blind",
};

// Events where the "average" result is a Mean of 3, not an Ao5
export const MEAN_EVENTS = new Set(["666", "777", "333fm", "444bf", "555bf"]);

export const EVENT_ORDER = [
  "333", "222", "444", "555", "666", "777",
  "333bf", "333fm", "333oh", "clock", "minx",
  "pyram", "skewb", "sq1", "444bf", "555bf", "333mbf",
];

export function eventName(id: string): string {
  return EVENT_NAMES[id] ?? id;
}

export function typeLabel(eventId: string, type: "single" | "average"): string {
  if (type === "single") return "Single";
  return MEAN_EVENTS.has(eventId) ? "Mean" : "Avg";
}

export function sortedByEvent<T extends { event_id: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (EVENT_ORDER.indexOf(a.event_id) === -1 ? 99 : EVENT_ORDER.indexOf(a.event_id)) -
      (EVENT_ORDER.indexOf(b.event_id) === -1 ? 99 : EVENT_ORDER.indexOf(b.event_id))
  );
}
