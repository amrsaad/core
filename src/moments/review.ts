import { dayKey } from '../lib/clock';
import type { AppState } from '../lib/state';

/** Montag der Woche als YYYY-MM-DD (lokal) */
export function weekKey(d: Date): string {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return dayKey(x);
}

export const isReviewDue = (s: AppState, now: Date) => now.getDay() === 0 && !s.weekReviewShown[weekKey(now)];

export function lastDays(now: Date, n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.add(dayKey(d));
  }
  return out;
}

export function weekStats(s: AppState, now: Date) {
  const days = lastDays(now, 7);
  const minutes = Math.round([...days].reduce((sum, d) => sum + (s.feedTime[d] ?? 0), 0) / 60000);
  const log = s.momentLog.filter((e) => days.has(e.day));
  const ended = log.length ? Math.round((log.filter((e) => e.ended).length / log.length) * 100) : null;
  const weak = log.length ? Math.round((log.filter((e) => e.feedback === 'schwach' || e.feedback === 'falsch').length / log.length) * 100) : null;
  const since = now.getTime() - 7 * 86_400_000;
  const saved = Object.values(s.savedMoments).filter((x) => Date.parse(x.savedAt) >= since).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  return { minutes, ended, weak, saved, count: log.length };
}

/**
 * Wochenrückblick Runde 1, Punkt 7 (R13, R14, R16). Freigabe Max 26.10.: Plan der Vorwoche mit "Did it happen?",
 * genau ein Plan "When ..., I will ...", Zahlen nur zur Aufgabe, "Skip this week" bleibt.
 * Gleiche Regeln für ios/Core.
 */
export interface WeekPlan {
  when: string;
  will: string;
  /** in der Folgewoche beantwortet */
  happened?: boolean;
}

export const prevWeekKey = (now: Date) => {
  const d = new Date(now);
  d.setDate(d.getDate() - 7);
  return weekKey(d);
};

/** Ein Plan zählt erst mit beiden Teilen, jeder mindestens 3 Zeichen */
export const planComplete = (when: string, will: string) => when.trim().length >= 3 && will.trim().length >= 3;

export function weekTask(s: AppState, now: Date) {
  const days = lastDays(now, 7);
  let seen = 0;
  let gotIt = 0;
  for (const d of days) {
    seen += s.dayCount?.[d]?.seen ?? 0;
    gotIt += s.dayCount?.[d]?.gotIt ?? 0;
  }
  const since = now.getTime() - 7 * 86_400_000;
  const applied = Object.values(s.savedMoments).filter((x) => x.done && Date.parse(x.savedAt) >= since).length;
  return { seen, gotIt, applied };
}

/** "14 seen, 9 got it, 3 applied", nur Zahlen zur Aufgabe, keine Wertung */
export const weekLine = (t: { seen: number; gotIt: number; applied: number }) => `${t.seen} seen, ${t.gotIt} got it, ${t.applied} applied`;
