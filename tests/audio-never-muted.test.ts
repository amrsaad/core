// Runde 30: Netzquellen spielen nie stumm. Vor der ersten Geste lädt der Vorrat nichts, die erste Geste schaltet alle Elemente still frei und danach füllt er sich.
// Ohne Geste oder mit "Ton aus" bleibt der Ausschnitt pausiert (Laden und Sprung laufen), der Tipp spielt laut. Arbeitshypothese (Korrelation aus Geräteprotokollen, am iPhone unbelegt).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, NEVER_MUTED, POOL, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';


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
  muted = false;
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
    this.log.push(this.src.startsWith('data:') ? 'play:silence' : this.muted ? 'play:muted' : 'play');
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

function setup(opts: { neverMuted?: boolean; unlockSilent?: boolean } = {}) {
  const els: El[] = [];
  const hid = { v: false };
  const deck = new AudioDeck({
    standby: true,
    ...opts,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      els.push(e);
      return e;
    },
    hidden: () => hid.v,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const refused: string[] = [];
  deck.onRefused = (id) => refused.push(id);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink, refused, hid };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => t.els.find((e) => e.src.endsWith(`/${id}.mp3`))!;
const gesture = async (t: T, type = 'pointerup') => {
  t.deck.unlock(type);
  await flush();
};
const trail = (e: El) => e.log.slice(e.log.lastIndexOf('load')).filter((l) => l !== 'play:silence');
const netPlayLines = (t: T) => t.els.flatMap((e) => e.log.filter((l) => l === 'play' || l === 'play:muted'));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Audio spielt nie stumm (Runde 30)', () => {
  it('der Schalter steht auf true', () => {
    expect(NEVER_MUTED).toBe(true);
  });

  it('(1) vor der ersten Geste trägt kein Vorrats-Element eine Netzquelle, auch nicht nach fill() und pointerdown', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    t.deck.fill([clip('b'), clip('c')]);
    await gesture(t, 'pointerdown');
    t.deck.fill([clip('b'), clip('c')]);
    expect(t.els).toHaveLength(POOL + 1);
    expect(t.els.filter((e) => e.src.startsWith('https://')).map((e) => e.src)).toEqual(['https://pod.test/a.mp3']);
    expect(t.deck.poolInfo()).toEqual([]);
    expect(t.lines.some((l) => l.startsWith('deck: pool'))).toBe(false);
  });

  it('(2) die erste Geste schaltet alle Elemente still frei, danach beginnt der Vorrat zu laden', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: false, muted: false });
    t.deck.fill([clip('b'), clip('c')]);
    await flush();
    expect(t.els).toHaveLength(1);
    await gesture(t);
    expect(t.els).toHaveLength(POOL + 1);
    const a = t.deck.element as El;
    const free = t.els.filter((e) => e !== a);
    for (const e of free) expect(e.log.filter((l) => l === 'play:silence').length).toBeGreaterThanOrEqual(1);
    const i = t.lines.findIndex((l) => /^deck: gesture unlock \d+ elements ok=\d+ after \d+ ms$/.test(l));
    const j = t.lines.indexOf('deck: pool start after unlock');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);
    expect(t.lines.filter((l) => l === 'deck: pool start after unlock')).toHaveLength(1);
    expect(t.lines.findIndex((l) => l.startsWith('deck: pool load'))).toBeGreaterThan(j);
    expect(t.deck.poolInfo().map((p) => p.id)).toContain('b');
    // keine stumme Netz-Wiedergabe, kein Netzquellen-play() für die Freischaltung
    expect(netPlayLines(t)).toEqual([]);
    for (const e of t.els) expect(e.src.startsWith('data:')).toBe(false);
    // weitere Gesten wiederholen nichts
    await gesture(t, 'click');
    expect(t.lines.filter((l) => l === 'deck: pool start after unlock')).toHaveLength(1);
  });

  it('(3) kein play() mit muted=true auf einer Netzquelle: Start, Tausch, Ausweichen, Neuaufbau, Warten', async () => {
    const t = setup();
    await gesture(t);
    // Start mit "Ton aus": kein play, auch nicht stumm
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    const a = t.deck.element as El;
    a.meta(10);
    a.seeked();
    await flush();
    expect(netPlayLines(t)).toEqual([]);
    t.deck.setMuted(t.sink, false);
    await flush();
    expect(netPlayLines(t)).toEqual(['play']);
    // Tausch auf einen bereiten Eintrag, Ton aus mitten im Spielen: anhalten
    t.deck.fill([clip('b'), clip('c')]);
    elOf(t, 'b').ready(30);
    elOf(t, 'c').ready(30);
    t.deck.setMuted(t.sink, true);
    expect(a.paused).toBe(true);
    t.deck.load(clip('b'), t.sink, { play: true, muted: true });
    await flush();
    expect(elOf(t, 'b').log.filter((l) => l === 'play' || l === 'play:muted')).toEqual([]);
    t.deck.setMuted(t.sink, false);
    await flush();
    const b = t.deck.element as El;
    expect(b.log).toContain('play');
    // Kollaps: Ausweichen, dann Neuaufbau (zweiter Kollaps), alles laut
    b.collapse();
    await flush();
    const f = t.deck.element as El;
    f.meta(29);
    f.seeked();
    await flush();
    f.collapse();
    await flush();
    const g = t.deck.element as El;
    g.meta(29);
    g.seeked();
    await flush();
    expect(netPlayLines(t).filter((l) => l === 'play:muted')).toEqual([]);
    expect(t.els.some((e) => e.src.startsWith('https://') && e.muted && !e.paused)).toBe(false);
    expect(t.lines.some((l) => l.startsWith('deck: muted play blocked'))).toBe(false);
  });

  it('(4) ohne Geste oder mit "Ton aus": kein play(), Zeile "waiting for tap", Tippfläche, der Tipp spielt laut', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    const a = t.deck.element as El;
    a.meta(10);
    a.seeked();
    await flush();
    expect(netPlayLines(t)).toEqual([]);
    expect(a.paused).toBe(true);
    expect(t.lines.filter((l) => l === 'deck: waiting for tap a (no gesture or sound off)')).toHaveLength(1);
    expect(t.refused).toEqual(['a']);
    // der Sprung lief trotzdem
    expect(a.log).toContain('seek:10');
    // der Tipp: Geste, Ton an, play im selben Handler, laut
    t.deck.unlock('pointerup');
    t.deck.setMuted(t.sink, false);
    t.deck.play(t.sink);
    await flush();
    expect(a.log.filter((l) => l === 'play')).toHaveLength(1);
    expect(a.muted).toBe(false);
    expect(t.lines.filter((l) => l.startsWith('deck: waiting for tap'))).toHaveLength(1);
    // andere Elemente wurden im selben Tipp still freigeschaltet
    expect(t.lines.some((l) => /^deck: gesture unlock \d+ elements ok=\d+ after \d+ ms$/.test(l))).toBe(true);
  });

  it('(4) nach der Geste, aber mit "Ton aus": Tippfläche, kein play(), der Tipp mit Ton an spielt', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    const a = t.deck.element as El;
    a.meta(10);
    a.seeked();
    await flush();
    expect(a.paused).toBe(true);
    expect(t.refused).toEqual(['a']);
    t.deck.unlock('pointerup');
    t.deck.setMuted(t.sink, false);
    await flush();
    expect(a.log.filter((l) => l === 'play')).toHaveLength(1);
  });

  it('(4) pointerdown allein reicht nicht (iOS), die Tippfläche kommt dort nicht, pointerup spielt', async () => {
    const t = setup();
    await gesture(t, 'pointerdown');
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    a.meta(10);
    a.seeked();
    await flush();
    expect(a.log).not.toContain('play');
    expect(t.refused).toEqual([]);
    await gesture(t, 'pointerup');
    expect(a.log.filter((l) => l === 'play')).toHaveLength(1);
  });

  it('(5) Reihenfolge nach der Geste: load, seek, seeked, play laut', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    const a = t.deck.element as El;
    expect(trail(a)).toEqual(['load']);
    a.meta(10);
    expect(trail(a)).toEqual(['load', 'seek:10']);
    a.seeked();
    await flush();
    expect(trail(a)).toEqual(['load', 'seek:10', 'play']);
    expect(a.muted).toBe(false);
  });

  it('(6) Weiter im Hintergrund: der nächste Moment spielt auf dem freigeschalteten Element ohne Geste, laut, nach dem Sprung', async () => {
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
    b.ready(30);
    t.hid.v = true;
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.deck.element).toBe(b);
    expect(b.log.filter((l) => l === 'play')).toHaveLength(1);
    expect(b.log.indexOf('play')).toBeGreaterThan(b.log.indexOf('seek:30'));
    expect(b.muted).toBe(false);
    expect(t.lines.some((l) => l.startsWith('deck: waiting for tap'))).toBe(false);
  });

  it('(7) beide Schalter false: das Verhalten von da2670a, stummer Start ohne Geste', async () => {
    const t = setup({ neverMuted: false, unlockSilent: false });
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    const a = t.deck.element as El;
    expect(a.muted).toBe(true);
    expect(a.log).toContain('play:muted');
    t.deck.fill([clip('b')]);
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(['b']);
    expect(t.lines.some((l) => l.startsWith('deck: waiting for tap'))).toBe(false);
  });

  it('(8) höchstens sechs Elemente, auch mit Vorrat, Tausch und Gesten', async () => {
    const t = setup();
    await gesture(t);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    (t.deck.element as El).meta(10);
    (t.deck.element as El).seeked();
    const ids = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    t.deck.fill(ids.map((i) => clip(i)));
    for (const e of t.els) if (e.src.endsWith('.mp3')) e.ready(30);
    for (const id of ids.slice(0, 4)) {
      t.deck.load(clip(id), t.sink, { play: true, muted: false });
      await flush();
      await gesture(t, 'touchend');
      t.deck.fill(ids.map((i) => clip(i)));
      for (const e of t.els) if (e.src.endsWith('.mp3')) e.ready(30);
    }
    expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
  });
});
