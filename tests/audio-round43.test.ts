// Runde 43 (Gerätelog 26.11.2026 11:43 bis 12:04, sehr schwaches Mobilnetz): A) verdeckt bleibt eine stumme Quelle nicht länger als BG_DEAD_NEXT_MS ohne nächsten Kandidaten (BG_DEAD_NEXT),
// B) die Zeit des laufenden Moments steht STALL_SWITCH_MS und ein Element ist bereit: Wechsel darauf (STALL_SWITCH). Entscheidungslogik als reine Funktionen, dazu das Deck mit nachgebautem Element.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioDeck,
  BG_DEAD_NEXT,
  BG_DEAD_NEXT_MAX,
  BG_DEAD_NEXT_MS,
  BG_STUCK_MS,
  STALL_SWITCH,
  STALL_SWITCH_MS,
  deadNextCall,
  stallSwitchCall,
  type DeckClip,
  type DeckEl,
  type DeckSink,
} from '../src/video/audioDeck';

/** Quellen, die nie Daten liefern (das Netz hängt): das Element bleibt bei readyState 0, play() meldet kein playing */
const dead = new Set<string>();
/** Quellen, deren Element im Fehlerzustand steht: play() lehnt mit NotSupportedError ab */
const broken = new Set<string>();

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
  networkState = 2;
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
  private name() {
    return /\/(\w+)\.mp3$/.exec(this.src)?.[1] ?? '';
  }
  play() {
    const sil = this.src.startsWith('data:');
    if (!sil && broken.has(this.name())) {
      this.log.push('play:notsupported');
      return Promise.reject(new DOMException('no', 'NotSupportedError'));
    }
    this.log.push(sil ? 'play:silence' : 'play');
    this.paused = false;
    this.emit('play');
    if (!sil && dead.has(this.name())) return new Promise<void>(() => {});
    if (!sil) this.emit('playing');
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.log.push('pause');
    this.emit('pause');
  }
  load() {
    // HTML-Spezifikation: load() setzt paused auf true
    this.paused = true;
    this.t = 0;
    this.readyState = 0;
    this.seeking = false;
    this.duration = Number.NaN;
    this.log.push('load');
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
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
  tick(t: number) {
    this.t = t;
    this.emit('timeupdate');
  }
  ready(target: number) {
    this.meta(target);
    if (this.seeking) this.seeked();
    else this.emit('canplaythrough');
  }
}

const clip = (id: string): DeckClip => ({ key: `${id}|10|14`, id, url: `https://pod.test/${id}.mp3`, start: 10, end: 14 });
const ALL = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(clip);

function setup(opts: { bgDeadNext?: boolean; stallSwitch?: boolean; bgInline?: boolean } = {}) {
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
  const adv: { to: string; unseen: boolean; at: number }[] = [];
  let cur = 0;
  deck.nextClips = (n) => ALL.slice(cur + 1, cur + 1 + n);
  deck.onAdvance = (_f, to, unseen) => {
    cur = ALL.findIndex((c) => c.key === to.key);
    adv.push({ to: to.id, unseen: !!unseen, at: Date.now() });
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
  return a;
}

/** a spielt, die Seite geht in den Hintergrund, der Vorrat ist leer */
async function bootHidden(t: T) {
  const a = await boot(t);
  t.hid.v = true;
  t.deck.pageEvent('hidden');
  return a;
}

/** Das Element des Rückfalls bekommt Daten (Metadaten, Sprung) und spielt */
async function arrive(e: El, target = 10) {
  e.meta(target);
  e.seeked();
  await adv(10);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-26T11:50:00Z'));
  dead.clear();
  broken.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Schalter und reine Funktionen (Runde 43)', () => {
  it('die Schalter stehen auf true, die Werte wie vereinbart', () => {
    expect(BG_DEAD_NEXT).toBe(true);
    expect(STALL_SWITCH).toBe(true);
    expect(BG_DEAD_NEXT_MS).toBe(10_000);
    expect(BG_DEAD_NEXT_MAX).toBe(3);
    expect(STALL_SWITCH_MS).toBe(8000);
  });

  it('deadNextCall: warten, bis BG_DEAD_NEXT_MS stumm, bei Fehler sofort, bereites Element vor Warteschlange, nach max Versuchen Stopp', () => {
    const base = { on: true, hidden: true, hasHost: true, tries: 0, max: 3, silentMs: 0, afterMs: 10_000, errored: false, ready: 0, candidate: true };
    expect(deadNextCall(base)).toBe('wait');
    expect(deadNextCall({ ...base, silentMs: 9_999 })).toBe('wait');
    expect(deadNextCall({ ...base, silentMs: 10_000 })).toBe('inline');
    expect(deadNextCall({ ...base, silentMs: 10_000, ready: 2 })).toBe('swap');
    expect(deadNextCall({ ...base, errored: true })).toBe('inline');
    expect(deadNextCall({ ...base, errored: true, ready: 1 })).toBe('swap');
    expect(deadNextCall({ ...base, silentMs: 10_000, tries: 2 })).toBe('inline');
    expect(deadNextCall({ ...base, silentMs: 10_000, tries: 3 })).toBe('stop');
    expect(deadNextCall({ ...base, errored: true, tries: 3, ready: 1 })).toBe('stop');
    // nichts zu wechseln: kein Stopp, kein Versuch
    expect(deadNextCall({ ...base, silentMs: 10_000, candidate: false })).toBe('none');
    expect(deadNextCall({ ...base, silentMs: 10_000, candidate: false, tries: 3 })).toBe('none');
    // Schalter aus, sichtbar, kein Host
    expect(deadNextCall({ ...base, on: false, silentMs: 99_000 })).toBe('none');
    expect(deadNextCall({ ...base, hidden: false, silentMs: 99_000 })).toBe('none');
    expect(deadNextCall({ ...base, hasHost: false, silentMs: 99_000 })).toBe('none');
  });

  it('stallSwitchCall: nur bei Schalter, schon gespielt, Wunsch, nicht pausiert, ab 8 s, mit bereitem Element', () => {
    const base = { on: true, played: true, want: true, paused: false, stalledMs: 8000, afterMs: 8000, ready: 1, done: false };
    expect(stallSwitchCall(base)).toBe(true);
    expect(stallSwitchCall({ ...base, stalledMs: 7999 })).toBe(false);
    expect(stallSwitchCall({ ...base, ready: 0 })).toBe(false);
    expect(stallSwitchCall({ ...base, on: false })).toBe(false);
    expect(stallSwitchCall({ ...base, played: false })).toBe(false);
    expect(stallSwitchCall({ ...base, want: false })).toBe(false);
    expect(stallSwitchCall({ ...base, paused: true })).toBe(false);
    expect(stallSwitchCall({ ...base, done: true })).toBe(false);
  });
});

describe('Hintergrund: stumme Quelle, nächster Kandidat (BG_DEAD_NEXT)', () => {
  it('(1) Quelle lädt nie (rs=0): nach 10 s der nächste Kandidat, der spielt, höchstens 15 s Stille, der verlassene bleibt ungesehen', async () => {
    const t = setup();
    dead.add('b');
    const a = await bootHidden(t);
    const t0 = Date.now();
    a.tick(14);
    await adv(10);
    // Ende von a: Vorrat leer, das aktive Element nimmt b (lädt nie)
    expect(has(t, /^bg: inline next b \(pool empty\)$/)).toBe(1);
    expect(t.adv).toMatchObject([{ to: 'b', unseen: false }]);
    expect(act(t)).toBe(a);
    await adv(BG_DEAD_NEXT_MS - 100);
    expect(has(t, /^bg: dead next /)).toBe(0);
    await adv(200);
    expect(has(t, /^bg: dead next #1\/3 b silent 10 s \(timer\) rs=0 ns=2 error=none, next in queue$/)).toBe(1);
    expect(has(t, /^bg: inline next c \(pool empty\)$/)).toBe(1);
    expect(t.adv.map((x) => `${x.to}${x.unseen ? '!' : ''}`)).toEqual(['b', 'c!']);
    expect(a.src).toBe('https://pod.test/c.mp3');
    // c bekommt Daten und spielt
    await arrive(a);
    await adv(10);
    expect(has(t, /^bg: dead next ok c playing after \d+ ms \(try 1\/3\)$/)).toBe(1);
    expect(has(t, /^bg: inline next playing c after \d+ ms$/)).toBe(1);
    // Stille auf einer Quelle: von der ersten stummen Quelle bis zum Ton auf c höchstens 15 s
    expect(Date.now() - t0).toBeLessThanOrEqual(15_000);
    expect(has(t, /^bg: dead next stop/)).toBe(0);
  });

  it('(2) höchstens BG_DEAD_NEXT_MAX Versuche in Folge, danach Stopp mit einer Zeile, keine weitere Quelle', async () => {
    const t = setup();
    for (const id of ['b', 'c', 'd', 'e', 'f', 'g']) dead.add(id);
    const a = await bootHidden(t);
    a.tick(14);
    await adv(10);
    expect(t.adv.map((x) => x.to)).toEqual(['b']);
    await adv(BG_DEAD_NEXT_MS * 4 + 500);
    // b (Rückfall), dann drei Versuche: c, d, e
    expect(t.adv.map((x) => `${x.to}${x.unseen ? '!' : ''}`)).toEqual(['b', 'c!', 'd!', 'e!']);
    expect(has(t, /^bg: dead next #[123]\/3 /)).toBe(3);
    expect(has(t, /^bg: dead next stop after 3 tries, last e \(timer\) rs=0 ns=2 error=none, staying$/)).toBe(1);
    expect(a.src).toBe('https://pod.test/e.mp3');
    // danach bleibt es still: keine neue Quelle, keine weitere Zeile
    const n = t.lines.length;
    await adv(120_000);
    expect(t.adv).toHaveLength(4);
    expect(has(t, /^bg: dead next stop/)).toBe(1);
    expect(t.lines.slice(n).filter((l) => /^bg: (dead next|inline next (?!timeout))/.test(l))).toEqual([]);
  });

  it('(3) Fehler am Element (error.code 4, NotSupportedError): sofort der nächste Kandidat, ohne die 10 s abzuwarten', async () => {
    const t = setup();
    broken.add('b');
    const a = await bootHidden(t);
    a.tick(14);
    await adv(10);
    expect(has(t, /^bg: inline next b \(pool empty\)$/)).toBe(1);
    // ohne Metadaten wartet das erste play() auf den Sprung (JUMP_META_MS), dann lehnt das Element ab
    await adv(8100);
    expect(has(t, /^bg: inline next refused b NotSupportedError$/)).toBe(1);
    expect(has(t, /^bg: dead next #1\/3 b silent \d+ s \(NotSupportedError\) /)).toBe(1);
    expect(has(t, /^bg: inline next c \(pool empty\)$/)).toBe(1);
    expect(t.adv.map((x) => `${x.to}${x.unseen ? '!' : ''}`)).toEqual(['b', 'c!']);
    await arrive(a);
    expect(has(t, /^bg: dead next ok c /)).toBe(1);
  });

  it('(3b) Fehlerereignis des aktiven Elements nach dem Rückfall: sofort weiter', async () => {
    const t = setup();
    dead.add('b');
    const a = await bootHidden(t);
    a.tick(14);
    await adv(2000);
    expect(t.adv.map((x) => x.to)).toEqual(['b']);
    a.error = { code: 4 };
    a.emit('error');
    await adv(10);
    expect(has(t, /^bg: dead next #1\/3 b silent 2 s \(error\) rs=0 ns=2 error=4, next in queue$/)).toBe(1);
    expect(a.src).toBe('https://pod.test/c.mp3');
  });

  it('(4) NotAllowedError (iOS verweigert das play()): kein weiterer Kandidat, nichts, was iOS verweigert', async () => {
    const t = setup();
    const a = await bootHidden(t);
    a.tick(14);
    await adv(10);
    expect(has(t, /^bg: inline next b \(pool empty\)$/)).toBe(1);
    const b = a;
    b.play = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
    b.meta(10);
    b.seeked();
    await adv(10);
    expect(has(t, /^bg: inline next refused b NotAllowedError$/)).toBe(1);
    await adv(60_000);
    expect(has(t, /^bg: dead next /)).toBe(0);
    expect(t.adv.map((x) => x.to)).toEqual(['b']);
  });

  it('(5) ein bereites Element des Vorrats wird vor der Warteschlange gewählt (Tausch, ohne neue Quelle)', async () => {
    const t = setup();
    dead.add('b');
    const a = await bootHidden(t);
    a.tick(14);
    await adv(10);
    expect(has(t, /^bg: inline next b \(pool empty\)$/)).toBe(1);
    // während b stumm ist, wird d bereit (verdecktes Nachladen)
    await adv(5000);
    const d = withSrc(t, 'd')[0] ?? withSrc(t, 'c')[0];
    expect(d).toBeTruthy();
    const dId = d!.src.match(/\/(\w+)\.mp3$/)![1];
    d!.ready(10);
    await adv(10);
    expect(t.deck.readyCount()).toBeGreaterThan(0);
    await adv(5500);
    expect(has(t, /^bg: dead next #1\/3 b silent \d+ s \(timer\) rs=0 ns=2 error=none, ready element \(pool \d\)$/)).toBe(1);
    expect(t.adv.at(-1)).toMatchObject({ to: dId, unseen: true });
    expect(act(t)).toBe(d);
  });

  it('(6) läuft die Zeit auf der neuen Quelle, beginnen die Versuche in Folge neu', async () => {
    const t = setup();
    dead.add('b');
    const a = await bootHidden(t);
    a.tick(14);
    await adv(BG_DEAD_NEXT_MS + 300);
    expect(has(t, /^bg: dead next #1\/3 /)).toBe(1);
    await arrive(a);
    // Zeit läuft (mehrere Takte des Hänge-Zeitgebers sehen Fortschritt)
    for (let i = 0; i < 5; i++) {
      a.tick(10.5 + i);
      await adv(2100);
    }
    // c hängt später erneut und der Nachfolger d lädt nie: wieder bei Versuch 1
    dead.add('d');
    a.tick(14);
    await adv(10);
    await adv(BG_DEAD_NEXT_MS + 300);
    expect(has(t, /^bg: dead next #1\/3 d /)).toBe(1);
    expect(has(t, /^bg: dead next #2\/3 /)).toBe(0);
  });

  it('(7) Schalter aus: wie Runde 42, nach dem Rückfall kein Weiterwechseln (nur der eine Hänge-Wechsel je Phase)', async () => {
    const t = setup({ bgDeadNext: false });
    dead.add('b');
    dead.add('c');
    const a = await bootHidden(t);
    a.tick(14);
    await adv(10);
    await adv(120_000);
    expect(has(t, /^bg: dead next /)).toBe(0);
    // b (Rückfall), c (der eine Hänge-Wechsel dieser Phase), dann nichts mehr
    expect(t.adv.map((x) => `${x.to}${x.unseen ? '!' : ''}`)).toEqual(['b', 'c']);
    expect(has(t, /^bg: stuck .* advancing$/)).toBe(1);
    expect(a.src).toBe('https://pod.test/c.mp3');
  });

  it('(8) kein weiterer Kandidat: kein Wechsel, kein Stopp, das Element bleibt (kein Halt)', async () => {
    const t = setup();
    dead.add('b');
    const a = await bootHidden(t);
    t.deck.nextClips = (n) => ALL.slice(1, 2).filter(() => n > 0);
    a.tick(14);
    await adv(10);
    t.deck.nextClips = () => [];
    await adv(BG_DEAD_NEXT_MS + 5000);
    expect(has(t, /^bg: dead next /)).toBe(0);
    expect(t.adv.map((x) => x.to)).toEqual(['b']);
    expect(a.src).toBe('https://pod.test/b.mp3');
  });

  it('(9) sichtbar wird nichts gewechselt', async () => {
    const t = setup();
    dead.add('b');
    const a = await bootHidden(t);
    a.tick(14);
    await adv(5000);
    t.hid.v = false;
    t.deck.pageEvent('visible');
    await adv(60_000);
    expect(has(t, /^bg: dead next /)).toBe(0);
    expect(t.adv.map((x) => x.to)).toEqual(['b']);
  });

  it('(10) erneut hängender Wechsel (Zeit steht auf dem Nachfolger): BG_STUCK wechselt weiter, bis max Versuche erreicht sind', async () => {
    // STALL_SWITCH aus: sonst käme der Tausch auf das bereite b schon nach 8 s (eigener Test unten)
    const t = setup({ stallSwitch: false });
    const a = await boot(t);
    // b liegt bereit; a steht (Zeit 11.5), erster Hänge-Wechsel auf b, b spielt, aber seine Zeit steht ebenfalls
    t.deck.fill([ALL[1]]);
    withSrc(t, 'b')[0].ready(10);
    await adv(10);
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    a.tick(11.5);
    await adv(BG_STUCK_MS + 4000);
    expect(has(t, /^bg: stuck a t=11\.5 for \d+ s, advancing$/)).toBe(1);
    expect(t.adv.map((x) => x.to)).toEqual(['b']);
    // der Nachfolger steht auch (b hat Zeit 10, es kommt kein Fortschritt): nächster Kandidat nach BG_STUCK_MS
    for (const id of ['c', 'd', 'e', 'f']) dead.add(id);
    await adv(BG_STUCK_MS * 6);
    // der erste Hänge-Wechsel zählt als Versuch 1, danach "stuck again" (2) und der Rückfall mit Zeitgeber (3), dann Stopp
    expect(has(t, /^bg: dead next #2\/3 b .*\(stuck again\)/)).toBe(1);
    expect(has(t, /^bg: dead next #3\/3 c .*\(timer\)/)).toBe(1);
    expect(has(t, /^bg: dead next stop after 3 tries/)).toBe(1);
    expect(t.adv.map((x) => x.to)).toEqual(['b', 'c', 'd']);
  });
});

describe('Stehende Zeit (STALL_SWITCH)', () => {
  it('(1) sichtbar: stalledFor wächst nur bei stehender Zeit nach dem ersten Ton, setzt bei Fortschritt zurück', async () => {
    const t = setup();
    const a = await boot(t);
    a.tick(11);
    expect(t.deck.stalledFor()).toBe(0);
    await adv(3000);
    expect(t.deck.stalledFor()).toBeGreaterThanOrEqual(2900);
    await adv(5200);
    expect(t.deck.stalledFor()).toBeGreaterThanOrEqual(STALL_SWITCH_MS);
    // Fortschritt: von vorn
    a.tick(11.4);
    expect(t.deck.stalledFor()).toBe(0);
    await adv(1000);
    expect(t.deck.stalledFor()).toBeGreaterThanOrEqual(900);
  });

  it('(2) nicht bei Pause, nicht ohne Wunsch, nicht verdeckt, nicht nach stallHandled, Schalter aus', async () => {
    const t = setup();
    const a = await boot(t);
    a.tick(11);
    t.deck.stalledFor();
    await adv(9000);
    expect(t.deck.stalledFor()).toBeGreaterThanOrEqual(STALL_SWITCH_MS);
    t.deck.stallHandled();
    expect(t.deck.stalledFor()).toBe(0);

    const t2 = setup({ stallSwitch: false });
    const a2 = await boot(t2);
    a2.tick(11);
    t2.deck.stalledFor();
    await adv(9000);
    expect(t2.deck.stalledFor()).toBe(0);

    const t3 = setup();
    const a3 = await boot(t3);
    a3.tick(11);
    t3.deck.stalledFor();
    a3.pause();
    await adv(9000);
    expect(t3.deck.stalledFor()).toBe(0);

    const t4 = setup();
    const a4 = await boot(t4);
    a4.tick(11);
    t4.deck.stalledFor();
    await adv(9000);
    t4.hid.v = true;
    expect(t4.deck.stalledFor()).toBe(0);
  });

  it('(3) hasReady zeigt das bereite Element des Vorrats', async () => {
    const t = setup();
    await boot(t);
    expect(t.deck.hasReady()).toBe(false);
    t.deck.fill([ALL[1]]);
    withSrc(t, 'b')[0].ready(10);
    await adv(10);
    expect(t.deck.hasReady()).toBe(true);
  });

  it('(4) verdeckt: Zeit steht 8 s, Element bereit: Tausch mit "unseen" schon vor BG_STUCK_MS, Zeilen, ein Element mit Ton', async () => {
    const t = setup();
    const a = await boot(t);
    t.deck.fill([ALL[1]]);
    withSrc(t, 'b')[0].ready(10);
    await adv(10);
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    a.tick(11.5);
    await adv(STALL_SWITCH_MS + 2100);
    expect(has(t, /^deck: stall switch a no progress (8|9|10) s \(hidden\), ready element \(pool 1\)$/)).toBe(1);
    expect(has(t, /^deck: stall switch ok a to b$/)).toBe(1);
    expect(has(t, /^bg: stuck /)).toBe(0);
    expect(t.adv).toMatchObject([{ to: 'b', unseen: true }]);
    const b = withSrc(t, 'b')[0];
    expect(act(t)).toBe(b);
    expect(t.els.filter((e) => !e.paused && e.src && !e.src.startsWith('data:'))).toEqual([b]);
  });

  it('(5) verdeckt ohne bereites Element: kein Stall-Wechsel (weiter warten), erst BG_STUCK wie bisher', async () => {
    const t = setup();
    const a = await bootHidden(t);
    a.tick(11.5);
    await adv(STALL_SWITCH_MS + 1500);
    expect(has(t, /^deck: stall switch /)).toBe(0);
    expect(t.adv).toEqual([]);
    await adv(3000);
    expect(has(t, /^bg: stuck a t=11\.5 for \d+ s, advancing$/)).toBe(1);
  });

  it('(6) verdeckt, Schalter aus: Verhalten wie bisher (BG_STUCK nach 10 s)', async () => {
    const t = setup({ stallSwitch: false });
    const a = await boot(t);
    t.deck.fill([ALL[1]]);
    withSrc(t, 'b')[0].ready(10);
    await adv(10);
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    a.tick(11.5);
    await adv(STALL_SWITCH_MS + 500);
    expect(has(t, /^deck: stall switch /)).toBe(0);
    await adv(BG_STUCK_MS);
    expect(has(t, /^bg: stuck a t=11\.5 for \d+ s, advancing$/)).toBe(1);
    expect(t.adv).toMatchObject([{ to: 'b', unseen: false }]);
  });
});
