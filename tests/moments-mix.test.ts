import { describe, expect, it } from 'vitest';
import { effectiveShares, EXPLORE, leaveOf, newMomentCursor, nextMomentBlock, SIGNAL, type MomentPrefs } from '../src/moments/mix';
import { notForMe, signal } from '../src/moments/learn';
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
  it('gelernte Bereichsgewichte, jeder Bereich mindestens 10 %', () => {
    let w = prefs().weights;
    for (let i = 0; i < 40; i++) w = signal(w, { area: 'beat', channel: 'beat-0', topic: 'islam' }, 0.7, 0);
    const s = effectiveShares(prefs({ weights: w }));
    expect(s.beat).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(s.brain + s.body + s.beat).toBeCloseTo(1, 6);
    const flat2 = run(prefs({ weights: w }), 100, false).flat();
    expect(flat2.filter((m) => m.area === 'beat').length / flat2.length).toBeGreaterThanOrEqual(0.08);
  });
  it('20 % Neues: unbekannte Kanäle kommen auch bei starken Favoriten vor', () => {
    let w = prefs().weights;
    for (let i = 0; i < 10; i++) w = signal(w, { area: 'brain', channel: 'brain-0', topic: 'augen' }, SIGNAL.more, 0);
    const brain = run(prefs({ weights: w }), 120, false).flat().filter((m) => m.area === 'brain');
    const fromFav = brain.filter((m) => m.channel === 'brain-0' || m.topic === 'augen').length / brain.length;
    expect(fromFav).toBeGreaterThan(0.5);
    expect(fromFav).toBeLessThan(0.95);
  });
});

describe('leaveOf', () => {
  it('bewertet nach geschautem Anteil, Skip unter 3 Sekunden', () => {
    expect(leaveOf(0, 100)).toEqual({ kind: 'skip' });
    expect(leaveOf(2.9, 100)).toEqual({ kind: 'skip' });
    // ab 3 s kein Skip mehr, sondern früh weggewischt (unter 30 %)
    expect(leaveOf(3, 100)).toEqual({ kind: 'factor', f: SIGNAL.early });
    expect(leaveOf(4.5, 60)).toEqual({ kind: 'factor', f: SIGNAL.early });
    expect(leaveOf(20, 100)).toEqual({ kind: 'factor', f: SIGNAL.early });
    expect(leaveOf(50, 100)).toBeNull();
    expect(leaveOf(79, 100)).toBeNull();
    expect(leaveOf(85, 100)).toEqual({ kind: 'factor', f: SIGNAL.mostly });
  });
});

describe('Erkundung', () => {
  it('bleibt bei 20 Prozent', () => {
    expect(EXPLORE).toBe(0.2);
  });
  it('rund ein Fünftel der Plätze geht an Unbekanntes, auch wenn Favoriten stark sind', () => {
    // brain: Kanal brain-0 und Thema augen sind bekannt und beliebt, alle anderen Kanäle mit Thema ki sind unbekannt
    let w = prefs().weights;
    for (let i = 0; i < 4; i++) w = signal(w, { area: 'brain', channel: 'brain-0', topic: 'augen' }, SIGNAL.more, 0);
    seed = 99;
    const picks = run(prefs({ weights: w, now: 0 }), 150, false).flat().filter((m) => m.area === 'brain');
    const fresh = picks.filter((m) => m.topic === 'ki' && m.channel !== 'brain-0').length / picks.length;
    expect(fresh).toBeGreaterThan(0.1);
    expect(fresh).toBeLessThan(0.3);
  });
});

describe('Mix mit Abläufen der Gewichte', () => {
  const t0 = 1_000_000;
  it('ein gesperrtes Thema kommt 30 Tage nicht vor, danach wieder', () => {
    const m = { area: 'brain' as Area, channel: 'brain-0', topic: 'augen' };
    // Schlüssel bekannt, damit nicht jeder Moment "neu" ist: ki ist stark, augen gesperrt
    let w = notForMe(prefs().weights, m, t0);
    w = signal(w, { area: 'brain', channel: 'brain-1', topic: 'ki' }, SIGNAL.more, t0);
    const share = (now: number) => {
      seed = 5;
      // wenige Blöcke, damit die 40 starken ki-Momente von brain-1 nicht aufgebraucht sind
      const picks = run(prefs({ weights: w, now }), 14, false).flat().filter((x) => x.area === 'brain');
      return picks.filter((x) => x.topic === 'augen').length / picks.length;
    };
    const during = share(t0 + 29 * 86_400_000);
    const after = share(t0 + 30 * 86_400_000 + 1);
    // Top-Momente (höchstens 1 von 15) gehen an den Gewichten vorbei, darum nicht genau 0
    expect(during).toBeLessThan(0.1);
    expect(after).toBeGreaterThan(0.4);
  });
});
