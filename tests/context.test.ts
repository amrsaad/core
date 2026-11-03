import { describe, expect, it } from 'vitest';
import { ATTENTION_MOMENTS, attentionOn, attentionStep, isCellular, isHeavy, makeCtx, netWeightOf, newAttention, PRIOR, TIME_MAX, TIME_MIN, timeWeights, windowCells } from '../src/moments/context';
import { HISTORY, newMomentCursor, nextMoment, type MomentPrefs } from '../src/moments/mix';
import { recallQuiet } from '../src/moments/recall';
import type { Signals } from '../src/moments/signals';
import type { Moment } from '../src/moments/types';
import type { Area } from '../src/types';

function makeRng(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AREAS: Area[] = ['brain', 'body', 'beat'];
const NOW = Date.parse('2026-11-03T05:00:00Z');
const TODAY = '2026-11-03'; // Dienstag
const cell = (seen: number, done: number, saves = 0, skips = 0) => ({ seen, done, saves, skips });
const mk = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: 'v' + id, start: 0, end: 60, channel: 'c' + id, videoTitle: '', area: 'brain', topic: 't' + id, hook: '', kind: 'regel', createdAt: '2026-10-01T00:00:00Z', ...o });

describe('Tageszeit (a)', () => {
  const sig = (days: Signals['days']): Signals => ({ days });
  it('ohne Signale ist jedes Gewicht 1', () => {
    expect(timeWeights(undefined, TODAY, 7).size).toBe(0);
    expect(timeWeights(sig({}), TODAY, 7).size).toBe(0);
  });
  it('nur das Zeitfenster (± 1 Stunde, rund um Mitternacht), die letzten 28 Tage, gleiche Tagesart', () => {
    const s = sig({
      '2026-11-02': { byHour: { '06': { brain: { video: cell(4, 4) } }, '09': { brain: { video: cell(9, 9) } }, '07': { body: { video: cell(2, 0) } } } }, // Montag, Werktag
      '2026-11-01': { byHour: { '07': { brain: { video: cell(50, 50) } } } }, // Sonntag, anderer Typ
      '2026-09-01': { byHour: { '07': { brain: { video: cell(50, 50) } } } }, // zu alt
    });
    const c = windowCells(s, TODAY, 7);
    expect([...c.keys()].sort()).toEqual(['body:video', 'brain:video']);
    expect(c.get('brain:video')).toEqual(cell(4, 4));
    const mid = windowCells(sig({ '2026-11-02': { byHour: { '23': { beat: { audio: cell(3, 3) } }, '01': { beat: { audio: cell(2, 1) } } } } }), TODAY, 0);
    expect(mid.get('beat:audio')).toEqual(cell(5, 4));
  });
  it('Gewicht folgt dem Verhältnis Fertighören zu Gesehen, geglättet, und bleibt in den Grenzen', () => {
    const s = sig({ '2026-11-02': { byHour: { '07': { brain: { video: cell(40, 40) }, body: { video: cell(40, 0, 0, 40) } } } } });
    const w = timeWeights(s, TODAY, 7);
    expect(w.get('brain:video')!).toBeGreaterThan(1);
    expect(w.get('body:video')!).toBeLessThan(1);
    for (const v of w.values()) {
      expect(v).toBeGreaterThanOrEqual(TIME_MIN);
      expect(v).toBeLessThanOrEqual(TIME_MAX);
    }
    // eine einzelne Beobachtung bewegt kaum etwas (Glättung)
    const one = timeWeights(sig({ '2026-11-02': { byHour: { '07': { brain: { video: cell(1, 1) }, body: { video: cell(1, 0) } } } } }), TODAY, 7);
    expect(Math.abs(one.get('brain:video')! - 1)).toBeLessThan(0.2);
    expect(PRIOR).toBeGreaterThan(1);
  });
});

describe('Aufmerksamkeit (b)', () => {
  it('der dritte Skip in Folge schaltet 10 Momente lang ein, ein längerer Blick setzt zurück', () => {
    let a = newAttention();
    for (const sk of [true, true]) a = attentionStep(a, sk, 3).att;
    expect(a.run).toBe(2);
    a = attentionStep(a, false, 5).att;
    expect(a.run).toBe(0);
    for (const sk of [true, true]) a = attentionStep(a, sk, 6).att;
    const r = attentionStep(a, true, 8);
    expect(r.started).toBe(true);
    expect(r.att).toEqual({ run: 0, until: 8 + 1 + ATTENTION_MOMENTS });
    expect(attentionOn(r.att, 9)).toBe(true);
    expect(attentionOn(r.att, 18)).toBe(true);
    expect(attentionOn(r.att, 19)).toBe(false);
    expect(attentionStep(newAttention(), false, 0).att).toEqual(newAttention());
  });
  it('schwer: über 90 s oder Text in Brain', () => {
    expect(isHeavy(mk('1', { end: 91 }))).toBe(true);
    expect(isHeavy(mk('2', { end: 90 }))).toBe(false);
    expect(isHeavy(mk('3', { form: 'text', area: 'brain' }))).toBe(true);
    expect(isHeavy(mk('4', { form: 'text', area: 'body' }))).toBe(false);
  });
  it('Tempo 2x: keine Abrufkarte in den ersten 5 Minuten', () => {
    expect(recallQuiet(2, 4 * 60_000)).toBe(true);
    expect(recallQuiet(2, 5 * 60_000)).toBe(false);
    expect(recallQuiet(1.5, 60_000)).toBe(false);
    expect(recallQuiet(1, 0)).toBe(false);
  });
});

describe('Netzart (c)', () => {
  it('Mobilfunk erkennen, sonst neutral', () => {
    expect(isCellular({ type: 'cellular' })).toBe(true);
    expect(isCellular({ type: 'wifi', effectiveType: '3g' })).toBe(false);
    expect(isCellular({ effectiveType: '3g' })).toBe(true);
    expect(isCellular({ effectiveType: '4g' })).toBe(false);
    expect(isCellular(undefined)).toBe(false);
  });
  it('Mobilfunk: 1.5 auf Audio und Momente unter 90 s, 0.7 auf Video', () => {
    expect(netWeightOf(true, mk('1', { audio: true, end: 200 }))).toBe(1.5);
    expect(netWeightOf(true, mk('2', { end: 60 }))).toBe(1.5);
    expect(netWeightOf(true, mk('3', { end: 120 }))).toBe(0.7);
    expect(netWeightOf(true, mk('4', { form: 'text', end: 120 }))).toBe(1);
    expect(netWeightOf(false, mk('5', { end: 120 }))).toBe(1);
  });
});

describe('Gewichte verändern Anteile, nie die harten Regeln', () => {
  // 40 Folgen mit je 15 Momenten, kurz (60 s) und lang (120 s) gemischt, über alle drei Bereiche, 12 Kanäle
  const pool: Moment[] = [];
  for (let e = 0; e < 40; e++)
    for (let i = 0; i < 15; i++) {
      const ch = e % 12;
      pool.push(mk(`e${e}:${i}`, { videoId: `ep${e}`, channel: `ch${ch}`, area: AREAS[ch % 3], topic: `t${ch % 6}`, start: 0, end: i % 2 ? 120 : 60 }));
    }
  const prefs = (ctx?: (m: Moment) => number): MomentPrefs => ({ areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 }, weights: { area: {}, channel: {}, topic: {} }, seen: {}, mutedChannels: {}, now: NOW, ...(ctx ? { ctx } : {}) });
  const run = (p: MomentPrefs, n: number, seed: number) => {
    const c = newMomentCursor(false);
    const rng = makeRng(seed);
    const seq: Moment[] = [];
    for (let i = 0; i < n; i++) {
      const m = nextMoment(pool, p, c, seq, rng);
      if (!m) break;
      seq.push(m);
    }
    return { seq, c };
  };
  const longShare = (seq: Moment[]) => seq.filter((m) => m.end - m.start > 90).length / seq.length;

  it('Mobilfunk: mehr kurze Momente, harte Regeln unverändert', () => {
    const neutral = run(prefs(), 400, 3);
    const cell_ = run(prefs(makeCtx({ signals: undefined, today: TODAY, hour: 7, attention: newAttention(), position: () => 0, conn: { type: 'cellular' } })), 400, 3);
    expect(longShare(neutral.seq)).toBeGreaterThan(0.35);
    expect(longShare(cell_.seq)).toBeLessThan(longShare(neutral.seq) - 0.1);
    for (const r of [neutral, cell_]) {
      expect(r.c.relaxed).toEqual({ topic: 0, channel: 0, newcap: 0 });
      r.seq.forEach((m, i) => {
        expect(r.seq.slice(Math.max(0, i - HISTORY), i).some((x) => x.videoId === m.videoId)).toBe(false);
        expect(r.seq.slice(Math.max(0, i - 3), i).some((x) => x.channel === m.channel)).toBe(false);
        if (i) expect(r.seq[i - 1].area).not.toBe(m.area);
      });
    }
  });
  it('Aufmerksamkeit: in den nächsten 10 Positionen weniger schwere Momente, danach wieder normal', () => {
    let pos = 0;
    const att = { run: 0, until: 10 };
    const ctx = makeCtx({ signals: undefined, today: TODAY, hour: 7, attention: att, position: () => pos, conn: undefined });
    const seq: Moment[] = [];
    const heavyAt: number[] = [];
    for (let k = 0; k < 6; k++) {
      // viele Läufe: Anteil schwerer Momente an den Positionen 0 bis 9 gegen 10 bis 19
      seq.length = 0;
      const cc = newMomentCursor(false);
      for (pos = 0; pos < 20; pos++) {
        const m = nextMoment(pool, { areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 }, weights: { area: {}, channel: {}, topic: {} }, seen: {}, mutedChannels: {}, now: NOW, ctx }, cc, seq, makeRng(100 + k * 31 + pos));
        seq.push(m!);
      }
      heavyAt.push(seq.slice(0, 10).filter(isHeavy).length - seq.slice(10).filter(isHeavy).length);
    }
    expect(heavyAt.reduce((a, b) => a + b, 0)).toBeLessThan(0);
  });
  it('Tageszeit: ein starker Bereich bekommt mehr Anteil, die Bereichsregel hält', () => {
    const sig: Signals = { days: { '2026-11-02': { byHour: { '07': { brain: { video: cell(60, 60) }, body: { video: cell(60, 0, 0, 60) }, beat: { video: cell(60, 30) } } } } } };
    const w = timeWeights(sig, TODAY, 7);
    expect(w.get('brain:video')!).toBeGreaterThan(w.get('body:video')!);
    const r = run(prefs(makeCtx({ signals: sig, today: TODAY, hour: 7, attention: newAttention(), position: () => 0 })), 300, 5);
    r.seq.forEach((m, i) => {
      if (i) expect(r.seq[i - 1].area).not.toBe(m.area);
    });
    expect(r.c.relaxed).toEqual({ topic: 0, channel: 0, newcap: 0 });
  });
});
