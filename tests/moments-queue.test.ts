import { describe, expect, it } from 'vitest';
import { cursorFor, parseSaved, releaseTail, restoreQueue } from '../src/moments/queue';
import { newMomentCursor, nextMomentBlock } from '../src/moments/mix';
import type { Moment } from '../src/moments/types';

const mk = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: 'pod-' + id, start: 0, end: 40, channel: 'c' + id, videoTitle: '', area: 'brain', topic: 't' + id, hook: '', kind: 'story', createdAt: '', ...o });
const pool = Array.from({ length: 60 }, (_, i) => mk(String(i), { area: (['brain', 'body', 'beat'] as const)[i % 3] }));
let seed = 3;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const prefs = { areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 }, weights: { area: {}, channel: {}, topic: {} }, seen: {}, mutedChannels: {} };

describe('Warteschlange: Ablage und Wiederherstellung', () => {
  it('liest nur gültige Ablagen', () => {
    expect(parseSaved('{"day":"2026-10-29","ids":["a","b"]}')).toEqual({ day: '2026-10-29', ids: ['a', 'b'] });
    expect(parseSaved('kaputt')).toBeNull();
    expect(parseSaved('{"day":1,"ids":[]}')).toBeNull();
    expect(parseSaved(null)).toBeNull();
  });
  it('stellt nur den heutigen Tag wieder her, in Reihenfolge, ohne Gesehenes und Stummes', () => {
    const saved = { day: 'd1', ids: ['5', '6', '7', '8', 'weg', '5', '9'] };
    const got = restoreQueue(saved, 'd1', pool, { seen: { '6': 1 }, mutedChannels: { c8: 'c8' } }, 30);
    expect(got.map((m) => m.id)).toEqual(['5', '7', '9']);
    expect(restoreQueue(saved, 'd2', pool, { seen: {}, mutedChannels: {} }, 30)).toEqual([]);
    expect(restoreQueue(saved, 'd1', pool, { seen: {}, mutedChannels: {} }, 2).map((m) => m.id)).toEqual(['5', '6']);
  });
  it('Cursor zur übernommenen Warteschlange: keine Doppelten beim Auffüllen', () => {
    const restored = pool.slice(0, 9);
    const c = cursorFor(restored, false);
    expect(c.counts).toEqual({ brain: 1, body: 1, beat: 1 });
    const b = nextMomentBlock(pool, prefs, c, rng)!;
    for (const m of b) expect(restored).not.toContain(m);
  });
});

describe('Warteschlange: Rest neu planen', () => {
  it('der freigegebene Rest steht wieder zur Wahl, der Anfang bleibt gesperrt', () => {
    const c = newMomentCursor(true);
    const q: Moment[] = [];
    for (let i = 0; i < 10; i++) q.push(...nextMomentBlock(pool, prefs, c, rng)!);
    const head = q.slice(0, 6);
    const tail = q.slice(6);
    releaseTail(c, tail);
    for (const m of tail) expect(c.used.has(m.id)).toBe(false);
    for (const m of head) expect(c.used.has(m.id)).toBe(true);
    const total = c.counts.brain + c.counts.body + c.counts.beat;
    expect(total).toBe(2);
    const again: Moment[] = [];
    while (again.length < tail.length) again.push(...nextMomentBlock(pool, prefs, c, rng)!);
    for (const m of again) expect(head).not.toContain(m);
  });
});

import { reorderByRank } from '../src/moments/queue';
import { netRank } from '../src/moments/preload';

describe('Warteschlange: umsortieren im schlechten Netz', () => {
  const mp3 = (id: string, area: 'brain' | 'body' | 'beat') => mk(id, { area, hls: `https://x/${id}.mp3`, form: 'audio' });
  const yt = (id: string, area: 'brain' | 'body' | 'beat') => mk(id, { area, videoId: 'abcdefghi' + id.padStart(2, '0'), form: 'video' });
  const txt = (id: string, area: 'brain' | 'body' | 'beat') => mk(id, { area, videoId: 'txt-' + id, form: 'text' });
  const tail = [yt('1', 'beat'), mp3('2', 'beat'), yt('3', 'beat'), mp3('4', 'brain'), yt('5', 'brain'), mp3('6', 'brain'), txt('7', 'body'), yt('8', 'body'), mp3('9', 'body')];
  const rank = netRank((id) => id === '9');

  it('die Folge der Bereiche bleibt, Blöcke bleiben Blöcke', () => {
    const out = reorderByRank(tail, rank);
    expect(out.map((m) => m.area)).toEqual(tail.map((m) => m.area));
    expect(out).toHaveLength(tail.length);
    expect(new Set(out.map((m) => m.id))).toEqual(new Set(tail.map((m) => m.id)));
  });
  it('Vorgeladenes und Text vor, sonstige Streams dann, YouTube zuletzt, stabil', () => {
    const out = reorderByRank(tail, rank);
    expect(out.slice(0, 3).map((m) => m.id)).toEqual(['2', '1', '3']);
    expect(out.slice(3, 6).map((m) => m.id)).toEqual(['4', '6', '5']);
    expect(out.slice(6).map((m) => m.id)).toEqual(['7', '9', '8']);
  });
  it('ohne Unterschied im Rang bleibt alles wie es war', () => {
    expect(reorderByRank(tail, () => 0).map((m) => m.id)).toEqual(tail.map((m) => m.id));
  });
});
