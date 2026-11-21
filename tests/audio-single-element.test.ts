// Runde 33: höchstens ein Element gibt Ton. Ein zweites, nicht pausiertes Element wird pausiert (nie stummgeschaltet), die Diag-Zeile kommt einmal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

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

function setup(opts: { bgInline?: boolean; bgRefill?: boolean } = {}) {
  const els: El[] = [];
  const hid = { v: false };
  const deck = new AudioDeck({
    standby: true,
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

describe('höchstens ein Element gibt Ton (Runde 33)', () => {
  it('ein zweites Element spielt nach dem Sichtbarwerden: wird pausiert, die Zeile steht einmal', async () => {
    const t = setup();
    await boot(t);
    const b = withSrc(t, 'b')!;
    expect(b).toBeDefined();
    expect(act(t).paused).toBe(false);
    // im Hintergrund fängt das bereitliegende Element von selbst an zu spielen
    b.play();
    expect(b.paused).toBe(false);
    t.hid.v = false;
    t.deck.pageEvent('visible');
    expect(b.paused).toBe(true);
    expect(b.muted).toBe(false);
    expect(act(t).paused).toBe(false);
    expect(has(t, /^deck: second element playing pool \S+ t=[\d.]+, paused/)).toBe(1);
    t.deck.pageEvent('visible');
    await adv(3000);
    expect(has(t, /^deck: second element playing/)).toBe(1);
  });

  it('einmal je Sekunde, aber nur solange sichtbar', async () => {
    const t = setup();
    await boot(t);
    t.hid.v = false;
    t.deck.pageEvent('visible');
    const b = withSrc(t, 'b')!;
    b.play();
    t.hid.v = true;
    await adv(2500);
    expect(b.paused).toBe(false);
    t.hid.v = false;
    await adv(1100);
    expect(b.paused).toBe(true);
    expect(has(t, /^deck: second element playing pool /)).toBe(1);
  });

  it('nach einem play() wird ein weiteres laufendes Element im nächsten Mikroschritt pausiert', async () => {
    const t = setup();
    await boot(t);
    t.hid.v = false;
    const a = act(t);
    const b = withSrc(t, 'b')!;
    b.play();
    t.deck.load(ALL[0], t.sink, { play: true, muted: false });
    a.paused = true;
    t.deck.load(ALL[0], t.sink, { play: true, muted: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(b.paused).toBe(true);
    expect(has(t, /^deck: second element playing/)).toBe(1);
  });

  it('ein normaler Tausch erzeugt keine Zeile, das alte Element ist schon angehalten', async () => {
    const t = setup();
    await boot(t);
    t.hid.v = false;
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    await adv(1500);
    expect(has(t, /^deck: second element playing/)).toBe(0);
    expect(t.els.filter((e) => !e.paused && !e.src.startsWith('data:')).length).toBeLessThanOrEqual(1);
  });

  it('stille Inline-Quelle (Freischaltung) bleibt unberührt', async () => {
    const t = setup();
    await boot(t);
    t.hid.v = false;
    const spare = t.els.find((e) => e !== act(t) && !e.src)!;
    spare.src = 'data:audio/wav;base64,AAAA';
    spare.play();
    t.deck.pageEvent('visible');
    expect(spare.paused).toBe(false);
    expect(has(t, /^deck: second element playing/)).toBe(0);
  });
});
