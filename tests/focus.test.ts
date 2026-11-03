import { describe, expect, it } from 'vitest';
import { clearFocus, endSessionFocus, FOCUS_KEY, focusActive, focusFilter, focusLabel, focusUntil, inFocus, langOf, parseFocus, readFocus, writeFocus, type Focus } from '../src/moments/focus';
import { effectiveShares, learnedWeight, newMomentCursor, nextMoment } from '../src/moments/mix';
import type { Moment } from '../src/moments/types';

const NOW = new Date('2026-11-03T10:00:00').getTime();
const mk = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: 'v' + id, start: 0, end: 40, channel: 'c' + id, videoTitle: '', area: 'brain', topic: 't' + id, hook: 'plain', kind: 'regel', createdAt: '', ...o });
const AR = [[0, 'وما من قلب إلا وهو بين إصبعين من أصابع الرحمن']] as [number, string][];
const DE_CUES = [[0, 'Das ist nicht der Fall, und wir sehen es mit dem Auge.'], [3, 'Die Netzhaut ist ein Teil von dem Auge für das Sehen.']] as [number, string][];
const EN_CUES = [[0, 'This is the part of the eye that you need for the test.'], [3, 'It is what they said about the retina and the lens.']] as [number, string][];

const pool: Moment[] = [
  mk('b-ar', { area: 'beat', cues: AR }),
  mk('b-en', { area: 'beat', cues: EN_CUES }),
  mk('k-de', { area: 'body', cues: DE_CUES }),
  mk('r-ar', { area: 'brain', lang: 'ar' }),
  mk('r-de', { area: 'brain', cues: DE_CUES }),
  mk('r-en', { area: 'brain', cues: EN_CUES }),
];

/** Kleiner Speicher mit der Schnittstelle von Storage */
function memory(): Storage {
  const d = new Map<string, string>();
  return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => void d.set(k, String(v)), removeItem: (k) => void d.delete(k), clear: () => d.clear(), key: (i) => [...d.keys()][i] ?? null, get length() { return d.size; } } as Storage;
}

describe('Sprache des Moments', () => {
  it('lang gilt, sonst arabische Schrift, sonst Funktionswörter, bei Gleichstand Englisch', () => {
    expect(langOf(pool[3])).toBe('ar');
    expect(langOf(pool[0])).toBe('ar');
    expect(langOf(pool[2])).toBe('de');
    expect(langOf(pool[1])).toBe('en');
    expect(langOf(mk('leer'))).toBe('en');
    expect(langOf(mk('x', { lang: 'de', cues: EN_CUES }))).toBe('de');
  });
});

describe('Fokus: Filter', () => {
  const f = (o: Partial<Focus> = {}): Focus => ({ areas: [], langs: [], until: NOW + 1000, ...o });
  it('Beat und Arabisch liefert nur solche Momente', () => {
    const r = focusFilter(pool, f({ areas: ['beat'], langs: ['ar'] }), NOW);
    expect(r.map((m) => m.id)).toEqual(['b-ar']);
  });
  it('nur Säulen, nur Sprachen, Mehrfachauswahl', () => {
    expect(focusFilter(pool, f({ areas: ['beat', 'body'] }), NOW).map((m) => m.id)).toEqual(['b-ar', 'b-en', 'k-de']);
    expect(focusFilter(pool, f({ langs: ['de'] }), NOW).map((m) => m.id)).toEqual(['k-de', 'r-de']);
    expect(focusFilter(pool, f({ langs: ['ar', 'de'] }), NOW).map((m) => m.id)).toEqual(['b-ar', 'k-de', 'r-ar', 'r-de']);
  });
  it('ohne Fokus, leer oder abgelaufen: derselbe Pool', () => {
    expect(focusFilter(pool, null, NOW)).toBe(pool);
    expect(focusFilter(pool, f(), NOW)).toBe(pool);
    expect(focusFilter(pool, f({ areas: ['beat'], until: NOW }), NOW)).toBe(pool);
    expect(focusFilter(pool, f({ areas: ['beat'], until: 'session' }), NOW)).toHaveLength(2);
  });
  it('inFocus entscheidet je Moment', () => {
    expect(inFocus(pool[0], f({ areas: ['beat'] }))).toBe(true);
    expect(inFocus(pool[2], f({ areas: ['beat'] }))).toBe(false);
  });
  it('die Mischung mit Fokus liefert nur Momente im Fokus, Gewichte und Anteile bleiben unverändert', () => {
    const big: Moment[] = [];
    for (let e = 0; e < 40; e++) for (let i = 0; i < 5; i++) big.push(mk(`e${e}:${i}`, { videoId: 'ep' + e, channel: 'ch' + (e % 8), topic: 't' + (e % 6), area: (['beat', 'body', 'brain'] as const)[e % 3], lang: e % 2 === 0 ? 'ar' : 'en' }));
    const focus = f({ areas: ['beat'], langs: ['ar'] });
    const weights = { area: { beat: 1.5 }, channel: { ch1: 0.5 }, topic: {} };
    const before = JSON.stringify(weights);
    const p = { areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 }, weights, seen: {}, mutedChannels: {}, now: NOW };
    const fp = focusFilter(big, focus, NOW);
    expect(fp.length).toBeGreaterThan(0);
    const c = newMomentCursor(false);
    const seq: Moment[] = [];
    for (let i = 0; i < 30; i++) {
      const m = nextMoment(fp, p, c, seq.slice(-10));
      if (!m) break;
      seq.push(m);
    }
    expect(seq.length).toBeGreaterThan(5);
    for (const m of seq) expect(inFocus(m, focus)).toBe(true);
    // nichts am Lernen verändert
    expect(JSON.stringify(weights)).toBe(before);
    expect(learnedWeight(weights, big.find((m) => m.channel === 'ch1')!)).toBe(0.5);
    expect(effectiveShares(p).brain).toBeCloseTo(effectiveShares({ ...p, weights: { ...weights } }).brain, 9);
  });
});

describe('Fokus: Dauer und Ablauf', () => {
  it('focusUntil: Sitzung, 1 Stunde, bis Mitternacht', () => {
    expect(focusUntil('session', NOW)).toBe('session');
    expect(focusUntil('hour', NOW)).toBe(NOW + 3_600_000);
    const midnight = focusUntil('today', NOW) as number;
    expect(new Date(midnight).getHours()).toBe(0);
    expect(new Date(midnight).getDate()).toBe(4);
    expect(midnight).toBeGreaterThan(NOW);
  });
  it('focusActive: Ablauf und leere Auswahl', () => {
    expect(focusActive({ areas: ['beat'], langs: [], until: NOW + 1 }, NOW)).toBe(true);
    expect(focusActive({ areas: ['beat'], langs: [], until: NOW }, NOW)).toBe(false);
    expect(focusActive({ areas: [], langs: [], until: 'session' }, NOW)).toBe(false);
    expect(focusActive({ areas: [], langs: ['ar'], until: 'session' }, NOW + 1e12)).toBe(true);
    expect(focusActive(null, NOW)).toBe(false);
  });
  it('readFocus löscht Abgelaufenes von selbst, der Fokus läuft aus', () => {
    const s = memory();
    writeFocus({ areas: ['beat'], langs: ['ar'], until: NOW + 3_600_000, dur: 'hour' }, s);
    expect(readFocus(NOW + 1000, s)?.areas).toEqual(['beat']);
    expect(readFocus(NOW + 3_600_000, s)).toBeNull();
    expect(s.getItem(FOCUS_KEY)).toBeNull();
  });
  it('This session endet mit pagehide, andere Fokusse nicht', () => {
    const s = memory();
    writeFocus({ areas: ['beat'], langs: [], until: 'session', dur: 'session' }, s);
    expect(endSessionFocus(s)).toBe(true);
    expect(readFocus(NOW, s)).toBeNull();
    writeFocus({ areas: ['beat'], langs: [], until: NOW + 99_999, dur: 'today' }, s);
    expect(endSessionFocus(s)).toBe(false);
    expect(readFocus(NOW, s)).not.toBeNull();
  });
  it('Auswahl ohne Säule und Sprache löscht, clearFocus ebenso', () => {
    const s = memory();
    writeFocus({ areas: ['beat'], langs: [], until: 'session' }, s);
    writeFocus({ areas: [], langs: [], until: 'session' }, s);
    expect(readFocus(NOW, s)).toBeNull();
    writeFocus({ areas: ['body'], langs: [], until: 'session' }, s);
    clearFocus(s);
    expect(readFocus(NOW, s)).toBeNull();
  });
  it('parseFocus verwirft Ungültiges und bereinigt Listen', () => {
    expect(parseFocus(null)).toBeNull();
    expect(parseFocus('kaputt')).toBeNull();
    expect(parseFocus('{"areas":["beat"],"langs":[]}')).toBeNull();
    expect(parseFocus('{"areas":["beat","x","beat"],"langs":["ar","fr"],"until":"session"}')).toEqual({ areas: ['beat'], langs: ['ar'], until: 'session' });
    expect(parseFocus(JSON.stringify({ areas: ['beat'], langs: [], until: 5, dur: 'hour' }))).toEqual({ areas: ['beat'], langs: [], until: 5, dur: 'hour' });
  });
});

describe('Fokus: Pille', () => {
  it('Beat · Arabic · today, Reihenfolge Beat, Body, Brain dann Sprachen', () => {
    expect(focusLabel({ areas: ['beat'], langs: ['ar'], until: NOW + 5, dur: 'today' })).toBe('Beat · Arabic · today');
    expect(focusLabel({ areas: ['brain', 'beat'], langs: ['en', 'de'], until: 'session', dur: 'session' })).toBe('Beat · Brain · German · English · session');
    expect(focusLabel({ areas: [], langs: ['ar'], until: NOW + 5, dur: 'hour' })).toBe('Arabic · 1 hour');
  });
});
