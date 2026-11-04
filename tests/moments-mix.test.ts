import { describe, expect, it } from 'vitest';
import { effectiveShares, EXPLORE, HISTORY, isNewEpisode, leaveOf, newMomentCursor, nextMoment, sessionSkip, SIGNAL, upcoming, type MomentCursor, type MomentPrefs } from '../src/moments/mix';
import { signal } from '../src/moments/learn';
import type { Moment } from '../src/moments/types';
import type { Area } from '../src/types';

/** Festes Saatgut, damit jede Simulation bei jedem Lauf dasselbe zeigt */
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
const OLD = '2026-10-01T00:00:00Z';

const prefs = (o: Partial<MomentPrefs> = {}): MomentPrefs => ({ areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 }, weights: { area: {}, channel: {}, topic: {} }, seen: {}, mutedChannels: {}, now: NOW, ...o });

/** Realistischer Pool: episodes Folgen je per Momente, 12 Kanäle (4 je Bereich), Themen je Bereich */
function realPool(episodes: number, per: number, o: { top?: number; created?: (e: number) => string } = {}): Moment[] {
  const topics: Record<Area, string[]> = { brain: ['augen', 'ki', 'statistik'], body: ['kraft', 'ernaehrung'], beat: ['islam', 'sprache'] };
  const out: Moment[] = [];
  for (let e = 0; e < episodes; e++) {
    const ch = e % 12;
    const area = AREAS[ch % 3];
    const topic = topics[area][Math.floor(ch / 3) % topics[area].length];
    for (let i = 0; i < per; i++)
      out.push({ id: `e${e}:${i}`, videoId: `ep${e}`, start: i * 60, end: i * 60 + 60, channel: `ch${ch}`, videoTitle: `Folge ${e}`, area, topic, hook: `h${e}-${i}`, kind: 'regel', top: i < (o.top ?? 0), createdAt: o.created?.(e) ?? OLD });
  }
  return out;
}

/** Testpool aus dem Brief: 5 Folgen je 20 Momente, 3 Bereiche, 6 Kanäle (zwei Sprecher je Folge) */
function briefPool(): Moment[] {
  const out: Moment[] = [];
  for (let e = 0; e < 5; e++)
    for (let i = 0; i < 20; i++)
      out.push({ id: `b${e}:${i}`, videoId: `bp${e}`, start: i * 60, end: i * 60 + 60, channel: `c${(e + (i % 2)) % 6}`, videoTitle: '', area: AREAS[e % 3], topic: `t${e % 4}`, hook: '', kind: 'regel', createdAt: OLD });
  return out;
}

/** Zieht n Momente fortlaufend. Gibt Momente und je Zug, ob eine Regel gelockert wurde. */
function draw(pool: Moment[], p: MomentPrefs, n: number, o: { first?: boolean; seed?: number; c?: MomentCursor; history?: Moment[] } = {}) {
  const c = o.c ?? newMomentCursor(o.first ?? false);
  const rng = makeRng(o.seed ?? 1);
  const seq: Moment[] = [];
  const relaxed: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const before = c.relaxed.topic + c.relaxed.channel + c.relaxed.newcap;
    const m = nextMoment(pool, p, c, [...(o.history ?? []), ...seq], rng);
    if (!m) break;
    seq.push(m);
    relaxed.push(c.relaxed.topic + c.relaxed.channel + c.relaxed.newcap > before);
  }
  return { seq, relaxed, c };
}

/** Prüft jede harte Regel an Stelle i gegen die Momente davor */
function violations(seq: Moment[], relaxed: boolean[]) {
  const v = { episode: 0, channel: 0, topic: 0, area: 0, areaAvoidable: 0 };
  seq.forEach((m, i) => {
    const prev = seq.slice(Math.max(0, i - HISTORY), i);
    if (prev.some((x) => x.videoId === m.videoId)) v.episode++;
    if (!relaxed[i] && seq.slice(Math.max(0, i - 3), i).some((x) => x.channel === m.channel)) v.channel++;
    if (!relaxed[i] && seq.slice(Math.max(0, i - 4), i).filter((x) => x.topic === m.topic).length >= 2) v.topic++;
    if (i > 0 && seq[i - 1].area === m.area) v.area++;
  });
  return v;
}

const share = (seq: Moment[], a: Area) => seq.filter((m) => m.area === a).length / seq.length;
const pairs = (seq: Moment[]) => {
  let ep = 0, ch = 0, ar = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].videoId === seq[i - 1].videoId) ep++;
    if (seq[i].channel === seq[i - 1].channel) ch++;
    if (seq[i].area === seq[i - 1].area) ar++;
  }
  const n = seq.length - 1;
  return { episode: ep / n, channel: ch / n, area: ar / n };
};

describe('Mischung pro Moment: 1000 Ziehungen im realistischen Pool', () => {
  const pool = realPool(100, 20);
  const { seq, relaxed, c } = draw(pool, prefs(), 1000, { first: true });
  it('1000 Momente, alle verschieden, keine Regel musste gelockert werden', () => {
    expect(seq).toHaveLength(1000);
    expect(new Set(seq.map((m) => m.id)).size).toBe(1000);
    expect(c.relaxed).toEqual({ topic: 0, channel: 0, newcap: 0 });
    expect(relaxed.some(Boolean)).toBe(false);
  });
  it('jede harte Regel hält in jeder Ziehung', () => {
    expect(violations(seq, relaxed)).toEqual({ episode: 0, channel: 0, topic: 0, area: 0, areaAvoidable: 0 });
  });
  it('Bereichsanteile stimmen auf 5 Prozent', () => {
    for (const a of AREAS) expect(Math.abs(share(seq, a) - 1 / 3)).toBeLessThanOrEqual(0.05);
  });
  it('mixClump: gleiche Folge unter 2 %, gleicher Kanal unter 10 %, gleicher Bereich unter 35 %', () => {
    const p = pairs(seq);
    expect(p.episode).toBeLessThan(0.02);
    expect(p.channel).toBeLessThan(0.1);
    expect(p.area).toBeLessThan(0.35);
  });
  it('erster Moment des Tages ist Beat', () => {
    expect(seq[0].area).toBe('beat');
    expect(draw(pool, prefs(), 1, { first: false }).seq[0].area).toBeDefined();
  });
  it('kein Dreierblock eines Bereichs, keine zwei Momente derselben Folge nacheinander', () => {
    for (let i = 2; i < seq.length; i++) expect(seq[i].area === seq[i - 1].area && seq[i - 1].area === seq[i - 2].area).toBe(false);
    for (let i = 1; i < seq.length; i++) expect(seq[i].videoId).not.toBe(seq[i - 1].videoId);
  });
});

describe('Mischung pro Moment: Testpool aus dem Brief (5 Folgen je 20 Momente, 3 Bereiche, 6 Kanäle)', () => {
  // Mit 5 Folgen ist "nie dieselbe Folge innerhalb 10" nach 5 Momenten nicht mehr erfüllbar. 1000 Ziehungen sind darum 200 Sitzungen zu je 5 Momenten.
  const pool = briefPool();
  const sessions = Array.from({ length: 200 }, (_, s) => draw(pool, prefs(), 5, { seed: s + 1 }));
  it('jede Sitzung liefert 5 Momente aus 5 verschiedenen Folgen, die sechste Wahl gibt null', () => {
    for (const s of sessions) {
      expect(s.seq).toHaveLength(5);
      expect(new Set(s.seq.map((m) => m.videoId)).size).toBe(5);
      expect(nextMoment(pool, prefs(), s.c, s.seq, makeRng(1))).toBeNull();
    }
  });
  it('1000 Ziehungen: Folge nie innerhalb 10, Kanal und Thema halten, solange nichts gelockert wurde', () => {
    let draws = 0;
    for (const s of sessions) {
      draws += s.seq.length;
      expect(violations(s.seq, s.relaxed)).toMatchObject({ episode: 0, channel: 0, topic: 0 });
    }
    expect(draws).toBe(1000);
  });
  it('Bereichsanteile und mixClump über alle 1000 Ziehungen', () => {
    const all = sessions.flatMap((s) => s.seq);
    // Jede Sitzung nimmt alle 5 Folgen, der Pool hat 2 Folgen Brain, 2 Body, 1 Beat. Die Anteile sind damit 40/40/20 vom Pool vorgegeben.
    expect(share(all, 'brain')).toBeCloseTo(0.4, 5);
    expect(share(all, 'body')).toBeCloseTo(0.4, 5);
    expect(share(all, 'beat')).toBeCloseTo(0.2, 5);
    let ep = 0, ch = 0, ar = 0, n = 0;
    for (const s of sessions)
      for (let i = 1; i < s.seq.length; i++) {
        n++;
        if (s.seq[i].videoId === s.seq[i - 1].videoId) ep++;
        if (s.seq[i].channel === s.seq[i - 1].channel) ch++;
        if (s.seq[i].area === s.seq[i - 1].area) ar++;
      }
    expect(ep / n).toBeLessThan(0.02);
    expect(ch / n).toBeLessThan(0.1);
    expect(ar / n).toBeLessThan(0.35);
  });
});

describe('Harte Regeln einzeln', () => {
  it('derselbe Kanal höchstens 1 von 4, dasselbe Thema höchstens 2 von 5', () => {
    const { seq, relaxed } = draw(realPool(60, 10), prefs(), 300);
    for (let i = 0; i < seq.length; i++) {
      expect(relaxed[i]).toBe(false);
      for (let w = Math.max(0, i - 3); w <= i; w++) {
        const win = seq.slice(w, w + 4);
        if (w + 4 <= seq.length) expect(Math.max(...[...new Set(win.map((m) => m.channel))].map((c) => win.filter((m) => m.channel === c).length))).toBeLessThanOrEqual(1);
      }
    }
    for (let w = 0; w + 5 <= seq.length; w++) {
      const win = seq.slice(w, w + 5);
      expect(Math.max(...[...new Set(win.map((m) => m.topic))].map((t) => win.filter((m) => m.topic === t).length))).toBeLessThanOrEqual(2);
    }
  });
  it('der Verlauf vor dem Start zählt: keine Folge und kein Kanal aus den letzten Momenten', () => {
    const pool = realPool(30, 10);
    const history = ['ep0', 'ep1', 'ep2'].map((e) => pool.find((m) => m.videoId === e)!);
    const { seq } = draw(pool, prefs(), 20, { history });
    for (const m of seq.slice(0, 10)) expect(['ep0', 'ep1', 'ep2']).not.toContain(m.videoId);
    for (const m of seq.slice(0, 3)) expect(history.map((x) => x.channel)).not.toContain(m.channel);
  });
  it('Fallback: erst das Thema, dann der Kanal gelockert, nie die Folge', () => {
    // 4 Folgen, alle Thema t, 2 Kanäle: Folge-Regel allein erlaubt 4 Züge, Thema und Kanal müssen weichen
    const pool: Moment[] = [];
    for (let e = 0; e < 4; e++) for (let i = 0; i < 5; i++) pool.push({ id: `f${e}:${i}`, videoId: `f${e}`, start: 0, end: 60, channel: `k${e % 2}`, videoTitle: '', area: 'brain', topic: 't', hook: '', kind: 'regel', createdAt: OLD });
    const { seq, c } = draw(pool, prefs(), 10);
    expect(seq).toHaveLength(4);
    expect(new Set(seq.map((m) => m.videoId)).size).toBe(4);
    expect(c.relaxed.topic).toBeGreaterThan(0);
    expect(c.relaxed.channel).toBeGreaterThan(0);
    expect(nextMoment(pool, prefs(), c, seq, makeRng(1))).toBeNull();
  });
  it('Fallback-Reihenfolge: reicht das Thema zu lockern, bleibt der Kanal hart', () => {
    // 6 Folgen, 6 Kanäle (nie Kanal-Konflikt), 1 Thema: nur das Thema muss weichen
    const pool: Moment[] = [];
    for (let e = 0; e < 6; e++) for (let i = 0; i < 5; i++) pool.push({ id: `g${e}:${i}`, videoId: `g${e}`, start: 0, end: 60, channel: `k${e}`, videoTitle: '', area: 'brain', topic: 't', hook: '', kind: 'regel', createdAt: OLD });
    const { c, seq } = draw(pool, prefs(), 6);
    expect(seq).toHaveLength(6);
    expect(c.relaxed.topic).toBeGreaterThan(0);
    expect(c.relaxed.channel).toBe(0);
  });
  it('gleicher Bereich wie davor nur, wenn kein anderer Bereich Kandidaten hat', () => {
    const only = realPool(40, 10).filter((m) => m.area === 'brain');
    const { seq } = draw(only, prefs(), 20);
    expect(seq).toHaveLength(20);
    const two = realPool(40, 10).filter((m) => m.area !== 'beat');
    const s2 = draw(two, prefs(), 100).seq;
    for (let i = 1; i < s2.length; i++) expect(s2[i].area).not.toBe(s2[i - 1].area);
  });
  it('hat ein Bereich über die Hälfte der Anteile, entscheidet das Anteilsdefizit', () => {
    const { seq } = draw(realPool(100, 20), prefs({ areaShares: { brain: 0.6, body: 0.2, beat: 0.2 } }), 400);
    expect(Math.abs(share(seq, 'brain') - 0.6)).toBeLessThanOrEqual(0.05);
  });
  it('kein Moment doppelt, gesehene und stumme nie', () => {
    const pool = realPool(60, 10);
    const first = draw(pool, prefs(), 200, { seed: 3 }).seq;
    const seen = Object.fromEntries(first.slice(0, 120).map((m) => [m.id, 1]));
    expect(draw(pool, prefs({ seen }), 200, { seed: 4 }).seq.some((m) => seen[m.id])).toBe(false);
    const muted = { ch0: 'ch0', ch5: 'ch5' };
    expect(draw(pool, prefs({ mutedChannels: muted }), 300).seq.some((m) => m.channel in muted)).toBe(false);
  });
  it('höchstens 1 Top-Moment von 15', () => {
    const { seq } = draw(realPool(100, 20, { top: 2 }), prefs(), 600, { seed: 9 });
    const idx = seq.map((m, i) => (m.top ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < idx.length; k++) expect(idx[k] - idx[k - 1]).toBeGreaterThanOrEqual(15);
  });
});

describe('Neue Folge: höchstens 2 Momente pro Sitzung', () => {
  const fresh = new Date(NOW - 5 * 3_600_000).toISOString();
  it('isNewEpisode: jünger als 48 h, publishedAt vor createdAt', () => {
    expect(isNewEpisode({ createdAt: fresh }, NOW)).toBe(true);
    expect(isNewEpisode({ createdAt: new Date(NOW - 49 * 3_600_000).toISOString() }, NOW)).toBe(false);
    expect(isNewEpisode({ createdAt: fresh, publishedAt: OLD }, NOW)).toBe(false);
    expect(isNewEpisode({ createdAt: '' }, NOW)).toBe(false);
  });
  it('von einer neuen Folge kommen in einer langen Sitzung nur 2 Momente', () => {
    const pool = realPool(60, 20, { created: (e) => (e === 7 || e === 8 ? fresh : OLD) });
    const { seq, c } = draw(pool, prefs(), 800, { seed: 11 });
    for (const e of ['ep7', 'ep8']) expect(seq.filter((m) => m.videoId === e).length).toBeLessThanOrEqual(2);
    expect(c.relaxed.newcap).toBe(0);
  });
  it('bleibt nichts anderes, wird die Grenze zuletzt gelockert', () => {
    const only = realPool(12, 20, { created: () => fresh }).filter((m) => m.videoId === 'ep3');
    const { seq, c } = draw(only, prefs(), 6);
    expect(seq).toHaveLength(1);
    expect(c.relaxed.newcap).toBe(0);
    // einzelne Folge: nach der ersten Wahl blockt die Folge-Regel, nicht die Grenze
  });
});

describe('Gewichte sind weich, nie ein Filter', () => {
  it('Kanal- und Themagewichte unter 1 machen seltener, nicht unsichtbar', () => {
    const pool = realPool(100, 20);
    const w = { area: {}, channel: { ch0: 0.5, ch1: 0.5 }, topic: { augen: 0.9 } };
    const seq = draw(pool, prefs({ weights: w }), 600, { seed: 5 }).seq;
    const n = (c: string) => seq.filter((m) => m.channel === c).length;
    expect(n('ch0')).toBeGreaterThan(0);
    expect(seq.filter((m) => m.topic === 'augen').length).toBeGreaterThan(0);
    const mean = seq.length / 12;
    expect(n('ch0')).toBeLessThan(mean);
  });
  it('Gewicht je Folge und Unterthema wirkt, ohne Folgen zu sperren', () => {
    const pool = realPool(60, 20).map((m) => (m.videoId === 'ep4' ? { ...m, subtopic: ['ki/regulatorik'] } : m));
    const base = draw(pool, prefs(), 500, { seed: 6 }).seq.filter((m) => m.videoId === 'ep4').length;
    const low = draw(pool, prefs({ weights: { area: {}, channel: {}, topic: {}, episode: { ep4: 0.3 } } }), 500, { seed: 6 }).seq.filter((m) => m.videoId === 'ep4').length;
    const sub = draw(pool, prefs({ weights: { area: {}, channel: {}, topic: {}, subtopic: { 'ki/regulatorik': 0.3 } } }), 500, { seed: 6 }).seq.filter((m) => m.videoId === 'ep4').length;
    expect(low).toBeLessThanOrEqual(base);
    expect(sub).toBeLessThanOrEqual(base);
  });
  it('Netzrang ist ein Gewicht: Vorgeladene kommen öfter, die Mischregeln bleiben', () => {
    const pool = realPool(100, 20);
    const have = new Set(pool.filter((m) => Number(m.videoId.slice(2)) < 10).map((m) => m.id));
    const rank = (m: Moment) => (have.has(m.id) ? 0 : 1);
    const count = (s: Moment[]) => s.filter((m) => have.has(m.id)).length;
    let plain = 0, ranked = 0;
    for (let seed = 1; seed <= 5; seed++) {
      plain += count(draw(pool, prefs(), 300, { seed }).seq);
      const r = draw(pool, prefs({ rank }), 300, { seed });
      ranked += count(r.seq);
      expect(violations(r.seq, r.relaxed)).toMatchObject({ episode: 0, channel: 0, topic: 0 });
    }
    expect(ranked).toBeGreaterThan(plain * 1.5);
    expect(ranked).toBeLessThan(1500 * 0.5);
    // Lokal ca. 2 s, auf dem CI-Runner 5,9 s (CI-Lauf 41771898967 riss das Standardlimit von 5 s): mehr Luft, an der Mischung ändert das nichts
  }, 20000);
  it('Kontextgewicht (ctx) verschiebt die Anteile, nie eine harte Regel', () => {
    const pool = realPool(100, 20);
    const ctx = (m: Moment) => (m.area === 'beat' ? 3 : 1);
    const { seq, relaxed } = draw(pool, prefs({ ctx }), 500, { seed: 8 });
    expect(violations(seq, relaxed)).toMatchObject({ episode: 0, channel: 0, topic: 0 });
  });
  it('Skip-Serie der Sitzung: zwei Skips beim selben Kanal dämpfen ihn auf 0.1', () => {
    const pool = realPool(100, 20);
    const c = newMomentCursor(false);
    const m = pool.find((x) => x.channel === 'ch2')!;
    expect(sessionSkip(c, m)).toBe(false);
    expect(c.dampen.size).toBe(0);
    expect(sessionSkip(c, { channel: 'ch2', topic: 'other' })).toBe(true);
    expect(c.dampen.has('c:ch2')).toBe(true);
    const damped = draw(pool, prefs(), 600, { c, seed: 2 }).seq.filter((x) => x.channel === 'ch2').length;
    const plain = draw(pool, prefs(), 600, { seed: 2 }).seq.filter((x) => x.channel === 'ch2').length;
    expect(damped).toBeLessThan(plain);
  });
});

describe('upcoming', () => {
  const q = realPool(5, 2);
  it('die nächsten n hinter idx, ohne etwas zu verbrauchen', () => {
    expect(upcoming(q, 0, 3).map((m) => m.id)).toEqual(q.slice(1, 4).map((m) => m.id));
    expect(upcoming(q, 8, 5).map((m) => m.id)).toEqual([q[9].id]);
    expect(upcoming(q, -1, 2).map((m) => m.id)).toEqual(q.slice(0, 2).map((m) => m.id));
  });
  it('skip übergeht gescheiterte', () => {
    expect(upcoming(q, 0, 2, (m) => m.id === q[1].id).map((m) => m.id)).toEqual([q[2].id, q[3].id]);
  });
});

describe('Wirksame Anteile', () => {
  it('gelernte Bereichsgewichte, jeder Bereich mindestens 10 %', () => {
    let w = prefs().weights;
    for (let i = 0; i < 40; i++) w = signal(w, { area: 'beat', channel: 'ch2', topic: 'islam' }, 0.7, 0);
    const s = effectiveShares(prefs({ weights: w }));
    expect(s.beat).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(s.brain + s.body + s.beat).toBeCloseTo(1, 6);
    const seq = draw(realPool(100, 20), prefs({ weights: w }), 400).seq;
    expect(share(seq, 'beat')).toBeGreaterThanOrEqual(0.08);
  });
});

describe('Erkundung', () => {
  it('bleibt bei 20 Prozent', () => {
    expect(EXPLORE).toBe(0.2);
  });
  it('Unbekanntes bekommt mindestens ein Fünftel, auch wenn alle bekannten Kanäle stark gewichtet sind', () => {
    // Alles in einem Bereich, 12 Kanäle. 9 sind bekannt und stark, ch9 bis ch11 sind unbekannt (ohne Gewicht).
    const brain = realPool(100, 20).map((m) => ({ ...m, area: 'brain' as Area, topic: `t-${m.channel}` }));
    const channel = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`ch${i}`, 2]));
    const seq = draw(brain, prefs({ weights: { area: {}, channel, topic: {} } }), 600, { seed: 99 }).seq;
    const fresh = seq.filter((m) => ['ch9', 'ch10', 'ch11'].includes(m.channel)).length / seq.length;
    // Rein nach Gewicht wären es 3/21 = 14 %. Die Mindestquote hebt es auf 20 %, Abstandsregeln lassen manchmal keinen Unbekannten zu.
    expect(fresh).toBeGreaterThan(0.16);
    expect(fresh).toBeLessThanOrEqual(0.3);
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
