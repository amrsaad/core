// Runde 19 (Diag 16.11., Mobilfunk): Video im schwachen Netz. Merker, ein Nachbar, erst nach 3 s stabilem Spiel, früher gestaffelter Wiederholungsstart bei YouTube.
import { describe, expect, it } from 'vitest';
import { isWeakNet, isWeakStable, neighborBudget, neighborCall, slowStart, startWatchCall, weakUntil, START_GIVEUP_MS, START_RETRY_FIRST_MS, START_RETRY_NEXT_MS, SLOW_START_MS, WEAK_STABLE_MS, WEAK_VIDEO_MS, type ActiveObs, type NeighborObs } from '../src/moments/neighborGate';

const act = (o: Partial<ActiveObs> = {}): ActiveObs => ({ playedBefore: true, playing: false, playingMs: 0, waitingMs: 0, rs: 0, ahead: 0, userPaused: false, sinceMs: 0, weak: true, ...o });
const nb = (o: Partial<NeighborObs> = {}): NeighborObs => ({ rank: 1, started: false, canplay: false, prevCanplay: true, prevStartedMs: 0, ...o });

describe('Merker schwaches Netz', () => {
  it('Wisch bis playing über 3 s ist ein Anlass, genau 3 s nicht', () => {
    expect(slowStart(SLOW_START_MS)).toBe(false);
    expect(slowStart(SLOW_START_MS + 1)).toBe(true);
    expect(slowStart(7294)).toBe(true);
    expect(slowStart(65)).toBe(false);
  });
  it('gilt 5 Minuten, danach nicht mehr', () => {
    const until = weakUntil(1000);
    expect(until - 1000).toBe(WEAK_VIDEO_MS);
    expect(WEAK_VIDEO_MS).toBe(300_000);
    expect(isWeakNet({ until, now: 1000 + WEAK_VIDEO_MS - 1, deckWeak: false })).toBe(true);
    expect(isWeakNet({ until, now: 1000 + WEAK_VIDEO_MS, deckWeak: false })).toBe(false);
    expect(isWeakNet({ until: 0, now: 5000, deckWeak: false })).toBe(false);
  });
  it('der Merker des Audio-Decks zählt mit', () => {
    expect(isWeakNet({ until: 0, now: 5000, deckWeak: true })).toBe(true);
  });
  it('Budget: schwach ein Nachbar, sonst zwei', () => {
    expect(neighborBudget(true)).toBe(1);
    expect(neighborBudget(false)).toBe(2);
  });
});

describe('neighborCall im schwachen Netz', () => {
  it('der nächste Nachbar wartet, bis der aktive 3 s am Stück stabil spielt', () => {
    expect(neighborCall(act({ playing: true, playingMs: WEAK_STABLE_MS - 1 }), nb())).toEqual({ call: 'defer' });
    expect(neighborCall(act({ playing: true, playingMs: WEAK_STABLE_MS }), nb())).toEqual({ call: 'start', why: 'stable' });
  });
  it('der Puffer-Kurzschluss (rs 4, 8 s voraus) gilt im schwachen Netz nicht', () => {
    expect(neighborCall(act({ rs: 4, ahead: 20 }), nb())).toEqual({ call: 'defer' });
    // im guten Netz startet derselbe Fall sofort
    expect(neighborCall(act({ rs: 4, ahead: 20, weak: false }), nb())).toEqual({ call: 'start', why: 'stable' });
  });
  it('keine Frist: ein aktiver Moment, der nie spielte, hält den Nachbarn auch nach 6 s zurück', () => {
    expect(neighborCall(act({ playedBefore: false, sinceMs: 20_000 }), nb())).toEqual({ call: 'defer' });
    expect(neighborCall(act({ playedBefore: false, sinceMs: 20_000, weak: false }), nb())).toEqual({ call: 'start', why: 'deadline' });
  });
  it('der übernächste lädt nie, auch wenn der nächste fertig ist und der aktive stabil spielt', () => {
    const a = act({ playing: true, playingMs: 9000 });
    expect(neighborCall(a, nb({ rank: 2, prevCanplay: true }))).toEqual({ call: 'defer' });
  });
  it('ein ladender übernächster wird angehalten, ein fertiger bleibt', () => {
    const a = act({ playing: true, playingMs: 9000 });
    expect(neighborCall(a, nb({ rank: 2, started: true }))).toEqual({ call: 'pause' });
    expect(neighborCall(a, nb({ rank: 2, started: true, canplay: true }))).toEqual({ call: 'keep' });
  });
  it('Nutzer hat angehalten: der nächste lädt trotzdem (keine Konkurrenz um die Leitung)', () => {
    expect(neighborCall(act({ userPaused: true }), nb())).toEqual({ call: 'start', why: 'paused' });
  });
  it('Stockung hält den ladenden Nachbarn an, unter 300 ms zählt nicht (stall after 0s)', () => {
    expect(neighborCall(act({ playing: false, waitingMs: 301 }), nb({ started: true }))).toEqual({ call: 'pause' });
    expect(neighborCall(act({ playing: true, playingMs: 4000, waitingMs: 0 }), nb({ started: true }))).toEqual({ call: 'keep' });
    expect(neighborCall(act({ playing: false, waitingMs: 299 }), nb({ started: true }))).toEqual({ call: 'keep' });
  });
  it('ein schon ladender nächster bleibt, wenn der Merker erst danach gesetzt wird', () => {
    expect(neighborCall(act({ playing: true, playingMs: 100 }), nb({ started: true }))).toEqual({ call: 'keep' });
  });
  it('isWeakStable: waiting setzt zurück', () => {
    expect(isWeakStable({ playing: true, playingMs: 5000, waitingMs: 10 })).toBe(false);
    expect(isWeakStable({ playing: false, playingMs: 5000, waitingMs: 0 })).toBe(false);
  });
  it('Merker nicht gesetzt: Verhalten wie Runde 15 (isStable nach 2 s, zwei Nachbarn)', () => {
    const a = act({ weak: undefined, playing: true, playingMs: 2000 });
    expect(neighborCall(a, nb())).toEqual({ call: 'start', why: 'stable' });
    expect(neighborCall(a, nb({ rank: 2, prevCanplay: true }))).toEqual({ call: 'start', why: 'stable' });
  });
});

describe('startWatchCall (YouTube, Start in der Geste)', () => {
  const call = (st: number, tries: number, sinceCmdMs: number, sinceTryMs = 0) => startWatchCall({ st, tries, sinceCmdMs, sinceTryMs });
  it('vor 800 ms wartet er, genau auf den Versuch', () => {
    expect(call(-1, 0, 100)).toEqual({ call: 'wait', waitMs: START_RETRY_FIRST_MS - 100 });
    expect(call(-1, 0, 799)).toEqual({ call: 'wait', waitMs: 1 });
  });
  it('nach 800 ms in -1, 5 oder 2: sofort erneut playVideo (Versuch 1)', () => {
    for (const st of [-1, 5, 2]) expect(call(st, 0, 800)).toEqual({ call: 'retry', try: 1 });
  });
  it('Zustand 3 (puffert) bekommt nie einen Versuch, er wird weiter beobachtet', () => {
    expect(call(3, 0, 800)).toEqual({ call: 'wait', waitMs: 250 });
    expect(call(3, 0, 2500)).toEqual({ call: 'wait', waitMs: 250 });
    expect(call(3, 1, 4000, 3000)).toEqual({ call: 'wait', waitMs: 250 });
  });
  it('Zustand 1 bekommt keinen Versuch', () => {
    expect(call(1, 0, 900).call).toBe('wait');
  });
  it('Ablauf aus der Diag: 3, -1, dann Versuch 1 bei 800 ms, Versuch 2 nach weiteren 2000 ms', () => {
    expect(call(-1, 0, 460)).toEqual({ call: 'wait', waitMs: 340 });
    expect(call(-1, 0, 800)).toEqual({ call: 'retry', try: 1 });
    expect(call(-1, 1, 1500, 700)).toEqual({ call: 'wait', waitMs: START_RETRY_NEXT_MS - 700 });
    expect(call(-1, 1, 2800, 2000)).toEqual({ call: 'retry', try: 2 });
  });
  it('ein Versuch, der an Zustand 3 scheiterte, kommt, sobald der Player wieder -1 meldet', () => {
    expect(call(3, 0, 1200).call).toBe('wait');
    expect(call(-1, 0, 1450)).toEqual({ call: 'retry', try: 1 });
  });
  it('nach zwei Versuchen kommt nur noch die Tippfläche, nach 6 s', () => {
    expect(call(-1, 2, 3000, 200)).toEqual({ call: 'wait', waitMs: START_GIVEUP_MS - 3000 });
    expect(call(-1, 2, START_GIVEUP_MS - 1, 3000)).toEqual({ call: 'wait', waitMs: 1 });
    expect(call(-1, 2, START_GIVEUP_MS, 3000)).toEqual({ call: 'tap' });
  });
  it('die Tippfläche kommt auch im Zustand 3 nach 6 s (wie bisher)', () => {
    expect(call(3, 0, START_GIVEUP_MS)).toEqual({ call: 'tap' });
  });
  it('höchstens zwei Versuche', () => {
    expect(call(-1, 2, 5000, 5000).call).toBe('wait');
  });
});
