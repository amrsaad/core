import { describe, expect, it } from 'vitest';
import { needsLoad } from '../src/moments/slotplan';
import { skipPlay, PLAY_INFLIGHT_MS } from '../src/video/playguard';

describe('Slot lädt nach einem erneuten Plan nicht neu (Issue 56)', () => {
  const m = { id: 'a:1', start: 2047.5 };
  it('gleicher Moment, gleiche Startzeit: kein zweites load', () => {
    expect(needsLoad({ mid: 'a:1', loadStart: 2047.5 }, m)).toBe(false);
  });
  it('anderer Moment oder andere Startzeit oder leerer Slot: load', () => {
    expect(needsLoad({ mid: 'b:2', loadStart: 2047.5 }, m)).toBe(true);
    expect(needsLoad({ mid: 'a:1', loadStart: 0 }, m)).toBe(true);
    expect(needsLoad({ mid: '', loadStart: -1 }, m)).toBe(true);
  });
});

describe('play pro Geste genau einmal (Issue 56)', () => {
  it('erster Anstoß startet, die Anstöße von loadedmetadata und canplay binnen 1,5 s nicht', () => {
    let inflight = 0;
    const tries: string[] = [];
    for (const [t, why] of [[1000, 'playVideo'], [1200, 'loadedmetadata'], [1700, 'canplay']] as const) {
      if (!skipPlay({ paused: true, inflightAt: inflight }, t, why)) {
        tries.push(why);
        inflight = t;
      }
    }
    expect(tries).toEqual(['playVideo']);
  });
  it('spielt das Medium schon, kein weiterer Anstoß', () => {
    expect(skipPlay({ paused: false, inflightAt: 0 }, 5000, 'canplay')).toBe(true);
  });
  it('nach der Frist und bei muted-retry wird neu versucht', () => {
    expect(skipPlay({ paused: true, inflightAt: 1000 }, 1000 + PLAY_INFLIGHT_MS + 1, 'canplay')).toBe(false);
    expect(skipPlay({ paused: true, inflightAt: 1000 }, 1100, 'muted-retry')).toBe(false);
  });
});
