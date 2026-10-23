import { describe, expect, it } from 'vitest';
import { blocksPerArea, composeRound } from '../src/feed/round';
import { newSaved } from '../src/lib/fsrs';
import { adjustWeight, emptyState } from '../src/lib/state';
import type { Area, Card } from '../src/types';

const now = new Date('2026-10-23T08:00:00Z');
let n = 0;
function mk(area: Area, topic: string, count: number): Card[] {
  return Array.from({ length: count }, () => {
    n++;
    return { id: `c${n}`, area, topic, type: 'fact', headline: `Karte ${n}`, source: { id: `c${n}`, title: 't', publisher: 'p', url: 'https://x', excerpt: 'e' }, createdAt: '2026-10-01T00:00:00Z' } as Card;
  });
}
const cards = [...mk('brain', 'glaukom', 6), ...mk('brain', 'retina', 6), ...mk('brain', 'ki-medizin', 6), ...mk('brain', 'varia', 6), ...mk('body', 'kraft', 6), ...mk('body', 'schlaf', 6), ...mk('beat', 'koran', 6)];

describe('Runde', () => {
  it('Default-Anteile ergeben 2 Brain, 1 Body, 1 Beat', () => {
    expect(blocksPerArea({ brain: 0.55, body: 0.25, beat: 0.2 })).toEqual({ brain: 2, body: 1, beat: 1 });
  });

  it('12 Karten in Blöcken à 3, Beat zuerst in der ersten Runde', () => {
    const items = composeRound({ cards, state: emptyState(), now, roundToday: 0 });
    expect(items).toHaveLength(12);
    const cs = items.map((i) => (i.kind === 'card' ? i.card : null)!);
    expect(cs.slice(0, 3).every((c) => c.area === 'beat')).toBe(true);
    for (let b = 0; b < 4; b++) expect(new Set(cs.slice(b * 3, b * 3 + 3).map((c) => c.topic)).size).toBe(1);
    expect(cs.filter((c) => c.area === 'brain')).toHaveLength(6);
  });

  it('Gesehene Karten kommen nicht wieder', () => {
    const s = emptyState();
    const first = composeRound({ cards, state: s, now, roundToday: 0 });
    for (const i of first) if (i.kind === 'card') s.seen[i.card.id] = 1;
    const second = composeRound({ cards, state: s, now, roundToday: 1 });
    const ids = new Set(first.map((i) => (i.kind === 'card' ? i.card.id : '')));
    expect(second.some((i) => i.kind === 'card' && ids.has(i.card.id))).toBe(false);
  });

  it('Fällige gespeicherte Karte erscheint an Position 4 als Abruf (manipuliertes Datum)', () => {
    const s = emptyState();
    s.saved[cards[0].id] = newSaved(cards[0], now);
    expect(composeRound({ cards, state: s, now, roundToday: 1 }).some((i) => i.kind === 'recall')).toBe(false);
    const later = new Date(now.getTime() + 30 * 86_400_000);
    const items = composeRound({ cards, state: s, now: later, roundToday: 1 });
    expect(items[3].kind).toBe('recall');
    expect(items).toHaveLength(12);
  });

  it('Topic-Gewichte bleiben zwischen 0.3 und 3.0', () => {
    let s = emptyState();
    for (let i = 0; i < 30; i++) s = adjustWeight(s, 'glaukom', 1.25);
    expect(s.topicWeights.glaukom).toBe(3);
    for (let i = 0; i < 60; i++) s = adjustWeight(s, 'glaukom', 0.8);
    expect(s.topicWeights.glaukom).toBe(0.3);
  });
});
