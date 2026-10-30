// Issue 11: ein dauerhaftes Audio-Element, Quellwechsel und play() synchron im Ende-Handler.
// Der Nachbau des Elements verhält sich wie ein Browser: load() setzt die Position zurück, Ereignisse kommen nur durch emit.
import { describe, expect, it } from 'vitest';
import { AudioDeck, withStart, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

class FakeEl implements DeckEl {
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 600;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  /** Reihenfolge der Aufrufe: src:<url>, play */
  calls: string[] = [];
  playResult: () => Promise<void> = () => Promise.resolve();
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.calls.push('play');
    this.paused = false;
    this.emit('playing');
    return this.playResult();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit('pause');
  }
  load() {
    this.calls.push('load');
    this.currentTime = 0;
  }
  /** Wiedergabe bis t Sekunden Tonzeit */
  tick(t: number) {
    this.currentTime = t;
    this.emit('timeupdate');
  }
}

const clip = (id: string, start = 0, end: number | undefined = 60): DeckClip => ({ key: `${id}|${start}|${end ?? ''}`, id, url: `https://pod.test/${id}.mp3`, start, end });

function setup(opts: { hidden?: boolean; local?: Record<string, { url: string; offset: number }> } = {}) {
  const el = new FakeEl();
  let made = 0;
  let hidden = opts.hidden ?? true;
  const deck = new AudioDeck({
    local: (k) => opts.local?.[k],
    dropLocal: () => {},
    make: () => {
      made++;
      return el;
    },
    hidden: () => hidden,
  });
  // src protokollieren, damit die Reihenfolge von Quellwechsel und play() prüfbar ist
  let src = '';
  Object.defineProperty(el, 'src', {
    get: () => src,
    set: (v: string) => {
      src = v;
      el.calls.push(`src:${v}`);
    },
  });
  const states: number[] = [];
  const sink: DeckSink = { state: (st) => states.push(st), error: () => states.push(-1) };
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  return { deck, el, sink, states, lines, made: () => made, setHidden: (h: boolean) => (hidden = h) };
}

describe('withStart', () => {
  it('hängt den Start als Medienfragment an, nur bei Netzquellen ohne Fragment', () => {
    expect(withStart('https://a.test/x.mp3', 120)).toBe('https://a.test/x.mp3#t=120');
    expect(withStart('https://a.test/x.mp3', 0)).toBe('https://a.test/x.mp3');
    expect(withStart('https://a.test/x.mp3#t=5', 120)).toBe('https://a.test/x.mp3#t=5');
  });
});

describe('Ende im Hintergrund', () => {
  it('src und play kommen im Ende-Handler, vor der Buchführung, am selben Element', () => {
    const t = setup();
    const a = clip('a', 0, 4);
    const b = clip('b', 10, 20);
    const order: string[] = [];
    t.deck.load(a, t.sink, { play: true, muted: false });
    t.deck.arm(b);
    t.deck.onAdvance = (from, to) => {
      order.push(`advance ${from.id}>${to.id}`);
      // Zu diesem Zeitpunkt muss der Wechsel schon geschehen sein
      order.push(`calls ${t.el.calls.slice(-4).join(',')}`);
    };
    t.el.calls.length = 0;
    t.el.tick(4);
    expect(t.el.calls.filter((c) => c.startsWith('src:'))).toEqual(['src:https://pod.test/b.mp3#t=10']);
    expect(t.el.calls.indexOf('src:https://pod.test/b.mp3#t=10')).toBeLessThan(t.el.calls.lastIndexOf('play'));
    expect(order[0]).toBe('advance a>b');
    expect(order[1]).toContain('play');
    expect(t.made()).toBe(1);
    expect(t.deck.clip?.id).toBe('b');
    expect(t.el.muted).toBe(false);
    // Das Ende des Vorgängers wird nicht als ENDED an den alten Player gemeldet, der Wechsel läuft ohne Zwischenzustand
    expect(t.states).not.toContain(0);
  });

  it('zehn Momente in Folge am selben Element, ohne neues Element', () => {
    const t = setup();
    const clips = Array.from({ length: 10 }, (_, i) => clip(`m${i}`, 0, 4));
    let idx = 0;
    t.deck.load(clips[0], t.sink, { play: true, muted: false });
    t.deck.arm(clips[1]);
    t.deck.onAdvance = (_from, to) => {
      idx++;
      expect(to.id).toBe(clips[idx].id);
      t.deck.arm(clips[idx + 1] ?? null);
    };
    for (let i = 0; i < 9; i++) t.el.tick(4);
    expect(idx).toBe(9);
    expect(t.deck.history).toEqual(clips.map((c) => c.key));
    expect(t.made()).toBe(1);
  });

  it('ein Ende zählt nur einmal, auch wenn timeupdate und ended zusammenfallen', () => {
    const t = setup();
    t.deck.load(clip('a', 0, 4), t.sink, { play: true, muted: false });
    t.deck.arm(clip('b'));
    let n = 0;
    t.deck.onAdvance = () => n++;
    t.el.tick(4);
    t.el.emit('ended');
    t.el.tick(4);
    expect(n).toBe(1);
  });

  it('Ausschnitt aus dem Vorrat: Ende zählt ab der Tonzeit des ersten Bytes', () => {
    const t = setup({ local: { 'a|100|110': { url: 'blob:a', offset: 98 } } });
    const a = clip('a', 100, 110);
    t.deck.load(a, t.sink, { play: true, muted: false });
    expect(t.el.src).toBe('blob:a');
    expect(t.deck.time(t.sink)).toBe(100);
    t.deck.arm(clip('b'));
    let n = 0;
    t.deck.onAdvance = () => n++;
    t.el.tick(11);
    expect(n).toBe(0);
    t.el.tick(12);
    expect(n).toBe(1);
  });

  it('die Quelle des Nachfolgers wird erst beim Wechsel aufgelöst (Vorrat kann dazwischen fertig werden)', () => {
    const local: Record<string, { url: string; offset: number }> = {};
    const t = setup({ local });
    t.deck.load(clip('a', 0, 4), t.sink, { play: true, muted: false });
    t.deck.arm(clip('b', 0, 4));
    local['b|0|4'] = { url: 'blob:b', offset: 0 };
    t.deck.onAdvance = () => {};
    t.el.tick(4);
    expect(t.el.src).toBe('blob:b');
  });
});

describe('veraltetes ended', () => {
  it('ein ended vor dem ersten playing des Ausschnitts (Rest der Freischaltung) beendet ihn nicht', () => {
    const t = setup();
    t.deck.load(clip('a', 0, 4), t.sink, { play: false, muted: false });
    t.deck.arm(clip('b'));
    let n = 0;
    t.deck.onAdvance = () => n++;
    t.el.emit('ended');
    expect(n).toBe(0);
    expect(t.states).not.toContain(0);
    expect(t.deck.holds(clip('a', 0, 4).key)).toBe(true);
  });
});

describe('Ende im Vordergrund oder ohne Nachfolger', () => {
  it('Vordergrund: anhalten und ENDED melden, die App entscheidet', () => {
    const t = setup({ hidden: false });
    t.deck.load(clip('a', 0, 4), t.sink, { play: true, muted: false });
    t.deck.arm(clip('b'));
    let advanced = false;
    t.deck.onAdvance = () => (advanced = true);
    t.el.tick(4);
    expect(advanced).toBe(false);
    expect(t.el.paused).toBe(true);
    expect(t.states.at(-1)).toBe(0);
    expect(t.el.src).toBe('https://pod.test/a.mp3');
  });

  it('Hintergrund ohne Nachfolger: anhalten und ENDED melden', () => {
    const t = setup();
    t.deck.load(clip('a', 0, 4), t.sink, { play: true, muted: false });
    t.deck.onAdvance = () => {
      throw new Error('darf nicht passieren');
    };
    t.el.tick(4);
    expect(t.states.at(-1)).toBe(0);
  });

  it('Pause durch das Ende wird nicht zusätzlich als PAUSED gemeldet', () => {
    const t = setup({ hidden: false });
    t.deck.load(clip('a', 0, 4), t.sink, { play: true, muted: false });
    t.el.tick(4);
    expect(t.states.filter((x) => x === 2)).toEqual([]);
  });
});

describe('play wird verweigert', () => {
  it('Diagnose bg: play rejected <Name>, Zustand Pause, kein Zeitgeber, Rückkehr startet sofort', async () => {
    const t = setup();
    const a = clip('a', 0, 4);
    const b = clip('b', 0, 4);
    t.deck.load(a, t.sink, { play: true, muted: false });
    t.deck.arm(b);
    t.deck.onAdvance = () => {};
    t.el.playResult = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    t.el.tick(4);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.lines).toContain('bg: play rejected NotAllowedError');
    expect(t.lines.filter((l) => l.startsWith('bg: play rejected')).length).toBe(1);
    // Der neue Besitzer übernimmt, wie es goTo tut, und bekommt Pause gemeldet
    const sink2: DeckSink = { state: (st) => t.states.push(st), error: () => {} };
    t.deck.load(b, sink2, { play: true, muted: false });
    t.el.paused = true;
    // Rückkehr: sofort weiter, ohne neue Quelle
    t.el.playResult = () => Promise.resolve();
    t.el.calls.length = 0;
    t.deck.play(sink2);
    expect(t.el.calls).toEqual(['play']);
    expect(t.el.paused).toBe(false);
  });

  it('ein abgebrochenes play (neuer Quellwechsel) ist kein Fehler', async () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    t.el.playResult = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }));
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.lines.some((l) => l.includes('rejected'))).toBe(false);
  });
});

describe('Besitz des Elements', () => {
  it('nur der Besitzer pausiert, spielt und stellt Ton und Zeit ein', () => {
    const t = setup();
    const other: DeckSink = { state: () => {}, error: () => {} };
    t.deck.load(clip('a', 5, 60), t.sink, { play: true, muted: false });
    t.deck.pause(other);
    expect(t.el.paused).toBe(false);
    t.deck.setMuted(other, true);
    expect(t.el.muted).toBe(false);
    expect(t.deck.time(other)).toBeNull();
    t.deck.pause(t.sink);
    expect(t.el.paused).toBe(true);
  });

  it('läuft der Ausschnitt schon im Element (nach dem Wechsel im Hintergrund), übernimmt der neue Player ohne neue Quelle', () => {
    const t = setup();
    const a = clip('a', 0, 4);
    const b = clip('b', 0, 4);
    t.deck.load(a, t.sink, { play: true, muted: false });
    t.deck.arm(b);
    t.deck.onAdvance = () => {};
    t.el.tick(4);
    const srcCalls = () => t.el.calls.filter((c) => c.startsWith('src:')).length;
    const before = srcCalls();
    const sink2: DeckSink = { state: (st) => t.states.push(st), error: () => {} };
    t.states.length = 0;
    t.deck.load(b, sink2, { play: true, muted: false });
    expect(srcCalls()).toBe(before);
    // playing kam schon, der neue Besitzer bekommt den Zustand sofort
    expect(t.states).toContain(1);
  });

  it('release hält an und löscht Nachfolger und Rückrufe, das Element bleibt', () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    t.deck.arm(clip('b'));
    t.deck.onAdvance = () => {};
    t.deck.release();
    expect(t.el.paused).toBe(true);
    expect(t.deck.armedKey).toBeNull();
    expect(t.deck.onAdvance).toBeNull();
    t.deck.load(clip('c'), t.sink, { play: true, muted: false });
    expect(t.made()).toBe(1);
  });

  it('Tempo gilt für das Element und bleibt nach dem Quellwechsel', () => {
    const t = setup();
    t.deck.setRate(1.5);
    t.deck.load(clip('a', 0, 4), t.sink, { play: true, muted: false });
    expect(t.el.playbackRate).toBe(1.5);
    expect(t.el.defaultPlaybackRate).toBe(1.5);
    t.deck.arm(clip('b'));
    t.deck.onAdvance = () => {};
    t.el.tick(4);
    expect(t.el.playbackRate).toBe(1.5);
  });
});

describe('Freischalten durch eine Geste', () => {
  it('spielt einmal Stille auf dem Element, bevor ein Moment da ist, danach nie wieder', async () => {
    const t = setup();
    t.deck.unlock();
    expect(t.el.src.startsWith('data:audio/wav')).toBe(true);
    expect(t.el.calls).toContain('play');
    await Promise.resolve();
    t.el.calls.length = 0;
    t.deck.unlock();
    expect(t.el.calls).toEqual([]);
  });

  it('ein vom Menschen angehaltener Ausschnitt wird dabei nicht gestartet', () => {
    const t = setup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    t.deck.pause(t.sink);
    t.el.calls.length = 0;
    t.deck.unlock();
    expect(t.el.calls).toEqual([]);
    expect(t.el.paused).toBe(true);
  });
});

// Lautheit (Entscheidung 16): zwei feste Elemente, eines je Spur
function setupLanes(opts: { noChain?: boolean } = {}) {
  const plain = new FakeEl();
  const level = new FakeEl();
  const hosts: string[] = [];
  const chained: number[] = [];
  const made: boolean[] = [];
  const deck = new AudioDeck({
    local: () => undefined,
    dropLocal: () => {},
    make: (lv) => {
      made.push(lv);
      return lv ? level : plain;
    },
    hidden: () => true,
    lane: (c, _local, force) => (force || !c.gain ? { lane: 'plain', why: force ? 'fallback' : 'no value' } : { lane: 'level', why: 'cors trial' }),
    chain: (_el, db) => {
      if (opts.noChain) return null;
      chained.push(db);
      return { linear: () => 10 ** (db / 20) };
    },
    host: (u, s) => hosts.push(`${s} ${u}`),
  });
  const states: number[] = [];
  const sink: DeckSink = { state: (st) => states.push(st), error: () => states.push(-1) };
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  return { deck, plain, level, hosts, chained, made, states, sink, lines };
}
const loud = (id: string, gain: number, end: number | undefined = 4): DeckClip => ({ ...clip(id, 0, end), gain });

describe('Lautheit: zwei feste Elemente', () => {
  it('Ausschnitt mit Anpassung läuft im Element der geregelten Spur, ohne Anpassung im anderen, beide werden nie ersetzt', () => {
    const t = setupLanes();
    t.deck.load(loud('a', 6), t.sink, { play: true, muted: false });
    expect(t.level.calls).toContain('play');
    expect(t.chained).toEqual([6]);
    expect(t.deck.loud(t.sink)).toEqual({ db: 6, how: 'web audio', linear: 10 ** (6 / 20) });
    t.deck.load(loud('b', 0), t.sink, { play: true, muted: false });
    expect(t.plain.calls).toContain('play');
    expect(t.level.paused).toBe(true);
    t.deck.load(loud('c', -3), t.sink, { play: true, muted: false });
    expect(t.made.slice().sort()).toEqual([false, true]);
  });

  it('Wechsel im Hintergrund von einer Spur zur anderen: src und play am neuen Element im selben Handler', () => {
    const t = setupLanes();
    const a = loud('a', 0);
    const b = loud('b', 6);
    t.deck.load(a, t.sink, { play: true, muted: false });
    t.deck.arm(b);
    let advanced = 0;
    t.deck.onAdvance = () => {
      // Bei der Buchführung läuft der Nachfolger schon
      expect(t.level.paused).toBe(false);
      advanced++;
    };
    t.plain.tick(4);
    expect(advanced).toBe(1);
    expect(t.level.src).toContain('b.mp3');
    expect(t.plain.paused).toBe(true);
    // Ereignisse des alten Elements zählen nicht mehr
    t.plain.emit('ended');
    t.plain.tick(4);
    expect(advanced).toBe(1);
  });

  it('die geregelte Spur darf nicht spielen (nie entsperrt): sofort unverändert weiter, kein bg: play rejected', async () => {
    const t = setupLanes();
    t.level.playResult = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    t.deck.load(loud('a', 6), t.sink, { play: true, muted: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.plain.calls).toContain('play');
    expect(t.plain.src).toContain('a.mp3');
    expect(t.lines.some((l) => l.startsWith('bg: play rejected'))).toBe(false);
    expect(t.deck.loud(t.sink)?.how).toBe('unchanged: fallback');
  });

  it('Netzquelle lädt in der geregelten Spur nicht (kein CORS): unverändert, Host wird erst nach dem Laden als bad gemerkt', () => {
    const t = setupLanes();
    t.deck.load(loud('a', 6), t.sink, { play: true, muted: false });
    t.level.emit('error');
    expect(t.plain.src).toContain('a.mp3');
    expect(t.plain.calls).toContain('play');
    expect(t.hosts).toEqual([]);
    t.plain.emit('loadedmetadata');
    expect(t.hosts).toEqual(['bad https://pod.test/a.mp3']);
  });

  it('lädt die Quelle in der geregelten Spur, gilt der Host als ok', () => {
    const t = setupLanes();
    t.deck.load(loud('a', 6), t.sink, { play: true, muted: false });
    t.level.emit('loadedmetadata');
    expect(t.hosts).toEqual(['ok https://pod.test/a.mp3']);
  });

  it('ohne Kette (Web Audio nicht verfügbar) läuft der Ausschnitt unverändert', () => {
    const t = setupLanes({ noChain: true });
    t.deck.load(loud('a', 6), t.sink, { play: true, muted: false });
    expect(t.plain.calls).toContain('play');
    expect(t.deck.loud(t.sink)).toEqual({ db: 0, how: 'unchanged: no audio graph' });
  });

  it('prime schaltet das Element der geregelten Spur frei, ohne den laufenden Ausschnitt zu stören', () => {
    const t = setupLanes();
    t.deck.load(loud('a', 0), t.sink, { play: true, muted: false });
    t.deck.prime();
    expect(t.level.src.startsWith('data:audio/wav')).toBe(true);
    expect(t.level.calls).toContain('play');
    expect(t.plain.paused).toBe(false);
  });
});
