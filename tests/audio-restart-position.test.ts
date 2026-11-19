// Runde 22 (Geräteprotokoll 18.11.): iOS meldet nach dem Tausch duration gleich currentTime und danach ended. play() im Ende-Zustand springt an den Anfang der Folge.
// Das Element hier verhält sich spezifikationstreu: play() bei ended oder Position gleich duration setzt die Position auf 0, eine Position unter duration hebt ended auf.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioDeck,
  DATA_WAIT_MS,
  ENDED_DEBOUNCE_MS,
  POS_FIX_MAX,
  STEP_BACK,
  ignoreEnded,
  plausibleEnd,
  positionBeforeStart,
  restartPos,
  stepBackPos,
  type DeckClip,
  type DeckEl,
  type DeckSink,
} from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  private t = 0;
  get currentTime() {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
    if (!Number.isFinite(this.duration) || v < this.duration) this.ended = false;
  }
  paused = true;
  ended = false;
  readyState = 0;
  duration = 3000;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  plays = 0;
  loads = 0;
  /** Zahl der Sprünge auf 0 durch play() im Ende-Zustand */
  jumps = 0;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.plays++;
    if (this.ended || (Number.isFinite(this.duration) && this.duration > 0 && this.t >= this.duration)) {
      this.t = 0;
      this.jumps++;
    }
    this.paused = false;
    this.ended = false;
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
    this.t = 0;
    this.ended = false;
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
}

const clip = (id: string, start = 303.6, len = 48): DeckClip => ({ key: `${id}|${start}|${start + len}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + len });
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
  return { deck, els, lines, sink, states };
}
type T = ReturnType<typeof setup>;

/** Ausschnitt laden, Metadaten melden (der Sprung steht an der Startstelle), spielt */
async function boot(t: T, c = clip('a')): Promise<El> {
  t.deck.load(c, t.sink, { play: true, muted: true });
  const el = t.els[0];
  await flush();
  el.readyState = 4;
  el.currentTime = c.start;
  el.emit('loadedmetadata');
  await flush();
  return el;
}
const posLines = (t: T) => t.lines.filter((l) => l.startsWith('deck: position before clip start'));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('reine Funktionen', () => {
  it('stepBackPos: Rückschritt, nie unter 0, nie vor Schnittbeginn minus 0,3', () => {
    expect(stepBackPos(303.6, 303.6)).toBeCloseTo(303.6 - STEP_BACK, 9);
    expect(stepBackPos(0.1, 0)).toBe(0);
    expect(stepBackPos(0, 0)).toBe(0);
    expect(stepBackPos(310, 303.6)).toBeCloseTo(309.75, 9);
    expect(stepBackPos(303.7, 303.6)).toBeGreaterThanOrEqual(303.6 - 0.3);
  });
  it('restartPos: Rückschritt nur im Ende-Zustand', () => {
    expect(restartPos({ ended: false, dur: 3000, at: 303.6, startEl: 303.6 })).toBe(303.6);
    expect(restartPos({ ended: true, dur: 3000, at: 303.6, startEl: 303.6 })).toBeCloseTo(303.35, 9);
    expect(restartPos({ ended: false, dur: 303.6, at: 303.6, startEl: 303.6 })).toBeCloseTo(303.35, 9);
    expect(restartPos({ ended: false, dur: 0, at: 5, startEl: 5 })).toBe(5);
    expect(restartPos({ ended: false, dur: NaN, at: 5, startEl: 5 })).toBe(5);
  });
  it('positionBeforeStart: mehr als 2 s vor target minus Rückschritt', () => {
    expect(positionBeforeStart({ t: 6.9, target: 303.6 })).toBe(true);
    expect(positionBeforeStart({ t: 0, target: 303.6 })).toBe(true);
    expect(positionBeforeStart({ t: 303.35, target: 303.6 })).toBe(false);
    expect(positionBeforeStart({ t: 301.5, target: 303.6 })).toBe(false);
    expect(positionBeforeStart({ t: 0, target: 0 })).toBe(false);
    expect(positionBeforeStart({ t: 0, target: 2 })).toBe(false);
    expect(positionBeforeStart({ t: NaN, target: 300 })).toBe(false);
  });
  it('ignoreEnded: ein ended vor dem Schnittbeginn wird nie ignoriert, sonst wie bisher', () => {
    expect(ignoreEnded({ sinceRecoverMs: 3, t: 0, dur: 0, target: 303.6 })).toBe(null);
    expect(ignoreEnded({ sinceRecoverMs: 3, t: 0, dur: 0 })).toBe('recovering');
    expect(ignoreEnded({ sinceRecoverMs: 3, t: 303.4, dur: 303.6, target: 303.6 })).toBe('recovering');
    expect(ignoreEnded({ sinceRecoverMs: 9999, t: 0.1, dur: 0, target: 0 })).toBe('empty');
    expect(ignoreEnded({ sinceRecoverMs: 9999, t: 0.1, dur: 0, target: 303.6 })).toBe(null);
  });
  it('echtes Ende bleibt plausibel', () => {
    expect(plausibleEnd({ t: 351.6, dur: 3000, clipEnd: 351.6, offset: 0, advanced: 48 })).toBe(true);
  });
});

describe('falsches ended mit duration gleich currentTime', () => {
  it('weiche Wiederherstellung steht mit Rückschritt im Fenster, nie bei 0, play() gerufen', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    const plays = el.plays;
    el.duration = c.start;
    el.currentTime = c.start;
    el.ended = true;
    el.paused = true;
    el.emit('pause');
    el.emit('ended');
    // Runde 25: erst wartet das Element DATA_WAIT_MS auf Daten (keine Daten kommen), dann greift die Wiederherstellung wie bisher
    expect(t.lines.some((l) => l.startsWith('deck: false ended'))).toBe(false);
    vi.advanceTimersByTime(DATA_WAIT_MS);
    // der sanfte Anstoß des Wartens hat schon einen Rückschritt gesetzt (303,35), die Wiederherstellung startet von dort
    expect(t.lines.some((l) => /^deck: false ended a t=303\.\d dur=303\.6 adv=0\.0, recovering/.test(l))).toBe(true);
    expect(el.plays).toBe(plays + 1);
    expect(el.jumps).toBe(0);
    expect(el.currentTime).toBeGreaterThanOrEqual(c.start - STEP_BACK - 1e-9);
    expect(el.currentTime).toBeLessThanOrEqual(c.start);
    expect(el.currentTime).toBeGreaterThan(0);
    expect(t.states).not.toContain(0);
  });
  it('Sequenz aus dem Protokoll: zweites ended mit t=0 dur=0 nach 3 ms, Runde 25: Warten, nie Abspielen ab 0, höchstens ein Neuaufbau', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.duration = c.start;
    el.currentTime = c.start;
    el.ended = true;
    el.paused = true;
    el.emit('ended');
    vi.advanceTimersByTime(3);
    // iOS: Sprung auf 0, leere Dauer, ended
    el.currentTime = 0;
    el.duration = 0;
    el.ended = true;
    el.paused = true;
    el.emit('ended');
    // Runde 25: das Element wartet auf Daten, es springt nicht und baut nichts neu auf
    expect(el.loads).toBe(1);
    expect(t.lines.some((l) => l.startsWith('deck: rebuilding source'))).toBe(false);
    // Die Dauer kommt zurück, die Abfrage läuft weiter: Daten da, die Stelle kommt zurück, play() ohne Sprung auf 0
    el.duration = 3000;
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(150);
      t.deck.heartbeat(Date.now());
      await flush();
    }
    expect(el.currentTime).toBeGreaterThan(c.start - 1);
    expect(el.jumps).toBe(0);
    expect(el.loads).toBeLessThanOrEqual(2);
    expect(t.lines.filter((l) => l.startsWith('deck: rebuilding source')).length).toBeLessThanOrEqual(1);
  });
});

describe('Positionswächter', () => {
  it('Sprung auf 0 mitten im Lauf: der Takt setzt auf target und schreibt die Zeile', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.currentTime = 6.9;
    t.deck.heartbeat(Date.now());
    expect(el.currentTime).toBeCloseTo(c.start, 5);
    expect(t.lines).toContain(`deck: position before clip start a t=6.9 target=${c.start.toFixed(1)}, reseek`);
  });
  it('timeupdate wirkt ebenso', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.currentTime = 0.2;
    el.emit('timeupdate');
    expect(el.currentTime).toBeCloseTo(c.start, 5);
    expect(posLines(t)).toHaveLength(1);
  });
  it('ended mit t=0 wird nicht ignoriert, sondern sofort zurückgeholt, play() läuft ab target', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.currentTime = 0;
    el.ended = true;
    el.paused = true;
    const plays = el.plays;
    el.emit('ended');
    expect(el.currentTime).toBeCloseTo(c.start, 5);
    expect(el.plays).toBe(plays + 1);
    expect(el.jumps).toBe(0);
    expect(t.lines.some((l) => l.includes('ended ignored'))).toBe(false);
  });
  it('greift nicht beim normalen Start (vor loadedmetadata und erstem Seek)', async () => {
    const t = setup();
    const c = clip('a');
    t.deck.load(c, t.sink, { play: true, muted: true });
    const el = t.els[0];
    await flush();
    el.readyState = 4;
    el.currentTime = 0;
    for (let i = 0; i < 3; i++) {
      t.deck.heartbeat(Date.now());
      el.emit('timeupdate');
    }
    expect(posLines(t)).toHaveLength(0);
    expect(el.currentTime).toBe(0);
  });
  it('greift nicht während und nach dem Neuaufbau vor loadedmetadata', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    // erstes falsches Ende: weich, zweites: Neuaufbau (load() setzt die Position auf 0)
    const fake = () => {
      el.ended = true;
      el.paused = true;
      el.emit('ended');
    };
    fake();
    vi.advanceTimersByTime(ENDED_DEBOUNCE_MS);
    fake();
    expect(el.loads).toBe(2);
    expect(el.currentTime).toBe(0);
    t.deck.heartbeat(Date.now());
    el.emit('timeupdate');
    expect(posLines(t)).toHaveLength(0);
    // nach loadedmetadata ist er wieder scharf
    el.readyState = 4;
    el.currentTime = c.start;
    el.emit('loadedmetadata');
    el.currentTime = 1;
    t.deck.heartbeat(Date.now());
    expect(posLines(t)).toHaveLength(1);
  });
  it('greift nicht bei einem Ausschnitt, der bei 0 beginnt', async () => {
    const t = setup();
    const c = clip('z', 0);
    const el = await boot(t, c);
    el.currentTime = 0;
    t.deck.heartbeat(Date.now());
    el.emit('timeupdate');
    expect(posLines(t)).toHaveLength(0);
  });
  it('greift nicht, wenn der Mensch pausiert hat', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    t.deck.pause(t.sink);
    el.currentTime = 5;
    t.deck.heartbeat(Date.now());
    expect(posLines(t)).toHaveLength(0);
  });
  it('mehr als drei Korrekturen führen zum Neuaufbau der Quelle', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    for (let i = 0; i < POS_FIX_MAX; i++) {
      el.currentTime = 0;
      t.deck.heartbeat(Date.now());
      expect(el.currentTime).toBeCloseTo(c.start, 5);
    }
    expect(el.loads).toBe(1);
    el.currentTime = 0;
    t.deck.heartbeat(Date.now());
    expect(el.loads).toBe(2);
    expect(t.lines.some((l) => l.startsWith('deck: position before clip start a') && l.endsWith('rebuilding'))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('deck: rebuilding source a'))).toBe(true);
  });
});

describe('Tausch auf ein Element des Vorrats im Zustand "Ende gemeldet"', () => {
  it('Rückschritt vor play(), kein Sprung auf 0, Diag-Zeile', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    const b = clip('b', 303.6);
    t.deck.fill([b]);
    const eb = t.els.find((x) => x.src.includes('/b.mp3'))!;
    eb.emit('loadedmetadata');
    eb.readyState = 4;
    eb.emit('canplaythrough');
    // iOS meldet bei teilweise geladener Quelle duration gleich Startstelle
    eb.duration = 303.6;
    eb.currentTime = 303.6;
    t.deck.swapNext(t.sink);
    await flush();
    expect(t.lines.some((l) => l.startsWith('deck: swap at reported end b t=303.6 dur=303.6, stepping back'))).toBe(true);
    expect(eb.plays).toBe(1);
    expect(eb.jumps).toBe(0);
    expect(eb.currentTime).toBeGreaterThanOrEqual(303.6 - STEP_BACK - 1e-9);
    expect(eb.currentTime).toBeLessThan(303.6);
  });
  it('normaler Tausch ohne Ende-Zustand: keine Zeile, Position unverändert', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    const b = clip('b', 303.6);
    t.deck.fill([b]);
    const eb = t.els.find((x) => x.src.includes('/b.mp3'))!;
    eb.emit('loadedmetadata');
    eb.readyState = 4;
    eb.currentTime = 303.6;
    eb.emit('canplaythrough');
    t.deck.swapNext(t.sink);
    await flush();
    expect(t.lines.some((l) => l.includes('swap at reported end'))).toBe(false);
    expect(eb.currentTime).toBeCloseTo(303.6, 5);
  });
});

describe('echtes Ende', () => {
  it('Position am clip.end schaltet weiter wie bisher', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.currentTime = c.end! + 0.01;
    el.ended = true;
    el.paused = true;
    el.emit('ended');
    expect(t.states).toContain(0);
    expect(posLines(t)).toHaveLength(0);
  });
});
