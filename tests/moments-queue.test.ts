import { describe, expect, it } from 'vitest';
import { cursorFor, historyBefore, parseSaved, recentFromLog, releaseTail, remixTail, restoreQueue } from '../src/moments/queue';
import { HISTORY, newMomentCursor, nextMoment } from '../src/moments/mix';
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
    expect(c.counts).toEqual({ brain: 3, body: 3, beat: 3 });
    expect(c.used.size).toBe(9);
    const seq: Moment[] = [...restored];
    for (let i = 0; i < 20; i++) {
      const m = nextMoment(pool, prefs, c, historyBefore(seq, seq.length), rng)!;
      expect(seq).not.toContain(m);
      seq.push(m);
    }
  });
  it('Verlauf: die letzten 10 vor der Stelle, davor der Verlauf der letzten Sitzung', () => {
    const q = pool.slice(0, 30);
    expect(historyBefore(q, 30).map((m) => m.id)).toEqual(q.slice(20).map((m) => m.id));
    expect(historyBefore(q, 3, pool.slice(40, 48)).map((m) => m.id)).toEqual([...pool.slice(41, 48), ...q.slice(0, 3)].map((m) => m.id));
    expect(historyBefore(q, 0)).toEqual([]);
    expect(HISTORY).toBe(10);
  });
  it('Verlauf aus dem Protokoll: die zuletzt gespielten, im Pool vorhanden, ohne Doppelte, ältester zuerst', () => {
    const log = [{ id: '1' }, { id: 'weg' }, { id: '2' }, { id: '1' }, { id: '3' }];
    expect(recentFromLog(log, pool).map((m) => m.id)).toEqual(['2', '1', '3']);
    expect(recentFromLog(log, pool, 2).map((m) => m.id)).toEqual(['1', '3']);
  });
});

describe('Warteschlange: Rest neu planen', () => {
  it('der freigegebene Rest steht wieder zur Wahl, der Anfang bleibt gesperrt', () => {
    const c = newMomentCursor(true);
    const q: Moment[] = [];
    for (let i = 0; i < 30; i++) q.push(nextMoment(pool, prefs, c, historyBefore(q, q.length), rng)!);
    const head = q.slice(0, 18);
    const tail = q.slice(18);
    const before = c.counts.brain + c.counts.body + c.counts.beat;
    releaseTail(c, tail, Date.now());
    for (const m of tail) expect(c.used.has(m.id)).toBe(false);
    for (const m of head) expect(c.used.has(m.id)).toBe(true);
    expect(before).toBe(30);
    expect(c.counts.brain + c.counts.body + c.counts.beat).toBe(18);
    const again: Moment[] = [...head];
    for (let i = 0; i < 12; i++) again.push(nextMoment(pool, prefs, c, historyBefore(again, again.length), rng)!);
    expect(new Set(again.map((m) => m.id)).size).toBe(30);
  });
});

import { netRank } from '../src/moments/preload';

describe('Warteschlange: umsortieren im schlechten Netz', () => {
  const mp3 = (id: string, area: 'brain' | 'body' | 'beat') => mk(id, { area, hls: `https://x/${id}.mp3`, form: 'audio' });
  const yt = (id: string, area: 'brain' | 'body' | 'beat') => mk(id, { area, videoId: 'abcdefghi' + id.padStart(2, '0'), form: 'video' });
  const txt = (id: string, area: 'brain' | 'body' | 'beat') => mk(id, { area, videoId: 'txt-' + id, form: 'text' });
  const tail = [yt('1', 'beat'), mp3('2', 'beat'), yt('3', 'beat'), mp3('4', 'brain'), yt('5', 'brain'), mp3('6', 'brain'), txt('7', 'body'), yt('8', 'body'), mp3('9', 'body'), yt('10', 'brain'), mp3('11', 'beat'), txt('12', 'body')];
  const rank = netRank((id) => id === '9');
  const p = { ...prefs, rank };

  it('derselbe Inhalt, nichts geht verloren, nichts kommt dazu', () => {
    const out = remixTail(tail, [], p, rng);
    expect(out).toHaveLength(tail.length);
    expect(new Set(out.map((m) => m.id))).toEqual(new Set(tail.map((m) => m.id)));
  });
  it('die Mischregeln gelten auch im neu geordneten Rest und gegen den Verlauf davor', () => {
    const hist = [mk('h1', { area: 'brain', videoId: 'pod-4', channel: 'cx' })];
    const out = remixTail(tail, hist, p, rng);
    // pod-4 steht im Verlauf: die Folge des Verlaufs darf nicht in den ersten 10 des Rests stehen, sonst nur wenn nichts anderes bleibt
    const early = out.slice(0, 5);
    expect(early.some((m) => m.videoId === 'pod-4')).toBe(false);
  });
  it('Vorgeladene und Text rücken nach vorn, ohne die Regeln zu brechen', () => {
    let first = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      const out = remixTail(tail, [], p, () => Math.random());
      if (['9', '7', '12'].includes(out[0].id) || ['9', '7', '12'].includes(out[1].id)) first++;
    }
    // YouTube hat Rang 2, Vorgeladene und Text Rang 0 (Gewicht mal 3): sie stehen vorn deutlich öfter als bei gleichem Rang
    expect(first).toBeGreaterThan(n * 0.4);
  });
  it('ohne Unterschied im Rang bleibt die Menge gleich', () => {
    const out = remixTail(tail, [], { ...prefs, rank: () => 0 }, rng);
    expect(new Set(out.map((m) => m.id))).toEqual(new Set(tail.map((m) => m.id)));
  });
});
