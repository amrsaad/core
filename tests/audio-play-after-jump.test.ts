// Runde 29: auf einer Netzquelle kein play() vor dem abgeschlossenen Sprung. Kaltstart, Ausweichen bei Kollaps, Tausch auf einen noch ladenden Eintrag.
// Der Nachbau meldet seeking und seeked wie ein Browser, das Protokoll je Element zeigt die Reihenfolge load, seek, play.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, DODGE_BACK, JUMP_WAIT_MS, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  private t = 0;
  get currentTime() {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
    this.log.push(`seek:${v}`);
    this.seeking = true;
    this.emit('seeking');
  }
  seeking = false;
  paused = true;
  ended = false;
  readyState = 0;
  duration = Number.NaN;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  buffered = { length: 0, start: () => 0, end: () => 0 };
  log: string[] = [];
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.log.push(this.src.startsWith('data:') ? 'play:silence' : 'play');
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.log.push('pause');
    this.emit('pause');
  }
  load() {
    this.t = 0;
    this.readyState = 0;
    this.seeking = false;
    this.duration = Number.NaN;
    this.log.push('load');
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
  /** Metadaten und Daten ab der Startstelle */
  meta(target: number) {
    this.duration = 600;
    this.buffered = { length: 1, start: () => target - 1, end: () => target + 4 };
    this.readyState = 4;
    this.emit('loadedmetadata');
  }
  seeked() {
    this.seeking = false;
    this.emit('seeked');
    this.emit('canplay');
    this.emit('canplaythrough');
  }
  /** Wie iOS: duration fällt auf die Position, ended kommt, das Element pausiert */
  collapse() {
    this.duration = this.currentTime;
    this.emit('durationchange');
    this.ended = true;
    this.paused = true;
    this.emit('pause');
    this.emit('ended');
  }
  /** Eintrag bereit: Metadaten, Sprung, seeked */
  ready(target: number) {
    this.meta(target);
    if (this.seeking) this.seeked();
    else this.emit('canplaythrough');
  }
}

const clip = (id: string, start = 30): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60 });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup(unlockSilent?: boolean) {
  const els: El[] = [];
  const deck = new AudioDeck({
    neverMuted: false,
    standby: true,
    ...(unlockSilent === undefined ? {} : { unlockSilent }),
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      els.push(e);
      return e;
    },
    hidden: () => false,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => t.els.find((e) => e.src.endsWith(`/${id}.mp3`))!;
const unlockedSet = (t: T) => (t.deck as unknown as { unlockedEls: WeakSet<object> }).unlockedEls;
const netPlays = (e: El) => e.log.filter((l) => l === 'play').length;
const gesture = async (t: T, type = 'pointerup') => {
  t.deck.unlock(type);
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Reihenfolge im Protokoll eines Elements ab dem letzten load, ohne die Stille der Freischaltung */
const trail = (e: El) => {
  const i = e.log.lastIndexOf('load');
  return e.log.slice(i).filter((l) => l !== 'play:silence');
};

describe('erst der Sprung, dann play() (Runde 29)', () => {
  it('(4) Kaltstart auf einem freigeschalteten Element: load, seek, seeked, dann der erste play(), kein play() vor dem Sprung', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    expect(unlockedSet(t).has(a)).toBe(true);
    expect(trail(a)).toEqual(['load']);
    expect(t.lines.filter((l) => l.startsWith('deck: play waits for jump a '))).toHaveLength(1);
    a.meta(10);
    expect(trail(a)).toEqual(['load', 'seek:10']);
    a.seeked();
    await flush();
    expect(trail(a)).toEqual(['load', 'seek:10', 'play']);
    expect(t.lines.filter((l) => /^deck: play after jump a \(seeked\) t=10\.0 /.test(l))).toHaveLength(1);
    expect(a.paused).toBe(false);
  });

  it('(4) ohne seeked spielt er nach JUMP_WAIT_MS trotzdem', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    a.meta(10);
    vi.advanceTimersByTime(JUMP_WAIT_MS - 10);
    expect(trail(a)).toEqual(['load', 'seek:10']);
    vi.advanceTimersByTime(20);
    await flush();
    // (die Stummhaltung bis zur bestätigten Position setzt nach POS_CONFIRM_MS die Position noch einmal, das ist die bestehende Frist)
    expect(trail(a).filter((l) => l !== 'seek:10')).toEqual(['load', 'play']);
    expect(trail(a).indexOf('play')).toBeGreaterThan(trail(a).indexOf('seek:10'));
    expect(t.lines.some((l) => /^deck: play after jump a \(timeout\)/.test(l))).toBe(true);
  });

  it('ein play() des Hosts, ein Tipp oder canplay vor dem Sprung ruft kein play() auf (der Wunsch bleibt, der Sprung löst ihn ein)', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    t.deck.play(t.sink);
    t.deck.unlock('click');
    a.emit('canplay');
    expect(trail(a)).toEqual(['load']);
    a.meta(10);
    a.emit('canplay');
    expect(trail(a)).toEqual(['load', 'seek:10']);
    a.seeked();
    await flush();
    expect(trail(a)).toEqual(['load', 'seek:10', 'play']);
  });

  it('pausiert der Mensch während des Wartens, spielt der Sprung nichts an', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    t.deck.load(clip('a', 10), t.sink, { play: false, muted: false });
    a.meta(10);
    a.seeked();
    await flush();
    expect(trail(a)).toEqual(['load', 'seek:10']);
  });

  it('(5) Kaltstart in einer Geste ohne freies freigeschaltetes Element: der alte Weg, play() vor den Metadaten', async () => {
    const t = setup();
    t.deck.unlock('pointerup');
    // Das einzige Element der Spur ist das aktive, nichts ist frei und freigeschaltet (Elemente ohne Freischaltung)
    for (const e of t.els) e.log.length = 0;
    const un = unlockedSet(t);
    for (const e of t.els) (un as unknown as { delete: (k: object) => void }).delete(e);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    const a = t.deck.element as El;
    // der play() läuft synchron im Start, vor den Metadaten
    expect(unlockedSet(t).has(a)).toBe(false);
    expect(trail(a)).toEqual(['load', 'play']);
    await flush();
    a.meta(10);
    expect(trail(a)).toEqual(['load', 'play', 'seek:10']);
    expect(t.lines.some((l) => l.startsWith('deck: play waits for jump'))).toBe(false);
  });

  it('(5) Start in einer Geste: ist das aktive Element nicht freigeschaltet, nimmt der Start zuerst ein freies freigeschaltetes, dort greift erst Sprung, dann play()', async () => {
    const t = setup();
    // aktives Element ohne Freischaltung: der Moment wird geladen, aber nicht gespielt
    t.deck.load(clip('a', 10), t.sink, { play: false, muted: false });
    await flush();
    const a = t.deck.element as El;
    expect(unlockedSet(t).has(a)).toBe(false);
    await gesture(t);
    expect(t.els.length).toBeGreaterThan(1);
    // Wisch auf einen anderen Moment in derselben Geste
    t.deck.unlock('pointerup');
    t.deck.load(clip('z', 50), t.sink, { play: true, muted: false });
    await flush();
    const z = t.deck.element as El;
    expect(z).not.toBe(a);
    expect(unlockedSet(t).has(z)).toBe(true);
    expect(z.src).toBe('https://pod.test/z.mp3');
    expect(trail(z)).toEqual(['load']);
    z.meta(50);
    z.seeked();
    await flush();
    expect(trail(z)).toEqual(['load', 'seek:50', 'play']);
  });

  it('(6) Ausweichen bei Kollaps: das frische freigeschaltete Element lädt, springt nach den Metadaten, erst nach seeked der erste play()', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 30), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    a.meta(30);
    a.seeked();
    await flush();
    expect(netPlays(a)).toBe(1);
    a.collapse();
    await flush();
    const f = t.deck.element as El;
    expect(f).not.toBe(a);
    expect(unlockedSet(t).has(f)).toBe(true);
    expect(f.src).toBe('https://pod.test/a.mp3');
    expect(a.src).toBe('');
    expect(trail(f)).toEqual(['load']);
    f.meta(30 - DODGE_BACK);
    expect(trail(f)).toEqual(['load', `seek:${30 - DODGE_BACK}`]);
    expect(netPlays(f)).toBe(0);
    f.seeked();
    await flush();
    expect(trail(f)).toEqual(['load', `seek:${30 - DODGE_BACK}`, 'play']);
    // genau eine Zeile collapse mit den neuen Feldern
    const col = t.lines.filter((l) => l.startsWith('deck: collapse a '));
    expect(col).toHaveLength(1);
    expect(col[0]).toMatch(/ unlocked=1 unlockedBy=silent playedBeforeSeek=0 muted=\d /);
  });

  it('Ausweichen auf ein nicht freigeschaltetes frisches Element (keins frei und freigeschaltet): der alte Weg, play() sofort', async () => {
    const t = setup();
    t.deck.load(clip('a', 30), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    a.meta(30);
    a.seeked();
    await flush();
    a.collapse();
    const f = t.deck.element as El;
    expect(f).not.toBe(a);
    expect(unlockedSet(t).has(f)).toBe(false);
    expect(trail(f)).toEqual(['load', 'play']);
    const col = t.lines.find((l) => l.startsWith('deck: collapse a '))!;
    expect(col).toMatch(/ unlocked=1 unlockedBy=swipe playedBeforeSeek=1 /);
  });

  it('Kaltstart auf nicht freigeschaltetem Element: playedBeforeSeek=1 in der Zeile collapse', async () => {
    const t = setup();
    t.deck.load(clip('a', 30), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    a.meta(30);
    a.seeked();
    await flush();
    a.collapse();
    expect(t.lines.find((l) => l.startsWith('deck: collapse a '))).toMatch(/ playedBeforeSeek=1 /);
  });

  it('Tausch auf einen noch ladenden Eintrag (freigeschaltetes Element): der Sprung läuft, erst nach seeked der play(). Ein bereiter Eintrag spielt sofort.', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    a.meta(10);
    a.seeked();
    await flush();
    t.deck.fill([clip('b'), clip('c')]);
    const b = elOf(t, 'b');
    const c = elOf(t, 'c');
    expect(unlockedSet(t).has(b)).toBe(true);
    // c ist bereit, b hat Metadaten und der Sprung läuft noch
    c.ready(30);
    b.meta(30);
    expect(b.seeking).toBe(true);
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.deck.element).toBe(b);
    expect(trail(b)).toEqual(['load', 'seek:30']);
    b.seeked();
    await flush();
    expect(trail(b)).toEqual(['load', 'seek:30', 'play']);
    // bereit: der Sprung ist abgeschlossen, play() sofort (der gute Ablauf)
    t.deck.load(clip('c'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.deck.element).toBe(c);
    expect(trail(c)).toEqual(['load', 'seek:30', 'play']);
  });

  it('Tausch auf einen Eintrag ohne Freischaltung: play() sofort in der Geste, wie bisher', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    a.meta(10);
    a.seeked();
    await flush();
    t.deck.fill([clip('b')]);
    const b = elOf(t, 'b');
    b.meta(30);
    expect(unlockedSet(t).has(b)).toBe(false);
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.deck.element).toBe(b);
    expect(trail(b)).toEqual(['load', 'seek:30', 'play']);
    expect(t.lines.some((l) => l.startsWith('deck: play waits for jump b'))).toBe(false);
  });

  it('(7) UNLOCK_SILENT = false: Kaltstart und Ausweichen spielen sofort, vor den Metadaten', async () => {
    const t = setup(false);
    await gesture(t);
    t.deck.load(clip('a', 30), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    expect(trail(a)).toEqual(['load', 'play']);
    a.meta(30);
    a.seeked();
    await flush();
    a.collapse();
    await flush();
    const f = t.deck.element as El;
    expect(f).not.toBe(a);
    expect(trail(f)).toEqual(['load', 'play']);
    expect(t.lines.some((l) => l.startsWith('deck: play waits for jump'))).toBe(false);
  });

  it('Startstelle 0: kein Sprung nötig, play() sofort', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 0), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    expect(trail(a)).toEqual(['load', 'play']);
  });
});
