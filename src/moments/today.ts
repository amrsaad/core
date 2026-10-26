/**
 * Tageszahl statt Stopp (Bauliste Runde 1, Punkt 6, E1, R18, R22).
 * Nur zählen, nie begrenzen. "Got it" kommt aus dem Abruf (Punkt 5), bis dahin fehlt die Zahl.
 * Gleiche Regel für ios/Core.
 */
export interface DayCount {
  seen: number;
  gotIt: number;
}

export const DAY_KEEP = 60;

/** Neuer Moment heute zum ersten Mal gezeigt. Alte Tage über DAY_KEEP fallen weg. */
export function countSeen(days: Record<string, DayCount> | undefined, day: string): Record<string, DayCount> {
  const prev = days?.[day] ?? { seen: 0, gotIt: 0 };
  const next = { ...(days ?? {}), [day]: { ...prev, seen: prev.seen + 1 } };
  const keys = Object.keys(next).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAY_KEEP))) delete next[k];
  return next;
}

export function todayLine(c: DayCount | undefined, withGotIt: boolean): string {
  const seen = `today ${c?.seen ?? 0} seen`;
  return withGotIt ? `${seen}, ${c?.gotIt ?? 0} got it` : seen;
}
