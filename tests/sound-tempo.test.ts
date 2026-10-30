// Issue 13 Punkt 1: Hinweis "Ton aus" nur aus dem Zustand des Elements, erste Geste im Dokument.
// Issue 11 und 14: Wechsel im Hintergrund, Quelle aus dem Vorrat. Issue 15: Messung für die Untertitel.
// (Tempo, Lautheit und Vorrat nach Zeit: andere Session, Commit 3b6efef, eigene Tests.)
import { describe, expect, it } from 'vitest';
import { AudioDeck, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';
import { hintVisible, reduceSound, SOUND_NONE, type SoundObs } from '../src/moments/soundHint';
import { emitGesture, gestureSeen, onGesture, resetGesturesForTest } from '../src/moments/gesture';

class FakeEl implements DeckEl {
  private _src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 600;
  muted = true;
  volume = 1;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = true;
  calls: string[] = [];
  rateWrites = 0;
  playResult: () => Promise<void> = () => Promise.resolve();
  private on = new Map<string, (() => void)[]>();
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.calls.push(`src:${v}`);
  }
  removeAttribute(n: string) {
    if (n === 'src') this._src = '';
    this.calls.push(`remove:${n}`);
  }
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.calls.push('play');
    this.paused = false;
    this.emit('playing');
    return this.playResult();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit('pause');
  }
  load() {
    this.calls.push('load');
    this.currentTime = 0;
  }
  tick(t: number) {
    this.currentTime = t;
    this.emit('timeupdate');
  }
}

const clip = (id: string, start = 0, end: number | undefined = 60, gain?: number): DeckClip => ({ key: `${id}|${start}|${end ?? ''}`, id, url: `https://pod.test/${id}.mp3`, start, end, gain });

function setup(opts: { local?: Record<string, { url: string; offset: number }>; levelLane?: boolean } = {}) {
  const plain = new FakeEl();
  const level = new FakeEl();
  const made: boolean[] = [];
  const deck = new AudioDeck({
    local: (k) => opts.local?.[k],
    dropLocal: () => {},
    make: (lv) => {
      made.push(lv);
      return lv ? level : plain;
    },
    hidden: () => true,
    ...(opts.levelLane
      ? {
          lane: (c: DeckClip, _l: boolean, force: boolean) => (force || !c.gain ? { lane: 'plain' as const, why: force ? 'fallback' : 'no value' } : { lane: 'level' as const, why: 'cors trial' }),
          chain: (_el: DeckEl, db: number) => ({ linear: () => 10 ** (db / 20) }),
        }
      : {}),
  });
  const states: number[] = [];
  const times: [number, number, boolean][] = [];
  let soundCalls = 0;
  const sink: DeckSink = { state: (s) => states.push(s), error: () => states.push(-1), sound: () => soundCalls++, time: (t, r, p) => times.push([t, r, p]) };
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  return { deck, plain, level, made, sink, states, times, lines, sounds: () => soundCalls };
}

describe('Hinweis Ton aus: Regel', () => {
  const o = (muted: boolean, playing: boolean, refused: boolean): SoundObs => ({ muted, playing, refused });
  it('sichtbar genau dann, wenn das spielende Element stumm ist oder play() abgelehnt wurde', () => {
    expect(hintVisible(o(true, true, false))).toBe(true);
    expect(hintVisible(o(false, true, false))).toBe(false);
    expect(hintVisible(o(true, false, false))).toBe(false);
    expect(hintVisible(o(false, false, true))).toBe(true);
    expect(hintVisible(o(true, true, true))).toBe(true);
    expect(hintVisible(SOUND_NONE)).toBe(false);
  });
  it('die Ereignisse volumechange, playing und pause treiben den Zustand', () => {
    const el = { muted: true, volume: 1, paused: false };
    let s = reduceSound(SOUND_NONE, 'playing', el);
    expect(hintVisible(s)).toBe(true);
    el.muted = false;
    s = reduceSound(s, 'volumechange', el);
    expect(hintVisible(s)).toBe(false);
    el.muted = true;
    s = reduceSound(s, 'volumechange', el);
    expect(hintVisible(s)).toBe(true);
    el.paused = true;
    s = reduceSound(s, 'pause', el);
    expect(hintVisible(s)).toBe(false);
  });
  it('Lautstärke 0 zählt wie stumm', () => {
    expect(hintVisible(reduceSound(SOUND_NONE, 'playing', { muted: false, volume: 0, paused: false }))).toBe(true);
  });
  it('ein spielendes Element mit Ton löscht die Ablehnung', () => {
    let s = reduceSound(SOUND_NONE, 'refused', { muted: false, paused: true });
    expect(hintVisible(s)).toBe(true);
    s = reduceSound(s, 'playing', { muted: false, paused: false });
    expect(hintVisible(s)).toBe(false);
  });
});

describe('Hinweis Ton aus: am Deck-Element', () => {
  it('stummes spielendes Element zeigt den Hinweis, unMute über volumechange nimmt ihn weg', () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: true });
    expect(hintVisible(t.deck.sound(t.sink)!)).toBe(true);
    t.plain.muted = false;
    t.plain.emit('volumechange');
    expect(hintVisible(t.deck.sound(t.sink)!)).toBe(false);
    expect(t.sounds()).toBeGreaterThan(0);
  });
  it('play() mit NotAllowedError zeigt den Hinweis, auch bei Ton an', async () => {
    const t = setup();
    t.plain.playResult = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    t.plain.play = function (this: FakeEl) {
      this.calls.push('play');
      return this.playResult();
    };
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(hintVisible(t.deck.sound(t.sink)!)).toBe(true);
  });
  it('ein Element ohne Besitz liefert nichts', () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    const other: DeckSink = { state: () => {}, error: () => {} };
    expect(t.deck.sound(other)).toBeNull();
  });
});

describe('Diagnosezeilen des Audio-Reiters', () => {
  it('deck: src local|net je Start (Issue 14)', () => {
    const t = setup({ local: { 'b|0|60': { url: 'blob:x', offset: 0 } } });
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    expect(t.lines.filter((l) => l.startsWith('deck: src '))).toEqual(['deck: src net a', 'deck: src local b']);
    expect(t.plain.src).toBe('blob:x');
  });
  it('Ende im Hintergrund: Diagnose clip end, advance, arm; Wechsel am selben Element, Quelle vor play', () => {
    const t = setup();
    t.deck.load(clip('a', 0, 4), t.sink, { play: true, muted: false });
    t.deck.arm(clip('b', 10, 20));
    t.deck.onAdvance = () => {};
    t.plain.calls.length = 0;
    t.plain.tick(4);
    expect(t.lines.some((l) => l.startsWith('bg: arm b'))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('bg: deck clip end via timeupdate') && l.includes('armed=b') && l.includes('advance=yes'))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('bg: deck advance a to b') && l.includes('same element true'))).toBe(true);
    expect(t.plain.calls.indexOf('src:https://pod.test/b.mp3#t=10')).toBeLessThan(t.plain.calls.indexOf('play'));
    t.plain.readyState = 3;
    t.plain.emit('playing');
    expect(t.lines.some((l) => l.startsWith('bg: deck advance to b: playing after'))).toBe(true);
  });
  it('pause vor ended am natürlichen Ende ist kein Anhalten', () => {
    const t = setup();
    t.deck.load(clip('a', 0, undefined), t.sink, { play: true, muted: false });
    t.states.length = 0;
    t.plain.ended = true;
    t.plain.paused = true;
    t.plain.emit('pause');
    expect(t.states).not.toContain(2);
  });
  it('die Zeilen der Hintergrund-Zählung heißen nicht wie neue Diagnosezeilen', () => {
    const t = setup();
    t.deck.load(clip('a', 0, 4), t.sink, { play: true, muted: false });
    t.deck.arm(clip('b'));
    t.deck.onAdvance = () => {};
    t.plain.tick(4);
    // bg: started, bg: ended, bg: next und bg: play rejected zählt die App, das Deck schreibt keine davon
    expect(t.lines.filter((l) => /^bg: (started|ended|next) /.test(l))).toEqual([]);
  });
});

describe('Messung für die Untertitel (Issue 15)', () => {
  it('timeupdate meldet Quellzeit mit Versatz, Tempo und Wiedergabe', () => {
    const t = setup({ local: { 'a|100|200': { url: 'blob:a', offset: 90 } } });
    t.deck.setRate(2);
    t.deck.load(clip('a', 100, 200), t.sink, { play: true, muted: false });
    t.times.length = 0;
    t.plain.tick(25);
    expect(t.times.at(-1)).toEqual([115, 2, true]);
  });
  it('waiting hält die Zeit, playing setzt sie fort', () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    t.plain.tick(5);
    t.plain.emit('waiting');
    expect(t.times.at(-1)?.[2]).toBe(false);
    t.plain.emit('playing');
    expect(t.times.at(-1)?.[2]).toBe(true);
  });
  it('beim Start (Quell- und Spurwechsel) übernimmt die Messung die Zeit des Ausschnitts und hält sie', () => {
    const t = setup({ levelLane: true });
    t.deck.load(clip('a', 30, 90, 6), t.sink, { play: true, muted: false });
    t.plain.tick(0);
    t.level.currentTime = 41;
    t.level.emit('timeupdate');
    t.times.length = 0;
    t.deck.setRate(2);
    // Spurwechsel: die erste Messung trägt die Stelle des alten Elements und steht still
    expect(t.times[0]).toEqual([41, 1, false]);
  });
});

describe('Erste Geste im Dokument', () => {
  it('die erste Geste ist first, jede weitere nicht, Abonnenten bekommen alle', () => {
    resetGesturesForTest();
    const seen: boolean[] = [];
    onGesture((g) => seen.push(g.first));
    expect(gestureSeen()).toBe(false);
    emitGesture('pointerdown', 4);
    emitGesture('touchend');
    emitGesture('click');
    expect(seen).toEqual([true, false, false]);
    expect(gestureSeen()).toBe(true);
    resetGesturesForTest();
  });
  it('ein Abonnent, der wirft, stört die anderen nicht', () => {
    resetGesturesForTest();
    let n = 0;
    onGesture(() => {
      throw new Error('x');
    });
    onGesture(() => n++);
    emitGesture('click');
    expect(n).toBe(1);
    resetGesturesForTest();
  });
});
