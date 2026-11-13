// Runde 7 (Issue 60): Max' Diag 12.11. zeigte, dass jeder Tausch auf ein Vorrats-Element nach einem Wisch mit NotAllowedError abgelehnt wurde.
// Der Nachbau des Elements folgt der iOS-Regel: play() wird nur angenommen, wenn es in einem erlaubten Ereignis läuft (pointerup, touchend, click, keydown)
// ODER das Element früher ein angenommenes play() hatte. Bei pointerdown und ohne Ereignis lehnt es mit NotAllowedError ab. Ein play(), das vor seiner
// Erfüllung durch pause() abgebrochen wird (AbortError), zählt nicht als angenommen (so verhält sich iOS vermutlich bei Stille mit sofortigem Anhalten).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, POOL, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

const ALLOWED = new Set(['pointerup', 'touchend', 'click', 'keydown']);
/** Das Ereignis, das der Test gerade zustellt ('none': ein Zeitgeber oder Promise, keine Geste) */
let ev = 'none';

class IosEl implements DeckEl {
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 600;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  /** Ein play() wurde angenommen und erfüllt: ab jetzt darf dieses Element auch ohne Geste starten */
  played = false;
  playCalls = 0;
  private tok = 0;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.playCalls++;
    if (!this.played && !ALLOWED.has(ev)) {
      const e = new Error('not allowed');
      e.name = 'NotAllowedError';
      return Promise.reject(e);
    }
    this.paused = false;
    const tok = ++this.tok;
    return Promise.resolve().then(() => {
      if (this.paused || tok !== this.tok) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      this.played = true;
      this.emit('playing');
    });
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
}

const clip = (id: string): DeckClip => ({ key: `${id}|0|60`, id, url: `https://pod.test/${id}.mp3`, start: 0, end: 60 });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

let hiddenNow = false;
function setup() {
  hiddenNow = false;
  const els: IosEl[] = [];
  const deck = new AudioDeck({
    standby: true,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new IosEl();
      els.push(e);
      return e;
    },
    hidden: () => hiddenNow,
    lane: (c) => (c.id === 'lv' ? { lane: 'level', why: 'test' } : { lane: 'plain', why: 'no value' }),
    chain: () => ({ linear: () => 1 }),
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const refused: string[] = [];
  deck.onRefused = (id, why) => refused.push(`${id}:${why}`);
  const states: number[] = [];
  const sink: DeckSink = { state: (s) => states.push(s), error: () => {} };
  return { deck, els, lines, refused, states, sink };
}
type T = ReturnType<typeof setup>;

/** Ein Ereignis zustellen: der Deck sieht es (wie deckGesture), danach laufen die Promises ab */
async function fire(t: T, type: string) {
  ev = type;
  t.deck.unlock(type);
  ev = 'none';
  await flush();
}
/** Ein Tipp ohne Bewegung: alle vier Ereignisse in der Reihenfolge von iOS */
async function tap(t: T) {
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click']) await fire(t, type);
}
/** Vorrat mit Daten füllen: Metadaten und genug Daten, damit die Einträge bereit sind */
function fillPool(t: T, ids: string[]) {
  t.deck.fill(ids.map(clip));
  for (const id of ids) {
    const e = t.els.find((x) => x.src.includes(`/${id}.mp3`))!;
    e.emit('loadedmetadata');
    e.readyState = 4;
    e.emit('canplaythrough');
  }
}
const poolEls = (t: T, ids: string[]) => ids.map((id) => t.els.find((x) => x.src.includes(`/${id}.mp3`))!);
const IDS = ['b', 'c', 'd', 'e', 'f'];

beforeEach(() => {
  vi.useFakeTimers();
  ev = 'none';
});
afterEach(() => {
  vi.useRealTimers();
});

/** App-Start im Audio-Reiter: der erste Ausschnitt wird ohne Geste gestartet und abgelehnt, der Vorrat füllt sich schon */
async function coldStart(t: T) {
  t.deck.load(clip('a'), t.sink, { play: true, muted: false });
  await flush();
  // Runde 12: der aktive Ausschnitt hat Daten (readyState 3), sonst stellt der Vorrat alle Netz-Abrufe bis auf einen zurück. Dieser Test prüft die Freischaltung, nicht die Zurückstellung.
  (t.deck.element as IosEl).readyState = 3;
  fillPool(t, IDS);
}

describe('Freischalten des Vorrats (Ziel A)', () => {
  it('(a) ein Tipp schaltet aktives Element und alle Vorrats-Elemente frei, danach gelingt ein Tausch ohne Geste', async () => {
    const t = setup();
    await coldStart(t);
    await tap(t);
    const act = t.deck.element as IosEl;
    expect(act.played).toBe(true);
    for (const e of poolEls(t, IDS)) expect(e.played).toBe(true);
    expect(t.els.length).toBe(POOL + 1);
    t.lines.length = 0;
    // Wisch: kein Ereignis, das Medien erlaubt
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.lines.filter((l) => /refused|needs tap/.test(l))).toEqual([]);
    const now = t.deck.element as IosEl;
    expect(now.src).toContain('/b.mp3');
    expect(now.paused).toBe(false);
    expect(now.played).toBe(true);
  });

  it('(b) pointerdown allein schaltet nichts frei und sperrt spätere Versuche nicht', async () => {
    const t = setup();
    await coldStart(t);
    await fire(t, 'pointerdown');
    for (const e of poolEls(t, IDS)) expect(e.played).toBe(false);
    expect(t.lines.some((l) => /gesture pointerdown unlocked/.test(l))).toBe(false);
    await fire(t, 'pointerup');
    for (const e of poolEls(t, IDS)) expect(e.played).toBe(true);
  });

  it('das Freischalten hält die Position und gibt keinen Ton aus (stumm, Stummschaltung danach wie vorher)', async () => {
    const t = setup();
    await coldStart(t);
    const els = poolEls(t, IDS);
    els.forEach((e) => (e.muted = false));
    await tap(t);
    for (const e of els) {
      expect(e.paused).toBe(true);
      expect(e.muted).toBe(false);
      expect(e.currentTime).toBe(0);
    }
    // Die Einträge bleiben bereit (kein Eintrag im Vorrat fiel heraus)
    expect(t.deck.readyCount()).toBe(IDS.length);
  });

  it('(c) ein nach dem Tausch neu geladenes Vorrats-Element wird beim nächsten Tipp freigeschaltet', async () => {
    const t = setup();
    await coldStart(t);
    await tap(t);
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    // Neuer Moment mit geregelter Spur: dafür entsteht ein neues Element, das keine Geste gesehen hat
    t.deck.fill([clip('c'), clip('d'), clip('e'), clip('f'), clip('lv')]);
    const lv = t.els.find((x) => x.src.includes('/lv.mp3'))!;
    expect(lv.played).toBe(false);
    t.lines.length = 0;
    await tap(t);
    expect(lv.played).toBe(true);
    expect(lv.paused).toBe(true);
  });

  it('ein Element, dessen play() mit NotAllowedError abgelehnt wurde, fällt aus der Freischaltung heraus und wird beim nächsten Tipp wieder versucht', async () => {
    const t = setup();
    await coldStart(t);
    await tap(t);
    const e = poolEls(t, IDS)[0];
    // iOS hat dem Element die Freigabe wieder genommen (Nachbau: Flag zurück)
    e.played = false;
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.lines.some((l) => /deck play refused NotAllowedError \(swap\)/.test(l))).toBe(true);
    // Wisch auf den nächsten Moment: b geht frei zurück in den Vorrat, ohne dass ein play() es wieder freigab
    t.deck.load(clip('c'), t.sink, { play: true, muted: false });
    await flush();
    expect(e.played).toBe(false);
    await tap(t);
    expect(e.played).toBe(true);
  });
});

describe('Abgelehnter Start oder Tausch (Ziel B)', () => {
  it('(e) abgelehnter Start beim App-Start meldet needs tap sofort, ohne Zeitgeber', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.refused).toEqual(['a:start']);
    expect(t.lines).toContain('audio: needs tap a (start)');
  });

  it('verdeckt abgelehnter Start verlangt keinen Tipp, die Rückkehr darf von selbst starten (CI rot 1937fa7: bgRejectResumesOnReturn)', async () => {
    const t = setup();
    hiddenNow = true;
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.refused).toEqual([]);
    expect(t.lines.some((l) => l.startsWith('audio: needs tap'))).toBe(false);
    expect(t.lines).toContain('bg: play rejected NotAllowedError');
  });

  it('(d) abgelehnter Tausch meldet needs tap, weitere Anstöße ohne Geste rufen kein play(), der Tipp startet den Moment', async () => {
    const t = setup();
    await coldStart(t);
    // Aktives Element ist durch einen Tipp freigeschaltet, der Vorrat nicht (z. B. Eintrag kam erst danach)
    await tap(t);
    for (const e of poolEls(t, IDS)) e.played = false;
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.refused).toEqual(['a:start', 'b:swap']);
    expect(t.lines).toContain('audio: needs tap b (swap)');
    const el = t.deck.element as IosEl;
    const calls = el.playCalls;
    // Der Tausch liegt vor dem Wisch-Ende mehr als 120 ms zurück
    vi.advanceTimersByTime(500);
    // soundGuard und Feed: play ohne Geste, mehrfach, auch nach 2,5 s
    for (let i = 0; i < 4; i++) {
      t.deck.play(t.sink);
      vi.advanceTimersByTime(2500);
      await flush();
    }
    expect(el.playCalls).toBe(calls);
    // Der Tipp: Ereignis pointerup, der Feed startet synchron im Handler
    ev = 'pointerup';
    t.deck.unlock('pointerup');
    t.deck.play(t.sink);
    ev = 'none';
    await flush();
    expect(el.paused).toBe(false);
    expect(el.played).toBe(true);
    expect(t.lines.filter((l) => /^audio: needs tap/.test(l))).toHaveLength(2);
  });

  it('ein Tausch, der dann gelingt, löst keine Tippfläche aus', async () => {
    const t = setup();
    await coldStart(t);
    await tap(t);
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.refused).toEqual(['a:start']);
  });
});

describe('Diag je Geste (Ziel C)', () => {
  it('eine knappe Zeile je Geste, nur wenn sich die Zahl ändert', async () => {
    const t = setup();
    await coldStart(t);
    await fire(t, 'pointerdown');
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.lines.filter((l) => /^deck: gesture/.test(l))).toEqual([]);
    await fire(t, 'pointerup');
    await vi.advanceTimersByTimeAsync(1000);
    await fire(t, 'touchend');
    await vi.advanceTimersByTimeAsync(1000);
    await fire(t, 'click');
    await vi.advanceTimersByTimeAsync(1000);
    const g = t.lines.filter((l) => /^deck: gesture/.test(l));
    expect(g).toEqual([`deck: gesture pointerup unlocked ${POOL + 1}/${POOL + 1}`]);
  });
});
