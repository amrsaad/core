import { afterEach, describe, expect, it } from 'vitest';
import { discardedIds, endDiagLine, endStats, focusDiagLine, focusReplanMode, freeCount, mixNullLine } from '../src/moments/endState';
import { endSessionFocus, FOCUS_EVENT, FOCUS_KEY, writeFocus } from '../src/moments/focus';
import { newMomentCursor, nextMoment } from '../src/moments/mix';
import type { Moment } from '../src/moments/types';

const NOW = new Date('2026-11-03T10:00:00').getTime();
const mk = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: 'v' + id, start: 0, end: 40, channel: 'c' + id, videoTitle: '', area: 'brain', topic: 't' + id, hook: 'plain', kind: 'regel', createdAt: '', ...o });
const prefs = { areaShares: { brain: 1 / 3, body: 1 / 3, beat: 1 / 3 }, weights: { area: {}, channel: {}, topic: {} }, seen: {} as Record<string, number>, mutedChannels: {} as Record<string, string>, now: NOW };

function memory(): Storage {
  const d = new Map<string, string>();
  return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => void d.set(k, String(v)), removeItem: (k) => void d.delete(k), clear: () => d.clear(), key: (i) => [...d.keys()][i] ?? null, get length() { return d.size; } } as Storage;
}

describe('Fokus ändert sich: Neuaufbau oder Rest neu planen', () => {
  it('Endseite (idx gleich Länge) und letzter Moment bauen neu auf, mit Rest bleibt es beim Neuplanen', () => {
    expect(focusReplanMode(5, 5)).toBe('refill');
    expect(focusReplanMode(5, 4)).toBe('refill');
    expect(focusReplanMode(0, 0)).toBe('refill');
    expect(focusReplanMode(5, 3)).toBe('keep');
    expect(focusReplanMode(8, 0)).toBe('keep');
  });
  it('Diagnosezeile des Fokuswechsels', () => {
    expect(focusDiagLine('Body · English · session', null, 5, 0, 'refill')).toBe('focus: Body · English · session to none, replan from 5 tail 0 (refill)');
    expect(focusDiagLine(null, 'Beat · today', 3, 4, 'keep')).toBe('focus: none to Beat · today, replan from 3 tail 4 (keep)');
  });
});

describe('Sitzungs-Cursor: verworfene Wahl und Endseite', () => {
  const pool = [mk('a', { area: 'body' }), mk('b', { area: 'body' }), mk('c', { area: 'beat' }), mk('d', { area: 'beat' })];
  it('freeCount zählt, was nextMoment anbieten darf', () => {
    expect(freeCount(pool, {}, {}, new Set())).toBe(4);
    expect(freeCount(pool, { a: 1 }, { cb: 'x' }, new Set(['c']))).toBe(1);
  });
  it('verworfene Wahl bleibt in used, ist aber ungesehen: discardedIds findet sie, Warteschlange und Sperre nicht', () => {
    const c = newMomentCursor(false);
    const picked: Moment[] = [];
    for (let i = 0; i < 4; i++) {
      const m = nextMoment(pool, prefs, c, [], () => 0.5);
      if (m) picked.push(m);
    }
    expect(c.used.size).toBeGreaterThan(0);
    const queue = new Set([picked[0].id]);
    const bad = new Set([picked[1].videoId]);
    const ids = discardedIds(pool, {}, {}, c.used, queue, bad);
    expect(ids).not.toContain(picked[0].id);
    expect(ids).not.toContain(picked[1].id);
    for (const m of picked.slice(2)) expect(ids).toContain(m.id);
    // Gesehene und stumme Momente kommen nie zurück
    expect(discardedIds(pool, { [picked[2].id]: 1 }, { [picked[3].channel]: 'x' }, c.used, queue, bad)).toEqual([]);
  });
  it('nach dem Freigeben liefert nextMoment den ungesehenen Moment wieder (ohne Freigabe null)', () => {
    const c = newMomentCursor(false);
    const m1 = nextMoment(pool, prefs, c, [], () => 0.5)!;
    // alle weiteren gewählt und verworfen
    while (nextMoment(pool, prefs, c, [], () => 0.5));
    expect(nextMoment(pool, prefs, c, [], () => 0.5)).toBeNull();
    const ids = discardedIds(pool, {}, {}, c.used, new Set([m1.id]), new Set());
    expect(ids.length).toBe(3);
    for (const id of ids) c.used.delete(id);
    // Verlauf leer: die Mischregeln lassen einen Moment zu
    expect(nextMoment(pool, prefs, c, [m1], () => 0.5)).not.toBeNull();
  });
  it('die Mischregel Folge innerhalb der letzten 10 bleibt: derselbe Moment im Verlauf wird nie gewählt', () => {
    const c = newMomentCursor(false);
    const only = [mk('x1', { videoId: 'same' }), mk('x2', { videoId: 'same' })];
    expect(nextMoment(only, prefs, c, [mk('h', { videoId: 'same' })], () => 0.5)).toBeNull();
  });
});

describe('Zeilen der Endseite', () => {
  const all = [mk('a', { area: 'body' }), mk('b', { area: 'body' }), mk('c', { area: 'beat' }), mk('d', { area: 'beat' }), mk('e')];
  it('zählt Pool, gesehen, stumm, abgelehnt, gesperrt, schlecht, used, Fokus und frei', () => {
    const formPool = all.filter((m) => m.id !== 'e');
    const focused = formPool.filter((m) => m.area === 'body');
    const s = endStats({ form: 'audio', formAll: all, formPool, focused, seen: { a: 1, c: 1 }, muted: { cd: 'x' }, rejected: { c: 1 }, badVideos: new Set(['vb']), used: new Set(['a', 'b']), focus: 'Body · English · session', queue: 7, idx: 7 });
    expect(s).toMatchObject({ pool: 5, seen: 2, muted: 1, rejected: 1, swipeBlocked: 1, bad: 1, used: 2, focusPool: 2, free: 0, queue: 7, idx: 7 });
    expect(endDiagLine(s)).toBe('end: audio pool 5, seen 2, muted 1, rejected 1, swipe-blocked 1, session bad 1, used 2, focus Body · English · session, focus-pool 2, free 0, queue 7 idx 7');
  });
  it('ohne Fokus steht none, alles gesehen heißt free 0', () => {
    const s = endStats({ form: 'audio', formAll: all, formPool: all, focused: all, seen: Object.fromEntries(all.map((m) => [m.id, 1])), muted: {}, rejected: undefined, badVideos: new Set(), used: new Set(), focus: null, queue: 3, idx: 3 });
    expect(endDiagLine(s)).toBe('end: audio pool 5, seen 5, muted 0, rejected 0, swipe-blocked 0, session bad 0, used 0, focus none, focus-pool 5, free 0, queue 3 idx 3');
  });
  it('mix: null nennt Pool und freie Momente', () => {
    expect(mixNullLine(12, 3)).toBe('mix: null (pool 12, free 3)');
  });
});

describe('Fokus Sitzung endet mit pagehide: Abonnenten erfahren es', () => {
  const g = globalThis as { window?: unknown };
  const had = 'window' in g;
  afterEach(() => {
    if (!had) delete g.window;
  });
  it('notify nur, wenn wirklich ein Sitzungs-Fokus gelöscht wurde', () => {
    const w = new EventTarget();
    g.window = w;
    let n = 0;
    w.addEventListener(FOCUS_EVENT, () => n++);
    const s = memory();
    expect(endSessionFocus(s)).toBe(false);
    expect(n).toBe(0);
    writeFocus({ areas: ['beat'], langs: [], until: 'session', dur: 'session' }, s);
    expect(n).toBe(1);
    expect(endSessionFocus(s)).toBe(true);
    expect(s.getItem(FOCUS_KEY)).toBeNull();
    expect(n).toBe(2);
    writeFocus({ areas: ['beat'], langs: [], until: NOW + 99_999, dur: 'today' }, s);
    expect(endSessionFocus(s)).toBe(false);
    expect(n).toBe(3);
  });
});
