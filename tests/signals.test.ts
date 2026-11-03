import { describe, expect, it } from 'vitest';
import { applyDoc, canon, emptyDoc, mergeDocs, syncedChanged, toDoc } from '../src/lib/sync/merge';
import { emptyState } from '../src/lib/state';
import { addMissed, bumpCell, bumpColdNetStart, bumpPair, MISSED_MAX, mergeSignals, mixClumpShare, normalizeMissed, SIGNAL_DAYS, type MissedItem, type Signals } from '../src/moments/signals';
import type { Moment } from '../src/moments/types';

const mk = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: 'v' + id, start: 0, end: 40, channel: 'c' + id, videoTitle: '', area: 'brain', topic: 't', hook: '', kind: 'regel', createdAt: '', ...o });
const D = '2026-11-03';
const item = (id: string, at: number, o: Partial<MissedItem> = {}): MissedItem => ({ id, question: 'Q ' + id, correct: 'A', why: 'W', at, ...o });

describe('Signale: Zähler', () => {
  it('bumpCell zählt je Tag, Stunde, Bereich und Form', () => {
    let s = emptyState();
    s = bumpCell(s, D, '07', mk('1'), 'seen');
    s = bumpCell(s, D, '07', mk('2'), 'seen');
    s = bumpCell(s, D, '07', mk('2'), 'done');
    s = bumpCell(s, D, '07', mk('3', { area: 'beat', form: 'audio' }), 'saves');
    s = bumpCell(s, D, '21', mk('4', { audio: true }), 'skips');
    const h = s.signals!.days[D].byHour!;
    expect(h['07'].brain!.video).toEqual({ seen: 2, done: 1, saves: 0, skips: 0 });
    expect(h['07'].beat!.audio).toEqual({ seen: 0, done: 0, saves: 1, skips: 0 });
    expect(h['21'].brain!.audio!.skips).toBe(1);
  });
  it('bumpCell ändert den alten Zustand nicht (neue Verweise)', () => {
    const a = bumpCell(emptyState(), D, '07', mk('1'), 'seen');
    const b = bumpCell(a, D, '07', mk('1'), 'seen');
    expect(a.signals!.days[D].byHour!['07'].brain!.video!.seen).toBe(1);
    expect(b.signals).not.toBe(a.signals);
  });
  it('bumpPair zählt Paare mit gleicher Folge, gleichem Kanal und gleichem Bereich', () => {
    let s = emptyState();
    s = bumpPair(s, D, mk('1'), mk('2'));
    s = bumpPair(s, D, mk('1'), mk('1'));
    s = bumpPair(s, D, mk('3', { area: 'body' }), mk('4', { channel: 'c3', area: 'body' }));
    expect(s.signals!.days[D].mixClump).toEqual({ pairs: 3, episode: 1, channel: 2, area: 3 });
    const r = mixClumpShare(s.signals);
    expect(r.episodeShare).toBeCloseTo(1 / 3, 6);
    expect(r.channelShare).toBeCloseTo(2 / 3, 6);
    expect(r.areaShare).toBeCloseTo(1, 6);
    expect(mixClumpShare(undefined).episodeShare).toBe(0);
    expect(mixClumpShare(s.signals, ['2020-01-01']).pairs).toBe(0);
  });
  it('bumpColdNetStart ist die Schnittstelle für Brief 02', () => {
    let s = emptyState();
    s = bumpColdNetStart(bumpColdNetStart(s, D), D);
    expect(s.signals!.days[D].coldNetStarts).toBe(2);
  });
});

describe('Signale: missed (Entscheidung 35)', () => {
  it('höchstens 20, die ältesten fallen raus, je Moment der jüngste Eintrag', () => {
    let s = emptyState();
    for (let i = 0; i < 25; i++) s = addMissed(s, item('m' + i, 1000 + i));
    expect(s.signals!.missed).toHaveLength(MISSED_MAX);
    expect(s.signals!.missed![0].id).toBe('m24');
    expect(s.signals!.missed!.some((x) => x.id === 'm4')).toBe(false);
    expect(s.signals!.missed!.some((x) => x.id === 'm5')).toBe(true);
    s = addMissed(s, item('m10', 5000, { why: 'neu' }));
    expect(s.signals!.missed!.filter((x) => x.id === 'm10')).toHaveLength(1);
    expect(s.signals!.missed![0]).toMatchObject({ id: 'm10', why: 'neu' });
  });
  it('normalizeMissed ist unabhängig von der Eingabereihenfolge', () => {
    const xs = Array.from({ length: 30 }, (_, i) => item('m' + (i % 22), 100 + i));
    expect(normalizeMissed(xs)).toEqual(normalizeMissed([...xs].reverse()));
  });
});

// Kleiner Zufallsgenerator für Prüfdaten
function rngOf(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomSignals(r: () => number): Signals {
  const days: Signals['days'] = {};
  const n = Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const k = `2026-10-${String(1 + Math.floor(r() * 6)).padStart(2, '0')}`;
    const d: Signals['days'][string] = {};
    if (r() < 0.7) d.mixClump = { pairs: Math.floor(r() * 50), episode: Math.floor(r() * 3), channel: Math.floor(r() * 9), area: Math.floor(r() * 20) };
    if (r() < 0.7) d.byHour = { [String(Math.floor(r() * 24)).padStart(2, '0')]: { brain: { video: { seen: Math.floor(r() * 9), done: Math.floor(r() * 9), saves: Math.floor(r() * 3), skips: Math.floor(r() * 4) } } } };
    if (r() < 0.5) d.coldNetStarts = Math.floor(r() * 4);
    days[k] = d;
  }
  const out: Signals = { days };
  if (r() < 0.6) out.missed = Array.from({ length: Math.floor(r() * 30) }, () => item('m' + Math.floor(r() * 40), Math.floor(r() * 1000)));
  return out;
}

describe('Signale: Zusammenführen', () => {
  const sets = Array.from({ length: 40 }, (_, i) => {
    const r = rngOf(i + 1);
    return [randomSignals(r), randomSignals(r), randomSignals(r)] as const;
  });
  const m = (a: Signals | undefined, b: Signals | undefined) => canon(mergeSignals(a, b));
  it('vertauschbar', () => {
    for (const [a, b] of sets) expect(m(a, b)).toBe(m(b, a));
  });
  it('wiederholbar', () => {
    for (const [a] of sets) expect(canon(mergeSignals(mergeSignals(a, a), a))).toBe(canon(mergeSignals(a, a)));
  });
  it('gruppierbar', () => {
    for (const [a, b, c] of sets) expect(canon(mergeSignals(mergeSignals(a, b), c))).toBe(canon(mergeSignals(a, mergeSignals(b, c))));
  });
  it('Zähler: je Feld und Tag der größere Wert', () => {
    const a: Signals = { days: { [D]: { mixClump: { pairs: 10, episode: 0, channel: 2, area: 3 }, coldNetStarts: 1 } } };
    const b: Signals = { days: { [D]: { mixClump: { pairs: 8, episode: 1, channel: 1, area: 5 }, byHour: { '07': { beat: { text: { seen: 2, done: 1, saves: 0, skips: 0 } } } } } } };
    const r = mergeSignals(a, b)!;
    expect(r.days[D].mixClump).toEqual({ pairs: 10, episode: 1, channel: 2, area: 5 });
    expect(r.days[D].coldNetStarts).toBe(1);
    expect(r.days[D].byHour!['07'].beat!.text).toEqual({ seen: 2, done: 1, saves: 0, skips: 0 });
  });
  it('nur die letzten 90 Tage bleiben', () => {
    const days: Signals['days'] = {};
    for (let i = 0; i < 120; i++) days['2026-' + String(1 + Math.floor(i / 28)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0')] = { coldNetStarts: 1 };
    const r = mergeSignals({ days }, { days: {} })!;
    expect(Object.keys(r.days)).toHaveLength(SIGNAL_DAYS);
    expect(Object.keys(r.days).sort()[0]).toBe(Object.keys(days).sort()[120 - SIGNAL_DAYS]);
  });
  it('Dokument: ohne Signale bleibt das Feld weg, mit Signalen wandert es und wird angewendet', () => {
    const s0 = emptyState();
    expect('signals' in toDoc(s0).state).toBe(false);
    expect('signals' in mergeDocs(emptyDoc(), emptyDoc()).state).toBe(false);
    const s1 = bumpCell(s0, D, '07', mk('1'), 'seen');
    const doc = toDoc(s1);
    expect(doc.state.signals!.days[D].byHour!['07'].brain!.video!.seen).toBe(1);
    const back = applyDoc(emptyState(), doc);
    expect(back.signals).toEqual(s1.signals);
    // Merge mit einem zweiten Gerät: Maximum
    const other = bumpCell(bumpCell(emptyState(), D, '07', mk('9'), 'seen'), D, '07', mk('9'), 'seen');
    const merged = applyDoc(s1, mergeDocs(toDoc(s1), toDoc(other)));
    expect(merged.signals!.days[D].byHour!['07'].brain!.video!.seen).toBe(2);
    // Wiederholtes Anwenden ändert nichts (gleicher Verweis)
    expect(applyDoc(merged, toDoc(merged)).signals).toBe(merged.signals);
  });
  it('syncedChanged erkennt Signale', () => {
    const a = emptyState();
    expect(syncedChanged(a, bumpColdNetStart(a, D))).toBe(true);
    expect(syncedChanged(a, a)).toBe(false);
  });
});
