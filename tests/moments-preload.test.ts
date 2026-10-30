import { describe, expect, it } from 'vitest';
import { addNet, isPoorNet, mbText, netRank, nextToLoad, planEviction, PRELOAD_CAP_BYTES, PRELOAD_COUNT, preloadedLine, streamKind, windowOf, windowOfTime, PRELOAD_COUNT_MAX, queueAhead, type NetSample, type Stored } from '../src/moments/preload';
import { newMomentCursor, nextMomentBlock, type MomentPrefs } from '../src/moments/mix';
import type { Moment } from '../src/moments/types';
const makeRng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const mk = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: o.videoId ?? id, start: 10, end: 50, channel: 'c' + id, videoTitle: '', area: 'brain', topic: 't' + id, hook: '', kind: 'story', createdAt: '', ...o });
const mp3 = (id: string, o: Partial<Moment> = {}) => mk(id, { videoId: 'pod-' + id, hls: `https://cdn.example/${id}.mp3?x=1`, form: 'audio', ...o });
const yt = (id: string, o: Partial<Moment> = {}) => mk(id, { videoId: 'abcdefghi' + id.padStart(2, '0'), form: 'video', ...o });
const txt = (id: string) => mk(id, { videoId: 'txt-' + id, form: 'text' });
const MB = 1024 * 1024;

describe('Vorrat: Art der Quelle', () => {
  it('mp3 wird vorgeladen, m3u8 und m4a nicht, YouTube nie, Text braucht nichts', () => {
    expect(streamKind(mp3('1'))).toBe('mp3');
    expect(streamKind(mp3('1', { hls: 'https://x/a.M3U8' }))).toBe('stream');
    expect(streamKind(mp3('1', { hls: 'https://x/a.m4a' }))).toBe('stream');
    expect(streamKind(yt('1'))).toBe('youtube');
    expect(streamKind(txt('1'))).toBe('text');
    expect(streamKind(mk('x', { videoId: 'pod-x' }))).toBe('none');
  });
});

describe('Vorrat: Fenster und Auswahl', () => {
  const q = [mp3('0'), ...Array.from({ length: 40 }, (_, i) => mp3(String(i + 1)))];
  it('die nächsten 30 nach dem aktuellen', () => {
    const w = windowOf(q, 0);
    expect(w).toHaveLength(PRELOAD_COUNT);
    expect(w[0]).toMatchObject({ rank: 1 });
    expect(w[0].m.id).toBe('1');
    expect(w[29].m.id).toBe('30');
  });
  it('Fenster wandert mit dem Index und endet am Ende der Warteschlange', () => {
    expect(windowOf(q, 35).map((r) => r.m.id)).toEqual(['36', '37', '38', '39', '40']);
    expect(windowOf(q, 100)).toEqual([]);
  });
  it('lädt den nächsten fehlenden vorladbaren, überspringt Text, YouTube, Vorhandene und Gesperrte', () => {
    const queue = [mp3('0'), txt('1'), yt('2'), mp3('3'), mp3('4'), mp3('5')];
    const w = windowOf(queue, 0);
    expect(nextToLoad(w, new Set())?.m.id).toBe('3');
    expect(nextToLoad(w, new Set(['3']))?.m.id).toBe('4');
    expect(nextToLoad(w, new Set(['3']), (m) => m.id === '4')?.m.id).toBe('5');
    expect(nextToLoad(w, new Set(['3', '4', '5']))).toBeNull();
  });
});

const st = (id: string, mb: number, at: number): Stored => ({ id, bytes: mb * MB, at });

describe('Vorrat: Verdrängung des Ältesten bei 60 MB', () => {
  const cap = PRELOAD_CAP_BYTES;
  it('Obergrenze sind 60 MB', () => expect(cap).toBe(60 * MB));
  it('passt es, wird nichts verdrängt', () => expect(planEviction([st('a', 20, 1)], 10 * MB, cap, 5, () => 3)).toEqual({ evict: [], ok: true }));
  it('zuerst Ausschnitte außerhalb des Fensters, das Älteste zuerst', () => {
    const stored = [st('new', 20, 30), st('old', 20, 10), st('mid', 20, 20)];
    const ranks: Record<string, number | null> = { new: 4, old: null, mid: null };
    const r = planEviction(stored, 10 * MB, cap, 9, (id) => ranks[id]);
    expect(r).toEqual({ evict: ['old'], ok: true });
  });
  it('mehrere, bis es passt', () => {
    const stored = [st('a', 20, 1), st('b', 20, 2), st('c', 20, 3)];
    const r = planEviction(stored, 25 * MB, cap, 9, () => null);
    expect(r.evict).toEqual(['a', 'b']);
    expect(r.ok).toBe(true);
  });
  it('ist alles im Fenster, geht nur das Fernere für das Nähere, das Älteste zuerst', () => {
    const stored = [st('r2', 20, 1), st('r9', 20, 2), st('r8', 20, 3)];
    const ranks: Record<string, number> = { r2: 2, r9: 9, r8: 8 };
    const r = planEviction(stored, 10 * MB, cap, 5, (id) => ranks[id]);
    expect(r).toEqual({ evict: ['r9'], ok: true });
  });
  it('niemals ein Näheres für ein Ferneres: dann wird nicht geladen', () => {
    const stored = [st('r1', 30, 1), st('r2', 30, 2)];
    const ranks: Record<string, number> = { r1: 1, r2: 2 };
    expect(planEviction(stored, 10 * MB, cap, 20, (id) => ranks[id])).toEqual({ evict: [], ok: false });
  });
  it('ein einzelner Ausschnitt über der Grenze wird nie geladen', () => expect(planEviction([], 61 * MB, cap, 1, () => null)).toEqual({ evict: [], ok: false }));
  it('bereits gespielte (Rang unter 1) zählen als außerhalb', () => {
    const r = planEviction([st('played', 40, 1), st('next', 20, 2)], 10 * MB, cap, 3, (id) => (id === 'played' ? 0 : 1));
    expect(r.evict).toEqual(['played']);
  });
});

describe('Vorrat: Anzeige', () => {
  it('Zeile in Settings', () => {
    expect(preloadedLine(0, 0)).toBe('Preloaded: 0 moments, 0.0 MB');
    expect(preloadedLine(12, 25.34 * MB)).toBe('Preloaded: 12 moments, 25.3 MB');
    expect(preloadedLine(1, MB)).toBe('Preloaded: 1 moment, 1.0 MB');
    expect(mbText(60 * MB)).toBe('60.0');
  });
});

const S = (ms: number): NetSample => ({ k: 'start', ms });
const P = (ms: number): NetSample => ({ k: 'probe', ms });
const all = (...xs: NetSample[]) => xs.reduce<NetSample[]>((l, x) => addNet(l, x), []);

describe('Netz-bewusst: wann das Netz schlecht ist', () => {
  it('offline ist immer schlecht', () => expect(isPoorNet([], false)).toBe(true));
  it('normal ohne Messungen', () => expect(isPoorNet([], true)).toBe(false));
  it('die letzten drei Starts über 1 s', () => {
    expect(isPoorNet(all(S(1200), S(1500), S(2000)), true)).toBe(true);
    expect(isPoorNet(all(S(1200), S(1500)), true)).toBe(false);
    expect(isPoorNet(all(S(1200), S(900), S(2000)), true)).toBe(false);
    expect(isPoorNet(all(S(5000), S(1200), S(1500), S(2000)), true)).toBe(true);
  });
  it('genau 1 s ist noch nicht langsam', () => expect(isPoorNet(all(S(1000), S(1000), S(1000)), true)).toBe(false));
  it('ein schneller Abruf beendet den Zustand wieder', () => {
    const slow = all(S(1200), S(1500), S(2000));
    expect(isPoorNet(addNet(slow, P(300)), true)).toBe(false);
    expect(isPoorNet(addNet(slow, P(3000)), true)).toBe(true);
  });
  it('drei langsame Abrufe sind schlecht, ein schneller Start danach nicht', () => {
    const p = all(P(1500), P(2500), P(1200));
    expect(isPoorNet(p, true)).toBe(true);
    expect(isPoorNet(addNet(p, S(400)), true)).toBe(false);
  });
  it('hält nur die letzten Messungen', () => {
    let l: NetSample[] = [];
    for (let i = 0; i < 50; i++) l = addNet(l, S(i));
    expect(l.length).toBeLessThanOrEqual(12);
  });
});

describe('Netz-bewusst: Rang für die Mischung', () => {
  const cached = new Set(['c1']);
  const r = netRank((id) => cached.has(id));
  it('vorgeladen und Text zuerst, sonstige Streams dann, YouTube zuletzt', () => {
    expect(r(mp3('c1'))).toBe(0);
    expect(r(txt('t'))).toBe(0);
    expect(r(mp3('other'))).toBe(1);
    expect(r(mp3('m', { hls: 'https://x/a.m3u8' }))).toBe(1);
    expect(r(yt('9'))).toBe(2);
  });
});

describe('Netz-bewusst: Mix-Regeln bleiben, nur die Kandidaten werden enger', () => {
  const pool: Moment[] = [
    ...Array.from({ length: 12 }, (_, i) => mp3('b' + i, { area: 'brain' })),
    ...Array.from({ length: 12 }, (_, i) => yt('1' + (i % 10), { id: 'yb' + i, area: 'brain', videoId: 'abcdefghi' + String(i).padStart(2, '0') })),
    ...Array.from({ length: 12 }, (_, i) => mp3('e' + i, { area: 'beat' })),
    ...Array.from({ length: 12 }, (_, i) => yt('2' + (i % 10), { id: 'ye' + i, area: 'beat', videoId: 'zbcdefghi' + String(i).padStart(2, '0') })),
  ];
  const prefs = (rank?: (m: Moment) => number): MomentPrefs => ({ areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 }, weights: { area: {}, channel: {}, topic: {} }, seen: {}, mutedChannels: {}, rank });
  const run = (rank?: (m: Moment) => number, blocks = 8) => {
    const c = newMomentCursor(true);
    const rng = makeRng(7);
    const out: Moment[][] = [];
    for (let i = 0; i < blocks; i++) out.push(nextMomentBlock(pool, prefs(rank), c, rng)!);
    return out;
  };

  it('ohne Rang oder mit gleichem Rang für alle unverändert (gleiches Ergebnis wie zuvor)', () => {
    const ids = (x: Moment[][]) => x.flat().map((m) => m.id);
    expect(ids(run(() => 0))).toEqual(ids(run(undefined)));
    expect(ids(run(undefined))).toEqual(ids(run(undefined)));
  });
  it('Blöcke à 3 aus demselben Bereich, Beat zuerst am Tag, auch mit Rang', () => {
    const blocks = run(netRank(() => false));
    for (const b of blocks) {
      expect(b).toHaveLength(3);
      expect(new Set(b.map((m) => m.area)).size).toBe(1);
    }
    expect(blocks[0][0].area).toBe('beat');
  });
  it('YouTube kommt nach hinten, solange Streams da sind', () => {
    const blocks = run(netRank(() => false), 6).flat();
    expect(blocks.filter((m) => streamKind(m) === 'youtube')).toHaveLength(0);
  });
  it('Vorgeladene gehen vor sonstigen Streams', () => {
    const have = new Set(['b0', 'b1', 'b2', 'e0', 'e1', 'e2']);
    const blocks = run(netRank((id) => have.has(id)), 2).flat();
    expect(blocks.every((m) => have.has(m.id))).toBe(true);
  });
  it('sind Streams aufgebraucht, folgt YouTube (nichts bleibt hängen)', () => {
    const streamsOnly = pool.filter((m) => streamKind(m) === 'youtube' || m.area === 'brain' && m.id === 'b0');
    const c = newMomentCursor(false);
    const b = nextMomentBlock(streamsOnly, prefs(netRank(() => false)), c, makeRng(1));
    expect(b).not.toBeNull();
    expect(b!.length).toBeGreaterThan(0);
  });
});

describe('Vorrat: Zeitfenster bei Tempo über 1x (Issue 13)', () => {
  const q = Array.from({ length: 100 }, (_, i) => mp3(String(i), { start: 0, end: 40 }));
  it('bei 1x genau die nächsten 30, wie bisher', () => {
    expect(windowOfTime(q, 0, 1).map((r) => r.rank)).toEqual(windowOf(q, 0).map((r) => r.rank));
    expect(windowOfTime(q, 0, 1)).toHaveLength(30);
  });
  it('bei 2x doppelt so viel Inhalt, 1.5x anderthalb mal', () => {
    expect(windowOfTime(q, 0, 2)).toHaveLength(60);
    expect(windowOfTime(q, 0, 1.5)).toHaveLength(45);
    expect(windowOfTime(q, 0, 2)[59].rank).toBe(60);
  });
  it('Zeit statt Anzahl: längere Momente weiter hinten verkürzen das Fenster', () => {
    const mixed = Array.from({ length: 100 }, (_, i) => mp3(String(i), { start: 0, end: i > 30 ? 120 : 40 }));
    // Inhalt der nächsten 30: 30 * 40 s, bei 2x 2400 s. Ab Rang 31 zählen 120 s je Moment
    const w = windowOfTime(mixed, 0, 2);
    expect(w.length).toBeLessThan(60);
    expect(w.length).toBeGreaterThan(30);
  });
  it('höchstens das Doppelte, endet am Ende der Warteschlange, fehlende Längen zählen mit dem Durchschnitt', () => {
    expect(windowOfTime(q, 0, 4)).toHaveLength(PRELOAD_COUNT_MAX);
    expect(windowOfTime(q, 90, 2).map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const noLen = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
    expect(windowOfTime(noLen, 0, 2)).toHaveLength(60);
  });
  it('Warteschlangen-Vorlauf wächst mit dem Tempo', () => {
    expect(queueAhead(1)).toBe(32);
    expect(queueAhead(1.5)).toBe(47);
    expect(queueAhead(2)).toBe(62);
  });
});
