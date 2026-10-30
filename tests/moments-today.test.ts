import { describe, expect, it } from 'vitest';
import { countSeen, DAY_KEEP, todayLine } from '../src/moments/today';

describe('Tageszahl (Runde 1, Punkt 6)', () => {
  it('zählt pro Tag hoch, ohne Limit', () => {
    let d = countSeen(undefined, '2026-10-26');
    for (let i = 0; i < 199; i++) d = countSeen(d, '2026-10-26');
    expect(d['2026-10-26']).toEqual({ seen: 200, gotIt: 0 });
    d = countSeen(d, '2026-10-27');
    expect(d['2026-10-27'].seen).toBe(1);
  });
  it('hält nur die letzten Tage', () => {
    let d = {};
    for (let i = 0; i < DAY_KEEP + 5; i++) d = countSeen(d, `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
    expect(Object.keys(d)).toHaveLength(DAY_KEEP);
  });
  it('Zeile wie in der Bauliste', () => {
    expect(todayLine({ seen: 14, gotIt: 3 }, true)).toBe('today 14 seen, 3 got it');
    expect(todayLine(undefined, false)).toBe('today 0 seen');
  });
});
