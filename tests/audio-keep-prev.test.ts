import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, KEEP_PREV, POOL, WEAK_PLAY_MS, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

/**
 * Runde 26 (Diag 19.11. 09:16:47 und 09:16:24): Zurückwischen ohne Kaltstart, und der Vorrat läuft im schwachen Netz weiter.
 * Das ist ein Nachbau (Fake-Elemente, Fake-Uhr). Am iPhone ist nichts davon belegt.
 */
class El implements DeckEl {
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 3000;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  quiet = false;
  /** Zahl der load()-Aufrufe mit einer Netzadresse */
  netLoads = 0;
  /** Ms bis das Laden fertig ist (0: nie von selbst) */
  loadMs = 0;
  /** Nach dem Laden liegt hinter der Startstelle nur 1 s Puffer (dünn, nie bereit) */
  thin = false;
  buf = 0;
  private on = new Map<string, (() => void)[]>();
  get buffered() {
    const end = this.buf;
    return { length: end > 0 ? 1 : 0, end: () => end };
  }
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.paused = false;
    if (!this.quiet) this.emit('playing');
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit('pause');
  }
  load() {
    this.currentTime = 0;
    this.readyState = 0;
    this.buf = 0;
    if (this.src.startsWith('https://')) this.netLoads++;
    const src = this.src;
    if (this.loadMs > 0) {
      setTimeout(() => {
        if (this.src !== src) return;
        this.readyState = 4;
        this.buf = this.thin ? this.currentTime + 1 : this.currentTime + 600;
        this.emit('loadedmetadata');
        this.emit('canplaythrough');
      }, this.loadMs);
    }
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
}

const clip = (id: string, start = 0): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60 });
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function setup(loadMs: number | ((i: number) => number) = 0, quietFirst = false) {
  const els: El[] = [];
  const deck = new AudioDeck({
    neverMuted: false,
    standby: true,
    // Runde 27: dieses Verhalten (Eintrag springt sofort, Geste spielt jeden Eintrag an) gilt mit unlockSilent: false (Verhalten von da2670a); die neue Regel prüfen audio-unlock-silent.test.ts und audio-play-after-jump.test.ts
    unlockSilent: false,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      e.loadMs = typeof loadMs === 'number' ? loadMs : loadMs(els.length);
      e.quiet = quietFirst && els.length === 0;
      els.push(e);
      return e;
    },
    hidden: () => false,
    running: () => true,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => [...t.els].reverse().find((x) => x.src.includes(`/${id}.mp3`));
const count = (t: T, re: RegExp) => t.lines.filter((l) => re.test(l)).length;
const readyAll = (t: T, ids: string[]) => {
  for (const id of ids) {
    const el = elOf(t, id)!;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.buf = el.currentTime + 600;
    el.emit('canplaythrough');
  }
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Zurückwischen ohne Kaltstart', () => {
  it('vorwärts über den Vorrat und zurück: kein neues load() auf einer Netzadresse, Start an der Startstelle', async () => {
    const t = setup();
    t.deck.load(clip('a', 30), t.sink, { play: true, muted: false });
    await flush();
    const a = t.els[0];
    a.readyState = 4;
    t.deck.fill([clip('b'), clip('c'), clip('d')]);
    readyAll(t, ['b', 'c', 'd']);
    a.currentTime = 47;
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(a.paused).toBe(true);
    expect(a.src).toContain('/a.mp3');
    expect(t.lines.filter((l) => l === 'deck: keep prev a (kept 1)')).toHaveLength(1);
    const before = t.els.map((e) => e.netLoads);
    t.lines.length = 0;
    t.deck.load(clip('a', 30), t.sink, { play: true, muted: false });
    await flush();
    expect(t.els.map((e) => e.netLoads)).toEqual(before);
    expect(t.lines.some((l) => l.startsWith('deck: src net'))).toBe(false);
    expect(t.lines.filter((l) => l === 'deck: swap back a from kept')).toHaveLength(1);
    expect(a.paused).toBe(false);
    expect(a.currentTime).toBe(30);
    expect(t.deck.holds(clip('a', 30).key)).toBe(true);
  });

  it('vorwärts per Kaltstart (kein Vorrat) und zurück: der verlassene Moment bleibt, auch der zweite Wisch vorwärts kostet kein load()', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.els[0].readyState = 4;
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    const b = elOf(t, 'b')!;
    expect(b).not.toBe(t.els[0]);
    b.readyState = 4;
    expect(t.lines).toContain('deck: keep prev a (kept 1)');
    const loads = () => t.els.reduce((n, e) => n + e.netLoads, 0);
    const n0 = loads();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    expect(loads()).toBe(n0);
    expect(t.deck.holds(clip('a').key)).toBe(true);
    // b wurde dabei verlassen und bleibt: wieder vorwärts ohne Kaltstart
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(loads()).toBe(n0);
    expect(t.deck.holds(clip('b').key)).toBe(true);
    expect(count(t, /^deck: swap back /)).toBe(2);
  });

  it('der verlassene Moment ist nach dem Zurückwischen wieder der nächste im Vorrat (kein zweiter Kaltstart)', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.els[0].readyState = 4;
    t.deck.fill([clip('b'), clip('c'), clip('d')]);
    readyAll(t, ['b', 'c', 'd']);
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    // Der Host füllt neu: Kandidaten sind b, c, d. b liegt im behaltenen Element und kehrt in den Vorrat zurück.
    const before = t.lines.filter((l) => l.startsWith('deck: pool load b ')).length;
    t.deck.fill([clip('b'), clip('c'), clip('d')]);
    expect(t.lines.filter((l) => l.startsWith('deck: pool load b ')).length).toBe(before);
    expect(t.deck.poolReady(clip('b').key)).toBe(true);
  });

  it('die Elementzahl überschreitet POOL + 1 nie, der nächste Vorrats-Eintrag bleibt, der am weitesten vorausliegende geht', async () => {
    const t = setup();
    expect(KEEP_PREV).toBe(1);
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.els[0].readyState = 4;
    const q = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const queue = (from: number) => q.slice(from, from + 6).map((id) => clip(id));
    t.deck.fill(queue(0));
    readyAll(t, ['b', 'c', 'd', 'e', 'f']);
    expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
    for (let i = 0; i < 4; i++) {
      t.deck.load(clip(q[i]), t.sink, { play: true, muted: false });
      await flush();
      t.deck.fill(queue(i + 1));
      for (const el of t.els) if (el.src && el.readyState === 0) el.readyState = 4;
      for (const id of q.slice(i + 1, i + 6)) if (elOf(t, id)?.readyState === 4) readyAll(t, [id]);
      expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
      // der nächste ist immer im Vorrat
      expect(t.deck.poolInfo().some((p) => p.id === q[i + 1])).toBe(true);
      expect(t.deck.poolInfo().length).toBeLessThanOrEqual(POOL - 1);
    }
    // zurückwischen und Kaltstart eines unbekannten Moments: Elemente bleiben in der Grenze
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.deck.load(clip('zz'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
    expect(t.els.filter((e) => e.src).length).toBeLessThanOrEqual(POOL + 1);
  });

  it('Diag-Zeilen: "keep prev" und "swap back" je einmal je Ereignis', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.els[0].readyState = 4;
    t.deck.fill([clip('b'), clip('c')]);
    readyAll(t, ['b', 'c']);
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(count(t, /^deck: keep prev /)).toBe(1);
    expect(count(t, /^deck: swap back /)).toBe(0);
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    expect(count(t, /^deck: swap back /)).toBe(1);
    expect(count(t, /^deck: keep prev /)).toBe(2);
    expect(t.lines).toContain('deck: keep prev b (kept 1)');
    expect(t.lines).toContain('deck: swap back a from kept');
  });
});

describe('Vorrat im schwachen Netz läuft weiter', () => {
  /** Schwaches Netz über den ersten Moment: er spielt erst nach WEAK_PLAY_MS */
  async function weak(t: T) {
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    const a = t.els[0];
    a.readyState = 4;
    vi.advanceTimersByTime(WEAK_PLAY_MS + 500);
    a.emit('playing');
    expect(t.lines).toContain('deck: weak net, pool one at a time');
  }

  it('drei Wechsel im Abstand von 5 s bei 2 s Ladezeit: der Vorrat fällt nie auf 0, auch mit einem Eintrag mit zu dünnem Puffer', async () => {
    const t = setup(2000, true);
    await weak(t);
    const q = ['b', 'c', 'st', 'd', 'e', 'f', 'g', 'h', 'i'];
    // st liefert Daten, aber hinter der Startstelle nur 1 s Puffer: nie bereit
    const mark = () => {
      const st = elOf(t, 'st');
      if (st) st.thin = true;
    };
    const queue = (from: number) => q.slice(from, from + 6).map((id) => clip(id));
    const fillThin = (from: number) => {
      t.deck.fill(queue(from));
      mark();
    };
    fillThin(0);
    // st bekommt thin vor Ablauf seiner Ladezeit gesetzt (der Timer prüft beim Auslösen)
    for (let s = 0; s < 14; s++) {
      vi.advanceTimersByTime(1000);
      fillThin(0);
    }
    const mins: number[] = [];
    for (let i = 0; i < 3; i++) {
      mins.push(t.deck.readyCount());
      t.deck.load(clip(q[i]), t.sink, { play: true, muted: false });
      await flush();
      fillThin(i + 1);
      for (let s = 0; s < 5; s++) {
        vi.advanceTimersByTime(1000);
        fillThin(i + 1);
      }
    }
    mins.push(t.deck.readyCount());
    expect(Math.min(...mins)).toBeGreaterThanOrEqual(1);
    expect(t.deck.readyCount()).toBeGreaterThan(0);
    // st war wirklich hängen geblieben (Zeile "pool slow"), und hat das Netz nicht schwach gemacht
    expect(count(t, /^deck: pool slow st /)).toBeGreaterThanOrEqual(1);
    expect(count(t, /^deck: weak net, pool one at a time$/)).toBe(1);
    expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
  });

  it('ein langsamer Eintrag mit Daten (readyState 4, dünner Puffer) macht das Netz nicht schwach', async () => {
    const t = setup(500);
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.els[0].readyState = 4;
    t.deck.fill([clip('st'), clip('b')]);
    elOf(t, 'st')!.thin = true;
    vi.advanceTimersByTime(9000);
    expect(count(t, /^deck: pool slow st /)).toBe(1);
    expect(count(t, /weak net/)).toBe(0);
  });

  it('zwei schnelle Einträge in Folge heben "schwach" auf, genau eine Zeile', async () => {
    const t = setup(1000, true);
    await weak(t);
    t.deck.fill([clip('b'), clip('c'), clip('d')]);
    vi.advanceTimersByTime(1100);
    expect(count(t, /^deck: weak net off/)).toBe(0);
    t.deck.fill([clip('b'), clip('c'), clip('d')]);
    vi.advanceTimersByTime(1100);
    expect(count(t, /^deck: weak net off \(pool ready 1000 ms, 2 in a row\)$/)).toBe(1);
    expect(t.deck.isWeakNet()).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(count(t, /^deck: weak net off/)).toBe(1);
    expect(count(t, /^deck: net ok/)).toBe(0);
  });

  it('ein langsamer Eintrag setzt die Zählung zurück', async () => {
    // Elemente: a (0), b (1, 1 s), c (2, 4 s), d (3, 1 s)
    const t = setup((i) => (i === 2 ? 4000 : 1000), true);
    await weak(t);
    t.deck.fill([clip('b'), clip('c'), clip('d')]);
    vi.advanceTimersByTime(1100);
    t.deck.fill([clip('b'), clip('c'), clip('d')]);
    vi.advanceTimersByTime(4100);
    t.deck.fill([clip('b'), clip('c'), clip('d')]);
    vi.advanceTimersByTime(1100);
    // b schnell (1), c langsam (Zählung zurück), d schnell (1): noch nicht aufgehoben
    expect(count(t, /^deck: pool ready /)).toBeGreaterThanOrEqual(3);
    expect(count(t, /^deck: weak net off/)).toBe(0);
    expect(t.deck.isWeakNet()).toBe(true);
  });
});
