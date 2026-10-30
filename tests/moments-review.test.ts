import { describe, expect, it } from 'vitest';
import { planComplete, prevWeekKey, weekKey, weekLine, weekTask } from '../src/moments/review';
import { emptyState } from '../src/lib/state';

describe('Wochenrückblick (Runde 1, Punkt 7)', () => {
  const sun = new Date(2026, 9, 25, 10);
  it('Woche beginnt Montag, Vorwoche 7 Tage früher', () => {
    expect(weekKey(sun)).toBe('2026-10-19');
    expect(prevWeekKey(sun)).toBe('2026-10-12');
  });
  it('genau ein Plan, beide Teile nötig', () => {
    expect(planComplete('after OCT clinic', 'explain it')).toBe(true);
    expect(planComplete('after OCT clinic', '')).toBe(false);
    expect(planComplete(' a ', 'xyz')).toBe(false);
  });
  it('Zahlen nur zur Aufgabe', () => {
    const s = emptyState();
    s.dayCount = { '2026-10-25': { seen: 10, gotIt: 6 }, '2026-10-22': { seen: 4, gotIt: 3 }, '2026-10-10': { seen: 99, gotIt: 99 } };
    const m = { id: 'a' } as never;
    s.savedMoments = { a: { moment: m, savedAt: '2026-10-23T10:00:00Z', done: true }, b: { moment: m, savedAt: '2026-10-23T10:00:00Z' } };
    const t = weekTask(s, sun);
    expect(t).toEqual({ seen: 14, gotIt: 9, applied: 1 });
    expect(weekLine({ seen: 14, gotIt: 9, applied: 3 })).toBe('14 seen, 9 got it, 3 applied');
  });
});
