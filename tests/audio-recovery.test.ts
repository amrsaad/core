// Runde 17: falsches ended, stehende Zeit und fehlendes playing im Audio-Deck. Reine Funktionen und das Verhalten des Decks mit nachgebautem Element.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADVANCE_MIN,
  AudioDeck,
  CLIP_RECOVER_MAX,
  END_NEAR_DUR,
  FROZEN_MS,
  frozen,
  plausibleEnd,
  recoverStep,
  sampleTime,
  timeAdvancing,
  type DeckClip,
  type DeckEl,
  type DeckSink,
  type TimeSamples,
} from '../src/video/audioDeck';

describe('plausibleEnd', () => {
  const base = { t: 100, dur: 3000, clipEnd: 160 as number | undefined, offset: 0 };
  it('Position am Start des Ausschnitts ist kein Ende', () => {
    expect(plausibleEnd({ ...base, t: 100 })).toBe(false);
    expect(plausibleEnd({ ...base, t: 130 })).toBe(false);
  });
  it('Position am Ende des Ausschnitts (mit Toleranz) ist ein Ende', () => {
    expect(plausibleEnd({ ...base, t: 160 })).toBe(true);
    expect(plausibleEnd({ ...base, t: 159.8 })).toBe(true);
    expect(plausibleEnd({ ...base, t: 159.5 })).toBe(false);
    expect(plausibleEnd({ ...base, t: 170 })).toBe(true);
  });
  it('der Versatz der Quelle zählt zur Position', () => {
    expect(plausibleEnd({ t: 40, dur: 3000, clipEnd: 160, offset: 120 })).toBe(true);
    expect(plausibleEnd({ t: 30, dur: 3000, clipEnd: 160, offset: 120 })).toBe(false);
  });
  it('kurz vor duration ist ein Ende der Quelle, auch ohne clip.end', () => {
    expect(plausibleEnd({ t: 3000 - END_NEAR_DUR, dur: 3000, clipEnd: undefined, offset: 0 })).toBe(true);
    expect(plausibleEnd({ t: 3000 - END_NEAR_DUR - 0.1, dur: 3000, clipEnd: undefined, offset: 0 })).toBe(false);
    expect(plausibleEnd({ ...base, clipEnd: 4000, t: 2999 })).toBe(true);
  });
  it('duration NaN, Infinity oder 0 und clip.end fehlt: nie plausibel', () => {
    for (const dur of [NaN, Infinity, 0, -1]) expect(plausibleEnd({ t: 5000, dur, clipEnd: undefined, offset: 0 })).toBe(false);
  });
  it('duration Infinity: nur clip.end entscheidet', () => {
    expect(plausibleEnd({ t: 161, dur: Infinity, clipEnd: 160, offset: 0 })).toBe(true);
    expect(plausibleEnd({ t: 100, dur: Infinity, clipEnd: 160, offset: 0 })).toBe(false);
  });
  it('t NaN ist nie ein Ende', () => {
    expect(plausibleEnd({ ...base, t: NaN })).toBe(false);
  });
  it('Tempo 2x ändert nichts: die Position steht in Elementzeit', () => {
    expect(plausibleEnd({ ...base, t: 100.05 })).toBe(false);
  });
});

describe('sampleTime und timeAdvancing', () => {
  it('zwei Proben mit Zuwachs über ADVANCE_MIN: läuft', () => {
    let s: TimeSamples | null = sampleTime(null, 10);
    expect(timeAdvancing(s)).toBe(false);
    s = sampleTime(s, 10 + ADVANCE_MIN + 0.01);
    expect(timeAdvancing(s)).toBe(true);
  });
  it('Zuwachs genau ADVANCE_MIN oder weniger: läuft nicht', () => {
    const s = sampleTime(sampleTime(null, 10), 10 + ADVANCE_MIN);
    expect(timeAdvancing(s)).toBe(false);
  });
  it('mehrere kleine Schritte summieren sich (Tempo 1, Abfrage alle 150 ms)', () => {
    let s: TimeSamples | null = null;
    for (const t of [20, 20.15, 20.3]) s = sampleTime(s, t);
    expect(timeAdvancing(s)).toBe(true);
  });
  it('Rückwärts, Sprung oder NaN beginnt neu', () => {
    expect(sampleTime(sampleTime(null, 50), 10)).toEqual({ first: 10, last: 10, n: 1 });
    expect(sampleTime(sampleTime(null, 0), 2500)).toEqual({ first: 2500, last: 2500, n: 1 });
    expect(sampleTime(sampleTime(null, 1), NaN)).toBeNull();
    expect(timeAdvancing(null)).toBe(false);
  });
});

describe('frozen', () => {
  const on = { active: true };
  it('steht die Position FROZEN_MS lang, meldet er eingefroren', () => {
    let prev: { t: number; at: number } | null = null;
    let r = frozen({ prev, t: 5, now: 1000, ...on });
    expect(r.frozen).toBe(false);
    prev = r.next;
    r = frozen({ prev, t: 5, now: 1000 + FROZEN_MS - 1, ...on });
    expect(r.frozen).toBe(false);
    r = frozen({ prev, t: 5, now: 1000 + FROZEN_MS, ...on });
    expect(r.frozen).toBe(true);
  });
  it('Bewegung beginnt die Messung neu', () => {
    const prev = { t: 5, at: 0 };
    const r = frozen({ prev, t: 5.5, now: FROZEN_MS * 2, ...on });
    expect(r.frozen).toBe(false);
    expect(r.next).toEqual({ t: 5.5, at: FROZEN_MS * 2 });
  });
  it('nicht aktiv (Puffern, pausiert, verdeckt, zu Ende): keine Messung, kein Alarm', () => {
    const r = frozen({ prev: { t: 5, at: 0 }, t: 5, now: 60_000, active: false });
    expect(r).toEqual({ next: null, frozen: false });
  });
  it('NaN als Position: keine Messung', () => {
    expect(frozen({ prev: null, t: NaN, now: 0, ...on })).toEqual({ next: null, frozen: false });
  });
  it('t exakt am Start und stehend: eingefroren nach FROZEN_MS (Tempo 2x ändert nichts)', () => {
    const a = frozen({ prev: null, t: 2414.5, now: 0, ...on });
    expect(frozen({ prev: a.next, t: 2414.5, now: FROZEN_MS, ...on }).frozen).toBe(true);
  });
});

describe('recoverStep', () => {
  it('erstes falsches Ende: soft, danach Neuaufbau, danach aufgeben', () => {
    expect(recoverStep({ n: 0, kind: 'ended', hidden: false })).toBe('soft');
    expect(recoverStep({ n: 1, kind: 'ended', hidden: false })).toBe('rebuild');
    expect(recoverStep({ n: CLIP_RECOVER_MAX, kind: 'ended', hidden: false })).toBe('giveup');
  });
  it('stehende Zeit baut sofort neu auf', () => {
    expect(recoverStep({ n: 0, kind: 'frozen', hidden: false })).toBe('rebuild');
  });
  it('verdeckt kein Quellwechsel: Neuaufbau wird vertagt, die erste Stufe bleibt', () => {
    expect(recoverStep({ n: 1, kind: 'ended', hidden: true })).toBe('defer');
    expect(recoverStep({ n: 0, kind: 'frozen', hidden: true })).toBe('defer');
    expect(recoverStep({ n: 0, kind: 'ended', hidden: true })).toBe('soft');
  });
});

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
  plays = 0;
  loads = 0;
  /** true: play() meldet kein playing (iOS lässt es aus), das Element läuft trotzdem */
  silent = false;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.plays++;
    this.paused = false;
    this.ended = false;
    if (!this.silent) this.emit('playing');
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

const clip = (id: string, start = 414.1, len = 48): DeckClip => ({ key: `${id}|${start}|${start + len}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + len });
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function setup(hidden = false, silent = false) {
  const els: El[] = [];
  const state = { hidden };
  const deck = new AudioDeck({
    standby: true,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      e.silent = silent;
      els.push(e);
      return e;
    },
    hidden: () => state.hidden,
    running: () => true,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const states: number[] = [];
  let errors = 0;
  const sink: DeckSink = { state: (s) => states.push(s), error: () => errors++ };
  return { deck, els, lines, sink, states, state, errs: () => errors };
}
type T = ReturnType<typeof setup>;

/** Ausschnitt laden, spielen lassen, Metadaten melden (der Sprung steht schon an der Startstelle) */
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Deck: läuft aus fortschreitender Position ableiten', () => {
  it('ohne playing, mit wachsender Zeit über zwei timeupdate: Zustand 1 und Diag-Zeile', async () => {
    const t = setup(false, true);
    const c = clip('a');
    const el = await boot(t, c);
    expect(t.states).not.toContain(1);
    el.emit('timeupdate');
    expect(t.states).not.toContain(1);
    el.currentTime = c.start + 0.5;
    el.emit('timeupdate');
    expect(t.states).toContain(1);
    expect(t.lines).toContain('deck: playing inferred (time advancing) a');
  });
  it('ohne Zuwachs oder bei readyState unter 3: nichts', async () => {
    const t = setup(false, true);
    const c = clip('a');
    const el = await boot(t, c);
    el.emit('timeupdate');
    el.emit('timeupdate');
    el.readyState = 2;
    el.currentTime = c.start + 3;
    el.emit('timeupdate');
    expect(t.states).not.toContain(1);
  });
  it('die Abfrage des Feeds leitet es ebenfalls ab', async () => {
    const t = setup(false, true);
    const c = clip('a');
    const el = await boot(t, c);
    t.deck.heartbeat(Date.now());
    el.currentTime = c.start + 0.6;
    t.deck.heartbeat(Date.now());
    expect(t.states).toContain(1);
  });
});

describe('Deck: falsches ended', () => {
  it('ended an der Startstelle: kein Ende, kein Weiter, Position und play() erneut', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    const plays = el.plays;
    el.ended = true;
    el.paused = true;
    el.emit('pause');
    el.emit('ended');
    expect(t.states).not.toContain(0);
    expect(t.lines.some((l) => l.startsWith('deck: false ended a t=414.1 dur=3000.0, recovering'))).toBe(true);
    expect(el.plays).toBe(plays + 1);
    expect(el.currentTime).toBeCloseTo(c.start, 5);
    expect(el.loads).toBe(1);
  });
  it('zweites falsches Ende: Quelle am selben Element neu, danach noch eines: Fehlerweg', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    const fake = () => {
      el.ended = true;
      el.paused = true;
      el.emit('ended');
    };
    fake();
    expect(el.loads).toBe(1);
    fake();
    expect(el.loads).toBe(2);
    expect(t.els.length).toBeGreaterThanOrEqual(1);
    expect(t.lines.some((l) => l.startsWith('deck: rebuilding source a'))).toBe(true);
    // nach dem Neuaufbau meldet das Element wieder Metadaten und spielt
    await flush();
    el.readyState = 4;
    el.emit('loadedmetadata');
    await flush();
    fake();
    expect(t.errs()).toBe(1);
    expect(t.lines).toContain('deck: recovery gave up a');
    expect(t.states).not.toContain(0);
  });
  it('echtes Ende (Position am clip.end) bleibt ein Ende', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.currentTime = c.end! + 0.01;
    el.ended = true;
    el.paused = true;
    el.emit('ended');
    expect(t.states).toContain(0);
    expect(t.lines.some((l) => l.includes('false ended'))).toBe(false);
  });
  it('echtes Ende der Quelle (kurz vor duration, clip.end dahinter) bleibt ein Ende', async () => {
    const t = setup();
    const c = clip('a', 2990, 100);
    const el = await boot(t, c);
    el.currentTime = 2999;
    el.ended = true;
    el.paused = true;
    el.emit('ended');
    expect(t.states).toContain(0);
  });
  it('verdeckt: erstes falsches Ende heilt per Position und play(), der Neuaufbau wartet auf die Rückkehr', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    t.state.hidden = true;
    const fake = () => {
      el.ended = true;
      el.paused = true;
      el.emit('ended');
    };
    fake();
    fake();
    expect(el.loads).toBe(1);
    t.state.hidden = false;
    el.paused = false;
    t.deck.heartbeat(Date.now());
    expect(el.loads).toBe(2);
  });
  it('die Abfrage wertet el.ended ebenfalls, ohne ended-Ereignis', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.ended = true;
    el.paused = false;
    t.deck.heartbeat(Date.now());
    expect(t.lines.some((l) => l.startsWith('deck: false ended a'))).toBe(true);
    expect(t.states).not.toContain(0);
  });
});

describe('Deck: Schnitt ohne timeupdate und stehende Zeit', () => {
  it('Abfrage löst clipEnd aus, sobald die Position clip.end erreicht', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.currentTime = c.end! - 0.01;
    t.deck.heartbeat(Date.now());
    expect(t.states).toContain(0);
    expect(el.paused).toBe(true);
  });
  it('stehende Zeit 4 s lang: Diag, Neuaufbau mit Sprung auf die Startstelle', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    let now = 1_000_000;
    t.deck.heartbeat(now);
    now += FROZEN_MS - 1;
    t.deck.heartbeat(now);
    expect(el.loads).toBe(1);
    now += 1;
    t.deck.heartbeat(now);
    expect(t.lines).toContain('deck: time frozen a t=414.1 ended=false, recovering');
    expect(el.loads).toBe(2);
    expect(el.src).toContain('#t=414.1');
  });
  it('Puffern (readyState unter 3), Pause oder verdeckt: kein Alarm', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    let now = 1_000_000;
    t.deck.heartbeat(now);
    el.readyState = 2;
    now += 10_000;
    t.deck.heartbeat(now);
    el.readyState = 4;
    t.deck.heartbeat(now);
    t.state.hidden = true;
    now += 10_000;
    t.deck.heartbeat(now);
    expect(t.lines.some((l) => l.includes('time frozen'))).toBe(false);
    expect(el.loads).toBe(1);
  });
  it('laufende Zeit löst nichts aus', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    let now = 1_000_000;
    for (let i = 0; i < 100; i++) {
      el.currentTime += 0.3;
      now += 150;
      t.deck.heartbeat(now);
    }
    expect(t.lines.some((l) => l.includes('time frozen') || l.includes('false ended'))).toBe(false);
  });
});
