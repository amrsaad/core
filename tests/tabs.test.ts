import { describe, expect, it } from 'vitest';
import { applyDoc, mergeDocs, syncedChanged, toDoc } from '../src/lib/sync/merge';
import { emptyState, type AppState } from '../src/lib/state';
import { REJECT, reject } from '../src/moments/learn';
import { restoreQueue, type SavedQueue } from '../src/moments/queue';
import { bumpStart, dropOverStarted, isQuickSkip, quickSkip, REJECT_AFTER, resumeSaved, setTabCursor, START_MAX } from '../src/moments/tabs';
import type { Moment } from '../src/moments/types';

const mk = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: 'v' + id, start: 0, end: 40, channel: 'c' + id, videoTitle: '', area: 'brain', topic: 't' + id, hook: '', kind: 'regel', createdAt: '', ...o });
const pool = Array.from({ length: 20 }, (_, i) => mk(String(i)));
const DAY = '2026-11-03';
const NOW = Date.parse('2026-11-03T08:00:00Z');

describe('Reiterposition (Entscheidung 36)', () => {
  it('setTabCursor merkt die Position je Reiter, gleiche Position gibt denselben Zustand zurück', () => {
    const s = setTabCursor(emptyState(), 'video', '5', DAY);
    expect(s.tabCursor).toEqual({ video: { id: '5', day: DAY } });
    expect(setTabCursor(s, 'video', '5', DAY)).toBe(s);
    expect(setTabCursor(s, 'audio', '7', DAY).tabCursor).toEqual({ video: { id: '5', day: DAY }, audio: { id: '7', day: DAY } });
  });
  it('resumeSaved beginnt bei der Position, nicht am Anfang der Ablage', () => {
    const saved: SavedQueue = { day: DAY, ids: ['1', '2', '3', '4'] };
    expect(resumeSaved(saved, { id: '3', day: DAY }, DAY)!.ids).toEqual(['3', '4']);
    expect(resumeSaved(saved, { id: '1', day: DAY }, DAY)).toBe(saved);
    expect(resumeSaved(saved, { id: 'weg', day: DAY }, DAY)).toBe(saved);
    expect(resumeSaved(saved, { id: '3', day: 'gestern' }, DAY)).toBe(saved);
    expect(resumeSaved(null, { id: '3', day: DAY }, DAY)).toBeNull();
    expect(resumeSaved(saved, undefined, DAY)).toBe(saved);
  });
  it('dropOverStarted lässt vorn nur Momente stehen, die weniger als zweimal Start waren', () => {
    const q = [mk('a'), mk('b'), mk('c')];
    expect(dropOverStarted(q, undefined)).toBe(q);
    expect(dropOverStarted(q, { a: START_MAX - 1 })).toBe(q);
    expect(dropOverStarted(q, { a: START_MAX }).map((m) => m.id)).toEqual(['b', 'c']);
    expect(dropOverStarted(q, { a: 5, b: 2 }).map((m) => m.id)).toEqual(['c']);
    // nur vorn: ein Moment weiter hinten bleibt
    expect(dropOverStarted(q, { b: 2 }).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});

/** Ein Reiterwechsel wie der Feed ihn macht: Warteschlange aus der Ablage, Start zählen. `watch` bestimmt, was der Nutzer damit tut. */
function visit(s0: AppState, saved: SavedQueue | null, watch: 'play' | 'leave'): { s: AppState; start: string; saved: SavedQueue } {
  let s = s0;
  let q = restoreQueue(resumeSaved(saved, s.tabCursor?.video, DAY), DAY, pool, { seen: s.momentSeen, mutedChannels: s.mutedChannels }, 30);
  q = dropOverStarted(q, s.startShown);
  if (!q.length) q = pool.filter((m) => !s.momentSeen[m.id]).slice(0, 30);
  const head = q[0];
  s = bumpStart(setTabCursor(s, 'video', head.id, DAY), head.id);
  // spielt der Moment an, ist er gesehen
  if (watch === 'play') s = { ...s, momentSeen: { ...s.momentSeen, [head.id]: NOW } };
  return { s, start: head.id, saved: { day: DAY, ids: q.map((m) => m.id) } };
}

describe('Reiterwechsel: Startmomente (Issue 27)', () => {
  it('dreimal Reiterwechsel, jedes Mal wird der Startmoment gespielt: drei verschiedene Startmomente', () => {
    let s = emptyState();
    let saved: SavedQueue | null = null;
    const starts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const v = visit(s, saved, 'play');
      s = v.s;
      saved = v.saved;
      starts.push(v.start);
    }
    expect(new Set(starts).size).toBe(3);
  });
  it('wird der Startmoment nie angespielt, ist er höchstens zweimal Start, dann folgt der nächste', () => {
    let s = emptyState();
    let saved: SavedQueue | null = null;
    const starts: string[] = [];
    for (let i = 0; i < 4; i++) {
      const v = visit(s, saved, 'leave');
      s = v.s;
      saved = v.saved;
      starts.push(v.start);
    }
    expect(starts.slice(0, 2)).toEqual([starts[0], starts[0]]);
    expect(starts[2]).not.toBe(starts[0]);
    for (const id of new Set(starts)) expect(starts.filter((x) => x === id).length).toBeLessThanOrEqual(START_MAX);
  });
  it('die Position gilt je Reiter', () => {
    let s = setTabCursor(emptyState(), 'audio', '9', DAY);
    s = setTabCursor(s, 'video', '2', DAY);
    expect(s.tabCursor!.audio!.id).toBe('9');
  });
});

describe('Ablehnung nach zwei schnellen Skips (Issue 27)', () => {
  const m = mk('r1');
  it('schneller Skip heißt unter 5 Sekunden', () => {
    expect(isQuickSkip(0)).toBe(true);
    expect(isQuickSkip(4.9)).toBe(true);
    expect(isQuickSkip(5)).toBe(false);
  });
  it('der erste schnelle Skip lehnt nicht ab, der zweite schon', () => {
    const a = quickSkip(emptyState(), m, NOW);
    expect(a.rejected).toBe(false);
    expect(a.state.momentSkips).toEqual({ r1: 1 });
    expect(a.state.momentRejected).toBeUndefined();
    expect(REJECT_AFTER).toBe(2);
    const b = quickSkip(a.state, m, NOW + 1000);
    expect(b.rejected).toBe(true);
    expect(b.state.momentRejected).toEqual({ r1: NOW + 1000 });
    // zählt wie gesehen
    expect(b.state.momentSeen.r1).toBe(NOW + 1000);
    // Minus für Kanal und Thema, nicht für den Bereich
    expect(b.state.momentWeights.channel.cr1).toBeCloseTo(REJECT, 4);
    expect(b.state.momentWeights.topic.tr1).toBeCloseTo(REJECT, 4);
    expect(b.state.momentWeights.area.brain).toBeUndefined();
  });
  it('schon Gesehenes behält den früheren Zeitpunkt', () => {
    const s0 = { ...emptyState(), momentSeen: { r1: 111 } };
    const r = quickSkip(quickSkip(s0, m, NOW).state, m, NOW + 1);
    expect(r.state.momentSeen.r1).toBe(111);
  });
  it('ein abgelehnter Moment kommt nicht in die Warteschlange zurück', () => {
    const rejected = quickSkip(quickSkip(emptyState(), pool[0], NOW).state, pool[0], NOW + 1).state;
    const q = restoreQueue({ day: DAY, ids: pool.map((x) => x.id) }, DAY, pool, { seen: rejected.momentSeen, mutedChannels: {} }, 30);
    expect(q.some((x) => x.id === pool[0].id)).toBe(false);
    expect(q).toHaveLength(pool.length - 1);
  });
  it('learn.reject senkt nur Kanal und Thema und nur um den Faktor', () => {
    const w = reject({ area: {}, channel: { ca: 2 }, topic: {} }, { channel: 'ca', topic: 'ta', area: 'brain' }, NOW);
    expect(w.channel.ca).toBeCloseTo(2 * REJECT, 4);
    expect(w.topic.ta).toBeCloseTo(REJECT, 4);
    expect(w.area).toEqual({});
  });
  it('Sync: abgelehnt wandert, der frühere Zeitpunkt gewinnt, Dokument ohne Ablehnung bleibt unverändert', () => {
    const a = quickSkip(quickSkip(emptyState(), m, 500).state, m, 600).state;
    expect('momentRejected' in toDoc(emptyState()).state).toBe(false);
    const b: AppState = { ...emptyState(), momentRejected: { r1: 400, r2: 900 } };
    const merged = mergeDocs(toDoc(a), toDoc(b));
    expect(merged.state.momentRejected).toEqual({ r1: 400, r2: 900 });
    expect(mergeDocs(toDoc(b), toDoc(a)).state.momentRejected).toEqual(merged.state.momentRejected);
    const applied = applyDoc(a, merged);
    expect(applied.momentRejected).toEqual({ r1: 400, r2: 900 });
    expect(syncedChanged(a, applied)).toBe(true);
    expect(applyDoc(applied, toDoc(applied)).momentRejected).toBe(applied.momentRejected);
  });
});
