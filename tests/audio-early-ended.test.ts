// Runde 13 (Diag 14.11. 05:47): iOS meldete direkt nach dem Sprung an die Startstelle "ended" (played=false), das Element pausierte, das play() blieb offen.
// Das Deck springt jetzt zurück an die Startstelle und ruft play() erneut (höchstens 3 Versuche), ohne den Schutz "one in flight" auszuhebeln.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, EARLY_RESTART_MS, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

class El implements DeckEl {
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 900;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  plays = 0;
  /** Zahl der play()-Aufrufe, die still offen bleiben (kein playing, Promise offen), danach spielt es normal */
  stall = 0;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.plays++;
    this.paused = false;
    if (this.stall > 0) {
      this.stall--;
      return new Promise<void>(() => {});
    }
    this.ended = false;
    this.emit('playing');
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
  /** Wie iOS: Position steht an der Startstelle, ended kommt ohne playing, das Element pausiert (pause vor ended) */
  earlyEnd() {
    this.ended = true;
    this.paused = true;
    this.emit('pause');
    this.emit('ended');
  }
}

const clip = (id: string, start = 414.1): DeckClip => ({ key: `${id}|${start}|${start + 60}`, id, url: `https://pod.test/${id}.mp3`, start, end: start + 60 });
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function setup() {
  const els: El[] = [];
  const deck = new AudioDeck({
    standby: true,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      // das erste play() jedes Elements bleibt offen, wie auf iOS in der Diagnose
      e.stall = 1;
      els.push(e);
      return e;
    },
    hidden: () => false,
    running: () => true,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  let errors = 0;
  const sink: DeckSink = { state: () => {}, error: () => errors++ };
  return { deck, els, lines, sink, errs: () => errors };
}
type T = ReturnType<typeof setup>;

/** Start wie in der Diagnose: play() bleibt offen, Metadaten kommen, dann das vorzeitige ended */
async function boot(t: T, c = clip('a')): Promise<El> {
  t.deck.load(c, t.sink, { play: true, muted: true });
  await flush();
  const el = t.els[0];
  el.readyState = 4;
  el.currentTime = c.start;
  return el;
}
const restartLines = (t: T) => t.lines.filter((l) => l.startsWith('deck: early ended, restart'));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('A: vorzeitiges ended ohne gespielt zu haben', () => {
  it('Ablauf der Diagnose: play() offen, loadedmetadata, Sprung, ended played=false endet mit laufendem Element ohne Tipp', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: true });
    await flush();
    const el = t.els[0];
    expect(el.plays).toBe(1);
    expect(el.paused).toBe(false);
    el.emit('loadedmetadata');
    el.readyState = 4;
    expect(el.currentTime).toBe(414.1);
    t.lines.length = 0;
    el.earlyEnd();
    expect(el.plays).toBe(1);
    vi.advanceTimersByTime(EARLY_RESTART_MS[0]);
    await flush();
    expect(el.plays).toBe(2);
    expect(el.currentTime).toBe(414.1);
    expect(el.paused).toBe(false);
    expect(t.lines).toContain('deck: early ended, restart 1 rs=4 t=414.1');
    expect(t.lines.some((l) => /giving up/.test(l))).toBe(false);
    expect((t.deck as unknown as { played: boolean }).played).toBe(true);
  });

  it('Neustart springt an clip.start zurück, auch wenn die Position verrutscht ist', async () => {
    const t = setup();
    const el = await boot(t);
    el.paused = true;
    el.currentTime = 0;
    el.earlyEnd();
    vi.advanceTimersByTime(EARLY_RESTART_MS[0]);
    await flush();
    expect(el.currentTime).toBe(414.1);
    expect(el.plays).toBe(2);
  });

  it('drei Fehlversuche: drei Neustarts mit den Zeilen 1 bis 3, dann einmal die Aufgabe-Zeile, keine weiteren play()', async () => {
    const t = setup();
    const el = await boot(t);
    el.stall = 99;
    t.lines.length = 0;
    const base = el.plays;
    for (let i = 0; i < 3; i++) {
      el.earlyEnd();
      vi.advanceTimersByTime(EARLY_RESTART_MS[i]);
      await flush();
    }
    expect(el.plays - base).toBe(3);
    expect(restartLines(t).map((l) => l.split(' ')[4])).toEqual(['1', '2', '3']);
    el.earlyEnd();
    el.earlyEnd();
    vi.advanceTimersByTime(5000);
    await flush();
    expect(el.plays - base).toBe(3);
    expect(t.lines.filter((l) => l === 'deck: early ended, giving up (tap starts)')).toHaveLength(1);
  });

  it('zweites ended vor Ablauf des Zeitgebers erzeugt keinen zweiten gleichzeitigen play()', async () => {
    const t = setup();
    const el = await boot(t);
    const base = el.plays;
    el.earlyEnd();
    el.earlyEnd();
    vi.advanceTimersByTime(EARLY_RESTART_MS[0]);
    await flush();
    expect(el.plays - base).toBe(1);
    expect(restartLines(t)).toHaveLength(1);
  });

  it('Tipp nach Aufgabe startet wie bisher (play), der Zähler beginnt bei einem neuen Ausschnitt neu', async () => {
    const t = setup();
    const el = await boot(t);
    el.stall = 99;
    for (let i = 0; i < 3; i++) {
      el.earlyEnd();
      vi.advanceTimersByTime(EARLY_RESTART_MS[i]);
      await flush();
    }
    el.earlyEnd();
    t.deck.load(clip('b', 30), t.sink, { play: true, muted: true });
    await flush();
    t.lines.length = 0;
    el.stall = 99;
    el.earlyEnd();
    vi.advanceTimersByTime(EARLY_RESTART_MS[0]);
    expect(restartLines(t)).toHaveLength(1);
  });
});

describe('B: Schutz bleibt', () => {
  it('echtes Ende (played=true) läuft wie bisher in clipEnd, kein Neustart', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: true });
    await flush();
    const el = t.els[0];
    el.emit('playing');
    expect((t.deck as unknown as { played: boolean }).played).toBe(true);
    t.lines.length = 0;
    el.currentTime = 474.1;
    el.ended = true;
    el.emit('ended');
    vi.advanceTimersByTime(5000);
    expect(t.lines.some((l) => /clip end via ended/.test(l))).toBe(true);
    expect(restartLines(t)).toHaveLength(0);
    expect(el.plays).toBe(1);
  });

  it('Position am Ende des Ausschnitts (played=false): kein Neustart', async () => {
    const t = setup();
    const el = await boot(t);
    el.currentTime = 474.1;
    el.earlyEnd();
    vi.advanceTimersByTime(5000);
    expect(restartLines(t)).toHaveLength(0);
  });

  it('Nutzerpause vor oder während des Wartens verhindert den Neustart', async () => {
    const t = setup();
    const el = await boot(t);
    el.earlyEnd();
    t.deck.pause(t.sink);
    vi.advanceTimersByTime(5000);
    await flush();
    expect(restartLines(t)).toHaveLength(0);
    expect(el.plays).toBe(1);
    // schon pausiert, dann ended
    el.earlyEnd();
    vi.advanceTimersByTime(5000);
    expect(restartLines(t)).toHaveLength(0);
  });

  it('anderer Ausschnitt geladen, solange der Zeitgeber läuft: kein Neustart für den alten', async () => {
    const t = setup();
    const el = await boot(t);
    el.earlyEnd();
    t.deck.load(clip('b', 30), t.sink, { play: true, muted: true });
    await flush();
    t.lines.length = 0;
    const base = el.plays;
    vi.advanceTimersByTime(5000);
    expect(restartLines(t)).toHaveLength(0);
    expect(el.plays).toBe(base);
  });

  it('Deck freigegeben: kein Neustart', async () => {
    const t = setup();
    const el = await boot(t);
    el.earlyEnd();
    t.deck.release();
    vi.advanceTimersByTime(5000);
    expect(el.plays).toBe(1);
  });

  it('Ausschnitt zu Ende (done) vor Ablauf: kein Neustart', async () => {
    const t = setup();
    const el = await boot(t);
    el.earlyEnd();
    (t.deck as unknown as { done: boolean }).done = true;
    vi.advanceTimersByTime(5000);
    expect(el.plays).toBe(1);
  });

  it('Neustart bleibt stumm und ändert muted nicht (Ton kommt erst beim Tipp)', async () => {
    const t = setup();
    const el = await boot(t);
    el.muted = true;
    el.earlyEnd();
    vi.advanceTimersByTime(EARLY_RESTART_MS[0]);
    expect(el.muted).toBe(true);
  });

  it('Datei kürzer als die Startstelle: kein Neustart, Zeile "clip start beyond duration", Fehlerbehandlung des Moments', async () => {
    const t = setup();
    const el = await boot(t);
    el.duration = 300;
    t.lines.length = 0;
    el.earlyEnd();
    vi.advanceTimersByTime(5000);
    expect(restartLines(t)).toHaveLength(0);
    expect(el.plays).toBe(1);
    expect(t.lines).toContain('deck: clip start beyond duration 300.0');
    expect(t.errs()).toBe(1);
  });

  it('Neustart abgelehnt (NotAllowedError): Tippfläche wie bisher, kein weiterer Versuch', async () => {
    const t = setup();
    const el = await boot(t);
    el.play = () => {
      el.plays++;
      const e = new Error('no');
      e.name = 'NotAllowedError';
      return Promise.reject(e);
    };
    el.earlyEnd();
    vi.advanceTimersByTime(EARLY_RESTART_MS[0]);
    await flush();
    const n = el.plays;
    el.earlyEnd();
    vi.advanceTimersByTime(5000);
    await flush();
    expect(el.plays).toBe(n);
  });
});

describe('D: übernommene Einträge des Vorrats', () => {
  it('Eintrag per swapNext übernommen: vorzeitiges ended führt zum Neustart an dessen Startstelle', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    const b = clip('b', 30);
    t.deck.fill([b]);
    const eb = t.els.find((x) => x.src.includes('/b.mp3'))!;
    eb.emit('loadedmetadata');
    eb.readyState = 4;
    eb.emit('canplaythrough');
    expect(t.deck.poolReady(b.key)).toBe(true);
    eb.stall = 1;
    t.deck.swapNext(t.sink);
    expect(t.deck.element).toBe(eb);
    t.lines.length = 0;
    eb.currentTime = 0;
    eb.earlyEnd();
    vi.advanceTimersByTime(EARLY_RESTART_MS[0]);
    await flush();
    expect(restartLines(t)).toHaveLength(1);
    expect(eb.currentTime).toBe(30);
    expect(eb.plays).toBe(2);
  });

  it('Eintrag, der im Vorrat schon "ended" war, wird beim Übernehmen an die Startstelle gesetzt', async () => {
    const t = setup();
    t.deck.load(clip('a', 10), t.sink, { play: true, muted: true });
    await flush();
    const b = clip('b', 30);
    t.deck.fill([b]);
    const eb = t.els.find((x) => x.src.includes('/b.mp3'))!;
    eb.emit('loadedmetadata');
    eb.readyState = 4;
    eb.emit('canplaythrough');
    eb.ended = true;
    eb.currentTime = 600;
    t.deck.swapNext(t.sink);
    expect(eb.currentTime).toBe(30);
  });
});

describe('C: Getter für die Zeile "ready but not playing"', () => {
  it('paused() und readyState() geben den Stand des aktiven Elements wieder (MomentFeed schreibt daraus die Zeile)', async () => {
    const t = setup();
    expect(t.deck.paused()).toBe(true);
    const el = await boot(t);
    expect(t.deck.holds(clip('a').key)).toBe(true);
    el.earlyEnd();
    expect(t.deck.readyState()).toBe(4);
    expect(t.deck.paused()).toBe(true);
  });
});
