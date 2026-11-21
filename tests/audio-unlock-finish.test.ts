// Runde 31: das stille Freischalten schliesst ab, bevor der Vorrat lädt. Der Nachbau nimmt das Inline-play verzögert an (300 ms), nie, mit NotAllowedError oder nur per Ereignis.
// Gerätelog 21.11.: der Vorrat lud Netzquellen in Elemente mit laufender Probe, die Proben brachen ab (ok=0).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, PROBE_MS, POOL, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

const mode: { v: 'now' | 'never' | 'reject' | 'playing' | number } = { v: 'now' };

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
  /** Eintrag bereit: Metadaten, Sprung, seeked */
  ready(target: number) {
    this.meta(target);
    if (this.seeking) this.seeked();
    else this.emit('canplaythrough');
  }
}

const clip = (id: string, start = 30): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60 });


function setup() {
  const els: El[] = [];
  const deck = new AudioDeck({
    standby: true,
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
const net = (t: T) => t.els.filter((e) => e.src.startsWith('https://'));
const count = (t: T, re: RegExp) => t.lines.filter((l) => re.test(l)).length;
const adv = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  mode.v = 'now';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('stilles Freischalten schliesst ab, bevor der Vorrat lädt (Runde 31)', () => {
  it('die stille Quelle ist eine echte WAV-Datei (8 kHz, mono, 8 Bit, 0,2 s)', async () => {
    mode.v = 300;
    const t = setup();
    t.deck.unlock('pointerup');
    const src = t.els.find((e) => e.src.startsWith('data:'))!.src;
    expect(src.startsWith('data:audio/wav;base64,')).toBe(true);
    const bin = atob(src.split(',')[1]);
    expect(bin.length).toBe(44 + 1600);
    expect(bin.slice(0, 4)).toBe('RIFF');
    expect(bin.slice(8, 16)).toBe('WAVEfmt ');
    expect(bin.charCodeAt(24) + bin.charCodeAt(25) * 256).toBe(8000);
    expect(bin.charCodeAt(34)).toBe(8);
    await adv(400);
  });

  it('(a)(b) Annahme nach 300 ms: kein pool load in ein Element mit laufender Probe, der Vorrat startet erst nach allen Proben', async () => {
    mode.v = 300;
    const t = setup();
    t.deck.fill([clip('b'), clip('c')]);
    t.deck.unlock('pointerup');
    t.deck.fill([clip('b'), clip('c')]);
    await adv(200);
    t.deck.fill([clip('b'), clip('c')]);
    expect(net(t)).toEqual([]);
    expect(t.deck.poolInfo()).toEqual([]);
    expect(count(t, /^deck: pool start/)).toBe(0);
    await adv(150);
    expect(count(t, /^deck: pool start after unlock ok=6\/6$/)).toBe(1);
    expect(t.deck.poolInfo().map((p) => p.id)).toContain('b');
    // die Zeile der Geste steht vor dem Start des Vorrats, die Proben vor jedem pool load
    const g = t.lines.findIndex((l) => /^deck: gesture unlock 6 elements ok=6 rejected=0 timeout=0 after \d+ ms$/.test(l));
    expect(g).toBeGreaterThanOrEqual(0);
    expect(t.lines.findIndex((l) => l.startsWith('deck: pool load'))).toBeGreaterThan(g);
    expect(t.lines.findIndex((l) => l.startsWith('deck: probe done'))).toBeLessThan(t.lines.findIndex((l) => l.startsWith('deck: pool load')));
    expect(count(t, /^deck: probe done .* ok=0/)).toBe(0);
  });

  it('(c) das Inline-play antwortet nie: nach PROBE_MS (800 ms) gilt ok=0, der Vorrat füllt, die nächste Geste wiederholt auf freien Elementen', async () => {
    mode.v = 'never';
    const t = setup();
    t.deck.unlock('pointerup');
    await adv(PROBE_MS - 50);
    t.deck.fill([clip('b'), clip('c')]);
    expect(net(t)).toEqual([]);
    expect(count(t, /^deck: pool start/)).toBe(0);
    await adv(100);
    expect(count(t, /^deck: pool start after unlock ok=0\/6$/)).toBe(1);
    expect(count(t, /^deck: gesture unlock 6 elements ok=0 rejected=0 timeout=6 after \d+ ms$/)).toBe(1);
    // die Elemente tragen die Stille nicht mehr, sind pausiert und nicht freigeschaltet
    expect(t.els.filter((e) => e.src.startsWith('data:'))).toEqual([]);
    expect(t.els.every((e) => e.paused)).toBe(true);
    expect(t.deck.poolInfo().map((p) => p.id)).toContain('b');
    const before = t.els.map((e) => e.log.filter((l) => l === 'play:silence').length);
    // nächste Geste: Elemente ohne Netzquelle werden wieder angespielt, Elemente des Vorrats nicht
    t.deck.unlock('click');
    await adv(PROBE_MS + 50);
    const after = t.els.map((e) => e.log.filter((l) => l === 'play:silence').length);
    const retried = t.els.filter((_, i) => after[i] > before[i]);
    expect(retried.length).toBeGreaterThan(0);
    for (const e of retried) expect(e.src.startsWith('https://')).toBe(false);
    for (const e of net(t)) expect(e.log.filter((l) => l === 'play:silence').length).toBe(before[t.els.indexOf(e)]);
    // Pool-Start steht nur einmal
    expect(count(t, /^deck: pool start/)).toBe(1);
  });

  it('abgelehnt (NotAllowedError): sofort entschieden, rejected zählt, Vorrat startet mit ok=0', async () => {
    mode.v = 'reject';
    const t = setup();
    t.deck.unlock('pointerup');
    await adv(10);
    expect(count(t, /^deck: gesture unlock 6 elements ok=0 rejected=6 timeout=0 after \d+ ms$/)).toBe(1);
    expect(count(t, /^deck: pool start after unlock ok=0\/6$/)).toBe(1);
  });

  it('ein Ereignis playing zählt als Annahme, auch ohne erfülltes Promise', async () => {
    mode.v = 'playing';
    const t = setup();
    t.deck.unlock('pointerup');
    await adv(150);
    // das Ereignis allein beendet die Probe nicht, erst die Zeitgrenze zählt es als Annahme
    expect(count(t, /^deck: gesture unlock /)).toBe(0);
    await adv(PROBE_MS);
    expect(count(t, /^deck: gesture unlock 6 elements ok=6 rejected=0 timeout=0 after \d+ ms$/)).toBe(1);
    expect(count(t, /^deck: pool start after unlock ok=6\/6$/)).toBe(1);
  });

  it('weitere Gesten während laufender Proben öffnen den Vorrat nicht vorzeitig (Ursache im Gerätelog)', async () => {
    mode.v = 300;
    const t = setup();
    t.deck.unlock('pointerdown');
    t.deck.unlock('pointerup');
    t.deck.unlock('touchend');
    t.deck.unlock('click');
    t.deck.fill([clip('b'), clip('c')]);
    await adv(100);
    expect(count(t, /^deck: pool start/)).toBe(0);
    expect(net(t)).toEqual([]);
    await adv(250);
    expect(count(t, /^deck: pool start after unlock ok=6\/6$/)).toBe(1);
    expect(count(t, /^deck: gesture unlock /)).toBe(1);
  });

  it('ein Start während laufender Proben nimmt kein Element mit Probe, solange ein anderes frei ist', async () => {
    mode.v = 300;
    const t = setup();
    t.deck.unlock('pointerup');
    // fünf Elemente in Probe, ein weiteres (sechstes) fehlt noch: das aktive Element wird neu angelegt oder eine Probe endet vor dem Setzen der Quelle
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: false });
    const a = net(t);
    expect(a).toHaveLength(1);
    expect(a[0].muted).toBe(false);
    // die Probe dieses Elements wurde vor dem Setzen der Netzquelle beendet, die anderen laufen weiter
    const aborted = t.lines.filter((l) => /^deck: probe done .* aborted ok=0/.test(l)).length;
    expect(aborted).toBeLessThanOrEqual(1);
    await adv(400);
    expect(net(t).map((e) => e.src)).toEqual(['https://pod.test/a.mp3']);
    expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
  });
});
