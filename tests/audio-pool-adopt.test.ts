// Runde 12 (Diag 13.11. 21:11): das Audio lud viel zu lange.
// A: ein Eintrag des Vorrats, der noch nicht bereit ist (readyState 3 oder noch ohne Metadaten), wird beim Start seines Ausschnitts übernommen statt verworfen und neu geladen.
// B: solange der aktive Moment nicht spielt, läuft höchstens ein Netz-Abruf des Vorrats, die übrigen folgen mit dem ersten playing oder nach 4 s nacheinander.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, FILL_DEFER_MS, POOL, type DeckClip, type DeckEl, type DeckSink, type LocalClip } from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 600;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  loads = 0;
  plays = 0;
  /** Wie ein Browser: playing kommt synchron, solange spielen erlaubt ist */
  allow = true;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.plays++;
    if (!this.allow) {
      const e = new Error('not allowed');
      e.name = 'NotAllowedError';
      return Promise.reject(e);
    }
    this.paused = false;
    this.emit('playing');
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit('pause');
  }
  load() {
    this.loads++;
    this.currentTime = 0;
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
}

const clip = (id: string, start = 0, gain?: number): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60, gain });
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function setup(opts: { level?: boolean; local?: Record<string, LocalClip> } = {}) {
  const els: El[] = [];
  const deck = new AudioDeck({
    standby: true,
    local: (k) => opts.local?.[k],
    dropLocal: () => {},
    make: () => {
      const e = new El();
      els.push(e);
      return e;
    },
    hidden: () => false,
    running: () => true,
    lane: (c, _l, force) => (opts.level && c.gain && !force ? { lane: 'level', why: 'cors trial' } : { lane: 'plain', why: 'no value' }),
    chain: (_el, db) => ({ linear: () => 10 ** (db / 20) }),
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => t.els.find((x) => x.src.includes(`/${id}.mp3`))!;
const netLoads = (t: T) => t.lines.filter((l) => l.startsWith('deck: pool load ')).length;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('A: Eintrag des Vorrats wird übernommen, nie verworfen und neu geladen', () => {
  async function boot(): Promise<T> {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.els[0].readyState = 4;
    return t;
  }

  it('Metadaten da, readyState 3 (nicht bereit): dasselbe Element, dieselbe Quelle, kein zweites load(), Zeile "pool adopt"', async () => {
    const t = await boot();
    const b = clip('b', 10);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    const src = el.src;
    el.emit('loadedmetadata');
    el.readyState = 3;
    expect(t.deck.poolReady(b.key)).toBe(false);
    expect(el.loads).toBe(1);
    t.lines.length = 0;
    t.deck.load(b, t.sink, { play: true, muted: false });
    await flush();
    expect(t.deck.element).toBe(el);
    expect(el.src).toBe(src);
    expect(el.loads).toBe(1);
    expect(el.plays).toBe(1);
    expect(t.lines.some((l) => /pool dropped/.test(l))).toBe(false);
    expect(t.lines.some((l) => /src net/.test(l))).toBe(false);
    expect(t.lines).toContain('deck: pool adopt b rs=3 meta=true after 0 ms');
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual([]);
  });

  it('noch ohne Metadaten: übernommen, nach loadedmetadata springt das Element an die Position (clip.start), kein Ton von der falschen Stelle', async () => {
    const t = await boot();
    const b = clip('b', 10);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    t.lines.length = 0;
    vi.advanceTimersByTime(300);
    t.deck.load(b, t.sink, { play: true, muted: false });
    await flush();
    expect(t.deck.element).toBe(el);
    expect(el.loads).toBe(1);
    expect(t.lines).toContain('deck: pool adopt b rs=0 meta=false after 300 ms');
    // iOS hat die Position vor den Metadaten nicht angenommen
    el.currentTime = 0;
    // Metadaten kommen jetzt als Element des aktiven Moments (nicht mehr als Eintrag): der Sprung an den Start folgt
    el.emit('loadedmetadata');
    expect(el.currentTime).toBe(10);
  });

  it('Start ohne play (load mit play false) übernimmt den Eintrag ebenfalls und ruft kein play()', async () => {
    const t = await boot();
    const b = clip('b', 10);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    t.lines.length = 0;
    t.deck.load(b, t.sink, { play: false, muted: false });
    await flush();
    expect(t.deck.element).toBe(el);
    expect(el.plays).toBe(0);
    expect(el.loads).toBe(1);
    expect(t.lines.some((l) => /pool dropped/.test(l))).toBe(false);
  });

  it('Eintrag mit Fehler wird verworfen und der Ausschnitt neu geladen', async () => {
    const t = await boot();
    const b = clip('b', 10);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.error = { code: 3 };
    t.lines.length = 0;
    t.deck.load(b, t.sink, { play: true, muted: false });
    await flush();
    expect(t.lines).toContain('deck: pool dropped b (error)');
    expect(t.lines.some((l) => /^deck: src net b$/.test(l))).toBe(true);
    expect(t.lines.some((l) => /pool adopt/.test(l))).toBe(false);
  });

  it('geregelte Spur: Kette und Anpassung (gain) kommen mit dem nicht bereiten Eintrag mit', async () => {
    const t = setup({ level: true });
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.els[0].readyState = 4;
    const b = clip('b', 10, -6);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    t.deck.load(b, t.sink, { play: true, muted: false });
    await flush();
    expect(t.deck.element).toBe(el);
    const loud = t.deck.loud(t.sink)!;
    expect(loud.how).toBe('web audio');
    expect(loud.db).toBe(-6);
    expect(loud.linear).toBeCloseTo(10 ** (-6 / 20));
  });

  it('geregelte Spur, aber Kontext läuft nicht: Eintrag fällt wegen der Spur heraus (einzige Ausnahme außer Fehler)', async () => {
    let running = true;
    const els: El[] = [];
    const deck = new AudioDeck({
      standby: true,
      local: () => undefined,
      dropLocal: () => {},
      make: () => {
        const e = new El();
        els.push(e);
        return e;
      },
      hidden: () => false,
      running: () => running,
      lane: (c) => (c.gain ? { lane: 'level', why: 'cors trial' } : { lane: 'plain', why: 'no value' }),
      chain: () => ({ linear: () => 1 }),
    });
    const lines: string[] = [];
    deck.diag = (l) => lines.push(l);
    const sink: DeckSink = { state: () => {}, error: () => {} };
    deck.load(clip('a'), sink, { play: true, muted: false });
    await flush();
    els[0].readyState = 4;
    const b = clip('b', 10, -3);
    deck.fill([b]);
    running = false;
    deck.load(b, sink, { play: true, muted: false });
    await flush();
    expect(lines).toContain('deck: pool dropped b (context not running)');
  });
});

describe('B: Vorrang für den aktiven Moment', () => {
  const ids = ['b', 'c', 'd', 'e', 'f'];
  const cs = ids.map((i) => clip(i));

  it('aktives Element spielt nicht (readyState 0): höchstens ein Vorlade-Abruf, Zeile "pool fill deferred"', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: false, muted: false });
    await flush();
    t.deck.fill(cs);
    expect(netLoads(t)).toBe(1);
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(['b']);
    expect(t.lines.filter((l) => l === 'deck: pool fill deferred (active not playing)').length).toBe(1);
    expect(t.lines).toContain('deck: pool fill 1/5 (local 0, net 1)');
    // Ein zweiter Aufruf des Hosts ändert nichts und schreibt die Zeile nicht noch einmal
    t.deck.fill(cs);
    expect(netLoads(t)).toBe(1);
    expect(t.lines.filter((l) => l === 'deck: pool fill deferred (active not playing)').length).toBe(1);
  });

  it('Kaltstart: fill vor dem ersten load, Host meldet einen erwarteten aktiven Moment (activePending): ein Abruf', () => {
    const t = setup();
    t.deck.fill(cs, undefined, true);
    expect(netLoads(t)).toBe(1);
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(['b']);
  });

  it('ohne aktiven Moment und ohne Erwartung: wie bisher bis POOL', () => {
    const t = setup();
    t.deck.fill(cs);
    expect(netLoads(t)).toBe(POOL);
  });

  it('sobald der aktive Moment spielt (playing), starten die übrigen bis POOL, ohne weiteren Aufruf des Hosts', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: false, muted: false });
    await flush();
    t.deck.fill(cs);
    expect(netLoads(t)).toBe(1);
    t.deck.play(t.sink);
    await flush();
    expect(netLoads(t)).toBe(POOL);
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(ids);
  });

  it('nach 4 s Zeitlimit der nächste Abruf, danach alle 4 s ein weiterer', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: false, muted: false });
    await flush();
    t.deck.fill(cs);
    expect(netLoads(t)).toBe(1);
    vi.advanceTimersByTime(FILL_DEFER_MS - 1);
    expect(netLoads(t)).toBe(1);
    vi.advanceTimersByTime(1);
    expect(netLoads(t)).toBe(2);
    vi.advanceTimersByTime(FILL_DEFER_MS);
    expect(netLoads(t)).toBe(3);
    vi.advanceTimersByTime(FILL_DEFER_MS * 2);
    expect(netLoads(t)).toBe(POOL);
  });

  it('aktives Element hat Daten (readyState 3), spielt aber noch nicht: nicht zurückgestellt', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: false, muted: false });
    await flush();
    t.els[0].readyState = 3;
    t.deck.fill(cs);
    expect(netLoads(t)).toBe(POOL);
    expect(t.lines.some((l) => /fill deferred/.test(l))).toBe(false);
  });

  it('lokale Quellen laufen auch zurückgestellt sofort, nur Netz-Abrufe zählen', async () => {
    const local = { 'c|0|60': { url: 'blob:c', offset: 0 }, 'd|0|60': { url: 'blob:d', offset: 0 } };
    const t = setup({ local });
    t.deck.load(clip('a'), t.sink, { play: false, muted: false });
    await flush();
    t.deck.fill(cs);
    expect(t.deck.poolInfo().map((p) => p.id).sort()).toEqual(['b', 'c', 'd']);
  });

  it('der Abruf für den nächsten Moment ist der eine: er steht vorn, nicht ein späterer', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: false, muted: false });
    await flush();
    t.deck.fill(cs);
    expect(t.deck.poolInfo()[0].id).toBe('b');
  });
});
