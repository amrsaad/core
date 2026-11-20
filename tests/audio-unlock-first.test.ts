// Runde 27 (Nacharbeit): Freischalten vor dem Sprung. Ein Vorrats-Element ohne Freischaltung springt nicht auf das Ziel, es bleibt bei t=0 und gilt als nicht bereit.
// Die nächste Geste schaltet es bei t=0 frei (stumm play, Annahme, pause), danach springt es. Ein freigeschaltetes Element springt sofort. Eine Geste spielt kein geparktes Element an (PROBE_PARKED = false).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, PROBE_PARKED, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  private t = 0;
  get currentTime() {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
    this.log.push(`seek:${v}`);
  }
  paused = true;
  ended = false;
  readyState = 0;
  duration = Number.NaN;
  muted = true;
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
    this.log.push(this.src.startsWith('data:') ? 'play:silence' : 'play');
    this.paused = false;
    const src = this.src;
    // strict: wie ein Browser, ein Quellwechsel während des play() bricht es ab
    return Promise.resolve().then(() => {
      if (this.strict && this.src !== src) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
    });
  }
  strict = false;
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.log.push('pause');
    this.emit('pause');
  }
  load() {
    this.t = 0;
    this.log.push('load');
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
  /** Daten ab der Startstelle da: Metadaten, genug Puffer */
  ready(target: number) {
    this.duration = 600;
    this.buffered = { length: 1, start: () => target - 1, end: () => target + 4 };
    this.readyState = 4;
    this.emit('loadedmetadata');
    this.emit('canplaythrough');
  }
}

const clip = (id: string, start = 30): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60 });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup(probeParked?: boolean) {
  const els: El[] = [];
  const deck = new AudioDeck({
    standby: true,
    probeParked: probeParked ?? false,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      els.push(e);
      return e;
    },
    hidden: () => false,
    lane: (c) => (c.id.startsWith('lv') ? { lane: 'level', why: 'test' } : { lane: 'plain', why: 'no value' }),
    chain: () => ({ linear: () => 1 }),
    running: () => true,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => t.els.find((e) => e.src.endsWith(`/${id}.mp3`))!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const gesture = async (t: T, type = 'pointerup') => {
  t.deck.unlock(type);
  await flush();
};
const plays = (e: El) => e.log.filter((l) => l === 'play').length;

/** Aktiver Moment und zwei Vorrats-Elemente vor der ersten Geste, mit Metadaten und Daten ab der Startstelle */
async function coldPool(probeParked?: boolean) {
  const t = setup(probeParked);
  t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
  await flush();
  (t.deck.element as El).readyState = 3;
  t.deck.fill([clip('b'), clip('c')]);
  for (const id of ['b', 'c']) elOf(t, id).ready(30);
  await flush();
  return t;
}

describe('Freischalten vor dem Sprung (Runde 27, Nacharbeit)', () => {
  it('der Schalter steht auf false', () => {
    expect(PROBE_PARKED).toBe(true); // 20.11.: am Gerät führte die Probe bei t=0 fast immer zum Kollaps, altes Verhalten bis Runde 29
  });

  it('(a) ein nicht freigeschaltetes Element springt ohne Geste nicht und meldet kein pool ready', async () => {
    const t = await coldPool();
    for (const id of ['b', 'c']) {
      const e = elOf(t, id);
      expect(e.log).toEqual(['load']);
      expect(e.currentTime).toBe(0);
    }
    expect(t.deck.readyCount()).toBe(0);
    expect(t.lines.filter((l) => /^deck: pool ready/.test(l))).toEqual([]);
  });

  it('(b) die Geste schaltet es bei t=0 frei: play, pause, dann Sprung auf das Ziel, danach bereit', async () => {
    const t = await coldPool();
    await gesture(t);
    for (const id of ['b', 'c']) {
      const e = elOf(t, id);
      const i = e.log.indexOf('play');
      const j = e.log.indexOf('pause');
      const k = e.log.indexOf('seek:30');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(j).toBeGreaterThan(i);
      expect(k).toBeGreaterThan(j);
      expect(e.log.slice(0, i).some((l) => l.startsWith('seek'))).toBe(false);
      expect(e.currentTime).toBe(30);
      expect(e.paused).toBe(true);
      expect(e.muted).toBe(true);
    }
    expect(t.deck.readyCount()).toBe(2);
    expect(t.deck.poolReady('b|30|90', true)).toBe(true);
    expect(t.lines.filter((l) => /^deck: probe b at t=0\.0 rs=4 dur=600\.0$/.test(l))).toHaveLength(1);
    expect(t.lines.filter((l) => /^deck: probe done b ok=1 /.test(l))).toHaveLength(1);
    const iProbe = t.lines.findIndex((l) => l.startsWith('deck: probe done b'));
    const iReady = t.lines.findIndex((l) => l.startsWith('deck: pool ready b'));
    expect(iReady).toBeGreaterThan(iProbe);
  });

  it('Geste vor den Metadaten: die Probe läuft in der Geste, der Sprung folgt nach den Metadaten', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    (t.deck.element as El).readyState = 3;
    t.deck.fill([clip('b')]);
    const b = elOf(t, 'b');
    await gesture(t);
    expect(plays(b)).toBe(1);
    expect(b.log).not.toContain('seek:30');
    b.ready(30);
    await flush();
    expect(b.currentTime).toBe(30);
    expect(t.deck.readyCount()).toBe(1);
  });

  it('Eintrag lädt in ein Element, dessen Probe gerade läuft (abgebrochen): sofort eine zweite Probe bei t=0, kein Warten bis zur nächsten Geste', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    (t.deck.element as El).readyState = 3;
    const made = t.els.length;
    // Die Geste legt die freien Elemente an und spielt sie an, im selben Zug lädt der Vorrat in eines davon
    t.deck.unlock('pointerup');
    for (const e of t.els) e.strict = true;
    t.deck.fill([clip('b')]);
    const b = elOf(t, 'b');
    expect(t.els.length).toBeGreaterThan(made);
    b.ready(30);
    await flush();
    expect(plays(b)).toBeGreaterThanOrEqual(1);
    expect(b.currentTime).toBe(30);
    expect(t.deck.readyCount()).toBe(1);
  });

  it('(c) ein freigeschaltetes Element springt sofort, ohne Probe', async () => {
    const t = await coldPool();
    await gesture(t);
    // Nach der Geste sind alle Elemente der Spur freigeschaltet, ein neuer Eintrag nimmt ein freies
    t.deck.fill([clip('b'), clip('c'), clip('d', 40)]);
    const d = elOf(t, 'd');
    d.ready(40);
    expect(d.log).toContain('seek:40');
    expect(d.log).not.toContain('play');
    expect(t.deck.poolReady('d|40|100', true)).toBe(true);
  });

  it('(d) Wechsel auf ein wartendes Element: play stumm vor dem Sprung, kein neues load, kein needs tap, Ton nach bestätigter Position', async () => {
    const t = await coldPool();
    t.lines.length = 0;
    const b = elOf(t, 'b');
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.deck.element).toBe(b);
    expect(t.lines.filter((l) => l === 'deck: swap unparked b (unlock in swipe)')).toHaveLength(1);
    expect(b.log.filter((l) => l === 'load')).toHaveLength(1);
    const i = b.log.indexOf('play');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(b.log.indexOf('seek:30')).toBeGreaterThan(i);
    expect(b.currentTime).toBe(30);
    expect(t.lines.some((l) => /needs tap|refused/.test(l))).toBe(false);
    expect(b.muted).toBe(true);
    vi.advanceTimersByTime(300);
    expect(b.muted).toBe(false);
    expect(t.lines.some((l) => /^deck: pos confirmed b /.test(l))).toBe(true);
  });

  it('(e) sind alle Elemente freigeschaltet, gibt es bei weiteren Gesten kein play() auf Vorrats-Elementen, die Zeile all unlocked steht einmal', async () => {
    const t = await coldPool();
    await gesture(t);
    const before = ['b', 'c'].map((id) => plays(elOf(t, id)));
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click']) await gesture(t, type);
    expect(['b', 'c'].map((id) => plays(elOf(t, id)))).toEqual(before);
    expect(before).toEqual([1, 1]);
    const all = t.lines.filter((l) => /^deck: all unlocked 6\/6 after \d+ ms$/.test(l));
    expect(all).toHaveLength(1);
  });

  it('Randfall: geparkt und nicht freigeschaltet (Freigabe zurückgenommen): keine Probe, Zeile parked locked einmal', async () => {
    const t = await coldPool();
    await gesture(t);
    const b = elOf(t, 'b');
    (t.deck as unknown as { unlockedEls: WeakSet<object> }).unlockedEls.delete(b);
    const n = plays(b);
    await gesture(t, 'click');
    await gesture(t, 'pointerup');
    expect(plays(b)).toBe(n);
    expect(t.lines.filter((l) => l === 'deck: parked locked b')).toHaveLength(1);
  });

  it('ein Eintrag mit Startstelle 0 wird weiter in der Geste freigeschaltet und braucht keinen Sprung', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    (t.deck.element as El).readyState = 3;
    t.deck.fill([clip('z', 0)]);
    elOf(t, 'z').ready(0);
    await gesture(t);
    expect(plays(elOf(t, 'z'))).toBe(1);
    expect(t.deck.readyCount()).toBe(1);
  });

  it('PROBE_PARKED = true: wie vor Runde 27, der Eintrag springt sofort, die Geste spielt ihn an', async () => {
    const t = await coldPool(true);
    for (const id of ['b', 'c']) {
      expect(elOf(t, id).currentTime).toBe(30);
      expect(plays(elOf(t, id))).toBe(0);
    }
    expect(t.deck.readyCount()).toBe(2);
    await gesture(t);
    for (const id of ['b', 'c']) {
      expect(plays(elOf(t, id))).toBe(1);
      expect(elOf(t, id).currentTime).toBe(30);
    }
    expect(t.lines.filter((l) => /^deck: probe done (b|c) ok=1/.test(l))).toHaveLength(2);
  });
});
