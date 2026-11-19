// Runde 27: Kollaps der Dauer (iOS setzt duration auf currentTime und meldet ended, obwohl die Datei bis zum Ende gepuffert ist).
// Das Deck baut das Element nicht neu auf, es lädt dieselbe Adresse in ein anderes freies Element, Ziel 1,0 s früher. Der Nachbau protokolliert Aufrufe (Quelle, Position, play).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, DODGE_BACK, EARLY_RESTART_MS, POOL, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  private t = 0;
  get currentTime() {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
    this.log.push(`seek:${v}`);
    if (!Number.isFinite(this.duration) || v < this.duration) this.ended = false;
  }
  paused = true;
  ended = false;
  readyState = 0;
  networkState = 1;
  duration = Number.NaN;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  buffered: { length: number; start: (i: number) => number; end: (i: number) => number } = { length: 0, start: () => 0, end: () => 0 };
  seekable = this.buffered;
  log: string[] = [];
  plays = 0;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.plays++;
    this.log.push('play');
    this.paused = false;
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
    this.duration = Number.NaN;
    this.log.push('load');
  }
  removeAttribute(n: string) {
    if (n === 'src') this.src = '';
  }
  /** Datei von Anfang an bis real Sekunden gepuffert */
  full(real: number) {
    this.buffered = { length: 1, start: () => 0, end: () => real };
    this.seekable = this.buffered;
  }
  /** Wie iOS: duration fällt auf die Position, ended kommt, das Element pausiert (pause vor ended) */
  collapse() {
    this.duration = this.currentTime;
    this.emit('durationchange');
    this.ended = true;
    this.paused = true;
    this.emit('pause');
    this.emit('ended');
  }
}

const clip = (id: string, start = 30): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60 });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

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
const count = (t: T, re: RegExp) => t.lines.filter((l) => re.test(l)).length;

/** Kaltstart wie am Gerät: play() stumm ab rs=0, Metadaten mit echter Dauer, Sprung auf die Startstelle */
async function coldStart(t: T, c = clip('a')) {
  t.deck.load(c, t.sink, { play: true, muted: false });
  await flush();
  const el = t.deck.element as El;
  el.duration = 600;
  el.full(600);
  el.readyState = 4;
  el.emit('durationchange');
  el.emit('loadedmetadata');
  await flush();
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Ausweichen auf ein frisches Element (Runde 27, Teil 2)', () => {
  it('Kollaps beim Start: anderes Element, dieselbe Adresse, Ziel 1,0 s früher, altes Element leer, eine Zeile collapse und eine Zeile fresh element', async () => {
    const t = setup();
    const a = await coldStart(t);
    expect(a.currentTime).toBe(30);
    expect(t.els).toHaveLength(1);
    a.collapse();
    await flush();
    expect(t.els).toHaveLength(2);
    const f = t.els[1];
    expect(t.deck.element).toBe(f);
    expect(f.src).toBe('https://pod.test/a.mp3');
    expect(a.src).toBe('');
    // Ziel 1,0 s früher: der Sprung kommt nach den Metadaten des frischen Elements
    expect(f.log).toContain('load');
    f.duration = 600;
    f.full(600);
    f.readyState = 4;
    f.emit('loadedmetadata');
    expect(f.currentTime).toBe(30 - DODGE_BACK);
    expect(f.plays).toBe(1);
    // genau ein Ausweichen, genau eine Zeile collapse (pause und ended kommen kurz nacheinander)
    expect(count(t, /^deck: collapse a /)).toBe(1);
    expect(t.lines.find((l) => l.startsWith('deck: collapse a '))).toMatch(
      /^deck: collapse a dur=30\.0 t=30\.0 rs=4 ns=1 err=none seeking=0 buf=\[0\.0-600\.0\] seekable=\[0\.0-600\.0\] played=\[\] sinceSeek=\S+ sincePlay=\d+ sinceLoad=\d+ unlocked=1 probed=0 loading=\d+$/,
    );
    expect(count(t, /^deck: fresh element/)).toBe(0);
    // nach 2 s Spielzeit: ok, einmal
    f.currentTime = 29 + 2.5;
    f.emit('timeupdate');
    f.emit('timeupdate');
    expect(t.lines.filter((l) => l === 'deck: fresh element a ok')).toHaveLength(1);
    expect(count(t, /^deck: collapse a /)).toBe(1);
    expect(count(t, /false ended|recovering|rebuilding/)).toBe(0);
  });

  it('Zeile "dur drop" beim Fallen der Dauer, einmal, ohne die alte Zeile "duration dropped"', async () => {
    const t = setup();
    const a = await coldStart(t);
    a.collapse();
    await flush();
    const drops = t.lines.filter((l) => l.startsWith('deck: dur drop a '));
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatch(/^deck: dur drop a 600\.0 -> 30\.0 t=30\.0 rs=4 paused=\d seeking=0 sinceSeek=\S+ sincePlay=\d+ probed=0$/);
    expect(count(t, /duration dropped/)).toBe(0);
  });

  it('zweiter Kollaps auf dem frischen Element: bestehende Kette (Neustart am Element), kein weiteres Ausweichen', async () => {
    const t = setup();
    const a = await coldStart(t);
    a.collapse();
    await flush();
    const f = t.els[1];
    f.duration = 600;
    f.full(600);
    f.readyState = 4;
    f.emit('loadedmetadata');
    await flush();
    f.collapse();
    await flush();
    expect(t.els).toHaveLength(2);
    expect(t.deck.element).toBe(f);
    expect(t.lines.filter((l) => l === 'deck: fresh element a collapsed')).toHaveLength(1);
    expect(count(t, /^deck: collapse a /)).toBe(2);
    expect(count(t, /^deck: fresh element a ok/)).toBe(0);
    // die bestehende Kette: Neustart nach vorzeitigem ended
    vi.advanceTimersByTime(EARLY_RESTART_MS[0]);
    await flush();
    expect(count(t, /^deck: early ended, restart 1/)).toBe(1);
    expect(t.els).toHaveLength(2);
    // und kein drittes Element, auch nach weiteren Kollapsen
    f.collapse();
    vi.advanceTimersByTime(EARLY_RESTART_MS[1]);
    await flush();
    expect(t.els).toHaveLength(2);
  });

  it('Kollaps nach dem Spielen (ended mit Dauer gleich Position, 5 s gelaufen): ebenfalls ein frisches Element, Ziel an der Stelle minus 1,0 s', async () => {
    const t = setup();
    const a = await coldStart(t);
    a.emit('playing');
    a.currentTime = 36;
    a.emit('timeupdate');
    a.collapse();
    await flush();
    expect(t.els).toHaveLength(2);
    const f = t.els[1];
    f.duration = 600;
    f.readyState = 4;
    f.emit('loadedmetadata');
    expect(f.currentTime).toBe(35);
    expect(count(t, /^deck: collapse a /)).toBe(1);
  });

  it('echtes Ende (Dauer gleich Position, nichts dahinter gepuffert und nie länger gemeldet): kein Ausweichen', async () => {
    const t = setup();
    t.deck.load(clip('z', 30), t.sink, { play: true, muted: false });
    await flush();
    const z = t.deck.element as El;
    z.duration = 90;
    z.full(90);
    z.readyState = 4;
    z.emit('loadedmetadata');
    z.emit('playing');
    z.currentTime = 89.9;
    z.emit('ended');
    expect(t.els).toHaveLength(1);
    expect(count(t, /^deck: collapse/)).toBe(0);
  });

  it('Elementzahl bleibt höchstens POOL + 1 je Spur: bei vollem Vorrat gibt der am weitesten vorausliegende Eintrag seinen Platz ab, nie der nächste', async () => {
    const t = setup();
    const a = await coldStart(t);
    a.emit('playing');
    const ids = ['b', 'c', 'd', 'e', 'f'];
    for (let round = 0; round < 6; round++) {
      t.deck.fill(ids.map((i) => clip(i, 40)));
      for (const e of t.els) {
        if (e === a || !e.src || e.readyState >= 4) continue;
        e.duration = 600;
        e.full(600);
        e.readyState = 4;
        e.emit('loadedmetadata');
        e.emit('canplaythrough');
      }
    }
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(ids);
    expect(t.els).toHaveLength(POOL + 1);
    const far = t.els.find((e) => e.src.endsWith('/f.mp3'))!;
    a.collapse();
    await flush();
    expect(t.els.length).toBeLessThanOrEqual(POOL + 1);
    expect(t.deck.element).toBe(far);
    expect(far.src).toBe('https://pod.test/a.mp3');
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(['b', 'c', 'd', 'e']);
    expect(count(t, /^deck: pool dropped f \(room for fresh\)/)).toBe(1);
  });

  it('Tausch auf ein Vorrats-Element im Zustand "Ende gemeldet" mit Daten dahinter: frisches Element statt Rückschritt, eine Zeile collapse', async () => {
    const t = setup();
    const a = await coldStart(t);
    a.emit('playing');
    // erst die Geste: sie schaltet die Elemente frei, ein Eintrag springt dann sofort und ist bereit
    t.deck.unlock('pointerup');
    await flush();
    t.deck.fill([clip('b', 40)]);
    const b = t.els.find((e) => e.src.endsWith('/b.mp3'))!;
    b.duration = 600;
    b.full(600);
    b.readyState = 4;
    b.emit('loadedmetadata');
    b.emit('canplaythrough');
    expect(t.deck.poolReady('b|40|100')).toBe(true);
    // iOS meldet vor dem Tausch die Dauer gleich Startstelle
    b.duration = 40;
    b.ended = true;
    t.deck.swapNext(t.sink);
    await flush();
    expect(t.deck.element).not.toBe(b);
    expect(t.deck.element.src).toBe('https://pod.test/b.mp3');
    expect(b.src).toBe('');
    expect(count(t, /^deck: collapse b /)).toBe(1);
    expect(count(t, /^deck: swap at reported end/)).toBe(0);
  });
});

describe('Messpunkte (Runde 27, Teil 3)', () => {
  it('env: eine Zeile je Sitzung mit Gerät und standalone', async () => {
    const t = setup();
    await coldStart(t);
    t.deck.unlock('pointerup');
    t.deck.unlock('click');
    expect(t.lines.filter((l) => l.startsWith('env: '))).toHaveLength(1);
    expect(t.lines.find((l) => l.startsWith('env: '))).toMatch(/^env: ua=.+ standalone=[01]$/);
  });
});
