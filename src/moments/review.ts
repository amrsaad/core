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
