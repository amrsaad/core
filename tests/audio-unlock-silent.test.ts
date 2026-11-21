// Runde 29: stilles Freischalten. Die Geste schaltet Elemente ohne Netzquelle mit der stillen Inline-Quelle frei und spielt nie eine Netzquelle an.
// Elemente mit Netzquelle (aktiv, Vorrat) bleiben unberührt. Vorrats-Elemente springen direkt nach den Metadaten, ohne vorheriges play().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, POOL, UNLOCK_SILENT, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  private t = 0;
  get currentTime() {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
    this.log.push(`seek:${v}`);
    this.seeking = true;
    this.emit('seeking');
  }
  seeking = false;
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
    this.emit('play');
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.log.push('pause');
    this.emit('pause');
  }
  load() {
    this.t = 0;
    this.readyState = 0;
    this.seeking = false;
    this.duration = Number.NaN;
    this.log.push('load');
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
  /** Metadaten und Daten ab der Startstelle */
  meta(target: number) {
    this.duration = 600;
    this.buffered = { length: 1, start: () => target - 1, end: () => target + 4 };
    this.readyState = 4;
    this.emit('loadedmetadata');
  }
  seeked() {
    this.seeking = false;
    this.emit('seeked');
    this.emit('canplay');
    this.emit('canplaythrough');
  }
  /** Eintrag bereit: Metadaten, Sprung, seeked */
  ready(target: number) {
    this.meta(target);
    if (this.seeking) this.seeked();
    else this.emit('canplaythrough');
  }
}

const clip = (id: string, start = 30): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60 });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup(unlockSilent?: boolean) {
  const els: El[] = [];
  const deck = new AudioDeck({
    neverMuted: false,
    standby: true,
    ...(unlockSilent === undefined ? {} : { unlockSilent }),
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      els.push(e);
      return e;
    },
    hidden: () => false,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => t.els.find((e) => e.src.endsWith(`/${id}.mp3`))!;
const unlockedSet = (t: T) => (t.deck as unknown as { unlockedEls: WeakSet<object> }).unlockedEls;
const netPlays = (e: El) => e.log.filter((l) => l === 'play').length;
const gesture = async (t: T, type = 'pointerup') => {
  t.deck.unlock(type);
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Aktiver Moment spielt (Kaltstart auf einem nicht freigeschalteten Element, alter Weg), zwei Einträge im Vorrat, alle mit Netzquelle */
async function coldPool(t = setup()) {
  t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
  await flush();
  const a = t.deck.element as El;
  a.meta(10);
  a.seeked();
  await flush();
  t.deck.fill([clip('b'), clip('c')]);
  return t;
}

describe('stilles Freischalten (Runde 29)', () => {
  it('der Schalter steht auf true', () => {
    expect(UNLOCK_SILENT).toBe(true);
  });

  it('(1) die erste Geste schaltet alle freien Elemente mit der Inline-Quelle frei, auf Elementen mit Netzquelle läuft kein play()', async () => {
    const t = await coldPool();
    const a = t.deck.element as El;
    const aBefore = netPlays(a);
    const bc = [elOf(t, 'b'), elOf(t, 'c')];
    expect(t.els).toHaveLength(3);
    await gesture(t);
    // die Geste legt die übrigen Elemente bis zur Obergrenze an und spielt sie mit Stille an
    expect(t.els).toHaveLength(POOL + 1);
    const free = t.els.filter((e) => e !== a && !bc.includes(e));
    expect(free).toHaveLength(POOL + 1 - 3);
    for (const e of free) {
      expect(e.log.filter((l) => l === 'play:silence')).toHaveLength(1);
      expect(netPlays(e)).toBe(0);
    }
    for (const e of bc) expect(e.log.some((l) => l.startsWith('play'))).toBe(false);
    expect(netPlays(a)).toBe(aBefore);
    // und jedes play() lief auf einem Element, dessen Quelle zu diesem Zeitpunkt die Inline-Quelle war (der Nachbau trennt beides im Protokoll)
    expect(t.lines.filter((l) => l.startsWith(`deck: gesture unlock ${POOL + 1 - 3} elements ok=${POOL + 1 - 3} rejected=0 timeout=0 after `))).toHaveLength(1);
    expect(t.lines.some((l) => /^deck: probe (b|c) /.test(l))).toBe(false);
  });

  it('(2) danach trägt kein Element mehr die Inline-Quelle, alle freien stehen in unlockedEls, der Zustand bleibt über weitere Gesten gleich', async () => {
    const t = await coldPool();
    const a = t.deck.element as El;
    await gesture(t);
    const free = t.els.filter((e) => e !== a && !['b', 'c'].some((id) => e === elOf(t, id)));
    for (const e of free) {
      expect(e.src).toBe('');
      expect(e.paused).toBe(true);
      expect(unlockedSet(t).has(e)).toBe(true);
    }
    expect(t.els.some((e) => e.src.startsWith('data:'))).toBe(false);
    const plays = t.els.map((e) => e.log.length);
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click']) await gesture(t, type);
    expect(t.els.map((e) => e.log.length)).toEqual(plays);
    expect(t.lines.filter((l) => l.startsWith('deck: gesture unlock'))).toHaveLength(1);
    // b und c sind nicht freigeschaltet und bleiben es, bis sie im Wisch spielen
    expect(unlockedSet(t).has(elOf(t, 'b'))).toBe(false);
    expect(unlockedSet(t).has(elOf(t, 'c'))).toBe(false);
  });

  it('ein Element, das erst nach der Geste frei wird (Vorrat verbraucht), wird bei der nächsten Geste still freigeschaltet, nie mit seiner Netzquelle', async () => {
    const t = await coldPool();
    await gesture(t);
    // b und c verlassen den Vorrat: ihre Quellen gehen frei (sichtbar), die nächste Geste schaltet sie still frei
    t.deck.fill([clip('x', 50)]);
    await flush();
    const b = t.els.find((e) => !unlockedSet(t).has(e) && e !== t.deck.element);
    expect(b).toBeDefined();
    const before = b!.log.filter((l) => l === 'play').length;
    await gesture(t, 'click');
    expect(b!.log.filter((l) => l === 'play').length).toBe(before);
    expect(unlockedSet(t).has(b!)).toBe(true);
    expect(b!.src).toBe('');
  });

  it('(3) ein Vorrats-Element springt nach den Metadaten ohne vorheriges play(), freigeschaltet oder nicht', async () => {
    const t = await coldPool();
    await gesture(t);
    // Eintrag auf einem freigeschalteten Element
    t.deck.fill([clip('d', 40), clip('b'), clip('c')]);
    const d = elOf(t, 'd');
    expect(unlockedSet(t).has(d)).toBe(true);
    d.ready(40);
    expect(d.log.filter((l) => l !== 'play:silence' && l !== 'pause').slice(-2)).toEqual(['load', 'seek:40']);
    expect(netPlays(d)).toBe(0);
    expect(t.deck.poolReady('d|40|100', true)).toBe(true);
    // Eintrag auf einem nicht freigeschalteten Element: ebenfalls sofort der Sprung, kein play()
    const b = elOf(t, 'b');
    expect(unlockedSet(t).has(b)).toBe(false);
    b.ready(30);
    expect(b.log).toEqual(['load', 'seek:30']);
    expect(t.deck.poolReady('b|30|90')).toBe(true);
  });

  it('(7) UNLOCK_SILENT = false: das Verhalten von da2670a, die Geste spielt jeden Eintrag an, der Eintrag springt sofort', async () => {
    const t = setup(false);
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    await flush();
    (t.deck.element as El).readyState = 3;
    t.deck.fill([clip('b'), clip('c')]);
    for (const id of ['b', 'c']) elOf(t, id).ready(30);
    for (const id of ['b', 'c']) {
      expect(elOf(t, id).currentTime).toBe(30);
      expect(netPlays(elOf(t, id))).toBe(0);
    }
    await gesture(t);
    for (const id of ['b', 'c']) {
      expect(netPlays(elOf(t, id))).toBe(1);
      expect(elOf(t, id).currentTime).toBe(30);
    }
    expect(t.lines.filter((l) => /^deck: probe done (b|c) ok=1/.test(l))).toHaveLength(2);
    expect(t.lines.some((l) => l.startsWith('deck: gesture unlock'))).toBe(false);
  });

  it('(8) höchstens POOL + 1 Elemente, auch nach vielen Gesten, Füllungen und Wechseln', async () => {
    const t = await coldPool();
    for (let i = 0; i < 6; i++) {
      await gesture(t, i % 2 ? 'pointerup' : 'click');
      t.deck.fill([clip(`n${i}`, 20 + i), clip(`m${i}`, 40 + i)]);
      for (const e of t.els) if (e.src && e.readyState === 0) e.ready(e.src.includes('/n') ? 20 + i : 40 + i);
      await flush();
      expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
    }
    t.deck.load(clip('n5', 25), t.sink, { play: true, muted: false });
    await flush();
    expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
  });
});
