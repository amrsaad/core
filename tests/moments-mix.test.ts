import { describe, expect, it } from 'vitest';
import { applySignal, applyTopic, effectiveShares, newMomentCursor, nextMomentBlock, SIGNAL, type MomentPrefs } from '../src/moments/mix';
import { leaveSignal } from '../src/moments/mix';
import type { Moment } from '../src/moments/types';
import type { Area } from '../src/types';

let n = 0;
function mk(area: Area, topic: string, channels: number, per: number, top = 0): Moment[] {
  const out: Moment[] = [];
  for (let c = 0; c < channels; c++)
    for (let i = 0; i < per; i++) {
      n++;
      out.push({ id: `v${n}:0`, videoId: `v${n}`, start: 0, end: 90, channel: `${area}-${c}`, videoTitle: 't', area, topic, hook: `Moment ${n}`, kind: 'regel', top: i < top, createdAt: '2026-10-20T00:00:00Z' });
    }
  return out;
}
const pool = [...mk('brain', 'augen', 5, 40, 2), ...mk('brain', 'ki', 5, 40), ...mk('body', 'kraft', 5, 40, 2), ...mk('beat', 'islam', 5, 40, 2)];
const prefs = (o: Partial<MomentPrefs> = {}): MomentPrefs => ({ areaShares: { brain: 0.55, body: 0.25, beat: 0.2 }, weights: { area: {}, channel: {}, topic: {} }, seen: {}, mutedChannels: {}, ...o });
let seed = 1;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function run(p: MomentPrefs, blocks: number, first = true) {
  const c = newMomentCursor(first);
  const out: Moment[][] = [];
  for (let i = 0; i < blocks; i++) {
    const b = nextMomentBlock(pool, p, c, rng);
    if (!b) break;
    out.push(b);
  }
  return out;
}

describe('Momente-Mix', () => {
  const blocks = run(prefs(), 100);
  const flat = blocks.flat();
  it('Blöcke à 3 Momente gleichen Bereichs', () => {
    for (const b of blocks) {
      expect(b).toHaveLength(3);
      expect(new Set(b.map((m) => m.area)).size).toBe(1);
    }
  });
  it('erster Block des Tages ist Beat', () => {
    expect(blocks[0][0].area).toBe('beat');
    expect(run(prefs(), 1, false)[0][0].area).toBe('brain');
  });
  it('Anteile folgen den Einstellungen (±5 %)', () => {
    const share = (a: Area) => flat.filter((m) => m.area === a).length / flat.length;
    expect(Math.abs(share('brain') - 0.55)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(share('body') - 0.25)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(share('beat') - 0.2)).toBeLessThanOrEqual(0.05);
  });
  it('kein Moment doppelt, gesehene nie', () => {
    expect(new Set(flat.map((m) => m.id)).size).toBe(flat.length);
    const seen = Object.fromEntries(flat.slice(0, 120).map((m) => [m.id, 1]));
    expect(run(prefs({ seen }), 100).flat().some((m) => seen[m.id])).toBe(false);
  });
  it('stummgeschalteter Kanal erscheint nie', () => {
    const muted = { 'beat-0': 'beat-0', 'brain-2': 'brain-2' };
    expect(run(prefs({ mutedChannels: muted }), 150).flat().some((m) => m.channel in muted)).toBe(false);
  });
  it('höchstens 1 Top-Moment von 15', () => {
    const idx = flat.map((m, i) => (m.top ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < idx.length; k++) expect(idx[k] - idx[k - 1]).toBeGreaterThanOrEqual(15);
  });
  it('Not for me senkt nur das Gewicht des Themas, mit dem Faktor von Weak', () => {
    const w0 = prefs().weights;
    const m = { area: 'brain' as Area, channel: 'brain-0', topic: 'augen' };
    const w1 = applyTopic(w0, m, SIGNAL.negative);
    expect(w1.topic.augen).toBeCloseTo(0.7, 6);
    expect(w1.channel).toEqual({});
    expect(w1.area).toEqual({});
    // zweimal: 0,49, nie unter die Untergrenze
    expect(applyTopic(w1, m, SIGNAL.negative).topic.augen).toBeCloseTo(0.49, 6);
    let w = w0;
    for (let i = 0; i < 40; i++) w = applyTopic(w, m, SIGNAL.negative);
    expect(w.topic.augen).toBe(0.2);
    // andere Themen bleiben
    expect(w.topic.ki).toBeUndefined();
    // gleicher Faktor wie bei Weak (applySignal), aber ohne Kanal und Bereich
    expect(applySignal(w0, m, SIGNAL.negative).topic.augen).toBeCloseTo(w1.topic.augen, 6);
  });
  it('gelernte Bereichsgewichte, jeder Bereich mindestens 10 %', () => {
    let w = prefs().weights;
    for (let i = 0; i < 40; i++) w = applySignal(w, { area: 'beat', channel: 'beat-0', topic: 'islam' }, SIGNAL.negative);
    const s = effectiveShares(prefs({ weights: w }));
    expect(s.beat).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(s.brain + s.body + s.beat).toBeCloseTo(1, 6);
    const flat2 = run(prefs({ weights: w }), 100, false).flat();
    expect(flat2.filter((m) => m.area === 'beat').length / flat2.length).toBeGreaterThanOrEqual(0.08);
  });
  it('20 % Neues: unbekannte Kanäle kommen auch bei starken Favoriten vor', () => {
    let w = prefs().weights;
    for (let i = 0; i < 10; i++) w = applySignal(w, { area: 'brain', channel: 'brain-0', topic: 'augen' }, SIGNAL.more);
    const brain = run(prefs({ weights: w }), 120, false).flat().filter((m) => m.area === 'brain');
    const fromFav = brain.filter((m) => m.channel === 'brain-0' || m.topic === 'augen').length / brain.length;
    expect(fromFav).toBeGreaterThan(0.5);
    expect(fromFav).toBeLessThan(0.95);
  });
});

describe('leaveSignal', () => {
  it('bewertet nach geschautem Anteil', () => {
    expect(leaveSignal(3, 100)).toBe(SIGNAL.skip);
    expect(leaveSignal(20, 100)).toBe(SIGNAL.early);
    expect(leaveSignal(50, 100)).toBeNull();
    expect(leaveSignal(85, 100)).toBe(SIGNAL.mostly);
  });
});
