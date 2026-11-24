// Runde 39 (Gerätelog 24.11.2026 07:47 bis 07:58): 1) toter Start: NotSupportedError und gescheitertes Neuladen führen zu einem sauberen Neuladen und zur Rettung nach Zeit ohne Ton,
// 2) Media Session folgt dem Zustand des aktiven Elements, 3) bei der Rückkehr hält das Deck zweite Elemente sofort und prüft dreimal nach.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioDeck,
  DEAD_RELOAD,
  DEAD_RELOAD_MAX,
  DEAD_RELOAD_MIN_MS,
  MS_FOLLOW,
  MS_HANDOVER_MS,
  RESCUE_RETRY,
  RETURN_SILENCE,
  RETURN_SILENCE_CHECKS,
  RETURN_SILENCE_GAP_MS,
  decideMsState,
  deadSource,
  reviveDue,
  type DeckClip,
  type DeckEl,
  type DeckSink,
} from '../src/video/audioDeck';

/** Wie iOS im Fehlerzustand (error.code 4): play() lehnt mit NotSupportedError ab, ohne zu laden, paused bleibt true */
const nse = { v: false };

class El implements DeckEl {
  src = '';
  private t = 0;
  get currentTime() {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
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
  networkState = 0;
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
    const sil = this.src.startsWith('data:');
    if (nse.v && !sil) {
      this.log.push('play:notsupported');
      return Promise.reject(new DOMException('no', 'NotSupportedError'));
    }
    this.log.push(sil ? 'play:silence' : 'play');
    this.paused = false;
    this.emit('play');
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
    this.t = 0;
    this.readyState = 0;
    this.seeking = false;
    this.duration = Number.NaN;
    this.error = null;
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
const ALL = ['a', 'b', 'c', 'd', 'e'].map(clip);

function setup(opts: { deadReload?: boolean; rescueRetry?: boolean; msFollow?: boolean; returnSilence?: boolean; bgStuck?: boolean; freshReload?: boolean } = {}) {
  const els: El[] = [];
  const hid = { v: false };
  const ms = { v: 'none' as 'playing' | 'paused' | 'none', writes: [] as string[] };
  const deck = new AudioDeck({
    standby: true,
    bgStuck: false,
    ...opts,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      els.push(e);
      return e;
    },
    hidden: () => hid.v,
    msRead: () => ms.v,
    playbackState: (s, why) => {
      ms.v = s;
      ms.writes.push(`${s} ${why}`);
    },
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink, hid, ms };
}
type T = ReturnType<typeof setup>;
const act = (t: T) => t.deck.element as El;
const withSrc = (t: T, id: string) => t.els.find((e) => e.src.endsWith(`/${id}.mp3`));
const has = (t: T, re: RegExp) => t.lines.filter((l) => re.test(l)).length;
const loads = (e: El) => e.log.filter((l) => l === 'load').length;
const adv = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** a spielt (Metadaten, Sprung, playing) */
async function bootPlaying(t: T) {
  t.ms.v = 'playing';
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

/** a startet vom Netz und bekommt nie Metadaten (toter Start) */
async function bootDead(t: T) {
  t.deck.unlock('pointerup');
  await adv(10);
  t.deck.load(ALL[0], t.sink, { play: true, muted: false });
  await adv(10);
  return act(t);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T08:00:00Z'));
  nse.v = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Schalter und reine Funktionen (Runde 39)', () => {
  it('die Schalter stehen auf true, die Werte wie vereinbart', () => {
    expect(DEAD_RELOAD).toBe(true);
    expect(RESCUE_RETRY).toBe(true);
    expect(MS_FOLLOW).toBe(true);
    expect(RETURN_SILENCE).toBe(true);
    expect(DEAD_RELOAD_MIN_MS).toBe(5000);
    expect(RETURN_SILENCE_GAP_MS).toBe(150);
    expect(RETURN_SILENCE_CHECKS).toBe(3);
  });

  it('decideMsState: Element zählt, Übergabe verdeckt hält playing, Ende der Quelle ohne Meinung', () => {
    const base = { has: true, paused: false, ended: false, done: false, want: true, handover: false };
    expect(decideMsState({ ...base, has: false })).toBeNull();
    expect(decideMsState(base)).toBe('playing');
    expect(decideMsState({ ...base, paused: true })).toBe('paused');
    expect(decideMsState({ ...base, paused: true, want: false })).toBe('paused');
    // in der Übergabe: playing, auch wenn das neue Element noch pausiert (Laden, Tausch, inline next)
    expect(decideMsState({ ...base, paused: true, handover: true })).toBe('playing');
    // Übergabe, aber kein Wunsch zu spielen: paused
    expect(decideMsState({ ...base, paused: true, handover: true, want: false })).toBe('paused');
    expect(decideMsState({ ...base, done: true })).toBe('paused');
    expect(decideMsState({ ...base, paused: true, ended: true })).toBeNull();
  });

  it('deadSource und reviveDue', () => {
    expect(deadSource({ errorCode: 4, marked: false, rs: 0, played: false, local: false })).toBe(true);
    expect(deadSource({ errorCode: null, marked: true, rs: 0, played: false, local: false })).toBe(true);
    expect(deadSource({ errorCode: null, marked: true, rs: 1, played: false, local: false })).toBe(false);
    expect(deadSource({ errorCode: null, marked: false, rs: 0, played: false, local: false })).toBe(false);
    expect(deadSource({ errorCode: 4, marked: true, rs: 0, played: true, local: false })).toBe(false);
    expect(deadSource({ errorCode: 4, marked: true, rs: 0, played: false, local: true })).toBe(false);
    expect(reviveDue({ now: 10_000, last: 0, n: 0 })).toBe(true);
    expect(reviveDue({ now: 10_000, last: 6_000, n: 1 })).toBe(false);
    expect(reviveDue({ now: 11_000, last: 6_000, n: 1 })).toBe(true);
    expect(reviveDue({ now: 99_000, last: 6_000, n: DEAD_RELOAD_MAX })).toBe(false);
  });
});

describe('Befund 1: tote Quelle wird sauber neu geladen (DEAD_RELOAD)', () => {
  it('play() meldet NotSupportedError: sofort ein sauberes Neuladen, ein zweiter Fehler binnen 5 s lädt nicht noch einmal, nach 5 s der Takt wieder', async () => {
    const t = setup({ freshReload: false });
    const a = await bootDead(t);
    nse.v = true;
    const n = loads(a);
    // ohne Metadaten wartet der erste play() auf den Sprung (JUMP_META_MS), dann lehnt das Element ab
    await adv(8100);
    expect(has(t, /^deck play refused NotSupportedError/)).toBeGreaterThanOrEqual(1);
    expect(has(t, /^deck: dead source a \(refused\)/)).toBe(1);
    expect(loads(a)).toBe(n + 1);
    // das Laden scheitert wieder (Netz weg, Fehlerereignis): binnen 5 s kein weiteres Laden
    a.error = { code: 4 };
    a.emit('error');
    await adv(20);
    expect(loads(a)).toBe(n + 1);
    await adv(DEAD_RELOAD_MIN_MS);
    t.deck.heartbeat();
    await adv(20);
    expect(loads(a)).toBe(n + 2);
    expect(has(t, /^deck: dead source a \(tick\)/)).toBe(1);
  });

  it('Element im Fehlerzustand (error.code 4): play() lädt neu statt wieder nur abgelehnt zu werden', async () => {
    const t = setup({ freshReload: false });
    const a = await bootDead(t);
    a.error = { code: 4 };
    nse.v = true;
    const n = loads(a);
    t.deck.play(t.sink);
    await adv(20);
    expect(has(t, /^deck: dead source a \(play\)/)).toBe(1);
    expect(loads(a)).toBe(n + 1);
    expect(a.error).toBeNull();
  });

  it('höchstens DEAD_RELOAD_MAX Neuladen je Moment', async () => {
    const t = setup({ freshReload: false });
    const a = await bootDead(t);
    nse.v = true;
    const n = loads(a);
    for (let i = 0; i < 8; i++) {
      a.error = { code: 4 };
      t.deck.heartbeat();
      await adv(DEAD_RELOAD_MIN_MS + 100);
    }
    expect(loads(a) - n).toBe(DEAD_RELOAD_MAX);
    expect(has(t, /^deck: dead source a/)).toBe(DEAD_RELOAD_MAX);
  });

  it('verdeckt lädt nichts neu (load() verdeckt hängt das Element), die Rückkehr lädt sofort', async () => {
    const t = setup({ freshReload: false });
    const a = await bootDead(t);
    a.error = { code: 4 };
    nse.v = true;
    const n = loads(a);
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    t.deck.play(t.sink);
    a.emit('error');
    await adv(6000);
    expect(loads(a)).toBe(n);
    t.hid.v = false;
    t.deck.pageEvent('visible');
    await adv(10);
    expect(loads(a)).toBe(n + 1);
    expect(has(t, /^deck: dead source a \(return\)/)).toBe(1);
  });

  it('"fresh reload failed" ohne Metadaten und danach NotSupportedError beim play (wie 07:48:07 bis 07:48:12 im Gerätelog): sauberes Neuladen, danach Erfolg', async () => {
    const t = setup();
    const a = await bootDead(t);
    nse.v = true;
    // 3 s ohne Metadaten: frisches Neuladen (Runde 36), nach weiteren 8 s "failed (no metadata)", der Sprung gibt dann das erste play() frei
    await adv(3100);
    expect(has(t, /fresh reload$/)).toBe(1);
    await adv(8100);
    expect(has(t, /^deck: fresh reload failed a .*\(no metadata\)$/)).toBe(1);
    expect(has(t, /^deck play refused NotSupportedError/)).toBeGreaterThanOrEqual(1);
    expect(has(t, /^deck: dead source a \(refused\)/)).toBe(1);
    // das saubere Neuladen gelingt: Metadaten da
    nse.v = false;
    a.meta(10);
    await adv(10);
    expect(has(t, /^deck: dead reload ok a after \d+ ms$/)).toBe(1);
  });

  it('Fehlerereignis des aktiven Elements nach gescheitertem Laden: sauberes Neuladen im selben Ereignis, der Host bekommt keinen Fehler (kein No-op-"recover")', async () => {
    const errs: string[] = [];
    const t = setup({ freshReload: false });
    t.sink.error = () => errs.push('error');
    const a = await bootDead(t);
    a.error = { code: 4 };
    const n = loads(a);
    a.emit('error');
    await adv(10);
    expect(has(t, /^deck: dead source a \(error\)/)).toBe(1);
    expect(loads(a)).toBe(n + 1);
    expect(errs).toHaveLength(0);
    // gleich der nächste Fehler (Mindestabstand): der Host bekommt ihn wie bisher
    a.error = { code: 4 };
    a.emit('error');
    await adv(10);
    expect(loads(a)).toBe(n + 1);
    expect(errs).toHaveLength(1);
  });

  it('Neuladen ohne Metadaten: nach der Frist "dead reload failed", der Moment bleibt für den nächsten Anlass vermerkt', async () => {
    const t = setup();
    const a = await bootDead(t);
    a.error = { code: 4 };
    nse.v = true;
    t.deck.play(t.sink);
    await adv(10);
    await adv(8100);
    expect(has(t, /^deck: dead reload failed a after \d+ ms$/)).toBe(1);
    const n = loads(a);
    t.deck.heartbeat();
    await adv(10);
    expect(loads(a)).toBe(n + 1);
  });

  it('Gesten und "net: recover" (load mit Wunsch zu spielen) sind Anlässe', async () => {
    const t = setup({ freshReload: false });
    const a = await bootDead(t);
    a.error = { code: 4 };
    nse.v = true;
    await adv(DEAD_RELOAD_MIN_MS + 100);
    const n = loads(a);
    t.deck.unlock('pointerup');
    await adv(10);
    expect(has(t, /^deck: dead source a \(gesture\)/)).toBe(1);
    expect(loads(a)).toBe(n + 1);
    a.error = { code: 4 };
    await adv(DEAD_RELOAD_MIN_MS + 100);
    t.deck.load(ALL[0], t.sink, { play: true, muted: false });
    await adv(10);
    expect(has(t, /^deck: dead source a \(resume\)/)).toBe(1);
    expect(loads(a)).toBe(n + 2);
  });

  it('ein Moment, der schon gespielt hat, und Schalter aus: kein Neuladen', async () => {
    const t = setup();
    const a = await bootPlaying(t);
    a.error = { code: 2 };
    nse.v = true;
    const n = loads(a);
    t.deck.heartbeat();
    await adv(10);
    expect(loads(a)).toBe(n);
    expect(has(t, /dead source/)).toBe(0);

    const u = setup({ deadReload: false, freshReload: false });
    const b = await bootDead(u);
    b.error = { code: 4 };
    nse.v = true;
    const m = loads(b);
    u.deck.play(u.sink);
    await adv(DEAD_RELOAD_MIN_MS + 100);
    u.deck.heartbeat();
    u.deck.pageEvent('visible');
    expect(loads(b)).toBe(m);
    expect(has(u, /dead source/)).toBe(0);
  });

  it('silentFor: wächst ab Start ohne Ton, 0 nach erstem playing, verdeckt, ohne Wunsch und mit Schalter aus', async () => {
    const t = setup();
    const a = await bootDead(t);
    expect(t.deck.silentFor()).toBeLessThan(100);
    await adv(4000);
    expect(t.deck.silentFor()).toBeGreaterThanOrEqual(4000);
    t.hid.v = true;
    expect(t.deck.silentFor()).toBe(0);
    t.hid.v = false;
    // Hintergrund-Zeit zählt: nach der Rückkehr ist der Wert seit dem Start gemessen
    expect(t.deck.silentFor()).toBeGreaterThanOrEqual(4000);
    t.deck.pause(t.sink);
    expect(t.deck.silentFor()).toBe(0);
    t.deck.play(t.sink);
    a.meta(10);
    a.seeked();
    await adv(20);
    expect(t.deck.silentFor()).toBe(0);

    const u = setup({ rescueRetry: false });
    await bootDead(u);
    await adv(4000);
    expect(u.deck.silentFor()).toBe(0);
    expect(u.deck.rescueRetry).toBe(false);
  });
});

describe('Befund 2: Media Session folgt dem Element (MS_FOLLOW)', () => {
  it('Element spielt, Anzeige steht auf paused (07:50:07): der Sekundentakt korrigiert mit Zeile', async () => {
    const t = setup();
    const a = await bootPlaying(t);
    expect(a.paused).toBe(false);
    t.ms.v = 'paused';
    await adv(1100);
    expect(t.ms.v).toBe('playing');
    expect(has(t, /^bg: ms state fixed paused to playing \(element paused=false\)/)).toBe(1);
    // gleicher Zustand: keine weitere Zeile
    await adv(3000);
    expect(has(t, /^bg: ms state fixed/)).toBe(1);
  });

  it('nichts läuft, Anzeige steht auf playing (07:48:27): auf paused korrigiert, auch verdeckt', async () => {
    const t = setup();
    const a = await bootDead(t);
    a.error = { code: 4 };
    nse.v = true;
    t.ms.v = 'playing';
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    // in den ersten MS_HANDOVER_MS nach dem Start gilt die Übergabe (kein Blitz auf Pause beim Laden)
    await adv(1100);
    expect(t.ms.v).toBe('playing');
    await adv(MS_HANDOVER_MS);
    expect(a.paused).toBe(true);
    expect(t.ms.v).toBe('paused');
    expect(has(t, /^bg: ms state fixed playing to paused \(element paused=true\)/)).toBe(1);
  });

  it('Ereignis pause des aktiven Elements stellt sofort auf paused, play stellt auf playing zurück', async () => {
    const t = setup();
    const a = await bootPlaying(t);
    t.ms.v = 'playing';
    a.pause();
    expect(t.ms.v).toBe('paused');
    await t.deck.play(t.sink);
    await adv(10);
    expect(a.paused).toBe(false);
    expect(t.ms.v).toBe('playing');
  });

  it('verdeckte Übergabe (inline next): bis zum Ton bleibt die Anzeige auf playing, danach folgt sie dem Element', async () => {
    const t = setup();
    await bootPlaying(t);
    t.deck.nextClips = (n) => ALL.slice(1, 1 + n);
    t.deck.onAdvance = () => {};
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    const a = act(t);
    a.tick(13.99);
    await adv(10);
    expect(has(t, /bg: inline next b/)).toBe(1);
    const b = act(t);
    // das neue Element wartet noch auf den Sprung, kein Ton
    b.paused = true;
    t.ms.v = 'paused';
    await adv(1100);
    // Übergabe: playing, obwohl das Element noch auf den Sprung wartet
    expect(t.ms.v).toBe('playing');
    expect(has(t, /bg: ms state fixed paused to playing/)).toBe(1);
  });

  it('verdeckter Tausch auf ein bereites Element: playing im selben Zug, keine Korrekturzeile nötig', async () => {
    const t = setup();
    const a = await bootPlaying(t);
    t.deck.nextClips = (n) => ALL.slice(1, 1 + n);
    t.deck.onAdvance = () => {};
    t.deck.fill([ALL[1]]);
    withSrc(t, 'b')!.ready(10);
    await adv(10);
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    a.tick(13.99);
    await adv(10);
    const b = act(t);
    expect(b).not.toBe(a);
    expect(b.paused).toBe(false);
    expect(t.ms.v).toBe('playing');
    expect(has(t, /^bg: ms state fixed/)).toBe(0);
  });

  it('msTruth: der Zustand des Elements überschreibt die Absicht des Hosts', async () => {
    const t = setup();
    const a = await bootPlaying(t);
    expect(t.deck.msTruth('paused')).toBe('playing');
    a.pause();
    expect(t.deck.msTruth('playing')).toBe('paused');
  });

  it('Dauer, Position und Tempo des Clips (nicht der Folge) werden beim Wechsel und bei Tempoänderung neu gesetzt', async () => {
    const t = setup();
    const a = await bootPlaying(t);
    a.tick(11);
    await adv(10);
    expect(t.deck.lastPos?.duration).toBe(4);
    expect(t.deck.lastPos?.position).toBeCloseTo(1, 1);
    t.deck.setRate(2);
    a.playbackRate = 2;
    await adv(10);
    expect(t.deck.lastPos?.playbackRate).toBe(2);
    // Wechsel auf einen anderen Clip mit anderer Länge: sofort neu, nicht erst mit dem ersten timeupdate
    const long: DeckClip = { key: 'z|100|160', id: 'z', url: 'https://pod.test/z.mp3', start: 100, end: 160 };
    t.deck.fill([long]);
    withSrc(t, 'z')!.ready(100);
    await adv(10);
    t.deck.load(long, t.sink, { play: true, muted: false });
    await adv(10);
    expect(t.deck.lastPos?.duration).toBe(60);
  });

  it('Schalter aus: keine Korrektur, keine Zeile', async () => {
    const t = setup({ msFollow: false });
    await bootPlaying(t);
    t.ms.v = 'paused';
    await adv(3000);
    expect(t.ms.v).toBe('paused');
    expect(has(t, /^bg: ms state fixed/)).toBe(0);
    expect(t.deck.msTruth('paused')).toBe('paused');
  });
});

describe('Befund 3: zweites Element bei der Rückkehr (RETURN_SILENCE)', () => {
  /** a spielt, b und c liegen im Vorrat, dann verdeckt */
  async function bootPool(t: T) {
    const a = await bootPlaying(t);
    t.deck.fill([ALL[1], ALL[2]]);
    withSrc(t, 'b')!.ready(10);
    withSrc(t, 'c')!.ready(10);
    await adv(10);
    t.hid.v = true;
    t.deck.pageEvent('hidden');
    await adv(10);
    return a;
  }

  it('iOS setzt Vorrats-Elemente bei der Rückkehr auf "spielt": sofort angehalten, dreimal im Abstand von 150 ms nachgeprüft, Zeile mit sinceCall', async () => {
    const t = setup();
    await bootPool(t);
    const b = withSrc(t, 'b')!;
    const c = withSrc(t, 'c')!;
    // verdeckt standen sie, bei der Rückkehr sind sie wieder auf paused=false
    t.hid.v = false;
    b.paused = false;
    c.paused = false;
    t.deck.pageEvent('visible');
    expect(b.paused).toBe(true);
    expect(c.paused).toBe(true);
    const line = t.lines.find((l) => /^deck: second element playing pool b /.test(l)) ?? '';
    expect(line).toMatch(/paused \(visible\) rs=\d+ sincePlay=\S+ sinceCall=none lastHalt=\S+/);
    // iOS setzt c nach 100 ms noch einmal um
    await adv(100);
    c.paused = false;
    await adv(RETURN_SILENCE_GAP_MS);
    expect(c.paused).toBe(true);
    // und noch einmal bei 400 ms
    await adv(150);
    b.paused = false;
    await adv(RETURN_SILENCE_GAP_MS + 10);
    expect(b.paused).toBe(true);
  });

  it('nach den drei Prüfungen endet die Wiederholung (danach nur noch der Sekundentakt)', async () => {
    const t = setup();
    await bootPool(t);
    const b = withSrc(t, 'b')!;
    t.hid.v = false;
    t.deck.pageEvent('visible');
    await adv(RETURN_SILENCE_GAP_MS * RETURN_SILENCE_CHECKS + 20);
    b.paused = false;
    await adv(RETURN_SILENCE_GAP_MS * 2);
    // der Sekundentakt kommt erst später: noch läuft b
    expect(b.paused).toBe(false);
    await adv(1000);
    expect(b.paused).toBe(true);
  });

  it('Schalter aus: keine Wiederholung und keine Zusatzfelder in der Zeile', async () => {
    const t = setup({ returnSilence: false });
    await bootPool(t);
    const b = withSrc(t, 'b')!;
    t.hid.v = false;
    b.paused = false;
    t.deck.pageEvent('visible');
    expect(b.paused).toBe(true);
    const line = t.lines.find((l) => /^deck: second element playing pool b /.test(l)) ?? '';
    expect(line).toMatch(/paused \(visible\)$/);
    await adv(100);
    b.paused = false;
    await adv(RETURN_SILENCE_GAP_MS * 4);
    expect(b.paused).toBe(false);
  });

  it('play-Ereignis eines nicht aktiven Elements steht im Protokoll (höchstens alle 5 s je Element)', async () => {
    const t = setup();
    await bootPool(t);
    const b = withSrc(t, 'b')!;
    b.emit('play');
    b.emit('play');
    expect(has(t, /^deck: element play event pool b hidden=1 rs=\d+ sinceCall=none/)).toBe(1);
  });

  it('das aktive Element läuft weiter, nur Fremdelemente werden angehalten', async () => {
    const t = setup();
    const a = await bootPool(t);
    t.hid.v = false;
    t.deck.pageEvent('visible');
    await adv(600);
    expect(a.paused).toBe(false);
  });
});
