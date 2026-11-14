// Runde 15: Vorrang für den aktiven Stream-Moment. Wann darf welcher Nachbar laden, wann wird angehalten, Frist, Erholung, kein doppeltes Laden.
import { describe, expect, it } from 'vitest';
import { aheadOf, DEADLINE_MS, isStable, isStalled, neighborCall, recoverCall, skipsReload, type ActiveObs, type NeighborObs } from '../src/moments/neighborGate';

const act = (o: Partial<ActiveObs> = {}): ActiveObs => ({ playedBefore: false, playing: false, playingMs: 0, waitingMs: 0, rs: 0, ahead: 0, userPaused: false, sinceMs: 0, ...o });
const nb = (o: Partial<NeighborObs> = {}): NeighborObs => ({ rank: 1, started: false, canplay: false, prevCanplay: true, prevStartedMs: 0, ...o });

describe('isStable', () => {
  it('spielt seit 2 s ohne waiting', () => {
    expect(isStable(act({ playing: true, playingMs: 2000 }))).toBe(true);
    expect(isStable(act({ playing: true, playingMs: 1999 }))).toBe(false);
    expect(isStable(act({ playing: true, playingMs: 5000, waitingMs: 10 }))).toBe(false);
  });
  it('readyState 4 mit mindestens 8 s Puffer', () => {
    expect(isStable(act({ rs: 4, ahead: 8 }))).toBe(true);
    expect(isStable(act({ rs: 4, ahead: 7.9 }))).toBe(false);
    expect(isStable(act({ rs: 3, ahead: 30 }))).toBe(false);
  });
});

describe('neighborCall', () => {
  it('Ablauf aus der Diagnose: aktiver Moment startet mit rs=3, kein Nachbar lädt, bis er stabil ist', () => {
    // 16:22:29.2 canplay rs=3, play ok, Stockungen nach 0,1 s
    const steps: ActiveObs[] = [
      act({ sinceMs: 0 }),
      act({ sinceMs: 2000, rs: 3, playing: true, playingMs: 50, playedBefore: true, ahead: 1.2 }),
      act({ sinceMs: 2100, rs: 2, waitingMs: 80, playedBefore: true, ahead: 0.1 }),
      act({ sinceMs: 4000, rs: 3, playing: true, playingMs: 900, playedBefore: true, ahead: 2 }),
      act({ sinceMs: 4800, rs: 1, waitingMs: 4000, playedBefore: true, ahead: 0 }),
    ];
    for (const a of steps) {
      expect(neighborCall(a, nb({ rank: 1 })).call).toBe('defer');
      expect(neighborCall(a, nb({ rank: 2, prevCanplay: false }))).toEqual({ call: 'defer' });
    }
    // erst wenn er 2 s ohne waiting spielt
    expect(neighborCall(act({ playedBefore: true, playing: true, playingMs: 2000, rs: 4, ahead: 3 }), nb({ rank: 1 }))).toEqual({ call: 'start', why: 'stable' });
  });
  it('einer nach dem anderen: der übernächste erst nach canplay des nächsten', () => {
    const stable = act({ playedBefore: true, playing: true, playingMs: 3000 });
    expect(neighborCall(stable, nb({ rank: 2, prevCanplay: false, prevStartedMs: 1000 }))).toEqual({ call: 'defer' });
    expect(neighborCall(stable, nb({ rank: 2, prevCanplay: true }))).toEqual({ call: 'start', why: 'stable' });
  });
  it('Stockung hält ladende Nachbarn an, wartende bleiben wartend', () => {
    const stalled = act({ playedBefore: true, waitingMs: 301 });
    expect(isStalled(stalled)).toBe(true);
    expect(neighborCall(stalled, nb({ started: true }))).toEqual({ call: 'pause' });
    expect(neighborCall(stalled, nb({ started: false }))).toEqual({ call: 'defer' });
    // 300 ms genau sind noch keine Stockung
    expect(neighborCall(act({ playedBefore: true, waitingMs: 300 }), nb({ started: true }))).toEqual({ call: 'keep' });
  });
  it('ein fertiger Nachbar bleibt, auch bei Stockung', () => {
    expect(neighborCall(act({ playedBefore: true, waitingMs: 5000 }), nb({ canplay: true }))).toEqual({ call: 'keep' });
  });
  it('nach der Stockung lädt der Nachbar wieder, sobald der aktive Moment stabil ist (keine Frist dazwischen)', () => {
    const resumed = act({ playedBefore: true, playing: true, playingMs: 500, sinceMs: 30_000 });
    expect(neighborCall(resumed, nb())).toEqual({ call: 'defer' });
    expect(neighborCall({ ...resumed, playingMs: 2500 }, nb())).toEqual({ call: 'start', why: 'stable' });
  });
  it('Frist: hängt der aktive Moment ohne ersten Start, darf der nächste nach 6 s laden (slow 3g)', () => {
    expect(neighborCall(act({ sinceMs: DEADLINE_MS - 1, waitingMs: 5000 }), nb())).toEqual({ call: 'defer' });
    expect(neighborCall(act({ sinceMs: DEADLINE_MS, waitingMs: 6000 }), nb())).toEqual({ call: 'start', why: 'deadline' });
    // der übernächste wartet auch dann auf den nächsten, oder 6 s nach dessen Start
    expect(neighborCall(act({ sinceMs: 7000 }), nb({ rank: 2, prevCanplay: false, prevStartedMs: 2000 }))).toEqual({ call: 'defer' });
    expect(neighborCall(act({ sinceMs: 13_000 }), nb({ rank: 2, prevCanplay: false, prevStartedMs: DEADLINE_MS }))).toEqual({ call: 'start', why: 'deadline' });
  });
  it('vom Nutzer angehalten: keine Konkurrenz, Nachbarn laden', () => {
    expect(neighborCall(act({ userPaused: true, playedBefore: true }), nb())).toEqual({ call: 'start', why: 'paused' });
  });
  it('ein ladender Nachbar läuft weiter, wenn der aktive Moment kurz unter 300 ms wartet', () => {
    expect(neighborCall(act({ playedBefore: true, waitingMs: 100 }), nb({ started: true }))).toEqual({ call: 'keep' });
  });
});

describe('aheadOf', () => {
  it('Puffer vor der Position', () => {
    expect(aheadOf([[0, 4], [10, 30]], 12)).toBe(18);
    expect(aheadOf([[0, 4]], 6)).toBe(0);
    expect(aheadOf([], 0)).toBe(0);
  });
});

describe('recoverCall', () => {
  const base = { playedBefore: true, waitingMs: 3001, paused: false, done: 0, sinceLastMs: Infinity, userPaused: false };
  it('erst nach mehr als 3 s waiting', () => {
    expect(recoverCall({ ...base, waitingMs: 3000 })).toEqual({ call: 'none' });
    expect(recoverCall(base)).toEqual({ call: 'nudge' });
  });
  it('pausiertes Element: play, sonst nudge', () => {
    expect(recoverCall({ ...base, paused: true })).toEqual({ call: 'play' });
  });
  it('höchstens zweimal, Abstand mindestens 3 s', () => {
    expect(recoverCall({ ...base, done: 1, sinceLastMs: 2000 })).toEqual({ call: 'none' });
    expect(recoverCall({ ...base, done: 1, sinceLastMs: 3000 })).toEqual({ call: 'nudge' });
    expect(recoverCall({ ...base, done: 2, sinceLastMs: 9000 })).toEqual({ call: 'none' });
  });
  it('nie vor dem ersten Spielen und nie bei Nutzerpause', () => {
    expect(recoverCall({ ...base, playedBefore: false })).toEqual({ call: 'none' });
    expect(recoverCall({ ...base, userPaused: true })).toEqual({ call: 'none' });
  });
});

describe('skipsReload', () => {
  const m = { id: 'ted1', start: 871.4, end: 900 };
  const ok = { sameEl: true, sameSrc: true, play: false, wantPlay: false, rs: 4 };
  it('geladener Nachbar mit gleichem Moment wird nicht erneut geladen', () => {
    expect(skipsReload(m, m, ok)).toBe(true);
  });
  it('anderer Ausschnitt, anderes Element, Abspielwunsch oder fehlende Metadaten laden neu', () => {
    expect(skipsReload(m, { ...m, start: 5 }, ok)).toBe(false);
    expect(skipsReload(m, m, { ...ok, sameEl: false })).toBe(false);
    expect(skipsReload(m, m, { ...ok, sameSrc: false })).toBe(false);
    expect(skipsReload(m, m, { ...ok, play: true })).toBe(false);
    expect(skipsReload(m, m, { ...ok, wantPlay: true })).toBe(false);
    expect(skipsReload(m, m, { ...ok, rs: 0 })).toBe(false);
    expect(skipsReload(null, m, ok)).toBe(false);
  });
});
