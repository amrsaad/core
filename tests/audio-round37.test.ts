// Runde 37: nie zwei Spuren (auch verdeckt), kein Tausch auf nicht freigeschaltetes Element, Wartezeit ohne Kartenzeit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restartWait } from '../src/moments/form';
import { AudioDeck, BG_SINGLE, BG_SINGLE_ESCALATE, PROBE_MS, UNLOCK_GUARD, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

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

function setup(opts: { bgSingle?: boolean; bgSingleEscalate?: boolean; unlockGuard?: boolean } = {}) {
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


type Priv = { unlockedEls: Set<unknown>; kept: unknown[] };
const priv = (t: T) => t.deck as unknown as Priv;

/** sichtbar: a spielt, b bereit (nicht verdeckt) */
async function bootVisible(t: T) {
  t.deck.unlock('pointerup');
  await adv(10);
  t.deck.load(ALL[0], t.sink, { play: true, muted: false });
  await adv(10);
  const a = act(t);
  a.meta(10);
  a.seeked();
  await adv(10);
  t.deck.fill([ALL[1], ALL[2]]);
  withSrc(t, 'b')!.ready(10);
  withSrc(t, 'c')!.ready(10);
  await adv(10);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
  refuse.v = false;
  mode.v = 'now';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('A: nie zwei Spuren, auch verdeckt (Runde 37)', () => {
  it('die Schalter stehen auf true', () => {
    expect(BG_SINGLE).toBe(true);
    expect(BG_SINGLE_ESCALATE).toBe(true);
    expect(UNLOCK_GUARD).toBe(true);
  });

  it('verdeckter Tausch: das alte Element wird angehalten, spielt es später wieder (iOS), pausiert der Takt es verdeckt, Zeile mit (hidden)', async () => {
    const t = setup();
    await boot(t);
    const a = act(t);
    a.tick(14);
    await adv(10);
    const b = act(t);
    expect(b).not.toBe(a);
    expect(a.paused).toBe(true);
    expect(has(t, /^deck: second element playing/)).toBe(0);
    // wie im Gerätelog: das Element steht später wieder auf paused=false
    a.paused = false;
    await adv(1100);
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(false);
    expect(t.hid.v).toBe(true);
    const l = t.lines.filter((x) => /^deck: second element playing/.test(x));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatch(/^deck: second element playing (kept|unknown) a t=[\d.]+, paused \(hidden\) rs=\d sincePlay=\S+ lastHalt=app: swap \d+ ms n=1$/);
    expect(a.muted).toBe(false);
  });

  it('Prüfung kurz nach dem verdeckten Tausch (300 ms), vor dem ersten Takt', async () => {
    const t = setup();
    await boot(t);
    const a = act(t);
    a.tick(14);
    await adv(10);
    // der Takt wurde beim Verdecken gestartet, die Prüfung nach dem Tausch liegt bei 300 ms
    a.paused = false;
    await adv(310);
    expect(a.paused).toBe(true);
    expect(has(t, /paused \(hidden\)/)).toBe(1);
  });

  it('mehrere Fremdelemente verdeckt (behalten, Vorrat, freie): alle pausiert, genau ein Element gibt Ton', async () => {
    const t = setup();
    await boot(t);
    for (const e of t.els) if (e !== act(t) && e.src && !e.src.startsWith('data:')) e.play();
    for (const e of t.els) if (e !== act(t) && !e.src) {
      e.src = 'https://pod.test/spare.mp3';
      e.play();
    }
    await adv(1100);
    expect(t.els.filter((e) => !e.paused && !e.src.startsWith('data:'))).toHaveLength(1);
    expect(has(t, /paused \(hidden\)/)).toBeGreaterThanOrEqual(2);
    expect(t.els.every((e) => !e.muted)).toBe(true);
  });

  it('pause() hält nicht (iOS ignoriert es): ein behaltenes Element geht ans Ende der Quelle, Zeilen "ignores pause" und "forced to end"', async () => {
    const t = setup();
    await boot(t);
    const a = act(t);
    a.tick(14);
    await adv(10);
    // a ist das alte Element: pause() bleibt wirkungslos
    a.pause = () => {};
    a.paused = false;
    a.duration = 600;
    await adv(1100);
    expect(has(t, /^deck: second element ignores pause (kept|unknown) a \(hidden\)/)).toBe(1);
    expect(has(t, /^deck: second element forced to end (kept|unknown) a \(hidden\)/)).toBe(1);
    expect(a.log).toContain(`seek:${600 - 0.05}`);
    expect(a.muted).toBe(false);
  });

  it('ein Vorrats-Element wird nie ans Ende gesetzt, auch wenn pause() nicht hält', async () => {
    const t = setup();
    await boot(t);
    const b = withSrc(t, 'b')!;
    b.pause = () => {};
    b.paused = false;
    b.duration = 600;
    const seeks = b.log.filter((l) => l.startsWith('seek:')).length;
    await adv(1100);
    expect(has(t, /^deck: second element ignores pause pool b/)).toBe(1);
    expect(has(t, /forced to end/)).toBe(0);
    expect(b.log.filter((l) => l.startsWith('seek:')).length).toBe(seeks);
  });

  it('BG_SINGLE aus (bgSingle false): verdeckt kein Wächter, Verhalten von Runde 33', async () => {
    const t = setup({ bgSingle: false });
    await boot(t);
    const a = act(t);
    a.tick(14);
    await adv(10);
    a.paused = false;
    await adv(3000);
    expect(a.paused).toBe(false);
    expect(has(t, /paused \(hidden\)/)).toBe(0);
  });

  it('BG_SINGLE_ESCALATE aus: pause() allein, kein Ans-Ende-Setzen', async () => {
    const t = setup({ bgSingleEscalate: false });
    await boot(t);
    const a = act(t);
    a.tick(14);
    await adv(10);
    a.pause = () => {};
    a.paused = false;
    await adv(1100);
    expect(has(t, /forced to end/)).toBe(0);
    expect(a.log.filter((l) => l.startsWith('seek:') && l !== 'seek:10')).toEqual([]);
  });

  it('das aktive Element und stille Inline-Quellen bleiben unberührt', async () => {
    const t = setup();
    await boot(t);
    const spare = t.els.find((e) => e !== act(t) && !e.src)!;
    spare.src = 'data:audio/wav;base64,AAAA';
    spare.play();
    await adv(2500);
    expect(act(t).paused).toBe(false);
    expect(spare.paused).toBe(false);
    expect(has(t, /^deck: second element playing/)).toBe(0);
  });
});

describe('B: kein Tausch auf nicht freigeschaltetes Element (Runde 37)', () => {
  it('Vorrat wartet, wenn kein freies Element freigeschaltet ist, und lädt nach der nächsten Geste', async () => {
    const t = setup();
    t.deck.unlock('pointerup');
    await adv(10);
    t.deck.load(ALL[0], t.sink, { play: true, muted: false });
    await adv(10);
    act(t).meta(10);
    act(t).seeked();
    await adv(10);
    // alle freien Elemente verlieren die Freischaltung (iOS hat sie nicht bestätigt)
    for (const e of t.els) if (e !== act(t)) priv(t).unlockedEls.delete(e);
    t.deck.fill([ALL[1], ALL[2]]);
    expect(t.deck.poolInfo()).toEqual([]);
    expect(has(t, /^deck: pool fill held 2 \(no unlocked element free, \d\/\d not unlocked\)$/)).toBe(1);
    // nächste Geste: die freien Elemente werden neu probiert, danach lädt der Vorrat
    t.deck.unlock('click');
    await adv(PROBE_MS + 50);
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(['b', 'c']);
    expect(has(t, /^deck: unlock catch-up \d not unlocked/)).toBeGreaterThanOrEqual(1);
  });

  it('ist gar kein Element bestätigt (Proben antworten nie), lädt der Vorrat trotzdem wie vorher', async () => {
    mode.v = 'never';
    const t = setup();
    t.deck.unlock('pointerup');
    await adv(PROBE_MS + 50);
    t.deck.fill([ALL[1], ALL[2]]);
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(['b', 'c']);
    expect(has(t, /^deck: pool fill held/)).toBe(0);
  });

  it('verdeckt: kein Tausch auf einen Eintrag, dessen Element nicht freigeschaltet ist, der Rückfall im aktiven Element übernimmt', async () => {
    const t = setup();
    await boot(t);
    const b = withSrc(t, 'b')!;
    priv(t).unlockedEls.delete(b);
    const a = act(t);
    a.tick(14);
    await adv(10);
    expect(act(t)).toBe(a);
    expect(has(t, /^deck: swap skips element not unlocked b \(hidden\)$/)).toBe(1);
    expect(has(t, /^bg: inline next b \(pool empty\)$/)).toBe(0);
    expect(t.adv.length).toBeLessThanOrEqual(1);
    expect(t.deck.poolInfo().map((p) => p.id)).toContain('b');
  });

  it('verdeckt: ein freigeschaltetes Element tauscht wie bisher', async () => {
    const t = setup();
    await boot(t);
    act(t).tick(14);
    await adv(10);
    expect(t.adv).toEqual(['b']);
    expect(has(t, /swap skips element not unlocked/)).toBe(0);
  });

  it('sichtbar: Tausch auf ein nicht freigeschaltetes Element trägt die Zeile "swap onto element not unlocked"', async () => {
    const t = setup();
    await bootVisible(t);
    const b = withSrc(t, 'b')!;
    priv(t).unlockedEls.delete(b);
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    await adv(10);
    expect(has(t, /^deck: swap onto element not unlocked b \(unlocked \d\/\d, hidden=0\)$/)).toBe(1);
  });

  it('abgelehntes play(): Zeile "refusal element" mit Stand der Freischaltung', async () => {
    const t = setup();
    await bootVisible(t);
    refuse.v = true;
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    await adv(10);
    expect(has(t, /^deck: refusal element b unlocked=1 via=\S+ unlockedAll=\d\/\d probing=0 sinceGesture=\d+ ms hidden=0 why=swap$/)).toBe(1);
    expect(has(t, /^audio: needs tap b|deck play refused NotAllowedError \(swap\)/)).toBeGreaterThanOrEqual(1);
  });

  it('nächste Geste: ein behaltenes Element ohne Freischaltung wird freigegeben und neu probiert', async () => {
    const t = setup();
    await bootVisible(t);
    const a = act(t);
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    await adv(10);
    expect(priv(t).kept).toHaveLength(1);
    priv(t).unlockedEls.delete(a);
    const before = a.log.filter((l) => l === 'play:silence').length;
    t.deck.unlock('click');
    await adv(PROBE_MS + 50);
    expect(priv(t).kept).toHaveLength(0);
    expect(a.log.filter((l) => l === 'play:silence').length).toBe(before + 1);
    expect(has(t, /^deck: unlock catch-up 1 not unlocked \(pool 0, kept 1, probing 0\)$/)).toBe(1);
  });

  it('unlockGuard aus: Vorrat lädt auf ein nicht freigeschaltetes Element wie in Runde 36', async () => {
    const t = setup({ unlockGuard: false });
    t.deck.unlock('pointerup');
    await adv(10);
    t.deck.load(ALL[0], t.sink, { play: true, muted: false });
    await adv(10);
    for (const e of t.els) if (e !== act(t)) priv(t).unlockedEls.delete(e);
    t.deck.fill([ALL[1]]);
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(['b']);
    expect(has(t, /pool fill held/)).toBe(0);
  });
});

describe('D: Wartezeit ohne Kartenzeit (Runde 37)', () => {
  it('restartWait setzt t0 neu und vergisst den Zeitfortschritt, ohne Messung bleibt null', () => {
    expect(restartWait(null, 500)).toBeNull();
    const w = { id: 'x', t0: 100, last: 42 };
    expect(restartWait(w, 16_279)).toEqual({ id: 'x', t0: 16_279, last: null });
    // die gemessene Zeit nach dem Schließen: 16 179 ms im Log, davon 15 s Karte
    const closed = restartWait(w, 16_279)!;
    expect(16_279 + 476 - closed.t0).toBe(476);
  });
});
