// Issue 58: Audio-Kaltstart mit spätem Startpunkt (Host pscrb.fm, Startpunkt 1819 s). Genau ein play() je Start, kein Sprung vor den Metadaten,
// ein neuer Anstoß erst, wenn Metadaten da sind und die Frist um ist. Der Nachbau des Elements bleibt bei readyState 0, bis der Test Metadaten meldet.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, skipKick, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

class Cold implements DeckEl {
  src = '';
  paused = true;
  ended = false;
  readyState = 0;
  duration = 3600;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  plays = 0;
  /** Zeitpunkte, zu denen die Position gesetzt wurde */
  sets: { t: number; rs: number }[] = [];
  private on = new Map<string, (() => void)[]>();
  _t = 0;
  get currentTime() {
    return this._t;
  }
  set currentTime(v: number) {
    this._t = v;
    this.sets.push({ t: v, rs: this.readyState });
  }
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.plays++;
    this.paused = false;
    // Der Host liefert noch nichts: das Versprechen steht aus
    return new Promise<void>(() => {});
  }
  pause() {
    this.paused = true;
  }
  load() {
    this._t = 0;
    this.readyState = 0;
  }
  removeAttribute() {}
}
const clip: DeckClip = { key: 'pod-x|1819.22|1860', id: 'pod-x:1819.22', url: 'https://pscrb.fm/e/x.mp3', start: 1819.22, end: 1860 };

function setup() {
  const els: Cold[] = [];
  const deck = new AudioDeck({
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new Cold();
      els.push(e);
      return e;
    },
    hidden: () => false,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, sink, lines, els };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('skipKick', () => {
  it('neuer Ausschnitt (start, swap) nie, ohne offenes play() nie', () => {
    expect(skipKick({ inflightAt: 1000, readyState: 0 }, 1100, 'start')).toBe(false);
    expect(skipKick({ inflightAt: 1000, readyState: 0 }, 1100, 'swap')).toBe(false);
    expect(skipKick({ inflightAt: 0, readyState: 0 }, 1100, 'play')).toBe(false);
  });
  it('offenes play() ohne Metadaten: jeder weitere Anstoß wartet, wie lange es auch dauert', () => {
    expect(skipKick({ inflightAt: 1000, readyState: 0 }, 1100, 'play')).toBe(true);
    expect(skipKick({ inflightAt: 1000, readyState: 0 }, 9000, 'canplay')).toBe(true);
  });
  it('mit Metadaten: nach 1,5 s ist ein neuer Anstoß erlaubt, vorher nicht', () => {
    expect(skipKick({ inflightAt: 1000, readyState: 1 }, 1400, 'canplay')).toBe(true);
    expect(skipKick({ inflightAt: 1000, readyState: 1 }, 2600, 'canplay')).toBe(false);
  });
});

describe('Kaltstart mit spätem Startpunkt (Issue 58, Ziel 4)', () => {
  it('drei weitere play-Aufrufe binnen 2 s (soundGuard, Feed) lösen kein weiteres play() aus', () => {
    const { deck, sink, lines } = setup();
    deck.load(clip, sink, { play: true, muted: false });
    const el = deck.element as Cold;
    expect(el.plays).toBe(1);
    deck.play(sink);
    vi.advanceTimersByTime(1500);
    deck.play(sink);
    vi.advanceTimersByTime(500);
    deck.play(sink);
    expect(el.plays).toBe(1);
    expect(lines.filter((l) => /^deck play#\d+ start/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /^deck play skipped/.test(l))).toHaveLength(1);
  });
  it('Netzquelle mit Fragment: kein Sprung vor den Metadaten, der Sprung kommt, sobald das Element Metadaten hat', () => {
    const { deck, sink, els } = setup();
    deck.load(clip, sink, { play: true, muted: false });
    const el = deck.element as Cold;
    expect(el.src.endsWith('#t=1819.22')).toBe(true);
    expect(el.sets).toEqual([]);
    el.readyState = 1;
    el.emit('loadedmetadata');
    expect(el.sets).toEqual([{ t: 1819.22, rs: 1 }]);
    expect(els.length).toBeGreaterThan(0);
  });
  it('nach den Metadaten und 1,5 s gilt ein neuer Anstoß wieder (canplay-Nachstoß für ein still verworfenes play())', () => {
    const { deck, sink } = setup();
    deck.load(clip, sink, { play: true, muted: false });
    const el = deck.element as Cold;
    el.readyState = 1;
    el.emit('loadedmetadata');
    vi.advanceTimersByTime(1600);
    deck.play(sink);
    expect(el.plays).toBe(2);
  });
  it('ein neuer Ausschnitt startet immer, auch wenn das play() des alten noch aussteht', () => {
    const { deck, sink } = setup();
    deck.load(clip, sink, { play: true, muted: false });
    const el = deck.element as Cold;
    deck.load({ ...clip, key: 'pod-y|10|60', id: 'pod-y:10', url: 'https://pscrb.fm/e/y.mp3', start: 10, end: 60 }, sink, { play: true, muted: false });
    expect(el.plays).toBe(2);
  });
});

describe('Rolle für die Zeile media (Issue 59, Ziel 5)', () => {
  it('Deck-Element ohne Vorrat: deck, fremdes Element: null', () => {
    const { deck, sink } = setup();
    deck.load(clip, sink, { play: true, muted: false });
    expect(deck.roleOf(deck.element)).toBe('deck');
    expect(deck.roleOf({})).toBeNull();
  });
});
