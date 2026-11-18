// Runde 24 (Geräteprotokoll 18.11.): Netzquellen tragen kein Medienfragment (#t=) mehr, iOS meldete damit duration gleich Startstelle und danach ended.
// Das Element bleibt stumm, bis currentTime an der Startstelle steht. Das Element hier verhält sich spezifikationstreu (play() im Ende-Zustand springt auf 0),
// "stubborn" bildet iOS nach: der Sprung vor den Metadaten und danach wird nicht angenommen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioDeck,
  FALSE_ENDED_MAX,
  POS_CONFIRM_MS,
  falseEndedGate,
  positionConfirmed,
  type DeckClip,
  type DeckEl,
  type DeckSink,
} from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  private t = 0;
  /** Sprünge der Position werden verworfen (iOS ignoriert currentTime, bis es will) */
  stubborn = false;
  seeking = false;
  get currentTime() {
    return this.t;
  }
  set currentTime(v: number) {
    if (this.stubborn) return;
    this.t = v;
    if (!Number.isFinite(this.duration) || v < this.duration) this.ended = false;
  }
  paused = true;
  ended = false;
  readyState = 0;
  duration = 3000;
  muted = false;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  plays = 0;
  loads = 0;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.plays++;
    if (this.ended || (Number.isFinite(this.duration) && this.duration > 0 && this.t >= this.duration)) this.t = 0;
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

function setup(hidden = false) {
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
    hidden: () => hidden,
    running: () => true,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const calls = { broken: 0, error: 0 };
  const sink: DeckSink = { state: () => {}, error: () => calls.error++, broken: () => calls.broken++ };
  return { deck, els, lines, sink, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('reine Funktionen', () => {
  it('positionConfirmed: Metadaten, kein Seek, nahe target, bei target über 2 nie unter 1', () => {
    const ok = { t: 303.5, target: 303.6, rs: 1, seeking: false };
    expect(positionConfirmed(ok)).toBe(true);
    expect(positionConfirmed({ ...ok, t: 303.0 })).toBe(false);
    expect(positionConfirmed({ ...ok, t: 0 })).toBe(false);
    expect(positionConfirmed({ ...ok, rs: 0 })).toBe(false);
    expect(positionConfirmed({ ...ok, seeking: true })).toBe(false);
    expect(positionConfirmed({ ...ok, t: NaN })).toBe(false);
    // target nahe 0: kein Sprung auf den Folgenanfang möglich
    expect(positionConfirmed({ t: 0.8, target: 1.2, rs: 1, seeking: false })).toBe(true);
    expect(positionConfirmed({ t: 0.5, target: 2.5, rs: 1, seeking: false })).toBe(false);
  });
  it('falseEndedGate: bis zur Grenze recover, dann Neuaufbau (Zähler neu), danach gestört; alte Ereignisse fallen aus dem Fenster', () => {
    let times: number[] = [];
    for (let i = 0; i < FALSE_ENDED_MAX; i++) {
      const g = falseEndedGate({ times, now: 1000 * i, rebuilt: false });
      expect(g.step).toBe('recover');
      times = g.times;
    }
    const g4 = falseEndedGate({ times, now: 3500, rebuilt: false });
    expect(g4.step).toBe('rebuild');
    expect(g4.times).toEqual([]);
    const after = falseEndedGate({ times: [0, 100, 200], now: 300, rebuilt: true });
    expect(after.step).toBe('broken');
    expect(falseEndedGate({ times: [0, 100, 200], now: 6000, rebuilt: false }).step).toBe('recover');
  });
});

describe('Quelle ohne Medienfragment', () => {
  it('Start mit Startpunkt: keine URL mit #t=, Sprung erst nach loadedmetadata', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    expect(el.src).toBe('https://pod.test/a.mp3');
    expect(el.src).not.toContain('#t=');
    el.readyState = 1;
    el.emit('loadedmetadata');
    expect(el.currentTime).toBeCloseTo(303.6, 5);
    expect(t.lines.some((l) => /^deck: pos set a target=303\.6 dur=3000\.0 t=303\.6 frag=none$/.test(l))).toBe(true);
  });
  it('Vorrat: keine URL mit #t= für Netzquellen', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    t.deck.fill([clip('b', 303.6), clip('c', 1649.4)]);
    const srcs = t.els.map((e) => e.src).filter(Boolean);
    expect(srcs.length).toBeGreaterThanOrEqual(3);
    for (const s of srcs) expect(s).not.toContain('#');
  });
  it('Neuaufbau (Wiederherstellung) und Rückkehr zur Quelle bleiben ohne Fragment', async () => {
    const t = setup();
    const c = clip('a');
    t.deck.load(c, t.sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    el.readyState = 4;
    el.emit('loadedmetadata');
    el.currentTime = 320;
    t.deck.setRate(1);
    el.ended = true;
    vi.advanceTimersByTime(700);
    t.deck.heartbeat(Date.now());
    vi.advanceTimersByTime(700);
    el.currentTime = 320;
    el.ended = true;
    t.deck.heartbeat(Date.now());
    for (const l of t.els.map((e) => e.src).filter(Boolean)) expect(l).not.toContain('#t=');
  });
});

describe('stumm bis die Position bestätigt ist', () => {
  it('Start: stumm, Sprung nicht angenommen: bleibt stumm, nach 1,5 s Zeile, letzter Sprung, Ton wie gewollt', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    expect(el.muted).toBe(true);
    el.stubborn = true;
    el.readyState = 1;
    el.emit('loadedmetadata');
    vi.advanceTimersByTime(POS_CONFIRM_MS - 100);
    expect(el.muted).toBe(true);
    el.stubborn = false;
    vi.advanceTimersByTime(100);
    expect(t.lines.some((l) => /^deck: pos unconfirmed a t=0\.0 target=303\.6 after 1500 ms$/.test(l))).toBe(true);
    // der letzte Sprung hat die Stelle gesetzt, danach Ton wie vom Host gewollt
    expect(el.currentTime).toBeCloseTo(303.6, 5);
    expect(el.muted).toBe(false);
  });
  it('Start: Position bestätigt, Ton an, eine Zeile mit Dauer', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    expect(el.muted).toBe(true);
    vi.advanceTimersByTime(300);
    el.readyState = 4;
    el.emit('loadedmetadata');
    el.emit('seeked');
    expect(el.muted).toBe(false);
    expect(t.lines.filter((l) => l.startsWith('deck: pos confirmed a t=303.6 after ')).length).toBe(1);
    expect(t.lines.some((l) => l.includes('pos unconfirmed'))).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(t.lines.filter((l) => l.startsWith('deck: pos confirmed')).length).toBe(1);
  });
  it('Host-Stummschaltung während der Wartezeit gilt ab Bestätigung (iOS: erster Start bleibt stumm bis zur Geste)', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: true });
    await flush();
    const el = t.els[0];
    expect(el.muted).toBe(true);
    el.readyState = 4;
    el.emit('loadedmetadata');
    el.emit('seeked');
    // bestätigt, aber der Host wollte stumm: bleibt stumm
    expect(el.muted).toBe(true);
    const t2 = setup();
    t2.deck.load(clip('a'), t2.sink, { play: true, muted: true });
    await flush();
    const e2 = t2.els[0];
    e2.stubborn = true;
    e2.readyState = 1;
    e2.emit('loadedmetadata');
    t2.deck.setMuted(t2.sink, false);
    expect(e2.muted).toBe(true);
    e2.stubborn = false;
    vi.advanceTimersByTime(POS_CONFIRM_MS);
    expect(e2.muted).toBe(false);
  });
  it('Entstummen von außen (ytApi.unMute schreibt auf das Element) bricht die Stummhaltung nicht, der Wunsch gilt ab Bestätigung', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: true });
    await flush();
    const el = t.els[0];
    el.stubborn = true;
    el.readyState = 1;
    el.emit('loadedmetadata');
    el.muted = false;
    el.emit('volumechange');
    expect(el.muted).toBe(true);
    el.stubborn = false;
    vi.advanceTimersByTime(POS_CONFIRM_MS);
    expect(el.muted).toBe(false);
  });
  it('Tausch auf Vorrats-Element: steht es an der Startstelle, kein Stummschalten; sonst stumm bis bestätigt', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    t.deck.fill([clip('b', 303.6)]);
    const eb = t.els.find((x) => x.src.includes('/b.mp3'))!;
    eb.readyState = 4;
    eb.emit('loadedmetadata');
    eb.emit('canplaythrough');
    expect(eb.currentTime).toBeCloseTo(303.6, 5);
    t.deck.swapNext(t.sink);
    await flush();
    expect(eb.muted).toBe(false);
    expect(t.lines.some((l) => l.startsWith('deck: pos set b target=303.6 dur=3000.0 t=303.6 frag=none'))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('deck: pos confirmed b t=303.6 after 0 ms'))).toBe(true);
    // zweites Element: iOS hat die Position zurückgesetzt
    t.deck.fill([clip('c', 1649.4)]);
    const ec = t.els.find((x) => x.src.includes('/c.mp3'))!;
    ec.readyState = 4;
    ec.emit('loadedmetadata');
    ec.emit('canplaythrough');
    ec.stubborn = true;
    ec.stubborn = false;
    ec.currentTime = 0;
    ec.stubborn = true;
    t.deck.swapNext(t.sink);
    await flush();
    expect(ec.muted).toBe(true);
    ec.stubborn = false;
    vi.advanceTimersByTime(POS_CONFIRM_MS);
    expect(t.lines.some((l) => l.startsWith('deck: pos unconfirmed c t=0.0 target=1649.4'))).toBe(true);
    expect(ec.muted).toBe(false);
    expect(ec.currentTime).toBeCloseTo(1649.4, 5);
  });
  it('verdeckt: keine Stummhaltung (iOS verweigert das Entstummen ohne Geste vermutlich)', async () => {
    const t = setup(true);
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.els[0].muted).toBe(false);
  });
  it('Quellwechsel während der Wartezeit: der gemerkte Ton geht nicht verloren (kein dauerhaft stummes Element)', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    t.deck.load(clip('b', 500), t.sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    el.readyState = 4;
    el.emit('loadedmetadata');
    el.emit('seeked');
    expect(el.muted).toBe(false);
    expect(t.lines.some((l) => l.startsWith('deck: pos confirmed b t=500.0'))).toBe(true);
  });
});

describe('Schleifensicherung', () => {
  /** ein falsches Ende mitten im Ausschnitt, spielend gemeldet */
  const falseEnd = (t: ReturnType<typeof setup>, el: El) => {
    el.readyState = 4;
    el.currentTime = 320;
    el.ended = true;
    el.paused = false;
    el.emit('playing');
    el.ended = true;
    vi.advanceTimersByTime(700);
    t.deck.heartbeat(Date.now());
  };
  it('höchstens drei Wiederherstellungen, Neuaufbau, dann gestört gemeldet: je Stufe eine Zeile, nie 50 gleiche', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    el.readyState = 4;
    el.emit('loadedmetadata');
    el.emit('seeked');
    for (let i = 0; i < 40; i++) falseEnd(t, el);
    const falseLines = t.lines.filter((l) => l.startsWith('deck: false ended a '));
    expect(falseLines.length).toBeLessThanOrEqual(FALSE_ENDED_MAX);
    expect(t.lines.filter((l) => l.startsWith('deck: false ended loop a')).length).toBe(1);
    expect(t.lines.filter((l) => l.startsWith('deck: moment broken a')).length).toBe(1);
    expect(t.calls.broken).toBe(1);
    // nach "gestört" bleibt es still
    const n = t.lines.length;
    for (let i = 0; i < 10; i++) falseEnd(t, el);
    expect(t.lines.length).toBe(n);
    expect(t.calls.broken).toBe(1);
    // kein Aufbau trägt ein Fragment
    for (const e of t.els) expect(e.src).not.toContain('#t=');
  });
});
