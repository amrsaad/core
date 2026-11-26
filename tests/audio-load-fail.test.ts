// Runde 36 (Gerätelog 22.11.2026 06:30 bis 06:38, schwaches Netz): A) der aktive Netz-Moment lädt ohne Metadaten oder meldet einen Ladefehler: einmal frisch neu laden, nicht bis zur 8-s-Grenze warten.
// B) verdeckt steht die Zeit des aktiven Elements länger als 10 s: genau einmal die bestehende Fortsetzung (Tausch auf bereites Element, sonst Rückfall im aktiven Element).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, BG_STUCK, BG_STUCK_MS, FRESH_RELOAD, FRESH_RELOAD_MS, RESCUE_FAST, RESCUE_FAST_MS, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

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

function setup(opts: { freshReload?: boolean; bgStuck?: boolean; bgInline?: boolean; stallSwitch?: boolean; bgDeadNext?: boolean } = {}) {
  const els: El[] = [];
  const hid = { v: false };
  const deck = new AudioDeck({
    standby: true,
    // Runde 43: diese Tests prüfen die Hänge-Erkennung von Runde 36 (10 s, ein Versuch je Phase). Den Wechsel nach 8 s (stallSwitch) und das Weiterwechseln (bgDeadNext) hat tests/audio-round43.test.ts
    stallSwitch: false,
    bgDeadNext: false,
    // Runde 46: diese Tests prüfen den Weg "fresh reload" (Abbruch und neues load() nach 3 s). Seit Runde 46 lädt START_HEDGE statt dessen ein zweites Element, wenn eines frei und freigeschaltet ist (tests/audio-start-race.test.ts)
    startHedge: false,
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
const withSrc = (t: T, id: string) => t.els.filter((e) => e.src.endsWith(`/${id}.mp3`));
const has = (t: T, re: RegExp) => t.lines.filter((l) => re.test(l)).length;
const adv = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const loads = (e: El) => e.log.filter((l) => l === 'load').length;
const sounding = (t: T) => t.els.filter((e) => !e.paused && e.src && !e.src.startsWith('data:'));

/** a spielt (Metadaten, Sprung), die Seite steht sichtbar */
async function boot(t: T) {
  t.deck.unlock('pointerup');
  await adv(10);
  t.deck.load(ALL[0], t.sink, { play: true, muted: false });
  await adv(10);
  const a = act(t);
  a.meta(10);
  a.seeked();
  await adv(10);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T06:30:00Z'));
  refuse.v = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Frisches Neuladen des aktiven Moments (Runde 36, A)', () => {
  it('die Schalter stehen auf true, die Rettung kommt nach 3 s', () => {
    expect(FRESH_RELOAD).toBe(true);
    expect(BG_STUCK).toBe(true);
    expect(RESCUE_FAST).toBe(true);
    expect(RESCUE_FAST_MS).toBe(3000);
  });

  it('(1) übernommener Eintrag lädt seit 8,7 s ohne Metadaten (Log 06:35:43): sofort ein frisches load(), nicht 8 s warten', async () => {
    const t = setup();
    await boot(t);
    t.deck.fill([ALL[1]]);
    await adv(8700);
    const b = withSrc(t, 'b')[0];
    const n = loads(b);
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    await adv(10);
    expect(has(t, /^deck: pool adopt b rs=0 meta=false after \d+ ms$/)).toBe(1);
    expect(has(t, /^deck: active not loading b rs=0 after 87\d\d ms, fresh reload$/)).toBe(1);
    expect(loads(b)).toBe(n + 1);
    expect(b.src).toBe('https://pod.test/b.mp3');
    // das neue Laden bringt Metadaten: ok, einmal
    b.meta(10);
    b.seeked();
    await adv(10);
    expect(has(t, /^deck: fresh reload ok b after \d+ ms$/)).toBe(1);
    expect(has(t, /fresh reload failed/)).toBe(0);
    // nie stumm, nie zwei Elemente mit Ton
    expect(b.log.filter((l) => l === 'play:muted')).toEqual([]);
    expect(sounding(t)).toEqual([b]);
  });

  it('(2) ein junger Eintrag (1 s) wird nicht sofort neu geladen, erst nach FRESH_RELOAD_MS seit seinem Beginn, und nur einmal', async () => {
    const t = setup();
    await boot(t);
    t.deck.fill([ALL[1]]);
    await adv(1000);
    const b = withSrc(t, 'b')[0];
    const n = loads(b);
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    await adv(100);
    expect(has(t, /fresh reload/)).toBe(0);
    await adv(FRESH_RELOAD_MS - 1100 + 200);
    expect(has(t, /^deck: active not loading b rs=0 after \d+ ms, fresh reload$/)).toBe(1);
    expect(loads(b)).toBe(n + 1);
    // kommt nichts: nach der Frist "failed", kein zweites Neuladen
    await adv(30_000);
    expect(has(t, /^deck: fresh reload failed b after \d+ ms \(no metadata\)$/)).toBe(1);
    expect(has(t, /fresh reload$/)).toBe(1);
    expect(loads(b)).toBe(n + 1);
  });

  it('(3) Metadaten sind nach 3 s da (nur der Sprung dauert): kein Neuladen', async () => {
    const t = setup();
    await boot(t);
    t.deck.fill([ALL[1]]);
    const b = withSrc(t, 'b')[0];
    const n = loads(b);
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    await adv(500);
    b.meta(10);
    await adv(10_000);
    expect(has(t, /fresh reload/)).toBe(0);
    expect(loads(b)).toBe(n);
  });

  it('(4) Kaltstart vom Netz ohne Metadaten und ohne Fehler: nach 3 s einmal frisch', async () => {
    const t = setup();
    t.deck.unlock('pointerup');
    await adv(10);
    t.deck.load(ALL[0], t.sink, { play: true, muted: false });
    await adv(100);
    const a = act(t);
    const n = loads(a);
    await adv(FRESH_RELOAD_MS + 100);
    expect(has(t, /^deck: active not loading a rs=0 after \d+ ms, fresh reload$/)).toBe(1);
    expect(loads(a)).toBe(n + 1);
  });

  it('(5) Fehler-Ereignis des aktiven Elements: sofort frisch neu, ein zweiter Fehler danach ist "failed" und löst kein weiteres Laden aus', async () => {
    const t = setup();
    await boot(t);
    const a = act(t);
    const n = loads(a);
    a.error = { code: 2 };
    a.emit('error');
    await adv(10);
    expect(has(t, /^deck: active has load error a, fresh reload$/)).toBe(1);
    expect(loads(a)).toBe(n + 1);
    a.emit('error');
    await adv(10);
    expect(has(t, /^deck: fresh reload failed a after \d+ ms \(error\)$/)).toBe(1);
    expect(has(t, /^deck error a$/)).toBe(1);
    expect(loads(a)).toBe(n + 1);
  });

  it('(6) kein frisches Neuladen verdeckt', async () => {
    const t = setup();
    await boot(t);
    t.deck.fill([ALL[1]]);
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    t.hid.v = true;
    await adv(FRESH_RELOAD_MS + 1000);
    expect(has(t, /fresh reload/)).toBe(0);
    const a = withSrc(t, 'b')[0];
    const n = loads(a);
    a.error = { code: 2 };
    a.emit('error');
    expect(loads(a)).toBe(n);
  });

  it('(7) Schalter aus: wie Runde 35', async () => {
    const t = setup({ freshReload: false });
    await boot(t);
    t.deck.fill([ALL[1]]);
    const b = withSrc(t, 'b')[0];
    const n = loads(b);
    t.deck.load(ALL[1], t.sink, { play: true, muted: false });
    await adv(20_000);
    expect(has(t, /fresh reload|active has load error|active not loading/)).toBe(0);
    expect(loads(b)).toBe(n);
  });
});

describe('Hängt verdeckt (Runde 36, B)', () => {
  /** a spielt, b liegt bereit, die Seite geht in den Hintergrund */
  async function bootHidden(t: T, withPool = true) {
    await boot(t);
    if (withPool) {
      t.deck.fill([ALL[1]]);
      withSrc(t, 'b')[0].ready(10);
      await adv(10);
    }
    t.hid.v = true;
    t.deck.pageEvent('hidden');
  }

  it('(1) Zeit steht 10 s bei paused=false: einmal Tausch auf das bereite Element, Zeilen, ein Element mit Ton', async () => {
    const t = setup();
    await bootHidden(t);
    const a = act(t);
    a.tick(11.5);
    await adv(BG_STUCK_MS + 4000);
    expect(has(t, /^bg: stuck a t=11\.5 for 1\d s, advancing$/)).toBe(1);
    expect(has(t, /^bg: stuck advance ok a to b$/)).toBe(1);
    expect(t.adv).toEqual(['b']);
    const b = withSrc(t, 'b')[0];
    expect(act(t)).toBe(b);
    expect(sounding(t)).toEqual([b]);
    expect(b.log.filter((l) => l === 'play:muted')).toEqual([]);
  });

  it('(2) danach kein Wiederholen: auch der Nachfolger steht, es bleibt bei einem Versuch je Phase', async () => {
    const t = setup();
    await bootHidden(t);
    act(t).tick(11.5);
    await adv(BG_STUCK_MS + 4000);
    expect(t.adv).toEqual(['b']);
    await adv(120_000);
    expect(has(t, /^bg: stuck .* advancing$/)).toBe(1);
    expect(has(t, /^bg: stuck advance/)).toBe(1);
  });

  it('(3) Vorrat leer: der Rückfall im aktiven Element (BG_INLINE_NEXT) übernimmt, ok', async () => {
    const t = setup();
    await bootHidden(t, false);
    const a = act(t);
    a.tick(11.5);
    await adv(BG_STUCK_MS + 4000);
    expect(has(t, /^bg: stuck a t=11\.5 for \d+ s, advancing$/)).toBe(1);
    expect(has(t, /^bg: inline next b \(pool empty\)$/)).toBe(1);
    expect(has(t, /^bg: stuck advance ok a to b$/)).toBe(1);
    expect(act(t)).toBe(a);
    expect(a.src).toBe('https://pod.test/b.mp3');
  });

  it('(4) ohne Rückfall und ohne bereites Element: "failed", das Element hält an wie beim Ende ohne Wechsel', async () => {
    const t = setup({ bgInline: false });
    await bootHidden(t, false);
    act(t).tick(11.5);
    await adv(BG_STUCK_MS + 4000);
    expect(has(t, /^bg: stuck advance failed a$/)).toBe(1);
    expect(t.adv).toEqual([]);
  });

  it('(5) die Zeit schreitet fort (timeupdate): nie hängend', async () => {
    const t = setup();
    await bootHidden(t);
    const a = act(t);
    for (let i = 0; i < 20; i++) {
      a.tick(11 + i * 0.1);
      await adv(3000);
    }
    expect(has(t, /^bg: stuck /)).toBe(0);
    expect(t.adv).toEqual([]);
  });

  it('(6) pausiert (Mensch, Sperrbildschirm): nicht hängend', async () => {
    const t = setup();
    await bootHidden(t);
    act(t).pause();
    await adv(60_000);
    expect(has(t, /^bg: stuck /)).toBe(0);
  });

  it('(7) Schalter aus: keine Erkennung', async () => {
    const t = setup({ bgStuck: false });
    await bootHidden(t);
    await adv(60_000);
    expect(has(t, /^bg: stuck /)).toBe(0);
    expect(t.adv).toEqual([]);
  });

  it('(8) Seite war eingefroren (kein Zeitgeber lief), bei der Rückkehr steht die Zeit noch: nur eine Zeile, kein Wechsel', async () => {
    const t = setup();
    await bootHidden(t);
    act(t).tick(11.5);
    await adv(BG_STUCK_MS / 2);
    // ab hier läuft kein Zeitgeber mehr: die Uhr springt, ohne dass etwas feuert
    vi.setSystemTime(Date.now() + 100_000);
    t.hid.v = false;
    t.deck.pageEvent('visible');
    expect(has(t, /^bg: stuck a t=11\.5 for \d+ s, found at return, no advance \(stuck checks \d+\) rs=4 buf=/)).toBe(1);
    expect(has(t, /advancing/)).toBe(0);
    expect(t.adv).toEqual([]);
    expect(act(t).paused).toBe(false);
    // der Zeitgeber ist aus: kein späterer Versuch
    await adv(60_000);
    expect(has(t, /advancing/)).toBe(0);
  });

  it('(9) neue Hintergrund-Phase: wieder ein Versuch', async () => {
    const t = setup();
    await bootHidden(t);
    act(t).tick(11.5);
    await adv(BG_STUCK_MS + 4000);
    expect(t.adv).toEqual(['b']);
    t.hid.v = false;
    t.deck.pageEvent('visible');
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    act(t).tick(11.5);
    await adv(BG_STUCK_MS + 4000);
    expect(has(t, /^bg: stuck .* advancing$/)).toBe(2);
  });
});
