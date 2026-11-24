// Runde 32: Audio läuft im Hintergrund weiter. Verdeckt nachfüllen (abgesicherte Messung) und, wenn nichts bereit ist, übernimmt das aktive Element den nächsten Moment.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, BG_INLINE_MS, BG_INLINE_NEXT, BG_REFILL, BG_REFILL_MS, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

const mode: { v: 'now' | 'never' | 'reject' | 'playing' | number } = { v: 'now' };
const refuse = { v: false };

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
  muted = false;
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
    if (refuse.v && !this.src.startsWith('data:')) {
      this.log.push('play:refused');
      return Promise.reject(new DOMException('no', 'NotAllowedError'));
    }
    const sil = this.src.startsWith('data:');
    if (sil && mode.v !== 'now') {
      this.log.push('play:silence');
      this.paused = false;
      this.emit('play');
      if (mode.v === 'never') return new Promise<void>(() => {});
      if (mode.v === 'reject') return Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
      if (mode.v === 'playing') {
        setTimeout(() => this.emit('playing'), 100);
        return new Promise<void>(() => {});
      }
      return new Promise<void>((ok) => setTimeout(ok, mode.v as number));
    }
    this.log.push(this.src.startsWith('data:') ? 'play:silence' : this.muted ? 'play:muted' : 'play');
    this.paused = false;
    this.emit('play');
    if (!this.src.startsWith('data:')) this.emit('playing');
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
  /** Wie iOS: duration fällt auf die Position, ended kommt, das Element pausiert */
  collapse() {
    this.duration = this.currentTime;
    this.emit('durationchange');
    this.ended = true;
    this.paused = true;
    this.emit('pause');
    this.emit('ended');
  }
  tick(t: number) {
    this.t = t;
    this.emit('timeupdate');
  }
  /** Eintrag bereit: Metadaten, Sprung, seeked */
  ready(target: number) {
    this.meta(target);
    if (this.seeking) this.seeked();
    else this.emit('canplaythrough');
  }
}

const clip = (id: string): DeckClip => ({ key: `${id}|10|14`, id, url: `https://pod.test/${id}.mp3`, start: 10, end: 14 });



const ALL = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(clip);

function setup(opts: { bgInline?: boolean; bgRefill?: boolean; bgRefillEarly?: boolean } = {}) {
  const els: El[] = [];
  const hid = { v: false };
  const deck = new AudioDeck({
    standby: true,
    // Runde 38: diese Tests prüfen das Verhalten von Runde 32 bis 37, das frühere Nachladen hat tests/audio-round38.test.ts
    bgRefillEarly: false,
    ...opts,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      els.push(e);
      return e;
    },
    hidden: () => hid.v,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const adv: string[] = [];
  let cur = 0;
  deck.nextClips = (n) => ALL.slice(cur + 1, cur + 1 + n);
  deck.onAdvance = (_f, to) => {
    cur = ALL.findIndex((c) => c.key === to.key);
    adv.push(to.id);
  };
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink, hid, adv };
}
type T = ReturnType<typeof setup>;
const act = (t: T) => t.deck.element as El;
const withSrc = (t: T, id: string) => t.els.find((e) => e.src.endsWith(`/${id}.mp3`));
const has = (t: T, re: RegExp) => t.lines.filter((l) => re.test(l)).length;
const adv = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** a spielt, b liegt bereit, dann verdeckt */
async function boot(t: T) {
  t.deck.unlock('pointerup');
  await adv(10);
  t.deck.load(ALL[0], t.sink, { play: true, muted: false });
  await adv(10);
  const a = act(t);
  a.meta(10);
  a.seeked();
  await adv(10);
  t.deck.fill([ALL[1]]);
  withSrc(t, 'b')!.ready(10);
  await adv(10);
  t.hid.v = true;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  refuse.v = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Hintergrund läuft weiter (Runde 32)', () => {
  it('die Schalter stehen auf true', () => {
    expect(BG_INLINE_NEXT).toBe(true);
    expect(BG_REFILL).toBe(true);
  });

  it('(1) verdeckt, Vorrat 1, vier Momente enden nacheinander: nachgefüllt, durchgespielt, kein stalled', async () => {
    const t = setup();
    await boot(t);
    for (let i = 0; i < 4; i++) {
      const el = act(t);
      el.tick(14);
      await adv(10);
      // das Nachfüllen (ein Eintrag) wird bereit, wie ein Netz, das verdeckt antwortet
      const next = ALL[Math.min(i + 2, ALL.length - 1)].id;
      const ld = withSrc(t, next);
      if (ld && !ld.paused === false && ld !== act(t)) ld.ready(10);
      await adv(10);
    }
    expect(t.adv).toEqual(['b', 'c', 'd', 'e']);
    expect(act(t).paused).toBe(false);
    expect(has(t, /^bg: end without switch/)).toBe(0);
    expect(has(t, /^bg: refill c \(pool 0\)$/)).toBe(1);
    expect(has(t, /^bg: refill ready c after \d+ ms$/)).toBe(1);
    expect(has(t, /^bg: inline next /)).toBe(0);
    // höchstens sechs Elemente
    expect(t.els.length).toBeLessThanOrEqual(6);
  });

  it('(2) das verdeckte Laden kommt nie an: nach der Frist "refill lost", Stufe B spielt weiter, beim Sichtbarwerden wird zurückgesetzt', async () => {
    const t = setup();
    await boot(t);
    act(t).tick(14);
    await adv(10);
    expect(has(t, /^bg: refill c \(pool 0\)$/)).toBe(1);
    const stuck = withSrc(t, 'c')!;
    await adv(BG_REFILL_MS + 10);
    expect(has(t, /^bg: refill lost c \(timeout rs=\d+ ns=\S+\)$/)).toBe(1);
    // das Ende von b: nichts bereit, das aktive Element nimmt c selbst
    const b = act(t);
    b.log.length = 0;
    b.tick(14);
    await adv(10);
    expect(has(t, /^bg: inline next c \(pool empty\)$/)).toBe(1);
    expect(act(t)).toBe(b);
    expect(b.src).toBe('https://pod.test/c.mp3');
    expect(b.log.filter((l) => l === 'play')).toEqual([]);
    b.meta(10);
    expect(b.log).toContain('seek:10');
    b.seeked();
    await adv(10);
    expect(b.log.filter((l) => l === 'play')).toHaveLength(1);
    expect(b.muted).toBe(false);
    expect(has(t, /^bg: inline next playing c after \d+ ms$/)).toBe(1);
    expect(t.adv).toEqual(['b', 'c']);
    expect(has(t, /^bg: end without switch/)).toBe(0);
    // der verdächtige Eintrag trägt noch seine Quelle, bis die Seite sichtbar wird
    expect(stuck.src).toBe('https://pod.test/c.mp3');
    t.hid.v = false;
    t.deck.pageEvent('visible');
    expect(stuck.src).toBe('');
  });

  it('(2b) nach zwei verlorenen Versuchen in einer Hintergrund-Phase keine weiteren Nachfüllversuche', async () => {
    const t = setup({ bgInline: false });
    await boot(t);
    act(t).tick(14);
    await adv(BG_REFILL_MS + 10);
    expect(has(t, /^bg: refill lost /)).toBe(1);
    // ohne Rückfall hält b an, ein zweiter Versuch kommt nur nach einem weiteren Wechsel, den es hier nicht gibt
    expect(has(t, /^bg: refill /)).toBe(2);
  });

  it('(3) play nach dem Quellwechsel wird abgelehnt: ein Versuch, kein Dauerschleifen', async () => {
    const t = setup({ bgRefill: false });
    await boot(t);
    act(t).tick(14);
    await adv(10);
    const b = act(t);
    refuse.v = true;
    b.tick(14);
    await adv(10);
    expect(has(t, /^bg: inline next c \(pool empty\)$/)).toBe(1);
    b.meta(10);
    b.seeked();
    await adv(10);
    expect(has(t, /^bg: inline next refused c NotAllowedError$/)).toBe(1);
    const n = b.log.filter((l) => l === 'play:refused').length;
    await adv(20000);
    expect(b.log.filter((l) => l === 'play:refused').length).toBe(n);
    expect(has(t, /^bg: inline next (playing|timeout)/)).toBe(0);
    // ein erneutes Ende desselben Moments versucht es nicht noch einmal
    b.tick(14);
    await adv(10);
    expect(has(t, /^bg: inline next c \(pool empty\)$/)).toBe(1);
  });

  it('Rückfall ohne Metadaten: nach BG_INLINE_MS "inline next timeout"', async () => {
    const t = setup({ bgRefill: false });
    await boot(t);
    act(t).tick(14);
    await adv(10);
    // ein Netz, das nichts liefert: das play() des Elements antwortet nie und es kommt kein playing
    act(t).play = () => new Promise<void>(() => {});
    act(t).tick(14);
    await adv(BG_INLINE_MS + 10);
    expect(has(t, /^bg: inline next timeout c after \d+ ms rs=\d+ ns=\S+$/)).toBe(1);
  });

  it('(4) beide Schalter false: Verhalten wie vor Runde 32, Ende ohne Wechsel, kein Nachfüllen, keine neue Quelle', async () => {
    const t = setup({ bgInline: false, bgRefill: false });
    await boot(t);
    act(t).tick(14);
    await adv(10);
    expect(has(t, /^bg: refill /)).toBe(0);
    const b = act(t);
    b.tick(14);
    await adv(10);
    expect(has(t, /^bg: inline next /)).toBe(0);
    expect(has(t, /^bg: end without switch b /)).toBe(1);
    expect(b.src).toBe('https://pod.test/b.mp3');
    expect(b.paused).toBe(true);
    expect(t.adv).toEqual(['b']);
  });

  it('sichtbar (Vordergrund) bleibt alles wie bisher: kein Rückfall, kein Nachfüllen durch Runde 32', async () => {
    const t = setup();
    await boot(t);
    t.hid.v = false;
    act(t).tick(14);
    await adv(10);
    expect(has(t, /^bg: (inline next|refill)/)).toBe(0);
  });
});
