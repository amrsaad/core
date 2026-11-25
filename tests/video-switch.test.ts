import { describe, expect, it } from 'vitest';
import { DEADLINE_MS, hlsBehindYt, neighborCall, SWITCH_MS, switchCall, type ActiveObs, type NeighborObs } from '../src/moments/neighborGate';
import { ambientPeak, AMBIENT_MAX } from '../src/lib/ambientCap';

const act = (o: Partial<ActiveObs> = {}): ActiveObs => ({ playedBefore: false, playing: false, playingMs: 0, waitingMs: 0, rs: 0, ahead: 0, userPaused: false, sinceMs: 0, ...o });
const nb = (o: Partial<NeighborObs> = {}): NeighborObs => ({ rank: 1, started: false, canplay: false, prevCanplay: true, prevStartedMs: 0, ...o });

describe('Runde 41: Video wartet nicht auf nie startende Momente (switchCall)', () => {
  const base = { waitedMs: SWITCH_MS, playedBefore: false, userPaused: false, ready1: true, ready2: false };
  it('nach 3 s ohne Bild und bereitem nächsten Moment: wechseln auf next+1', () => {
    expect(switchCall(base)).toEqual({ call: 'go', offset: 1 });
  });
  it('unter 3 s nichts', () => {
    expect(switchCall({ ...base, waitedMs: SWITCH_MS - 1 })).toEqual({ call: 'none' });
  });
  it('der nächste hat Vorrang, ist nur der übernächste bereit, geht es auf next+2', () => {
    expect(switchCall({ ...base, ready1: true, ready2: true })).toEqual({ call: 'go', offset: 1 });
    expect(switchCall({ ...base, ready1: false, ready2: true })).toEqual({ call: 'go', offset: 2 });
  });
  it('kein Nachbar bereit: Meldung, kein Wechsel', () => {
    expect(switchCall({ ...base, ready1: false })).toEqual({ call: 'no-ready' });
  });
  it('ein Moment, der schon gespielt hat (Stockung mitten im Spiel), und ein vom Nutzer angehaltener bleiben stehen', () => {
    expect(switchCall({ ...base, playedBefore: true })).toEqual({ call: 'none' });
    expect(switchCall({ ...base, userPaused: true })).toEqual({ call: 'none' });
  });
  it('Schalter aus: nie ein Wechsel', () => {
    expect(switchCall({ ...base, enabled: false })).toEqual({ call: 'none' });
  });
  it('die Grenze ist die Messgröße des Nutzers: 3 s', () => {
    expect(SWITCH_MS).toBe(3000);
  });
});

describe('Runde 41: Vorladen nach 3 s statt 6 s, auch im schwachen Netz', () => {
  it('Frist deadlineMs: der nächste Nachbar lädt bei hängendem aktivem Moment nach 3 s', () => {
    expect(neighborCall(act({ sinceMs: 2999, deadlineMs: SWITCH_MS }), nb())).toEqual({ call: 'defer' });
    expect(neighborCall(act({ sinceMs: 3000, deadlineMs: SWITCH_MS }), nb())).toEqual({ call: 'start', why: 'deadline' });
  });
  it('ohne deadlineMs bleibt alles wie in Runde 40: 6 s, im schwachen Netz keine Frist', () => {
    expect(neighborCall(act({ sinceMs: 3000 }), nb())).toEqual({ call: 'defer' });
    expect(neighborCall(act({ sinceMs: DEADLINE_MS }), nb())).toEqual({ call: 'start', why: 'deadline' });
    expect(neighborCall(act({ sinceMs: 20_000, weak: true }), nb())).toEqual({ call: 'defer' });
  });
  it('schwaches Netz mit Frist: nur der nächste Nachbar (Rang 1), der übernächste wartet weiter', () => {
    expect(neighborCall(act({ sinceMs: 3000, weak: true, deadlineMs: SWITCH_MS }), nb())).toEqual({ call: 'start', why: 'deadline' });
    expect(neighborCall(act({ sinceMs: 9000, weak: true, deadlineMs: SWITCH_MS }), nb({ rank: 2, prevCanplay: true }))).toEqual({ call: 'defer' });
  });
  it('die Frist gilt nur, solange der aktive Moment nie gespielt hat, und nie bei einer Stockung', () => {
    expect(neighborCall(act({ sinceMs: 9000, playedBefore: true, deadlineMs: SWITCH_MS }), nb())).toEqual({ call: 'defer' });
    expect(neighborCall(act({ sinceMs: 9000, playedBefore: true, waitingMs: 800, deadlineMs: SWITCH_MS }), nb({ started: true }))).toEqual({ call: 'pause' });
  });
});

describe('Runde 41: HLS hinter YouTube lädt im schwachen Netz mit (hlsBehindYt)', () => {
  const o = { weak: true, rank: 2 as const, rank1IsYoutube: true, selfIsHls: true };
  it('nur im schwachen Netz, nur Rang 2, nur hinter YouTube, nur für HLS', () => {
    expect(hlsBehindYt(o)).toBe(true);
    expect(hlsBehindYt({ ...o, weak: false })).toBe(false);
    expect(hlsBehindYt({ ...o, rank: 1 })).toBe(false);
    expect(hlsBehindYt({ ...o, rank1IsYoutube: false })).toBe(false);
    expect(hlsBehindYt({ ...o, selfIsHls: false })).toBe(false);
    expect(hlsBehindYt({ ...o, enabled: false })).toBe(false);
  });
  it('als Rang 1 behandelt startet er nach 3 s Hängen des aktiven YouTube-Moments, sonst erst nach 3 s stabilem Spiel', () => {
    expect(neighborCall(act({ sinceMs: 3000, weak: true, deadlineMs: SWITCH_MS }), nb({ rank: 1 }))).toEqual({ call: 'start', why: 'deadline' });
    expect(neighborCall(act({ sinceMs: 1000, weak: true, playing: true, playingMs: 3000, playedBefore: true, deadlineMs: SWITCH_MS }), nb({ rank: 1 }))).toEqual({ call: 'start', why: 'stable' });
  });
});

describe('Runde 41: Ambient kann keinen hellen Schleier mehr ergeben', () => {
  it('ohne Deckelung ergibt ein weißes Bild genau das Grau vom Gerät (89, 91, 94)', () => {
    expect([10, 14, 18].map((c) => ambientPeak(c, 0.32, 255))).toEqual([88, 91, 94]);
  });
  it('mit Deckelung bleibt die hellste mögliche Stelle unter 45 je Kanal', () => {
    const peak = [10, 14, 18].map((c) => ambientPeak(c));
    expect(Math.max(...peak)).toBeLessThan(45);
    expect(AMBIENT_MAX).toBe(96);
  });
});
