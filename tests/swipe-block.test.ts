// Brief 24, Ergänzung 45: zweimal weggewischt ohne Wiedergabe sperrt den Moment 30 Tage. Zähler und Sperre wandern per Sync.
import { describe, expect, it } from 'vitest';
import { blockedIds, clearSwipe, dropBlocked, emptyState, swipeAway, swipeBlocked, SWIPE_BLOCK_MS, type AppState, type Swipe } from '../src/lib/state';
import { applyDoc, canon, emptyDoc, mergeDocs, mergeSwipes, pickSwipe, syncedChanged, toDoc, type SyncDoc, type SyncState } from '../src/lib/sync/merge';
import { unseenCount } from '../src/moments/form';
import type { Moment } from '../src/moments/types';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const mom = (id: string, o: Partial<Moment> = {}): Moment => ({ id, videoId: 'v' + id, start: 10, end: 60, channel: 'c' + id, videoTitle: 'T', area: 'brain', topic: 't' + id, hook: 'H' + id, kind: 'story', createdAt: '', form: 'video', ...o });
const doc = (state: Partial<SyncState>): SyncDoc => {
  const d = emptyDoc();
  return { ...d, state: { ...d.state, ...state } };
};

describe('Schritt 1: Zählung und Sperre', () => {
  it('das erste Wegwischen zählt nur (n = 1), keine Sperre', () => {
    const r = swipeAway(emptyState(), 'a', T0);
    expect(r).toMatchObject({ blocked: false, n: 1 });
    expect(r.state.momentSwipes).toEqual({ a: { n: 1, at: T0 } });
    expect(swipeBlocked(r.state.momentSwipes!.a, T0)).toBe(false);
  });
  it('das zweite Wegwischen sperrt 30 Tage', () => {
    const r1 = swipeAway(emptyState(), 'a', T0);
    const r2 = swipeAway(r1.state, 'a', T0 + DAY);
    expect(r2).toMatchObject({ blocked: true, n: 2 });
    expect(r2.state.momentSwipes!.a).toEqual({ n: 2, at: T0 + DAY, until: T0 + DAY + SWIPE_BLOCK_MS });
    expect(SWIPE_BLOCK_MS).toBe(30 * DAY);
    expect(swipeBlocked(r2.state.momentSwipes!.a, T0 + DAY)).toBe(true);
    expect(swipeBlocked(r2.state.momentSwipes!.a, T0 + DAY + SWIPE_BLOCK_MS - 1)).toBe(true);
    expect(swipeBlocked(r2.state.momentSwipes!.a, T0 + DAY + SWIPE_BLOCK_MS)).toBe(false);
  });
  it('nach Ablauf der Sperre kommt der Moment wieder, n beginnt bei 0: das nächste Wegwischen ist wieder das erste', () => {
    const r2 = swipeAway(swipeAway(emptyState(), 'a', T0).state, 'a', T0 + DAY);
    const later = T0 + DAY + SWIPE_BLOCK_MS + 1;
    expect(blockedIds(r2.state.momentSwipes, later)).toEqual([]);
    const r3 = swipeAway(r2.state, 'a', later);
    expect(r3).toMatchObject({ blocked: false, n: 1 });
    expect(r3.state.momentSwipes!.a).toEqual({ n: 1, at: later });
  });
  it('abgelaufene Sperren anderer Momente fallen beim Schreiben weg, laufende bleiben', () => {
    let s: AppState = { ...emptyState(), momentSwipes: { old: { n: 2, at: T0 - 40 * DAY, until: T0 - 10 * DAY }, live: { n: 2, at: T0 - DAY, until: T0 + 29 * DAY }, once: { n: 1, at: T0 - 100 * DAY } } };
    s = swipeAway(s, 'b', T0).state;
    expect(Object.keys(s.momentSwipes!).sort()).toEqual(['b', 'live', 'once']);
  });
  it('ein gesperrter Moment bekommt kein weiteres Wegwischen angerechnet', () => {
    const r2 = swipeAway(swipeAway(emptyState(), 'a', T0).state, 'a', T0 + 1);
    const r3 = swipeAway(r2.state, 'a', T0 + 2);
    expect(r3.state).toBe(r2.state);
    expect(r3.blocked).toBe(false);
  });
  it('gespielt (watched über 0): der Eintrag ist weg, ohne Eintrag bleibt der Zustand derselbe', () => {
    const s = swipeAway(emptyState(), 'a', T0).state;
    const c = clearSwipe(s, 'a');
    expect(c.momentSwipes).toEqual({});
    expect(clearSwipe(c, 'a')).toBe(c);
    expect(clearSwipe(emptyState(), 'a').momentSwipes).toBeUndefined();
  });
});

describe('Schritt 2: Reihenfolge und Endseite', () => {
  const pool = [mom('a'), mom('b', { form: 'audio', audio: true }), mom('c', { form: 'audio', audio: true }), mom('d', { form: 'text' })];
  it('gesperrte Momente fehlen im Pool, ohne Sperre bleibt das Array dasselbe', () => {
    expect(dropBlocked(pool, undefined, T0)).toBe(pool);
    expect(dropBlocked(pool, { a: { n: 1, at: T0 } }, T0)).toBe(pool);
    const sw: Record<string, Swipe> = { b: { n: 2, at: T0, until: T0 + SWIPE_BLOCK_MS }, a: { n: 2, at: T0 - 31 * DAY, until: T0 - DAY } };
    expect(dropBlocked(pool, sw, T0).map((m) => m.id)).toEqual(['a', 'c', 'd']);
    expect(blockedIds(sw, T0)).toEqual(['b']);
  });
  it('die Endseite zählt den gesperrten Moment nicht als neu ("Audio, 1 new" statt 2)', () => {
    const sw: Record<string, Swipe> = { b: { n: 2, at: T0, until: T0 + SWIPE_BLOCK_MS } };
    expect(unseenCount(pool, 'audio', {}, {})).toBe(2);
    expect(unseenCount(dropBlocked(pool, sw, T0), 'audio', {}, {})).toBe(1);
    // nach Ablauf zählt er wieder
    expect(unseenCount(dropBlocked(pool, sw, T0 + SWIPE_BLOCK_MS), 'audio', {}, {})).toBe(2);
  });
});

describe('Schritt 3: Sync, Wegwischer sind Ereignisse, keine Zähler zweier Geräte', () => {
  it('zwei Geräte mit je einem Wegwischen ergeben n = 1, nicht 2 (Maximum, keine Summe)', () => {
    const a = doc({ momentSwipes: { x: { n: 1, at: T0 } } });
    const b = doc({ momentSwipes: { x: { n: 1, at: T0 + 5000 } } });
    const m = mergeDocs(a, b);
    expect(m.state.momentSwipes).toEqual({ x: { n: 1, at: T0 + 5000 } });
    expect(swipeBlocked(m.state.momentSwipes!.x, T0 + 5000)).toBe(false);
  });
  it('Sperre eines Geräts gewinnt gegen den einfachen Zähler des anderen, die spätere Sperre gewinnt', () => {
    const a = doc({ momentSwipes: { x: { n: 2, at: T0 + DAY, until: T0 + DAY + SWIPE_BLOCK_MS } } });
    const b = doc({ momentSwipes: { x: { n: 1, at: T0 } } });
    expect(mergeDocs(a, b).state.momentSwipes).toEqual({ x: { n: 2, at: T0 + DAY, until: T0 + DAY + SWIPE_BLOCK_MS } });
    const c = doc({ momentSwipes: { x: { n: 2, at: T0 + 2 * DAY, until: T0 + 2 * DAY + SWIPE_BLOCK_MS } } });
    expect(mergeDocs(a, c).state.momentSwipes!.x.until).toBe(T0 + 2 * DAY + SWIPE_BLOCK_MS);
  });
  it('Neuanfang nach Ablauf: ein Wegwischen nach der abgelaufenen Sperre des anderen Geräts beginnt mit n = 1', () => {
    const old: Swipe = { n: 2, at: T0, until: T0 + SWIPE_BLOCK_MS };
    const fresh: Swipe = { n: 1, at: T0 + SWIPE_BLOCK_MS + DAY };
    expect(pickSwipe(old, fresh)).toEqual(fresh);
    expect(pickSwipe(fresh, old)).toEqual(fresh);
    // Gerät A hat den abgelaufenen Eintrag schon weggeräumt, Gerät B hat ihn noch: gleiches Ergebnis
    const a = doc({ momentSwipes: { x: fresh } });
    const b = doc({ momentSwipes: { x: old } });
    expect(mergeDocs(a, b).state.momentSwipes).toEqual({ x: fresh });
  });
  it('vertauschbar, wiederholbar, gruppierbar', () => {
    const p = doc({ momentSwipes: { x: { n: 2, at: 10, until: 100 }, y: { n: 1, at: 5 } } });
    const q = doc({ momentSwipes: { x: { n: 1, at: 150 }, z: { n: 1, at: 1 } } });
    const r = doc({ momentSwipes: { x: { n: 1, at: 50 }, y: { n: 2, at: 7, until: 200 } } });
    expect(canon(mergeDocs(p, q))).toBe(canon(mergeDocs(q, p)));
    const pq = mergeDocs(p, q);
    expect(canon(mergeDocs(pq, pq))).toBe(canon(pq));
    expect(canon(mergeDocs(mergeDocs(p, q), r))).toBe(canon(mergeDocs(p, mergeDocs(q, r))));
    expect(canon(mergeDocs(mergeDocs(p, r), q))).toBe(canon(mergeDocs(p, mergeDocs(q, r))));
    expect(mergeDocs(p, q).state.momentSwipes).toEqual({ x: { n: 1, at: 150 }, y: { n: 1, at: 5 }, z: { n: 1, at: 1 } });
  });
  it('ohne Wegwischer bleibt das Dokument ohne das Feld', () => {
    expect('momentSwipes' in mergeDocs(doc({}), doc({})).state).toBe(false);
    expect(mergeSwipes(undefined, undefined)).toBeUndefined();
    expect('momentSwipes' in toDoc(emptyState()).state).toBe(false);
  });
  it('Zustand und Dokument: hin und zurück, Übernahme vom anderen Gerät, Änderung löst Sync aus', () => {
    const s: AppState = swipeAway(emptyState(), 'x', T0).state;
    const d = toDoc(s);
    expect(d.state.momentSwipes).toEqual({ x: { n: 1, at: T0 } });
    const remote = doc({ momentSwipes: { x: { n: 2, at: T0 + DAY, until: T0 + DAY + SWIPE_BLOCK_MS }, y: { n: 1, at: T0 } } });
    const next = applyDoc(s, mergeDocs(d, remote));
    expect(next.momentSwipes).toEqual(remote.state.momentSwipes);
    expect(applyDoc(next, toDoc(next)).momentSwipes).toBe(next.momentSwipes);
    expect(syncedChanged(s, swipeAway(s, 'y', T0).state)).toBe(true);
    expect(syncedChanged(s, s)).toBe(false);
  });
});
