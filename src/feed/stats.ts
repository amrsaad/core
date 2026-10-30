import { dayKey } from '../lib/clock';
import { isRetained } from '../lib/fsrs';
import type { AppState } from '../lib/state';

export function stats(state: AppState, now: Date) {
  const retained = Object.values(state.saved).filter(isRetained).length;
  const since = now.getTime() - 7 * 86_400_000;
  const recent = state.reviews.filter((r) => Date.parse(r.ts) >= since);
  const hitRate = recent.length ? Math.round((recent.filter((r) => r.hit).length / recent.length) * 100) : null;
  let streak = 0;
  const d = new Date(now);
  if (!state.rounds[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (state.rounds[dayKey(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return { retained, saved: Object.keys(state.saved).length, hitRate, reviews: recent.length, streak };
}
