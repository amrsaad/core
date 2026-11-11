import { describe, expect, it } from 'vitest';
import { abortAction, describeMedia, holdsNeighbor, hostOfSrc, needsLoad } from '../src/moments/slotplan';
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

describe('Vorlade-Gate (Issue 54, Ziel 2)', () => {
  it('YouTube neben YouTube wartet, auf iOS (nur cue) nicht, ein Stream wartet nie', () => {
    expect(holdsNeighbor({ yt: true }, { yt: true }, false)).toBe(true);
    expect(holdsNeighbor({ yt: true }, { yt: true }, true)).toBe(false);
    expect(holdsNeighbor({ yt: true }, { yt: false }, false)).toBe(false);
    expect(holdsNeighbor({ yt: false }, { yt: true }, false)).toBe(false);
  });
});

describe('AbortError (Issue 59, Ziel 3)', () => {
  const base = { wantPlay: true, current: true, paused: true, retries: 0 };
  it('Feed will spielen, Element steht, noch kein Wiederholungsstart: retry', () => {
    expect(abortAction(base)).toBe('retry');
  });
  it('eigenes Anhalten, anderes Element, spielt schon oder schon einmal wiederholt: ignore', () => {
    expect(abortAction({ ...base, wantPlay: false })).toBe('ignore');
    expect(abortAction({ ...base, current: false })).toBe('ignore');
    expect(abortAction({ ...base, paused: false })).toBe('ignore');
    expect(abortAction({ ...base, retries: 1 })).toBe('ignore');
  });
});

describe('Diag-Zeile media (Issue 59, Ziel 5)', () => {
  it('Host statt URL, data und blob als Art', () => {
    expect(hostOfSrc('https://pscrb.fm/rss/p/x.mp3?k=secret')).toBe('pscrb.fm');
    expect(hostOfSrc('data:audio/wav;base64,AAAA')).toBe('data');
    expect(hostOfSrc('blob:https://app.test/1-2')).toBe('blob');
    expect(hostOfSrc('/core/a.mp3')).toBe('relative');
  });
  it('acht Elemente: Zahl, Grenze und je Element Tag, Besitzer, Host', () => {
    const items = [
      ...[0, 1, 2].map((i) => ({ tag: 'VIDEO', owner: `slot${i}`, src: `https://stream.test/${i}.m3u8` })),
      ...[0, 1, 2, 3, 4].map((i) => ({ tag: 'AUDIO', owner: i === 0 ? 'deck' : 'pool', src: i < 3 ? 'data:audio/wav;base64,AA' : 'https://pscrb.fm/x.mp3' })),
    ];
    const line = describeMedia(items, 6);
    expect(line.startsWith('media: 8 elements with src (limit 6): ')).toBe(true);
    expect(line).toContain('video slot0 stream.test');
    expect(line).toContain('audio deck data');
    expect(line).toContain('audio pool pscrb.fm');
    expect(line.includes('https://')).toBe(false);
  });
});
