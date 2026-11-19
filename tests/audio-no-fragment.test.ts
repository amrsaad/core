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
  /** Runde 25: Puffer-Bereiche (undefined: das Gerät liefert keine) */
  buffered: { length: number; start(i: number): number; end(i: number): number } | undefined = undefined;
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
  /** Runde 25 (Geräteprotokoll 18.11. 18:44): iOS setzt nach dem Sprung in einen nicht geladenen Bereich duration auf currentTime, pausiert und meldet ended */
  iosFalseEnd() {
    this.duration = this.t;
    this.ended = true;
    this.paused = true;
    this.readyState = 4;
    this.emit('pause');
    this.emit('ended');
  }
  /** Runde 25: Daten kommen an (Puffer deckt bis real, Dauer wieder echt) */
  dataArrives(real: number) {
    this.duration = real;
    this.buffered = { length: 1, start: () => 0, end: () => real };
    this.emit('durationchange');
    this.emit('progress');
    this.emit('canplay');
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
    // Runde 27: dieses Verhalten (Eintrag springt sofort, Geste spielt jeden Eintrag an) gilt mit probeParked: true; die neue Regel prüft audio-unlock-first.test.ts
    probeParked: true,
    // Runde 27: diese Datei prüft die bestehende Kette (Warten, Wiederherstellung, Neuaufbau) am selben Element, das Ausweichen steht in audio-collapse.test.ts
    dodge: false,
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

describe('Runde 25: nach falschem Ende auf Daten warten', () => {
  /** Kaltstart wie im Protokoll: Metadaten mit echter Dauer, Sprung bestätigt, dann das falsche Ende */
  const coldThenFalseEnd = async (t: ReturnType<typeof setup>) => {
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    el.readyState = 1;
    el.emit('loadedmetadata');
    el.emit('seeked');
    el.readyState = 4;
    expect(el.currentTime).toBeCloseTo(303.6, 5);
    el.iosFalseEnd();
    return el;
  };
  const count = (t: ReturnType<typeof setup>, start: string) => t.lines.filter((l) => l.startsWith(start)).length;

  it('(1) während des Wartens kein Neustart, kein Neuaufbau, kein Sprung außer einem sanften Anstoß; stumm; Ladezustand', async () => {
    const states: number[] = [];
    const t = setup();
    const sink: DeckSink = { state: (s) => states.push(s), error: () => t.calls.error++, broken: () => t.calls.broken++ };
    t.deck.load(clip('a'), sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    el.readyState = 1;
    el.emit('loadedmetadata');
    el.emit('seeked');
    el.readyState = 4;
    const plays = el.plays;
    const loads = el.loads;
    el.iosFalseEnd();
    expect(t.lines.some((l) => /^deck: end before real end a t=303\.6 dur=303\.6 real=3000\.0, waiting for data$/.test(l))).toBe(true);
    expect(el.muted).toBe(true);
    expect(states[states.length - 1]).toBe(3);
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(150);
      t.deck.heartbeat(Date.now());
      if (i % 7 === 0) el.emit('ended');
    }
    expect(el.plays).toBe(plays);
    expect(el.loads).toBe(loads);
    expect(t.lines.some((l) => l.includes('false ended') || l.includes('rebuilding') || l.includes('restart') || l.includes('early ended'))).toBe(false);
    expect(states.includes(0)).toBe(false);
    expect(t.calls.error + t.calls.broken).toBe(0);
    expect(el.muted).toBe(true);
    // genau ein sanfter Anstoß, ohne load()
    expect(count(t, 'deck: data wait nudge a')).toBe(1);
    expect(el.currentTime).toBeCloseTo(303.35, 5);
  });

  it('(2) Daten da: genau ein play(), Ton an, Position zurück vom Ende-Zustand', async () => {
    const t = setup();
    const el = await coldThenFalseEnd(t);
    const plays = el.plays;
    vi.advanceTimersByTime(2000);
    expect(el.plays).toBe(plays);
    el.dataArrives(3000);
    expect(el.plays).toBe(plays + 1);
    expect(el.muted).toBe(false);
    expect(el.paused).toBe(false);
    expect(el.currentTime).toBeGreaterThan(300);
    expect(t.lines.filter((l) => /^deck: data ready a t=\d+\.\d after 2000 ms, play$/.test(l)).length).toBe(1);
    // weitere Ereignisse und Zeit: kein zweites play(), keine zweite Zeile
    el.emit('progress');
    el.emit('canplay');
    vi.advanceTimersByTime(8000);
    t.deck.heartbeat(Date.now());
    expect(el.plays).toBe(plays + 1);
    expect(count(t, 'deck: data ready a')).toBe(1);
    expect(count(t, 'deck: data wait timeout')).toBe(0);
  });

  it('(3) nach 6 s ohne Daten greift die bisherige Kette (Wiederherstellung), die Schleifensicherung bleibt', async () => {
    const t = setup();
    const el = await coldThenFalseEnd(t);
    const plays = el.plays;
    vi.advanceTimersByTime(5990);
    expect(el.plays).toBe(plays);
    expect(count(t, 'deck: data wait timeout')).toBe(0);
    vi.advanceTimersByTime(20);
    expect(t.lines.filter((l) => l === 'deck: data wait timeout a after 6000 ms').length).toBe(1);
    expect(count(t, 'deck: false ended a')).toBe(1);
    expect(el.plays).toBe(plays + 1);
    // iOS meldet das Ende wieder: kein zweites Warten, die Kette läuft weiter bis gestört
    for (let i = 0; i < 40; i++) {
      el.iosFalseEnd();
      vi.advanceTimersByTime(700);
      t.deck.heartbeat(Date.now());
    }
    expect(count(t, 'deck: end before real end')).toBe(1);
    expect(count(t, 'deck: data wait timeout')).toBe(1);
    expect(t.lines.some((l) => l.startsWith('deck: moment broken a'))).toBe(true);
    expect(t.calls.broken).toBe(1);
  });

  it('(4) echtes Ende am echten Ende und Ende des Ausschnitts bleiben Ende', async () => {
    const states: number[] = [];
    const t = setup();
    const sink: DeckSink = { state: (s) => states.push(s), error: () => {}, broken: () => {} };
    // Ausschnitt reicht über die Dauer der Datei hinaus: das Ende der Datei beendet ihn
    t.deck.load(clip('a', 2900, 200), sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    el.readyState = 4;
    el.emit('loadedmetadata');
    el.emit('seeked');
    el.currentTime = 2999.6;
    el.ended = true;
    el.paused = true;
    el.emit('ended');
    expect(states[states.length - 1]).toBe(0);
    expect(count(t, 'deck: end before real end')).toBe(0);
    // Ende des Ausschnitts mitten in der Datei
    const t2 = setup();
    const s2: number[] = [];
    t2.deck.load(clip('b', 303.6, 48), { state: (s) => s2.push(s), error: () => {}, broken: () => {} }, { play: true, muted: false });
    await flush();
    const e2 = t2.els[0];
    e2.readyState = 4;
    e2.emit('loadedmetadata');
    e2.emit('seeked');
    e2.currentTime = 351.5;
    e2.ended = true;
    e2.paused = true;
    e2.emit('ended');
    expect(s2[s2.length - 1]).toBe(0);
    expect(count(t2, 'deck: end before real end')).toBe(0);
  });

  it('(5) jede Zeile je Wartevorgang einmal, auch bei vielen ended-Ereignissen und Abfragen', async () => {
    const t = setup();
    const el = await coldThenFalseEnd(t);
    for (let i = 0; i < 20; i++) {
      el.emit('ended');
      el.emit('pause');
      el.emit('timeupdate');
      vi.advanceTimersByTime(150);
      t.deck.heartbeat(Date.now());
    }
    el.dataArrives(3000);
    vi.advanceTimersByTime(10000);
    expect(count(t, 'deck: end before real end')).toBe(1);
    expect(count(t, 'deck: data ready')).toBe(1);
    expect(count(t, 'deck: data wait timeout')).toBe(0);
    // kein falsches Ende, kein Neuaufbau
    expect(count(t, 'deck: false ended')).toBe(0);
    // Timeout-Zeile ebenfalls einmal
    const t2 = setup();
    await coldThenFalseEnd(t2);
    vi.advanceTimersByTime(30000);
    expect(count(t2, 'deck: data wait timeout')).toBe(1);
    expect(count(t2, 'deck: end before real end')).toBe(1);
  });

  it('Tausch auf Vorrats-Element: Dauer fiel auf die Startstelle, ein Ende danach wartet auf Daten', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    t.deck.fill([clip('b', 1923.5, 48)]);
    const eb = t.els.find((x) => x.src.includes('/b.mp3'))!;
    eb.duration = 2567.7;
    eb.readyState = 4;
    eb.emit('loadedmetadata');
    eb.emit('canplaythrough');
    expect(eb.currentTime).toBeCloseTo(1923.5, 5);
    // vor dem Tausch fällt die Dauer auf die Startstelle (Protokoll: dur=1923.5 target=1923.5 buf=2567.7)
    eb.duration = 1923.5;
    eb.buffered = { length: 1, start: () => 0, end: () => 2567.7 };
    t.deck.swapNext(t.sink);
    await flush();
    expect(t.lines.some((l) => l.startsWith('deck: swap at reported end b'))).toBe(true);
    const plays = eb.plays;
    eb.buffered = undefined;
    eb.iosFalseEnd();
    expect(t.lines.some((l) => /^deck: end before real end b t=\d+\.\d dur=\d+\.\d real=2567\.7, waiting for data$/.test(l))).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(eb.plays).toBe(plays);
  });
});
