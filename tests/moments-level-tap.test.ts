// Gleiche Lautheit, Ergänzung 30.10.2026: laufenden Moment bei der ersten Berührung anbinden, Rückfall behält die Stelle,
// Kontext-Unterbrechung führt auf die unveränderte Spur zurück, Host-Probe ersetzt den Fehlversuch mitten im Ton.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';
import { laneFor, loudLine } from '../src/moments/loudness';

class FakeEl implements DeckEl {
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 600;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  calls: string[] = [];
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.calls.push('play');
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
    this.calls.push('load');
    this.currentTime = 0;
  }
}

const clip = (id: string, gain: number, end = 120): DeckClip => ({ key: `${id}|0|${end}`, id, url: `https://pod.test/${id}.mp3`, start: 0, end, gain });

/** Deck mit der echten Spurregel (laneFor), der Kontext lässt sich ein- und ausschalten */
function setup(opts: { host?: 'ok' | 'bad' } = {}) {
  const plain = new FakeEl();
  const level = new FakeEl();
  const state = { running: false, broken: [] as string[], chained: [] as number[], hosts: [] as string[] };
  const deck = new AudioDeck({
    local: () => undefined,
    dropLocal: () => {},
    make: (lv) => (lv ? level : plain),
    hidden: () => false,
    lane: (c, local, force) => laneFor({ enabled: true, running: state.running, gainDb: c.gain ?? 0, local, url: c.url, host: opts.host, forcePlain: force }),
    chain: (_el, db) => {
      state.chained.push(db);
      return { linear: () => 10 ** (db / 20) };
    },
    host: (u, s) => state.hosts.push(`${s} ${u}`),
    running: () => state.running,
    broken: (why) => state.broken.push(why),
  });
  const sink: DeckSink = { state: () => {}, error: () => {} };
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  return { deck, plain, level, sink, lines, state };
}

describe('erste Berührung: laufenden Moment anbinden (relevel)', () => {
  it('vor der Berührung läuft der Moment unverändert, danach hängt er an der geregelten Spur, an der aktuellen Stelle', () => {
    const t = setup();
    t.deck.load(clip('a', 6), t.sink, { play: true, muted: false });
    expect(t.deck.loud(t.sink)?.how).toBe('unchanged: no audio context');
    t.plain.currentTime = 31.4;
    t.state.running = true;
    expect(t.deck.relevel()).toBe(true);
    expect(t.level.src).toBe('https://pod.test/a.mp3#t=31.4');
    expect(t.level.calls).toContain('play');
    expect(t.plain.paused).toBe(true);
    expect(t.state.chained).toEqual([6]);
    const l = t.deck.loud(t.sink);
    expect(l?.how).toBe('web audio');
    expect(l?.db).toBe(6);
    expect(l?.linear).toBeCloseTo(1.995, 2);
  });

  it('der Ton bleibt wie er war (stumm bleibt stumm, hörbar bleibt hörbar)', () => {
    const t = setup();
    t.deck.load(clip('a', -4), t.sink, { play: true, muted: true });
    t.state.running = true;
    t.deck.relevel();
    expect(t.level.muted).toBe(true);
    const u = setup();
    u.deck.load(clip('a', -4), u.sink, { play: true, muted: false });
    u.state.running = true;
    u.deck.relevel();
    expect(u.level.muted).toBe(false);
  });

  it('nichts zu tun: ohne Anpassung, Host ohne CORS, schon geregelt, wenige Sekunden vor dem Ende, angehaltener Moment ohne Wunsch bleibt angehalten', () => {
    const none = setup();
    none.deck.load(clip('a', 0), none.sink, { play: true, muted: false });
    none.state.running = true;
    expect(none.deck.relevel()).toBe(false);

    const bad = setup({ host: 'bad' });
    bad.deck.load(clip('a', 6), bad.sink, { play: true, muted: false });
    bad.state.running = true;
    expect(bad.deck.relevel()).toBe(false);
    expect(bad.deck.loud(bad.sink)?.how).toBe('unchanged: no audio context');

    const done = setup();
    done.deck.load(clip('a', 6), done.sink, { play: true, muted: false });
    done.state.running = true;
    expect(done.deck.relevel()).toBe(true);
    expect(done.deck.relevel()).toBe(false);

    const late = setup();
    late.deck.load(clip('a', 6, 120), late.sink, { play: true, muted: false });
    late.plain.currentTime = 117;
    late.state.running = true;
    expect(late.deck.relevel()).toBe(false);

    const held = setup();
    held.deck.load(clip('a', 6), held.sink, { play: false, muted: false });
    held.state.running = true;
    held.deck.relevel();
    expect(held.level.calls).not.toContain('play');
  });

  it('scheitert der Versuch (kein CORS), geht es an derselben Stelle unverändert weiter, nie an den Anfang, Grund skipped cors', () => {
    const t = setup();
    t.deck.load(clip('a', 6), t.sink, { play: true, muted: false });
    t.plain.currentTime = 42;
    t.state.running = true;
    t.deck.relevel();
    t.level.emit('error');
    expect(t.plain.src).toBe('https://pod.test/a.mp3#t=42');
    expect(t.deck.loud(t.sink)?.how).toBe('unchanged: skipped cors');
    expect(t.plain.calls.filter((c) => c === 'play').length).toBe(2);
    t.plain.emit('loadedmetadata');
    expect(t.state.hosts).toEqual(['bad https://pod.test/a.mp3']);
  });
});

describe('Kontext wird unterbrochen (iOS, gesperrter Bildschirm)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function levelled() {
    const t = setup();
    t.state.running = true;
    t.deck.load(clip('a', 6), t.sink, { play: true, muted: false });
    expect(t.deck.loud(t.sink)?.how).toBe('web audio');
    // Die Prüfung 700 ms nach dem Start des Elements (Kontext läuft?) ist durch, bevor die Unterbrechung kommt
    vi.advanceTimersByTime(1000);
    return t;
  }

  it('läuft der Kontext nach der Frist nicht, zurück auf die unveränderte Spur an der aktuellen Stelle, Leveling bleibt für die Sitzung aus', () => {
    const t = levelled();
    t.level.currentTime = 55.5;
    t.state.running = false;
    t.deck.contextChanged('suspended');
    vi.advanceTimersByTime(1400);
    expect(t.plain.calls).not.toContain('play');
    vi.advanceTimersByTime(200);
    expect(t.plain.src).toBe('https://pod.test/a.mp3#t=55.5');
    expect(t.plain.calls).toContain('play');
    expect(t.level.paused).toBe(true);
    expect(t.deck.loud(t.sink)?.how).toBe('unchanged: context suspended');
    expect(t.state.broken).toEqual(['context suspended']);
    expect(t.lines.some((l) => l.includes('level lane abandoned (context suspended)'))).toBe(true);
  });

  it('setzt iOS den Kontext von selbst fort, bleibt alles wie es ist', () => {
    const t = levelled();
    t.state.running = false;
    t.deck.contextChanged('interrupted');
    vi.advanceTimersByTime(800);
    t.state.running = true;
    t.deck.contextChanged('running');
    vi.advanceTimersByTime(2000);
    expect(t.plain.calls).not.toContain('play');
    expect(t.deck.loud(t.sink)?.how).toBe('web audio');
    expect(t.state.broken).toEqual([]);
  });

  it('läuft gerade nichts, passiert nichts', () => {
    const t = levelled();
    t.level.pause();
    t.state.running = false;
    t.deck.contextChanged('suspended');
    vi.advanceTimersByTime(2000);
    expect(t.plain.calls).not.toContain('play');
  });
});

describe('Diag-Zeile skipped cors', () => {
  it('Host ohne CORS: Zeile sagt loud: skipped cors und nennt lufs und den angewendeten Gain 0', () => {
    expect(laneFor({ enabled: true, running: true, gainDb: 5, local: false, url: 'https://anchor.test/a.mp3', host: 'bad' })).toEqual({ lane: 'plain', why: 'skipped cors' });
    expect(loudLine(-21, 0, 'unchanged: skipped cors')).toBe('loud: skipped cors, lufs -21.0, gain 0.0 dB (unchanged: skipped cors)');
    expect(loudLine(-21, 5, 'web audio')).toBe('loud: lufs -21.0, gain +5.0 dB (web audio)');
  });
});

describe('Tempo ungleich 1x: nie Web Audio (Issue 13, Max 30.10.2026)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('laneFor: bei 1.5x und 2x die unveränderte Spur, bei 1x und ohne Angabe die geregelte', () => {
    const o = { enabled: true, running: true, gainDb: 5, local: false, url: 'https://pod.test/a.mp3' };
    expect(laneFor({ ...o, rate: 1.5 })).toEqual({ lane: 'plain', why: 'tempo' });
    expect(laneFor({ ...o, rate: 2 })).toEqual({ lane: 'plain', why: 'tempo' });
    expect(laneFor({ ...o, rate: 1 }).lane).toBe('level');
    expect(laneFor(o).lane).toBe('level');
  });

  it('Tempowechsel auf 2x mitten im Moment: Wechsel auf die unveränderte Spur an der Stelle, Tempo bleibt', () => {
    const t = setup();
    t.state.running = true;
    t.deck.load(clip('a', 6), t.sink, { play: true, muted: false });
    expect(t.deck.loud(t.sink)?.how).toBe('web audio');
    vi.advanceTimersByTime(1000);
    t.level.currentTime = 40;
    t.deck.setRate(2);
    expect(t.lines.some((l) => l.includes('level lane abandoned (tempo)'))).toBe(true);
    expect(t.plain.src).toBe('https://pod.test/a.mp3#t=40');
    expect(t.plain.calls).toContain('play');
    expect(t.level.paused).toBe(true);
    expect(t.plain.defaultPlaybackRate).toBe(2);
    expect(t.plain.playbackRate).toBe(2);
    expect(t.deck.loud(t.sink)?.how).toBe('unchanged: tempo');
  });

  it('Tempo 1x ändert nichts, ein zweites setRate(2) wechselt nicht noch einmal', () => {
    const t = setup();
    t.state.running = true;
    t.deck.load(clip('a', 6), t.sink, { play: true, muted: false });
    vi.advanceTimersByTime(1000);
    t.deck.setRate(1);
    expect(t.deck.loud(t.sink)?.how).toBe('web audio');
    t.deck.setRate(2);
    const n = t.lines.filter((l) => l.includes('abandoned (tempo)')).length;
    t.deck.setRate(2);
    expect(t.lines.filter((l) => l.includes('abandoned (tempo)')).length).toBe(n);
    expect(n).toBe(1);
  });
});
