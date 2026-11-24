// Runde 38: verdeckt früher und zwei voraus nachladen (Ziel 2, parallel 2, schwaches Netz 1, verlorener Abruf einmal sofort mit dem nächsten Kandidaten).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, BG_REFILL_CAND, BG_REFILL_EARLY, BG_REFILL_MS, BG_REFILL_PARALLEL, BG_REFILL_TARGET, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

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

function setup(opts: { bgRefillEarly?: boolean } = {}) {
  const els: El[] = [];
  const hid = { v: false };
  const deck = new AudioDeck({
    standby: true,
    // die Zeit des aktiven Elements steht im Test still, die Hänge-Erkennung (Runde 36) hat ihre eigenen Tests
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
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const asked: number[] = [];
  let cur = 0;
  deck.nextClips = (n) => {
    asked.push(n);
    return ALL.slice(cur + 1, cur + 1 + n);
  };
  deck.onAdvance = (_f, to) => {
    cur = ALL.findIndex((c) => c.key === to.key);
  };
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink, hid, asked };
}
type T = ReturnType<typeof setup>;
const act = (t: T) => t.deck.element as El;
const withSrc = (t: T, id: string) => t.els.find((e) => e.src.endsWith(`/${id}.mp3`));
const has = (t: T, re: RegExp) => t.lines.filter((l) => re.test(l)).length;
const adv = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const sounding = (t: T) => t.els.filter((e) => !e.paused && !e.src.startsWith('data:')).length;
const mutedPlays = (t: T) => t.els.reduce((n, e) => n + e.log.filter((l) => l === 'play:muted').length, 0);

/** a spielt, der Vorrat enthält die ersten n der folgenden Clips bereit, Seite noch sichtbar */
async function boot(t: T, pool: string[] = []) {
  t.deck.unlock('pointerup');
  await adv(10);
  t.deck.load(ALL[0], t.sink, { play: true, muted: false });
  await adv(10);
  const a = act(t);
  a.meta(10);
  a.seeked();
  await adv(10);
  if (pool.length) {
    t.deck.fill(pool.map((id) => ALL.find((c) => c.id === id)!));
    for (const id of pool) withSrc(t, id)!.ready(10);
    await adv(10);
  }
}
const hide = async (t: T) => {
  t.hid.v = true;
  t.deck.pageEvent('hidden');
  await adv(10);
};
const weak = (t: T) => (t.deck as unknown as { markWeak: () => void }).markWeak();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
  refuse.v = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Hintergrund lädt früher und zwei voraus nach (Runde 38)', () => {
  it('die Schalter und Werte stehen wie vereinbart', () => {
    expect(BG_REFILL_EARLY).toBe(true);
    expect(BG_REFILL_TARGET).toBe(2);
    expect(BG_REFILL_PARALLEL).toBe(2);
    expect(BG_REFILL_CAND).toBeGreaterThanOrEqual(4);
  });

  it('Start beim Verdecken: ein bereiter Eintrag, das Ziel 2 verlangt einen zweiten Abruf, ohne dass ein Clip endet', async () => {
    const t = setup();
    await boot(t, ['b']);
    expect(has(t, /^bg: refill /)).toBe(0);
    await hide(t);
    expect(has(t, /^bg: refill c \(pool 1\/0, target 2\)$/)).toBe(1);
    expect(has(t, /^bg: refill /)).toBe(1);
    expect(withSrc(t, 'c')).toBeDefined();
    // das Ziel ist erreicht: weitere Auslöser starten nichts
    t.deck.pageEvent('hidden');
    await adv(10);
    expect(has(t, /^bg: refill [a-g] \(/)).toBe(1);
  });

  it('Ziel 2 wird gehalten: nach jedem Wechsel liegen wieder zwei Einträge bereit oder laden, nie mehr', async () => {
    const t = setup();
    await boot(t, ['b']);
    await hide(t);
    withSrc(t, 'c')!.ready(10);
    await adv(10);
    for (let i = 0; i < 3; i++) {
      act(t).tick(14);
      await adv(10);
      const e = (t.deck as unknown as { entries: unknown[] }).entries.length;
      expect(e).toBeLessThanOrEqual(2);
      expect(e).toBe(2);
      for (const el of t.els) if (!el.paused && el !== act(t)) throw new Error('zweites Element mit Ton');
      for (const id of ['b', 'c', 'd', 'e', 'f', 'g']) {
        const ld = withSrc(t, id);
        if (ld && ld !== act(t) && ld.paused && ld.readyState === 0) ld.ready(10);
      }
      await adv(10);
    }
    expect(sounding(t)).toBe(1);
    expect(mutedPlays(t)).toBe(0);
    expect(has(t, /^bg: end without switch/)).toBe(0);
  });

  it('parallel 2: ohne Vorrat starten beim Verdecken zwei Abrufe zugleich, nie ein dritter', async () => {
    const t = setup();
    await boot(t);
    await hide(t);
    expect(has(t, /^bg: refill b \(pool 0\/0, target 2\)$/)).toBe(1);
    expect(has(t, /^bg: refill c \(pool 0\/1, target 2\)$/)).toBe(1);
    expect(has(t, /^bg: refill /)).toBe(2);
    expect(withSrc(t, 'd')).toBeUndefined();
    expect(t.asked.every((n) => n >= 4)).toBe(true);
  });

  it('schwaches Netz: ein Abruf zugleich, der zweite startet, sobald der erste bereit ist (Ziel bleibt 2)', async () => {
    const t = setup();
    await boot(t);
    weak(t);
    await hide(t);
    expect(has(t, /^bg: refill /)).toBe(1);
    expect(has(t, /^bg: refill b \(pool 0\/0, target 2\)$/)).toBe(1);
    withSrc(t, 'b')!.ready(10);
    await adv(10);
    expect(has(t, /^bg: refill ready b after \d+ ms$/)).toBe(1);
    expect(has(t, /^bg: refill c \(pool 1\/0, target 2\)$/)).toBe(1);
    expect(has(t, /^bg: refill /)).toBe(3);
    withSrc(t, 'c')!.ready(10);
    await adv(10);
    // Ziel erreicht, nichts weiter
    expect(has(t, /^bg: refill [a-g] \(/)).toBe(2);
  });

  it('verlorenes Nachladen: einmal sofort der nächste Kandidat, ein zweiter Verlust zieht keinen weiteren nach', async () => {
    const t = setup();
    await boot(t, ['b']);
    await hide(t);
    expect(has(t, /^bg: refill c \(/)).toBe(1);
    await adv(BG_REFILL_MS + 10);
    expect(has(t, /^bg: refill lost c \(timeout rs=\d+ ns=\S+\), trying next d$/)).toBe(1);
    expect(has(t, /^bg: refill d \(pool 1\/0, target 2\)$/)).toBe(1);
    // c wird in dieser Phase nicht erneut versucht
    await adv(BG_REFILL_MS + 10);
    expect(has(t, /^bg: refill lost d \(timeout rs=\d+ ns=\S+\)$/)).toBe(1);
    expect(has(t, /trying next/)).toBe(1);
    expect(has(t, /^bg: refill c \(/)).toBe(1);
    // nach zwei Verlusten keine weiteren Abrufe in dieser Phase
    expect(has(t, /^bg: refill [a-g] \(/)).toBe(2);
    // sichtbar: Zurücksetzen, die Zeile "while hidden" zählt 2 gestartet, 0 bereit, 2 verloren
    t.hid.v = false;
    t.deck.pageEvent('visible');
    expect(has(t, /refills 2\/0\/2$/)).toBe(1);
  });

  it('verlorenes Nachladen bei zwei parallelen Abrufen: jeder Verlust ersetzt genau einmal, nie derselbe Clip', async () => {
    const t = setup();
    await boot(t);
    await hide(t);
    await adv(BG_REFILL_MS + 10);
    expect(has(t, /^bg: refill lost b .*trying next d$/)).toBe(1);
    expect(has(t, /^bg: refill lost c .*trying next e$/)).toBe(1);
    const starts = t.lines.filter((l) => /^bg: refill [a-g] \(/.test(l)).map((l) => l.split(' ')[2]);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('fertiger Abruf zählt in "while hidden": gestartet/bereit/verloren', async () => {
    const t = setup();
    await boot(t, ['b']);
    await hide(t);
    withSrc(t, 'c')!.ready(10);
    await adv(10);
    t.hid.v = false;
    t.deck.pageEvent('visible');
    expect(has(t, /refills 1\/1\/0$/)).toBe(1);
  });

  it('ein ladendes Nachfüll-Element gibt nie Ton und der Wächter bricht es nicht ab', async () => {
    const t = setup();
    await boot(t);
    await hide(t);
    const ld = [withSrc(t, 'b')!, withSrc(t, 'c')!];
    const pausesBefore = ld[0].log.filter((l) => l === 'pause').length;
    await adv(3500);
    expect(ld.every((e) => e.paused)).toBe(true);
    expect(has(t, /^deck: second element/)).toBe(0);
    expect(ld.every((e) => e.log.filter((l) => l === 'pause').length === pausesBefore)).toBe(true);
    expect(sounding(t)).toBe(1);
    // beide werden bereit und bleiben im Vorrat, ein Wechsel tauscht auf b, nur ein Element gibt Ton
    ld[0].ready(10);
    ld[1].ready(10);
    await adv(10);
    act(t).tick(14);
    await adv(3000);
    expect(act(t)).toBe(ld[0]);
    expect(sounding(t)).toBe(1);
    expect(mutedPlays(t)).toBe(0);
  });

  it('kein freies Element: ein behaltenes, freigeschaltetes wird verdeckt freigegeben und für das Ziel genutzt', async () => {
    const t = setup();
    await boot(t, ['b', 'c']);
    // sichtbar tauschen: a bleibt als behaltenes Element
    t.deck.swapNext(null);
    await adv(10);
    expect(has(t, /^deck: keep prev a /)).toBe(1);
    // alles andere ist belegt oder verdächtig, der Vorrat ist leer
    const d = t.deck as unknown as { entries: { el: El }[]; suspect: Set<El>; kept: { el: El }[] };
    const keptEl = d.kept[0].el;
    for (const e of [...d.entries]) d.suspect.add(e.el);
    d.entries.length = 0;
    for (const e of t.els) if (e !== act(t) && e !== keptEl) d.suspect.add(e);
    await hide(t);
    expect(has(t, /^bg: refill releases kept a$/)).toBe(1);
    expect(has(t, /^bg: refill [b-g] \(/)).toBe(1);
    expect(d.kept.length).toBe(0);
    expect(sounding(t)).toBe(1);
  });

  it('Schalter aus: Verhalten wie Runde 37 (Ziel 1, nur bei leerem Vorrat, ein Abruf, kein Auslöser beim Verdecken)', async () => {
    const t = setup({ bgRefillEarly: false });
    await boot(t, ['b']);
    await hide(t);
    expect(has(t, /^bg: refill /)).toBe(0);
    // leerer Vorrat: genau ein Abruf, altes Zeilenformat
    const u = setup({ bgRefillEarly: false });
    await boot(u);
    await hide(u);
    expect(has(u, /^bg: refill /)).toBe(0);
    act(u).tick(14);
    await adv(10);
    expect(has(u, /^bg: refill c \(pool 0\)$/)).toBe(1);
    expect(has(u, /^bg: refill /)).toBe(1);
    await adv(BG_REFILL_MS + 10);
    expect(has(u, /^bg: refill lost c \(timeout rs=\d+ ns=\S+\)$/)).toBe(1);
    expect(has(u, /trying next/)).toBe(0);
    expect(has(u, /^bg: refill [a-g] \(/)).toBe(1);
  });

  it('Verdecken ohne Schalter bg refill: nichts wird geladen', async () => {
    const t = setup();
    (t.deck as unknown as { bgRefillOn: boolean }).bgRefillOn = false;
    await boot(t);
    await hide(t);
    expect(has(t, /^bg: refill /)).toBe(0);
  });
});
