import { describe, expect, it } from 'vitest';
import { takeawayCounts, takeawayLine } from '../src/moments/takeaways';
import type { RecallState } from '../src/moments/recall';

const NOW = 1_000_000;
const m = (kind: string) => ({ kind: kind as never });
const r = (id: string, due: number | null) => ({ id, due, results: [] });

describe('takeawayCounts', () => {
  it('zählt Takeaway-Momente im Pool', () => {
    expect(takeawayCounts([m('takeaway'), m('regel'), m('takeaway'), m('story')], {}, NOW).pool).toBe(2);
    expect(takeawayCounts([], undefined, NOW)).toEqual({ pool: 0, due: 0 });
  });
  it('zählt nur fällige Abrufkarten zu txt-takeaway-IDs (due höchstens jetzt, nie abgeschlossene)', () => {
    const rec: RecallState = {
      'txt-takeaway-001:0': r('txt-takeaway-001:0', NOW - 1),
      'txt-takeaway-002:0': r('txt-takeaway-002:0', NOW),
      'txt-takeaway-003:0': r('txt-takeaway-003:0', NOW + 1),
      'txt-takeaway-004:0': r('txt-takeaway-004:0', null),
      'txt-other-005:0': r('txt-other-005:0', NOW - 5),
      'abc123:10': r('abc123:10', NOW - 5),
    };
    expect(takeawayCounts([m('takeaway')], rec, NOW)).toEqual({ pool: 1, due: 2 });
  });
  it('Zeile im festen Wortlaut', () => {
    expect(takeawayLine({ pool: 2, due: 1 })).toBe('takeaways: 2 in pool, 1 recall due');
  });
});
