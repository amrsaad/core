// Runde 17: falsches ended, stehende Zeit und fehlendes playing im Audio-Deck. Reine Funktionen und das Verhalten des Decks mit nachgebautem Element.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADVANCE_MIN,
  AudioDeck,
  CLIP_RECOVER_MAX,
  END_MIN_ADVANCE,
  END_NEAR_DUR,
  ENDED_DEBOUNCE_MS,
  FROZEN_MS,
  frozen,
  ignoreEnded,
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
  const base = { t: 100, dur: 3000, clipEnd: 160 as number | undefined, offset: 0, advanced: 10 };
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
    expect(plausibleEnd({ t: 40, dur: 3000, clipEnd: 160, offset: 120, advanced: 10 })).toBe(true);
    expect(plausibleEnd({ t: 30, dur: 3000, clipEnd: 160, offset: 120, advanced: 10 })).toBe(false);
  });
  it('kurz vor duration ist ein Ende der Quelle, auch ohne clip.end', () => {
    expect(plausibleEnd({ t: 3000 - END_NEAR_DUR, dur: 3000, clipEnd: undefined, offset: 0, advanced: 10 })).toBe(true);
    expect(plausibleEnd({ t: 3000 - END_NEAR_DUR - 0.1, dur: 3000, clipEnd: undefined, offset: 0, advanced: 10 })).toBe(false);
    expect(plausibleEnd({ ...base, clipEnd: 4000, t: 2999 })).toBe(true);
  });
  it('duration NaN, Infinity oder 0 und clip.end fehlt: nie plausibel', () => {
    for (const dur of [NaN, Infinity, 0, -1]) expect(plausibleEnd({ t: 5000, dur, clipEnd: undefined, offset: 0, advanced: 10 })).toBe(false);
  });
  it('duration Infinity: nur clip.end entscheidet', () => {
    expect(plausibleEnd({ t: 161, dur: Infinity, clipEnd: 160, offset: 0, advanced: 10 })).toBe(true);
    expect(plausibleEnd({ t: 100, dur: Infinity, clipEnd: 160, offset: 0, advanced: 10 })).toBe(false);
  });
  it('Runde 18: Dauer nahe der Position ohne gelaufenen Ausschnitt ist kein Ende (ended an der Startstelle, duration gleich t)', () => {
    expect(plausibleEnd({ t: 1405.9, dur: 1405.9, clipEnd: 1453.9, offset: 0, advanced: 0 })).toBe(false);
    expect(plausibleEnd({ t: 1405.9, dur: 1406.5, clipEnd: 1453.9, offset: 0, advanced: 1.9 })).toBe(false);
    expect(plausibleEnd({ t: 1405.9, dur: 1405.9, clipEnd: undefined, offset: 0, advanced: 0 })).toBe(false);
  });
  it('Runde 18: ended nahe duration nach 3 s Lauf ist ein echtes Ende der Quelle', () => {
    expect(plausibleEnd({ t: 1408.9, dur: 1409, clipEnd: 1453.9, offset: 0, advanced: 3 })).toBe(true);
    expect(plausibleEnd({ t: 1408.9, dur: 1409, clipEnd: 1453.9, offset: 0, advanced: END_MIN_ADVANCE })).toBe(true);
  });
  it('Runde 18: die Position am clip.end gilt auch ohne advanced (der Ausschnitt ist am Ende)', () => {
    expect(plausibleEnd({ t: 160, dur: 3000, clipEnd: 160, offset: 0, advanced: 0 })).toBe(true);
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
  it('Runde 18: stehende Zeit mit ended=true beginnt auch mit soft, dann Neuaufbau', () => {
    expect(recoverStep({ n: 0, kind: 'frozen', hidden: false })).toBe('soft');
    expect(recoverStep({ n: 1, kind: 'frozen', hidden: false })).toBe('rebuild');
    expect(recoverStep({ n: CLIP_RECOVER_MAX, kind: 'frozen', hidden: false })).toBe('giveup');
  });
  it('verdeckt kein Quellwechsel: Neuaufbau wird vertagt, die erste Stufe bleibt', () => {
    expect(recoverStep({ n: 1, kind: 'ended', hidden: true })).toBe('defer');
    expect(recoverStep({ n: 1, kind: 'frozen', hidden: true })).toBe('defer');
    expect(recoverStep({ n: 0, kind: 'ended', hidden: true })).toBe('soft');
    expect(recoverStep({ n: 0, kind: 'frozen', hidden: true })).toBe('soft');
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
    expect(t.lines.some((l) => l.startsWith('deck: false ended a t=414.1 dur=3000.0 adv=0.0, recovering'))).toBe(true);
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
    // Runde 21: ein zweites ended innerhalb von 300 ms zählt nicht (eigener Test unten)
    vi.advanceTimersByTime(ENDED_DEBOUNCE_MS);
    fake();
    expect(el.loads).toBe(2);
    expect(t.els.length).toBeGreaterThanOrEqual(1);
    expect(t.lines.some((l) => l.startsWith('deck: rebuilding source a'))).toBe(true);
    // nach dem Neuaufbau meldet das Element wieder Metadaten und spielt
    await flush();
    el.readyState = 4;
    el.emit('loadedmetadata');
    await flush();
    vi.advanceTimersByTime(ENDED_DEBOUNCE_MS);
    fake();
    expect(t.errs()).toBe(1);
    expect(t.lines).toContain('deck: recovery gave up a');
    expect(t.states).not.toContain(0);
  });
  it('Runde 21: ein zweites ended Millisekunden nach der Wiederherstellung wird ignoriert, kein Neuaufbau', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    el.ended = true;
    el.paused = true;
    el.emit('ended');
    expect(t.lines.some((l) => l.includes('false ended'))).toBe(true);
    el.currentTime = 0;
    el.duration = 0;
    el.emit('ended');
    expect(el.loads).toBe(1);
    expect(t.lines.some((l) => l.startsWith('deck: ended ignored a (recovering)'))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('deck: rebuilding source'))).toBe(false);
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
  it('Runde 18: ended an der Startstelle mit duration gleich t (iOS, Quelle teilweise geladen) ist ein falsches Ende, Zeile mit adv', async () => {
    const t = setup();
    const c = clip('a', 1405.9, 48);
    const el = await boot(t, c);
    el.duration = 1405.9;
    const plays = el.plays;
    el.ended = true;
    el.paused = true;
    el.emit('ended');
    expect(t.states).not.toContain(0);
    expect(t.lines.some((l) => l.startsWith('deck: false ended a t=1405.9 dur=1405.9 adv=0.0, recovering'))).toBe(true);
    expect(el.plays).toBe(plays + 1);
  });
  it('Runde 18: ended nahe duration nach 3 s Lauf ist ein echtes Ende', async () => {
    const t = setup();
    const c = clip('a', 2990, 100);
    const el = await boot(t, c);
    el.duration = 2994;
    el.currentTime = 2993;
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
    vi.advanceTimersByTime(ENDED_DEBOUNCE_MS);
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
  it('Runde 18: stehende Zeit mit ended=false ist Puffern: kein Neuaufbau, kein start(), Lade-Zustand am Sink, Diag einmal je Ausschnitt', async () => {
    const t = setup();
    const c = clip('a');
    const el = await boot(t, c);
    const loads: boolean[] = [];
    t.deck.onLoading = (on) => loads.push(on);
    const plays = el.plays;
    const n0 = t.lines.length;
    let now = 1_000_000;
    t.deck.heartbeat(now);
    now += FROZEN_MS - 1;
    t.deck.heartbeat(now);
    expect(t.states).not.toContain(3);
    now += 1;
    t.deck.heartbeat(now);
    expect(t.lines).toContain('deck: buffering inferred (time not advancing) a t=414.1');
    expect(t.states).toContain(3);
    expect(loads).toEqual([true]);
    expect(el.loads).toBe(1);
    expect(el.plays).toBe(plays);
    expect(t.lines.slice(n0).some((l) => l.includes('time frozen') || l.includes('rebuilding') || l.includes('src net'))).toBe(false);
    // Bleibt die Zeit stehen, bleibt es beim Laden, die Zeile steht nur einmal
    for (let i = 0; i < 3; i++) {
      now += FROZEN_MS;
      t.deck.heartbeat(now);
      now += FROZEN_MS;
      t.deck.heartbeat(now);
    }
    expect(t.lines.filter((l) => l.startsWith('deck: buffering inferred')).length).toBe(1);
    expect(el.loads).toBe(1);
    expect(t.errs()).toBe(0);
    // Die Zeit läuft wieder: als laufend abgeleitet, Laden aus
    el.currentTime += 0.5;
    t.deck.heartbeat(now + 150);
    el.currentTime += 0.5;
    t.deck.heartbeat(now + 300);
    expect(t.states[t.states.length - 1]).toBe(1);
    expect(loads[loads.length - 1]).toBe(false);
  });
  it('Runde 18: stehende Zeit mit ended=true: erst soft (Position, play()), erst bei erneutem Stillstand der Neuaufbau', async () => {
    const t = setup(false, true);
    const c = clip('a');
    const el = await boot(t, c);
    el.currentTime = c.start + 5;
    el.ended = true;
    const plays = el.plays;
    let now = 1_000_000;
    t.deck.heartbeat(now);
    now += FROZEN_MS;
    t.deck.heartbeat(now);
    expect(t.lines).toContain('deck: time frozen a t=419.1 ended=true, recovering');
    expect(el.plays).toBe(plays + 1);
    expect(el.loads).toBe(1);
    expect(t.lines.some((l) => l.startsWith('deck: rebuilding'))).toBe(false);
    // Es hilft nicht: wieder ended=true und stehende Zeit
    el.ended = true;
    t.deck.heartbeat(now + 150);
    now += FROZEN_MS + 150;
    t.deck.heartbeat(now);
    expect(el.loads).toBe(2);
    expect(t.lines.some((l) => l.startsWith('deck: rebuilding source a'))).toBe(true);
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

describe('ignoreEnded (Runde 21)', () => {
  it('innerhalb von 300 ms nach Beginn der Wiederherstellung wird ignoriert', () => {
    expect(ignoreEnded({ sinceRecoverMs: 5, t: 12, dur: 90 })).toBe('recovering');
    expect(ignoreEnded({ sinceRecoverMs: ENDED_DEBOUNCE_MS - 1, t: 12, dur: 90 })).toBe('recovering');
    expect(ignoreEnded({ sinceRecoverMs: ENDED_DEBOUNCE_MS, t: 12, dur: 90 })).toBeNull();
  });
  it('leere Dauer an der Startstelle wird ignoriert', () => {
    expect(ignoreEnded({ sinceRecoverMs: 5000, t: 0, dur: 0 })).toBe('empty');
    expect(ignoreEnded({ sinceRecoverMs: 5000, t: 0.4, dur: Number.NaN })).toBe('empty');
    expect(ignoreEnded({ sinceRecoverMs: 5000, t: 0, dur: Number.POSITIVE_INFINITY })).toBe('empty');
  });
  it('leere Dauer bei t ab 0,5 oder gültige Dauer wird gewertet', () => {
    expect(ignoreEnded({ sinceRecoverMs: 5000, t: 0.5, dur: 0 })).toBeNull();
    expect(ignoreEnded({ sinceRecoverMs: 5000, t: 0, dur: 60 })).toBeNull();
    expect(ignoreEnded({ sinceRecoverMs: Number.POSITIVE_INFINITY, t: 30, dur: 60 })).toBeNull();
  });
  it('ein echtes Ende bleibt davon unberührt (plausibleEnd zuerst)', () => {
    expect(plausibleEnd({ t: 160, dur: 0, clipEnd: 160, offset: 0, advanced: 60 })).toBe(true);
  });
});
