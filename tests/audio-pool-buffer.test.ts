// Runde 20 (Diag 17.11. 07:46): ein Vorrats-Element galt als bereit, obwohl hinter der Startstelle nichts gepuffert war (duration gleich Startstelle).
// Reine Funktion poolEntryReady, Bereitschaft des Vorrats mit nachgebautem Puffer, Tausch auf dünnen Puffer, falsches Ende ohne Puffer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, bufferedEnd, POOL_NUDGE_MS, poolEntryReady, PREBUF_S, type BufRanges, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

const ranges = (...r: [number, number][]): BufRanges => ({ length: r.length, start: (i) => r[i][0], end: (i) => r[i][1] });

describe('poolEntryReady', () => {
  const base = { rs: 4, target: 1185, dur: 3000 };
  it('Bereich schließt die Startstelle ein und reicht mindestens PREBUF_S darüber hinaus: bereit', () => {
    expect(poolEntryReady({ ...base, buffered: ranges([1180, 1185 + PREBUF_S]) })).toBe(true);
    expect(poolEntryReady({ ...base, buffered: ranges([0, 10], [1185, 1200]) })).toBe(true);
  });
  it('Bereich endet knapp zu früh oder genau an der Startstelle: nicht bereit', () => {
    expect(poolEntryReady({ ...base, buffered: ranges([1180, 1185 + PREBUF_S - 0.1]) })).toBe(false);
    expect(poolEntryReady({ ...base, buffered: ranges([1100, 1185]) })).toBe(false);
  });
  it('Bereiche da, aber keiner an der Startstelle: nicht bereit', () => {
    expect(poolEntryReady({ ...base, buffered: ranges([0, 600]) })).toBe(false);
  });
  it('duration gleich Startstelle (Abstand unter 1 s) ist nie bereit, auch bei readyState 4 und gutem Bereich', () => {
    expect(poolEntryReady({ rs: 4, target: 1185, dur: 1185, buffered: ranges([1100, 1185]) })).toBe(false);
    expect(poolEntryReady({ rs: 4, target: 1185, dur: 1185, buffered: undefined })).toBe(false);
    expect(poolEntryReady({ rs: 4, target: 1185, dur: 1185.9, buffered: ranges([1100, 1400]) })).toBe(false);
  });
  it('ohne Bereiche (fehlt, leer, wirft): duration endlich und größer als target + PREBUF_S', () => {
    expect(poolEntryReady({ ...base, buffered: undefined })).toBe(true);
    expect(poolEntryReady({ ...base, buffered: ranges() })).toBe(true);
    expect(poolEntryReady({ ...base, buffered: { length: 1, end: () => { throw new Error('x'); } } })).toBe(true);
    expect(poolEntryReady({ ...base, dur: 1185 + PREBUF_S, buffered: undefined })).toBe(false);
    expect(poolEntryReady({ ...base, dur: NaN, buffered: undefined })).toBe(false);
    expect(poolEntryReady({ ...base, dur: Infinity, buffered: undefined })).toBe(false);
  });
  it('Bereich ohne start (Nachbau): zählt ab 0', () => {
    expect(poolEntryReady({ ...base, buffered: { length: 1, end: () => 1300 } })).toBe(true);
  });
  it('bufferedEnd: undefined ohne Bereiche, null ohne Treffer, sonst das Ende', () => {
    expect(bufferedEnd(undefined, 5)).toBeUndefined();
    expect(bufferedEnd(ranges(), 5)).toBeUndefined();
    expect(bufferedEnd(ranges([10, 20]), 5)).toBeNull();
    expect(bufferedEnd(ranges([10, 20]), 12)).toBe(20);
  });
});

class El implements DeckEl {
  src = '';
  currentTime = 0;
  sets = 0;
  paused = true;
  ended = false;
  seeking = false;
  readyState = 0;
  duration = 3000;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  /** Ende des Puffer-Bereichs ab start (null: buffered leer) */
  buf: [number, number] | null = null;
  get buffered(): BufRanges {
    return this.buf ? ranges(this.buf) : ranges();
  }
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
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
    this.currentTime = 0;
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
}

const clip = (id: string, start = 414.1): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60 });
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function setup() {
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
    running: () => true,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const states: number[] = [];
  const sink: DeckSink = { state: (s) => states.push(s), error: () => {} };
  return { deck, els, lines, states, sink };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => t.els.find((x) => x.src.includes(`/${id}.mp3`))!;

/** Der aktive Moment a spielt, damit der Vorrat füllen darf */
async function boot(): Promise<T> {
  const t = setup();
  t.deck.load(clip('a'), t.sink, { play: true, muted: false });
  await flush();
  t.els[0].readyState = 4;
  return t;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Vorrat: bereit erst mit Puffer hinter der Startstelle', () => {
  it('readyState 4 und canplaythrough, Puffer endet an der Startstelle (duration gleich): nicht bereit, genau eine Zeile', async () => {
    const t = await boot();
    const b = clip('b', 1185);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.duration = 1185;
    el.buf = [1100, 1185];
    el.currentTime = 1185;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.emit('canplaythrough');
    el.emit('seeked');
    expect(t.deck.poolReady(b.key)).toBe(false);
    expect(t.lines.filter((l) => l.startsWith('deck: pool not ready yet'))).toEqual(['deck: pool not ready yet b rs=4 dur=1185.0 target=1185.0 buf=1185.0']);
    expect(t.lines.some((l) => l.startsWith('deck: pool ready b'))).toBe(false);
  });
  it('kommen Daten (progress, duration wächst), wird er bereit', async () => {
    const t = await boot();
    const b = clip('b', 1185);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.duration = 1185;
    el.buf = [1100, 1185];
    el.currentTime = 1185;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.emit('canplaythrough');
    expect(t.deck.poolReady(b.key)).toBe(false);
    el.duration = 3000;
    el.buf = [1100, 1300];
    el.emit('progress');
    expect(t.deck.poolReady(b.key)).toBe(true);
    expect(t.lines.filter((l) => l.startsWith('deck: pool not ready yet')).length).toBe(1);
  });
  it('nach POOL_NUDGE_MS ohne Bereitschaft: der Seek wird einmal wiederholt, Quelle bleibt, nie ein zweites load()', async () => {
    const t = await boot();
    const b = clip('b', 1185);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.duration = 1185;
    el.buf = [1100, 1185];
    el.currentTime = 1185;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.emit('canplaythrough');
    const src = el.src;
    let seeks = 0;
    let cur = 1185;
    Object.defineProperty(el, 'currentTime', { get: () => cur, set: (v: number) => { cur = v; seeks++; } });
    vi.advanceTimersByTime(POOL_NUDGE_MS - 1);
    expect(seeks).toBe(0);
    vi.advanceTimersByTime(2);
    expect(seeks).toBe(1);
    expect(el.src).toBe(src);
    expect(t.lines.some((l) => l.startsWith('deck: pool nudge b'))).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(seeks).toBe(1);
  });
  it('ein Eintrag, der rechtzeitig bereit wird, bekommt keinen Anstoß', async () => {
    const t = await boot();
    const b = clip('b', 1185);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.buf = [1100, 1185];
    el.currentTime = 1185;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.emit('canplaythrough');
    el.buf = [1100, 1400];
    el.emit('progress');
    let seeks = 0;
    Object.defineProperty(el, 'currentTime', { get: () => 1185, set: () => { seeks++; } });
    vi.advanceTimersByTime(POOL_NUDGE_MS * 2);
    expect(seeks).toBe(0);
  });
  it('ein Seek läuft noch (seeking): nicht bereit, erst nach seeked', async () => {
    const t = await boot();
    const b = clip('b', 100);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.buf = [90, 400];
    el.currentTime = 100;
    el.seeking = true;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.emit('canplaythrough');
    expect(t.deck.poolReady(b.key)).toBe(false);
    el.seeking = false;
    el.emit('seeked');
    expect(t.deck.poolReady(b.key)).toBe(true);
  });
  it('Gerät ohne buffered (leer): die bisherige Bedingung plus duration über target + 3 genügt', async () => {
    const t = await boot();
    const b = clip('b', 100);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.currentTime = 100;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.emit('canplaythrough');
    expect(t.deck.poolReady(b.key)).toBe(true);
    expect(t.lines.some((l) => l.startsWith('deck: pool not ready yet'))).toBe(false);
  });
});

describe('Tausch auf einen Eintrag mit dünnem Puffer', () => {
  it('Zeile "swap onto thin buffer", sofort Laden (3), nie Spielen (1), bis Daten da sind und die Zeit läuft', async () => {
    const t = await boot();
    const b = clip('b', 1185);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.buf = [1100, 1400];
    el.currentTime = 1185;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.emit('canplaythrough');
    expect(t.deck.poolReady(b.key)).toBe(true);
    // iOS verwirft den Puffer hinter der Stelle, nachdem der Eintrag bereit war
    el.buf = [1100, 1185];
    t.states.length = 0;
    t.lines.length = 0;
    t.deck.load(b, t.sink, { play: true, muted: false });
    await flush();
    expect(t.lines.some((l) => l.startsWith('deck: swap onto thin buffer b rs=4 dur=3000.0 target=1185.0 buf=1185.0'))).toBe(true);
    expect(t.states).toContain(3);
    expect(t.states).not.toContain(1);
    expect(t.states[t.states.length - 1]).toBe(3);
    // Daten kommen, die Zeit läuft: Spielen
    el.buf = [1100, 1300];
    el.currentTime = 1186;
    el.emit('timeupdate');
    el.currentTime = 1186.6;
    el.emit('timeupdate');
    expect(t.states[t.states.length - 1]).toBe(1);
  });
  it('Eintrag mit genug Puffer: kein Laden, sofort Spielen', async () => {
    const t = await boot();
    const b = clip('b', 1185);
    t.deck.fill([b]);
    const el = elOf(t, 'b');
    el.buf = [1100, 1400];
    el.currentTime = 1185;
    el.emit('loadedmetadata');
    el.readyState = 4;
    el.emit('canplaythrough');
    t.states.length = 0;
    t.lines.length = 0;
    t.deck.load(b, t.sink, { play: true, muted: false });
    await flush();
    expect(t.states).toEqual([1]);
    expect(t.lines.some((l) => l.includes('thin buffer'))).toBe(false);
  });
});

describe('Falsches Ende an der Grenze des Geladenen (Runde 20)', () => {
  async function bootActive(buf: [number, number] | null) {
    const t = setup();
    const c = clip('a', 1185);
    t.deck.load(c, t.sink, { play: true, muted: true });
    const el = t.els[0];
    await flush();
    el.readyState = 4;
    el.currentTime = c.start;
    el.buf = buf;
    el.emit('loadedmetadata');
    await flush();
    return { t, el, c };
  }
  const falseEnd = (el: El) => {
    el.ended = true;
    el.paused = true;
    el.emit('pause');
    el.emit('ended');
  };
  it('kein Puffer hinter target: sofort Laden (3) statt Spielen, Zeile, kein Neuaufbau', async () => {
    const { t, el } = await bootActive([1100, 1185]);
    t.states.length = 0;
    t.lines.length = 0;
    falseEnd(el);
    expect(t.lines.some((l) => l.startsWith('deck: false ended a'))).toBe(true);
    expect(t.lines).toContain('deck: restart without buffer a t=1185.0 buf=1185.0');
    expect(t.states[t.states.length - 1]).toBe(3);
    expect(t.states).not.toContain(1);
    expect(t.lines.some((l) => l.startsWith('deck: rebuilding'))).toBe(false);
    // Daten und Zeitfortschritt: Spielen
    el.buf = [1100, 1300];
    el.currentTime = 1186;
    el.emit('timeupdate');
    el.currentTime = 1186.6;
    el.emit('timeupdate');
    expect(t.states[t.states.length - 1]).toBe(1);
  });
  it('Puffer hinter target vorhanden: Spielen wie bisher, keine neue Zeile', async () => {
    const { t, el } = await bootActive([1100, 1400]);
    t.states.length = 0;
    t.lines.length = 0;
    falseEnd(el);
    expect(t.states).toContain(1);
    expect(t.states).not.toContain(3);
    expect(t.lines.some((l) => l.startsWith('deck: restart without buffer'))).toBe(false);
  });
  it('Gerät ohne buffered: wie bisher', async () => {
    const { t, el } = await bootActive(null);
    t.states.length = 0;
    falseEnd(el);
    expect(t.states).toContain(1);
    expect(t.states).not.toContain(3);
  });
});
