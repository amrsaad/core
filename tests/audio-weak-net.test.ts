// Runde 18 (Diag 16.11., Mobilfunk): der Vorrat nahm dem aktiven Moment die Bandbreite (fünf parallele Abrufe ganzer Podcast-Dateien).
// poolBudget (reine Funktion), schwaches Netz merken, Neuladen nach Fehler mit Wartezeit, Zähler ankommender Daten.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, POOL, RELOAD_MAX, RELOAD_WAIT_MS, WEAK_NET_MS, WEAK_PLAY_MS, poolBudget, reloadGate, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

describe('poolBudget', () => {
  it('aktiver Moment spielt, Netz gut: höchstens zwei in Arbeit', () => {
    const b = (inflight: number) => poolBudget({ activePlaying: true, weakNet: false, inflight });
    expect([b(0), b(1), b(2), b(3)]).toEqual([2, 1, 0, 0]);
  });
  it('aktiver Moment spielt nicht: höchstens einer in Arbeit', () => {
    const b = (inflight: number) => poolBudget({ activePlaying: false, weakNet: false, inflight });
    expect([b(0), b(1), b(2)]).toEqual([1, 0, 0]);
  });
  it('schwaches Netz: höchstens einer, auch wenn der aktive spielt', () => {
    expect(poolBudget({ activePlaying: true, weakNet: true, inflight: 0 })).toBe(1);
    expect(poolBudget({ activePlaying: true, weakNet: true, inflight: 1 })).toBe(0);
    expect(poolBudget({ activePlaying: false, weakNet: true, inflight: 0 })).toBe(1);
    expect(poolBudget({ activePlaying: false, weakNet: true, inflight: 4 })).toBe(0);
  });
  it('nie negativ, negative Eingabe zählt als null', () => {
    expect(poolBudget({ activePlaying: true, weakNet: false, inflight: 7 })).toBe(0);
    expect(poolBudget({ activePlaying: true, weakNet: false, inflight: -3 })).toBe(2);
  });
});

describe('reloadGate', () => {
  it('ohne schwaches Netz sofort, wie bisher', () => {
    expect(reloadGate({ weakNet: false, fails: 1, sinceMs: 0 })).toBe('now');
    expect(reloadGate({ weakNet: false, fails: 9, sinceMs: 0 })).toBe('now');
  });
  it('kein Fehler bisher: sofort', () => {
    expect(reloadGate({ weakNet: true, fails: 0, sinceMs: 0 })).toBe('now');
  });
  it('schwaches Netz: erst nach RELOAD_WAIT_MS, höchstens RELOAD_MAX mal', () => {
    expect(reloadGate({ weakNet: true, fails: 1, sinceMs: RELOAD_WAIT_MS - 1 })).toBe('wait');
    expect(reloadGate({ weakNet: true, fails: 1, sinceMs: RELOAD_WAIT_MS })).toBe('now');
    expect(reloadGate({ weakNet: true, fails: RELOAD_MAX, sinceMs: RELOAD_WAIT_MS })).toBe('now');
    expect(reloadGate({ weakNet: true, fails: RELOAD_MAX + 1, sinceMs: 10 * RELOAD_WAIT_MS })).toBe('never');
  });
});

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
  /** true: play() meldet playing erst, wenn der Test es auslöst */
  quiet = false;
  buf = 0;
  private on = new Map<string, (() => void)[]>();
  get buffered() {
    const end = this.buf;
    return { length: end > 0 ? 1 : 0, end: () => end };
  }
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    // Runde 22: wie Safari, play() im Ende-Zustand springt an den Anfang
    if (this.ended || (Number.isFinite(this.duration) && this.duration > 0 && this.currentTime >= this.duration)) this.currentTime = 0;
    this.paused = false;
    if (!this.quiet) this.emit('playing');
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

const clip = (id: string): DeckClip => ({ key: `${id}|0|60`, id, url: `https://pod.test/${id}.mp3`, start: 0, end: 60 });
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function setup(quiet = false) {
  const els: El[] = [];
  const deck = new AudioDeck({
    neverMuted: false,
    standby: true,
    // Runde 27: dieses Verhalten (Eintrag springt sofort, Geste spielt jeden Eintrag an) gilt mit unlockSilent: false (Verhalten von da2670a); die neue Regel prüfen audio-unlock-silent.test.ts und audio-play-after-jump.test.ts
    unlockSilent: false,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      e.quiet = quiet;
      els.push(e);
      return e;
    },
    hidden: () => false,
    running: () => true,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => [...t.els].reverse().find((x) => x.src.includes(`/${id}.mp3`))!;
const loads = (t: T, id?: string) => t.lines.filter((l) => l.startsWith('deck: pool load ') && (!id || l.includes(` ${id} `))).length;
const ready = (t: T, id: string) => {
  const el = elOf(t, id);
  el.emit('loadedmetadata');
  el.readyState = 4;
  el.emit('canplaythrough');
};
const ids = ['b', 'c', 'd', 'e', 'f'];
const cs = ids.map(clip);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function playing(t: T) {
  t.deck.load(clip('a'), t.sink, { play: true, muted: false });
  await flush();
  t.els[0].readyState = 4;
}

describe('Vorrat im schwachen Netz', () => {
  it('"pool slow" macht das Netz schwach: eine Zeile, danach höchstens ein Abruf in Arbeit, auch wenn der aktive spielt', async () => {
    const t = setup();
    await playing(t);
    t.deck.fill(cs);
    expect(loads(t)).toBe(2);
    vi.advanceTimersByTime(8100);
    expect(t.lines.filter((l) => l === 'deck: weak net, pool one at a time').length).toBe(1);
    // b wird bereit, c noch in Arbeit: kein neuer Abruf (ein einziger in Arbeit erlaubt)
    ready(t, 'b');
    expect(loads(t)).toBe(2);
    // c wird bereit: genau einer folgt, nicht zwei
    ready(t, 'c');
    expect(loads(t)).toBe(3);
    ready(t, 'd');
    expect(loads(t)).toBe(4);
    ready(t, 'e');
    expect(loads(t)).toBe(POOL);
  });

  it('nach WEAK_NET_MS: Rückmeldung "net ok", wieder zwei in Arbeit', async () => {
    const t = setup();
    await playing(t);
    t.deck.fill(cs);
    vi.advanceTimersByTime(8100);
    expect(t.lines).toContain('deck: weak net, pool one at a time');
    vi.advanceTimersByTime(WEAK_NET_MS);
    expect(t.lines).toContain('deck: net ok, pool two at a time');
    expect(t.lines.filter((l) => l === 'deck: net ok, pool two at a time').length).toBe(1);
    ready(t, 'b');
    ready(t, 'c');
    // zwei in Arbeit sind wieder erlaubt: nach b folgt d, nach c folgt e
    expect(loads(t)).toBe(4);
  });

  it('weitere "pool slow" im schwachen Netz verlängern es, ohne neue Zeile', async () => {
    const t = setup();
    await playing(t);
    t.deck.fill(cs);
    vi.advanceTimersByTime(8100);
    vi.advanceTimersByTime(WEAK_NET_MS - 12_000);
    // ein neuer langsamer Abruf kurz vor Ablauf
    ready(t, 'b');
    ready(t, 'c');
    vi.advanceTimersByTime(8100);
    expect(t.lines.filter((l) => l === 'deck: weak net, pool one at a time').length).toBe(1);
    vi.advanceTimersByTime(WEAK_NET_MS - 1000);
    expect(t.lines).not.toContain('deck: net ok, pool two at a time');
  });

  it('der aktive Moment braucht mehr als WEAK_PLAY_MS bis playing: schwaches Netz', async () => {
    const t = setup(true);
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    // das Element meldet playing erst spät
    const el = t.els[0];
    vi.advanceTimersByTime(WEAK_PLAY_MS + 500);
    el.emit('playing');
    expect(t.lines).toContain('deck: weak net, pool one at a time');
  });

  it('der aktive Moment spielt schnell: kein schwaches Netz', async () => {
    const t = setup(true);
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    vi.advanceTimersByTime(WEAK_PLAY_MS - 1000);
    t.els[0].emit('playing');
    expect(t.lines).not.toContain('deck: weak net, pool one at a time');
  });

  it('Fehler im schwachen Netz: Neuladen frühestens nach RELOAD_WAIT_MS, höchstens RELOAD_MAX mal je Ausschnitt', async () => {
    const t = setup();
    await playing(t);
    t.deck.fill([clip('b')]);
    vi.advanceTimersByTime(8100);
    expect(t.lines).toContain('deck: weak net, pool one at a time');
    expect(loads(t, 'b')).toBe(1);
    const fail = () => {
      elOf(t, 'b').emit('error');
      t.deck.fill([clip('b')]);
    };
    // erster Fehler: nicht sofort neu
    fail();
    expect(loads(t, 'b')).toBe(1);
    vi.advanceTimersByTime(RELOAD_WAIT_MS - 500);
    expect(loads(t, 'b')).toBe(1);
    vi.advanceTimersByTime(600);
    expect(loads(t, 'b')).toBe(2);
    // zweiter Fehler: wieder erst nach der Wartezeit
    fail();
    expect(loads(t, 'b')).toBe(2);
    vi.advanceTimersByTime(RELOAD_WAIT_MS + 100);
    expect(loads(t, 'b')).toBe(3);
    // dritter Fehler: nie wieder (solange das Netz schwach ist)
    fail();
    vi.advanceTimersByTime(RELOAD_WAIT_MS * 3);
    expect(loads(t, 'b')).toBe(3);
    expect(RELOAD_MAX).toBe(2);
  });

  it('Fehler bei gutem Netz: Neuladen sofort, wie bisher', async () => {
    const t = setup();
    await playing(t);
    t.deck.fill([clip('b')]);
    expect(loads(t, 'b')).toBe(1);
    elOf(t, 'b').emit('error');
    t.deck.fill([clip('b')]);
    expect(loads(t, 'b')).toBe(2);
  });

  it('lokale Einträge zählen nicht mit und laden auch im schwachen Netz', async () => {
    const els: El[] = [];
    const deck = new AudioDeck({
    neverMuted: false,
      standby: true,
      local: (k) => (k === 'c|0|60' || k === 'd|0|60' ? { url: `blob:${k[0]}`, offset: 0 } : undefined),
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
    const sink: DeckSink = { state: () => {}, error: () => {} };
    deck.load(clip('a'), sink, { play: true, muted: false });
    await flush();
    els[0].readyState = 4;
    deck.fill([clip('b'), clip('c'), clip('d'), clip('e')]);
    vi.advanceTimersByTime(8100);
    expect(lines).toContain('deck: weak net, pool one at a time');
    expect(lines.filter((l) => l.startsWith('deck: pool load ') && l.endsWith('src=local')).length).toBe(2);
    // net: b und e, im schwachen Netz einer in Arbeit
    expect(lines.filter((l) => l.startsWith('deck: pool load ') && l.endsWith('src=net')).length).toBe(2);
  });
});

describe('Zähler ankommender Daten (bytes)', () => {
  it('wächst mit dem Puffer und mit progress, bleibt ohne Daten stehen, anderer Sink: 0', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    const el = t.els[0];
    el.readyState = 0;
    const b0 = t.deck.bytes(t.sink);
    expect(t.deck.bytes(t.sink)).toBe(b0);
    el.emit('progress');
    const b1 = t.deck.bytes(t.sink);
    expect(b1).toBeGreaterThan(b0);
    el.buf = 12.3;
    expect(t.deck.bytes(t.sink)).toBeGreaterThan(b1);
    expect(t.deck.bytes({ state: () => {}, error: () => {} })).toBe(0);
  });
});
