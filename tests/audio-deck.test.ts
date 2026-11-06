// Issue 11: ein dauerhaftes Audio-Element, Quellwechsel und play() synchron im Ende-Handler.
// Der Nachbau des Elements verhält sich wie ein Browser: load() setzt die Position zurück, Ereignisse kommen nur durch emit.
import { describe, expect, it, vi } from 'vitest';
import { AudioDeck, POOL, withStart, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

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


// Brief 14, Entscheidung 52: ein Vorrat aus fünf Elementen hält die nächsten fünf Ausschnitte fertig, Weiter tauscht nur die Rollen.
// Jedes Element ist ein eigener Nachbau, die Ereignisse des Browsers kommen nur durch emit.
type PEl = FakeEl & { level: boolean };
type PoolOpts = { hidden?: boolean; local?: Record<string, { url: string; offset: number }>; running?: boolean; level?: boolean; standby?: boolean };
function setupPool(opts: PoolOpts = {}) {
  const els: PEl[] = [];
  const local = { ...(opts.local ?? {}) };
  let hidden = opts.hidden ?? false;
  let running = opts.running ?? true;
  const dropped: string[] = [];
  const hosts: string[] = [];
  const media: string[] = [];
  const chained: number[] = [];
  const deck = new AudioDeck({
    standby: opts.standby ?? true,
    local: (k) => local[k],
    dropLocal: (k) => {
      dropped.push(k);
      delete local[k];
    },
    make: (lv) => {
      const e = Object.assign(new FakeEl(), { level: lv });
      // src protokollieren: die Reihenfolge von Quelle und play() ist prüfbar
      let src = '';
      Object.defineProperty(e, 'src', {
        get: () => src,
        set: (v: string) => {
          src = v;
          e.calls.push(`src:${v}`);
        },
      });
      Object.assign(e, {
        removeAttribute: (n: string) => {
          if (n === 'src') src = '';
          e.calls.push(`remove:${n}`);
        },
      });
      els.push(e);
      return e;
    },
    hidden: () => hidden,
    running: () => running,
    lane: (c, _l, force) => (opts.level && c.gain && !force ? { lane: 'level', why: 'cors trial' } : { lane: 'plain', why: force ? 'fallback' : 'no value' }),
    chain: (_el, db) => {
      chained.push(db);
      return { linear: () => 10 ** (db / 20) };
    },
    host: (u, s) => hosts.push(`${s} ${u}`),
    playbackState: (s, why) => media.push(`${s} ${why}`),
  });
  const states: number[] = [];
  const sink: DeckSink = { state: (st) => states.push(st), error: () => states.push(-1) };
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  return { deck, els, sink, states, lines, dropped, hosts, media, chained, setHidden: (h: boolean) => (hidden = h), setRunning: (r: boolean) => (running = r), local };
}
type PT = ReturnType<typeof setupPool>;
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
/** Der erste Ausschnitt spielt (sichtbar), das Element ist durch ihn freigeschaltet: erst danach füllt der Vorrat */
async function boot(t: PT, c: DeckClip, play = true) {
  t.deck.load(c, t.sink, { play, muted: false });
  await settle();
}
/** Das Element, in das der Vorrat diesen Ausschnitt geladen hat */
const elOf = (t: PT, c: DeckClip): PEl => {
  const loc = t.local[c.key];
  // Bei mehrfach geladenem Ausschnitt gilt das zuletzt angelegte Element
  const e = [...t.els].reverse().find((x) => (loc ? x.src === loc.url : x.src.startsWith(c.url)));
  if (!e) throw new Error(`kein Element für ${c.key}`);
  return e;
};
/** Das Element bekommt Metadaten und genug Daten */
const fill = (el: FakeEl, rs = 4) => {
  el.emit('loadedmetadata');
  el.readyState = rs;
  el.emit('canplaythrough');
};
const fillAll = (t: PT, cs: DeckClip[]) => cs.forEach((c) => fill(elOf(t, c)));
/** Aktives Element plus fertiger Vorrat, danach verdeckt */
async function ready(t: PT, first: DeckClip, next: DeckClip[], hide = true) {
  await boot(t, first);
  t.deck.fill(next);
  fillAll(t, next);
  if (hide) t.setHidden(true);
}
const active = (t: PT) => t.deck.element as PEl;
const mk = (id: string) => clip(id, 0, 10);
const sbA = clip('a', 0, 60);
const sbB = clip('b', 10, 20);

describe('Ende im Hintergrund (Brief 14, Schritt 4: Tausch statt Quellwechsel)', () => {
  it('Tausch und play kommen im Ende-Handler, vor der Buchführung, ohne Quellwechsel und ohne load()', async () => {
    const t = setupPool();
    const a = clip('a', 0, 4);
    const b = clip('b', 10, 20);
    const order: string[] = [];
    await ready(t, a, [b]);
    const [first] = t.els;
    const bEl = elOf(t, b);
    t.deck.onAdvance = (from, to) => {
      order.push(`advance ${from.id}>${to.id}`);
      // Zu diesem Zeitpunkt muss der Wechsel schon geschehen sein
      order.push(`playing ${!bEl.paused}`);
    };
    first.calls.length = 0;
    bEl.calls.length = 0;
    first.tick(4);
    expect(order).toEqual(['advance a>b', 'playing true']);
    expect(bEl.calls).toEqual(['play']);
    expect(first.calls.filter((c) => c === 'load' || c.startsWith('src:'))).toEqual([]);
    expect(t.deck.clip?.id).toBe('b');
    expect(bEl.muted).toBe(false);
    expect(first.paused).toBe(true);
    // Das Ende des Vorgängers wird nicht als ENDED an den alten Player gemeldet, der Wechsel läuft ohne Zwischenzustand
    expect(t.states).not.toContain(0);
  });

  it('fünf Momente in Folge aus dem Vorrat, der sechste hält an und meldet das Ende', async () => {
    const t = setupPool();
    const clips = Array.from({ length: 6 }, (_, i) => clip(`m${i}`, 0, 4));
    await ready(t, clips[0], clips.slice(1));
    let idx = 0;
    t.deck.onAdvance = (_from, to) => {
      idx++;
      expect(to.id).toBe(clips[idx].id);
    };
    for (let i = 0; i < 5; i++) active(t).tick(4);
    expect(idx).toBe(5);
    expect(t.deck.history).toEqual(clips.map((c) => c.key));
    // Aktives Element plus fünf: nie ein sechstes angelegt
    expect(t.els).toHaveLength(6);
    const last = active(t);
    last.tick(4);
    expect(idx).toBe(5);
    expect(last.paused).toBe(true);
    expect(t.lines.some((l) => l.startsWith('bg: end without switch m5'))).toBe(true);
  });

  it('ein Ende zählt nur einmal, auch wenn timeupdate und ended zusammenfallen', async () => {
    const t = setupPool();
    const a = clip('a', 0, 4);
    await ready(t, a, [mk('b'), mk('c')]);
    let n = 0;
    t.deck.onAdvance = () => n++;
    const first = t.els[0];
    first.tick(4);
    first.emit('ended');
    first.tick(4);
    expect(n).toBe(1);
    expect(t.deck.clip?.id).toBe('b');
  });

  it('Ausschnitt aus dem Vorrat: Ende zählt ab der Tonzeit des ersten Bytes', async () => {
    const t = setupPool({ local: { 'a|100|110': { url: 'blob:a', offset: 98 } } });
    const a = clip('a', 100, 110);
    await boot(t, a);
    expect(t.els[0].src).toBe('blob:a');
    expect(t.deck.time(t.sink)).toBe(100);
    t.deck.fill([mk('b')]);
    fill(elOf(t, mk('b')));
    t.setHidden(true);
    let n = 0;
    t.deck.onAdvance = () => n++;
    t.els[0].tick(11);
    expect(n).toBe(0);
    t.els[0].tick(12);
    expect(n).toBe(1);
  });

  it('der Eintrag behält seine Quelle bis zum Tausch: lokal bleibt lokal, Netz bleibt Netz, beim Ende wird nichts aufgelöst', async () => {
    const t = setupPool({ local: { 'b|0|10': { url: 'blob:b', offset: 0 } } });
    await ready(t, clip('a', 0, 4), [mk('b'), mk('c')]);
    const b = elOf(t, mk('b'));
    const c = elOf(t, mk('c'));
    // Der Vorrat kann dazwischen lokal werden: ein bereiter Eintrag wird deshalb nicht neu geladen
    t.local['c|0|10'] = { url: 'blob:c', offset: 0 };
    t.deck.onAdvance = () => {};
    t.els[0].tick(4);
    expect(b.src).toBe('blob:b');
    expect(b.calls.filter((x) => x.startsWith('src:'))).toEqual(['src:blob:b']);
    expect(c.src).toBe('https://pod.test/c.mp3');
    expect(c.calls.filter((x) => x === 'load' || x.startsWith('src:'))).toEqual(['src:https://pod.test/c.mp3', 'load']);
  });
});

describe('veraltetes ended', () => {
  it('ein ended vor dem ersten playing des Ausschnitts (Rest der Freischaltung) beendet ihn nicht', async () => {
    const t = setupPool();
    t.deck.unlock();
    await settle();
    t.deck.load(clip('a', 0, 4), t.sink, { play: false, muted: false });
    t.deck.fill([mk('b')]);
    fill(elOf(t, mk('b')));
    t.setHidden(true);
    let n = 0;
    t.deck.onAdvance = () => n++;
    active(t).emit('ended');
    expect(n).toBe(0);
    expect(t.states).not.toContain(0);
    expect(t.deck.holds(clip('a', 0, 4).key)).toBe(true);
  });
});

describe('Ende im Vordergrund oder ohne Nachfolger', () => {
  it('Vordergrund: anhalten und ENDED melden, die App entscheidet, der Vorrat bleibt', async () => {
    const t = setupPool();
    await ready(t, clip('a', 0, 4), [mk('b')], false);
    let advanced = false;
    t.deck.onAdvance = () => (advanced = true);
    const first = t.els[0];
    first.tick(4);
    expect(advanced).toBe(false);
    expect(first.paused).toBe(true);
    expect(t.states.at(-1)).toBe(0);
    expect(first.src).toBe('https://pod.test/a.mp3');
    expect(t.deck.poolReady(mk('b').key)).toBe(true);
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

  it('Hintergrund, Vorrat leer: kein Quellwechsel, kein load(), das Element hält an', async () => {
    const t = setupPool();
    await ready(t, clip('a', 0, 4), []);
    t.deck.onAdvance = () => {
      throw new Error('darf nicht passieren');
    };
    const first = t.els[0];
    first.calls.length = 0;
    first.tick(4);
    expect(first.calls.filter((c) => c === 'load' || c.startsWith('src:'))).toEqual([]);
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
    const t = setupPool();
    const a = clip('a', 0, 4);
    const b = clip('b', 0, 4);
    await ready(t, a, [b]);
    t.deck.onAdvance = () => {};
    const bEl = elOf(t, b);
    bEl.playResult = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    t.els[0].tick(4);
    await settle();
    expect(t.lines).toContain('bg: play rejected NotAllowedError');
    expect(t.lines.filter((l) => l.startsWith('bg: play rejected')).length).toBe(1);
    // Der neue Besitzer übernimmt, wie es goTo tut, und bekommt Pause gemeldet
    const sink2: DeckSink = { state: (st) => t.states.push(st), error: () => {} };
    t.deck.load(b, sink2, { play: true, muted: false });
    bEl.paused = true;
    // Rückkehr: sofort weiter, ohne neue Quelle
    bEl.playResult = () => Promise.resolve();
    bEl.calls.length = 0;
    t.deck.play(sink2);
    expect(bEl.calls).toEqual(['play']);
    expect(bEl.paused).toBe(false);
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

  it('läuft der Ausschnitt schon im Element (nach dem Wechsel im Hintergrund), übernimmt der neue Player ohne neue Quelle', async () => {
    const t = setupPool();
    const b = clip('b', 0, 4);
    await ready(t, clip('a', 0, 4), [b]);
    t.deck.onAdvance = () => {};
    t.els[0].tick(4);
    const bEl = elOf(t, b);
    const srcCalls = () => bEl.calls.filter((c) => c.startsWith('src:')).length;
    const before = srcCalls();
    const sink2: DeckSink = { state: (st) => t.states.push(st), error: () => {} };
    t.states.length = 0;
    t.deck.load(b, sink2, { play: true, muted: false });
    expect(srcCalls()).toBe(before);
    // playing kam schon, der neue Besitzer bekommt den Zustand sofort
    expect(t.states).toContain(1);
  });

  it('release hält an und löscht Vorrat und Rückrufe, die Elemente bleiben', async () => {
    const t = setupPool();
    await ready(t, clip('a'), [mk('b')], false);
    t.deck.onAdvance = () => {};
    t.deck.release();
    expect(t.els.every((e) => e.paused)).toBe(true);
    expect(t.deck.poolInfo()).toEqual([]);
    expect(t.deck.readyCount()).toBe(0);
    expect(t.deck.onAdvance).toBeNull();
    const made = t.els.length;
    t.deck.load(clip('c'), t.sink, { play: true, muted: false });
    expect(t.els).toHaveLength(made);
  });

  it('Tempo gilt für das Element und bleibt nach dem Tausch', async () => {
    const t = setupPool();
    t.deck.setRate(1.5);
    await ready(t, clip('a', 0, 4), [mk('b')]);
    expect(t.els[0].playbackRate).toBe(1.5);
    t.deck.onAdvance = () => {};
    t.els[0].tick(4);
    expect(elOf(t, mk('b')).playbackRate).toBe(1.5);
    expect(elOf(t, mk('b')).defaultPlaybackRate).toBe(1.5);
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
function setupLanes(opts: { noChain?: boolean; pool?: boolean } = {}) {
  let hidden = true;
  const plain = new FakeEl();
  const level = new FakeEl();
  const hosts: string[] = [];
  const chained: number[] = [];
  const made: boolean[] = [];
  const deck = new AudioDeck({
    standby: opts.pool,
    local: () => undefined,
    dropLocal: () => {},
    make: (lv) => {
      made.push(lv);
      return lv ? level : plain;
    },
    hidden: () => hidden,
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
  return { deck, plain, level, hosts, chained, made, states, sink, lines, setHidden: (h: boolean) => (hidden = h) };
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

  it('Wechsel im Hintergrund von einer Spur zur anderen: Tausch auf das Element der anderen Spur, play im selben Handler', async () => {
    const t = setupLanes({ pool: true });
    const a = loud('a', 0);
    const b = loud('b', 6);
    t.setHidden(false);
    t.deck.load(a, t.sink, { play: true, muted: false });
    await Promise.resolve();
    await Promise.resolve();
    t.deck.fill([b]);
    t.level.emit('loadedmetadata');
    t.level.readyState = 4;
    t.level.emit('canplaythrough');
    t.setHidden(true);
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
    expect(t.deck.loud(t.sink)?.how).toBe('unchanged: play refused');
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

describe('Vorrat: fünf Elemente (Brief 14, Entscheidung 52)', () => {
  it('fill tut nichts, solange der Vorrat nicht eingeschaltet ist', () => {
    const t = setupPool({ standby: false });
    expect(t.deck.fill([sbB])).toBe(0);
    expect(t.els).toHaveLength(0);
    expect(t.deck.readyCount()).toBe(0);
  });

  it('fill lädt schon vor dem ersten play() und vor der ersten Geste (Brief 22, Entscheidung 57: der Pool ist der Vorrat)', () => {
    const t = setupPool();
    const cs = ['b', 'c', 'd', 'e', 'f'].map(mk);
    expect(t.deck.fill(cs)).toBe(5);
    expect(t.els).toHaveLength(5);
    expect(t.lines).toContain('deck: pool fill 5/5 (local 0, net 5)');
    fillAll(t, cs);
    expect(t.deck.readyCount()).toBe(5);
    // Kein play() auf den Elementen des Vorrats: sie laden nur
    expect(t.els.every((e) => !e.calls.includes('play'))).toBe(true);
  });

  it('die erste Geste spielt jedes vorher gefüllte Element stumm an und hält es gleich wieder an: Quelle und Stummschaltung bleiben, einmal je Element', async () => {
    const t = setupPool();
    const cs = ['b', 'c', 'd', 'e', 'f'].map(mk);
    t.deck.fill(cs);
    fillAll(t, cs);
    for (const e of t.els) e.muted = false;
    const n = t.lines.length;
    t.deck.unlock();
    await settle();
    const pooled = cs.map((c) => elOf(t, c));
    for (const e of pooled) {
      expect(e.calls.filter((c) => c === 'play')).toHaveLength(1);
      expect(e.paused).toBe(true);
      expect(e.muted).toBe(false);
      expect(e.src.startsWith('https://pod.test/')).toBe(true);
    }
    // Der Vorrat bleibt bereit, nichts wurde verworfen oder neu geladen
    expect(t.deck.readyCount()).toBe(5);
    expect(t.lines.slice(n).some((l) => /^deck: pool (dropped|load|evicted)/.test(l))).toBe(false);
    // Die zweite Geste lässt die Elemente in Ruhe
    t.deck.unlock();
    for (const e of pooled) expect(e.calls.filter((c) => c === 'play')).toHaveLength(1);
    // Das Element, das nach der Geste frei blieb, hat die Stille gesehen (ohne laufenden Ausschnitt spielt unlock sie auch auf dem künftigen aktiven Element)
    const spare = t.els.find((e) => !pooled.includes(e));
    expect(spare?.calls.filter((c) => c === 'play').length).toBeGreaterThanOrEqual(1);
  });

  it('nach 8 s ohne Bereitschaft bleibt der Eintrag im Vorrat, es gibt nur die Zeile "pool slow" (Brief 22)', async () => {
    vi.useFakeTimers();
    try {
      const t = setupPool();
      t.deck.fill([sbB]);
      vi.advanceTimersByTime(8100);
      expect(t.lines.some((l) => /^deck: pool slow b 8000 ms rs=0 meta=false$/.test(l))).toBe(true);
      expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['b']);
      // Erst ein Fehler-Ereignis nimmt ihn heraus
      elOf(t, sbB).emit('error');
      expect(t.deck.poolInfo()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('onReady meldet jede neue Bereitschaft mit der Zahl der bereiten Elemente (Brief 22)', async () => {
    const t = setupPool();
    const got: number[] = [];
    t.deck.onReady = (n) => got.push(n);
    const cs = ['b', 'c', 'd'].map(mk);
    t.deck.fill(cs);
    fillAll(t, cs);
    expect(got).toEqual([1, 2, 3]);
    t.deck.release();
    expect(t.deck.onReady).toBeNull();
  });

  it('fill lädt in freie Elemente, lokal zuerst, dann Netz; die Reihenfolge des Vorrats ist die der Warteschlange', async () => {
    const ids = ['b', 'c', 'd', 'e', 'f'];
    const cs = ids.map(mk);
    const t = setupPool({ local: { [cs[1].key]: { url: 'blob:c', offset: 0 }, [cs[3].key]: { url: 'blob:e', offset: 0 } } });
    await boot(t, sbA);
    expect(t.deck.fill(cs)).toBe(5);
    expect(t.lines.filter((l) => l.startsWith('deck: pool load '))).toEqual([
      'deck: pool load c src=local',
      'deck: pool load e src=local',
      'deck: pool load b src=net',
      'deck: pool load d src=net',
      'deck: pool load f src=net',
    ]);
    expect(t.lines).toContain('deck: pool fill 5/5 (local 2, net 3)');
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(ids);
    expect(elOf(t, cs[0]).src).toBe('https://pod.test/b.mp3');
    expect(elOf(t, cs[1]).src).toBe('blob:c');
    expect(elOf(t, cs[0]).calls).toContain('load');
    // Aktives Element bleibt unberührt, es gibt höchstens fünf Elemente im Vorrat
    expect(t.els[0].src).toBe('https://pod.test/a.mp3');
    expect(t.els).toHaveLength(6);
    // Ein weiterer Aufruf mit mehr Momenten nimmt nur die ersten fünf, nichts wird doppelt geladen
    const more = [...cs, mk('g'), mk('h')];
    const n = t.lines.length;
    expect(t.deck.fill(more)).toBe(5);
    expect(t.lines.length).toBe(n);
    expect(t.els).toHaveLength(6);
  });

  it('der laufende Ausschnitt kommt nicht in den Vorrat', async () => {
    const t = setupPool();
    await boot(t, sbA);
    expect(t.deck.fill([sbA, sbB])).toBe(1);
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['b']);
  });

  it('fill wählt aus sechs Kandidaten lokale zuerst, das Netz füllt nur auf (Brief 14b, Schritt 1)', async () => {
    const ids = ['b', 'c', 'd', 'e', 'f', 'g'];
    const cs = ids.map(mk);
    // lokal sind die hinteren drei (e, f, g), die vorderen drei kommen aus dem Netz
    const t = setupPool({ local: { [cs[3].key]: { url: 'blob:e', offset: 0 }, [cs[4].key]: { url: 'blob:f', offset: 0 }, [cs[5].key]: { url: 'blob:g', offset: 0 } } });
    await boot(t, sbA);
    expect(t.deck.fill(cs)).toBe(5);
    // Der nächste (b) bleibt, dann alle drei lokalen, dann ein Netz-Moment (c). d fällt heraus.
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['b', 'c', 'e', 'f', 'g']);
    expect(t.lines).toContain('deck: pool fill 5/5 (local 3, net 2)');
    // Lokale laden zuerst
    expect(t.lines.filter((l) => l.startsWith('deck: pool load '))).toEqual([
      'deck: pool load e src=local',
      'deck: pool load f src=local',
      'deck: pool load g src=local',
      'deck: pool load b src=net',
      'deck: pool load c src=net',
    ]);
  });

  it('fill: sind mehr als fünf lokal, bleibt der nächste trotzdem im Vorrat (der sichtbare Wisch darauf tauscht sofort)', async () => {
    const cs = ['b', 'c', 'd', 'e', 'f', 'g'].map(mk);
    const t = setupPool({ local: Object.fromEntries(cs.slice(1).map((c) => [c.key, { url: `blob:${c.id}`, offset: 0 }])) });
    await boot(t, sbA);
    expect(t.deck.fill(cs)).toBe(5);
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(t.lines).toContain('deck: pool fill 5/5 (local 4, net 1)');
  });

  it('fill ordnet neu, sobald lokale Quellen dazukommen: ein geladenes Netz-Element weicht, der Vorrat bleibt in Reihenfolge der Warteschlange', async () => {
    const cs = ['b', 'c', 'd', 'e', 'f', 'g'].map(mk);
    const t = setupPool();
    await boot(t, sbA);
    // Zuerst ist nichts lokal: die ersten fünf aus dem Netz
    t.deck.fill(cs);
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['b', 'c', 'd', 'e', 'f']);
    // Danach liegen f und g im Vorrat: g verdrängt das hinterste Netz-Element, f wird lokal neu geladen
    t.local[cs[4].key] = { url: 'blob:f', offset: 0 };
    t.local[cs[5].key] = { url: 'blob:g', offset: 0 };
    t.deck.fill(cs);
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['b', 'c', 'd', 'f', 'g']);
    expect(t.lines.filter((l) => l.startsWith('deck: pool dropped '))).toContain('deck: pool dropped e (left window)');
  });

  it('fill stellt ein Netz-Element auf lokal um, sobald sein Moment lokal verfügbar wird (Blob warm), auch der nächste', async () => {
    const cs = ['b', 'c', 'd', 'e', 'f'].map(mk);
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill(cs);
    expect(t.lines).toContain('deck: pool fill 5/5 (local 0, net 5)');
    t.local[cs[0].key] = { url: 'blob:b', offset: 0 };
    t.local[cs[2].key] = { url: 'blob:d', offset: 0 };
    t.deck.fill(cs);
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(t.lines).toContain('deck: pool dropped b (now local)');
    expect(t.lines).toContain('deck: pool dropped d (now local)');
    expect(t.lines).toContain('deck: pool load b src=local');
    expect(t.lines).toContain('deck: pool fill 5/5 (local 2, net 3)');
    // Ein zweiter Lauf ohne Änderung lädt nichts mehr
    const n = t.lines.length;
    t.deck.fill(cs);
    expect(t.lines.length).toBe(n);
  });

  it('verdeckt wird nichts geladen: kein Element, kein load(), keine Quelle', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.setHidden(true);
    expect(t.deck.fill([sbB, mk('c')])).toBe(0);
    expect(t.els).toHaveLength(1);
    expect(t.lines.some((l) => l.startsWith('deck: pool'))).toBe(false);
  });

  it('bereit erst mit Metadaten, gesetzter Position und genug Daten, die Position wird nach den Metadaten nachgezogen', async () => {
    const t = setupPool({ local: { [sbB.key]: { url: 'blob:b', offset: 8 } } });
    await boot(t, sbA);
    t.deck.fill([sbB]);
    const sb = elOf(t, sbB);
    // Vor den Metadaten: nichts
    sb.readyState = 1;
    sb.emit('canplaythrough');
    expect(t.deck.poolReady(sbB.key)).toBe(false);
    // iOS hat die frühe Position verworfen
    sb.currentTime = 0;
    sb.emit('loadedmetadata');
    // Start 10 minus Versatz 8
    expect(sb.currentTime).toBe(2);
    // Nach dem Springen zählt erst ein neues canplaythrough oder genug Daten
    expect(t.deck.poolReady(sbB.key)).toBe(false);
    sb.readyState = 4;
    sb.emit('canplaythrough');
    expect(t.deck.poolReady(sbB.key)).toBe(true);
    expect(t.deck.readyCount()).toBe(1);
    expect(t.lines.some((l) => /^deck: pool ready b after \d+ ms$/.test(l))).toBe(true);
  });

  it('aus dem Vorrat genügt readyState 3, übers Netz braucht es canplaythrough oder readyState 4', async () => {
    const t = setupPool({ local: { [sbB.key]: { url: 'blob:b', offset: 10 } } });
    await boot(t, sbA);
    const c = clip('c', 0, 10);
    t.deck.fill([sbB, c]);
    const loc = elOf(t, sbB);
    loc.emit('loadedmetadata');
    loc.readyState = 3;
    loc.emit('canplay');
    expect(t.deck.poolReady(sbB.key)).toBe(true);
    const net = elOf(t, c);
    net.emit('loadedmetadata');
    net.readyState = 3;
    net.emit('canplay');
    expect(t.deck.poolReady(c.key)).toBe(false);
    net.readyState = 4;
    net.emit('seeked');
    expect(t.deck.poolReady(c.key)).toBe(true);
  });

  it('swapNext ohne bereites Element tut nichts und sagt es', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB]);
    const [act, sb] = t.els;
    act.calls.length = 0;
    sb.calls.length = 0;
    expect(t.deck.swapNext()).toBeNull();
    expect(t.lines).toContain('deck: swap none ready=false pool=0');
    expect(act.calls).toEqual([]);
    expect(sb.calls).toEqual([]);
    expect(act.paused).toBe(false);
    expect(t.deck.clip?.id).toBe('a');
  });

  it('swapNext tauscht die Rollen: play() sofort auf dem Element, danach hält das alte an, nichts wird geladen, keine Quelle gewechselt', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB]);
    const [act, sb] = t.els;
    fill(sb);
    act.calls.length = 0;
    sb.calls.length = 0;
    const got = t.deck.swapNext();
    expect(got?.id).toBe('b');
    expect(sb.calls).toEqual(['play']);
    expect(sb.paused).toBe(false);
    expect(act.paused).toBe(true);
    // Weder load() noch eine neue Quelle an einem der beiden
    expect([...act.calls, ...sb.calls].filter((c) => c === 'load' || c.startsWith('src:'))).toEqual([]);
    expect(t.deck.clip?.id).toBe('b');
    expect(t.deck.history.at(-1)).toBe(sbB.key);
    expect(t.deck.readyCount()).toBe(0);
    expect(t.lines).toContain('deck: swap b ready=true pool=0');
    expect(t.lines.some((l) => /^deck play#\d+ swap /.test(l))).toBe(true);
    expect(t.media).toContain('playing swap');
    // Der alte Player ist abgegeben: seine Ereignisse und Befehle stören das neue Element nicht
    t.deck.pause(t.sink);
    expect(sb.paused).toBe(false);
    act.tick(60);
    expect(t.deck.clip?.id).toBe('b');
  });

  it('swapNext nimmt das erste bereite Element in Reihenfolge der Warteschlange und überspringt Ladende', async () => {
    const t = setupPool();
    const cs = ['b', 'c', 'd'].map(mk);
    await boot(t, sbA);
    t.deck.fill(cs);
    fill(elOf(t, cs[1]));
    fill(elOf(t, cs[2]));
    t.setHidden(true);
    expect(t.deck.swapNext()?.id).toBe('c');
    expect(t.deck.swapNext()?.id).toBe('d');
    // b lädt noch: nichts bereit
    expect(t.deck.swapNext()).toBeNull();
    expect(t.deck.poolInfo()).toEqual([{ key: cs[0].key, id: 'b', ready: false }]);
    // Es kommt später an: der nächste Tausch nimmt es
    fill(elOf(t, cs[0]));
    expect(t.deck.swapNext()?.id).toBe('b');
  });

  it('fünf Mal tauschen, verdeckt, gemischt lokal und Netz: lokale zuerst, dann Netz, jedes Mal spielt das Element sofort, nichts wird geladen (Brief 14b)', async () => {
    const cs = ['b', 'c', 'd', 'e', 'f'].map(mk);
    const t = setupPool({ local: { [cs[0].key]: { url: 'blob:b', offset: 0 }, [cs[2].key]: { url: 'blob:d', offset: 0 }, [cs[4].key]: { url: 'blob:f', offset: 0 } } });
    await ready(t, mk('a'), cs);
    t.els.forEach((e) => (e.calls.length = 0));
    t.lines.length = 0;
    // Verdeckt: die drei lokalen (b, d, f) in Reihenfolge der Warteschlange, danach die zwei aus dem Netz (c, e)
    const order = ['b', 'd', 'f', 'c', 'e'];
    for (const id of order) {
      const got = t.deck.swapNext(t.sink);
      expect(got?.id).toBe(id);
      expect(active(t).paused).toBe(false);
      expect(active(t).calls).toEqual(['play']);
    }
    expect(t.els).toHaveLength(6);
    expect(t.lines.filter((l) => /^deck: swap \S+ ready=true pool=\d$/.test(l))).toEqual([
      'deck: swap b ready=true pool=4',
      'deck: swap d ready=true pool=3',
      'deck: swap f ready=true pool=2',
      'deck: swap c ready=true pool=1',
      'deck: swap e ready=true pool=0',
    ]);
    expect(t.lines.some((l) => /ready=false/.test(l))).toBe(false);
    expect(t.els.flatMap((e) => e.calls).filter((c) => c === 'load' || c.startsWith('src:'))).toEqual([]);
    // Der sechste Tausch hat nichts mehr: kein Netzstart, keine Quelle
    expect(t.deck.swapNext(t.sink)).toBeNull();
    expect(t.lines).toContain('deck: swap none ready=false pool=0');
  });

  it('verdeckt geht ein bereites lokales Element einem früheren Netz-Element vor, auch wenn es erst readyState 3 hat; Netz nur, wenn kein lokales bereit ist (Brief 14b, Schritt 3)', async () => {
    const [b, c, d] = ['b', 'c', 'd'].map(mk);
    const t = setupPool({ local: { [d.key]: { url: 'blob:d', offset: 0 } } });
    await boot(t, sbA);
    t.deck.fill([b, c, d]);
    fill(elOf(t, b));
    fill(elOf(t, c));
    // d ist lokal, hat aber nur readyState 3 (lokal genügt 3), b und c haben 4
    fill(elOf(t, d), 3);
    t.setHidden(true);
    expect(t.deck.swapNext(t.sink)?.id).toBe('d');
    // Kein lokales mehr: jetzt das Netz, in Reihenfolge der Warteschlange
    expect(t.deck.swapNext(t.sink)?.id).toBe('b');
    expect(t.deck.swapNext(t.sink)?.id).toBe('c');
  });

  it('ein lokales Element mit readyState 4 geht dem lokalen mit readyState 3 vor', async () => {
    const [b, c] = ['b', 'c'].map(mk);
    const t = setupPool({ local: { [b.key]: { url: 'blob:b', offset: 0 }, [c.key]: { url: 'blob:c', offset: 0 } } });
    await boot(t, sbA);
    t.deck.fill([b, c]);
    fill(elOf(t, b), 3);
    fill(elOf(t, c), 4);
    t.setHidden(true);
    expect(t.deck.swapNext(t.sink)?.id).toBe('c');
    expect(t.deck.swapNext(t.sink)?.id).toBe('b');
  });

  it('sichtbar bleibt es bei der Reihenfolge der Warteschlange, ein lokales Element hat keinen Vorrang', async () => {
    const [b, c, d] = ['b', 'c', 'd'].map(mk);
    const t = setupPool({ local: { [d.key]: { url: 'blob:d', offset: 0 } } });
    await boot(t, sbA);
    t.deck.fill([b, c, d]);
    fillAll(t, [b, c, d]);
    expect(t.deck.swapNext(t.sink)?.id).toBe('b');
    expect(t.deck.swapNext(t.sink)?.id).toBe('c');
    expect(t.deck.swapNext(t.sink)?.id).toBe('d');
  });

  it('Auto-Weiter verdeckt nimmt ebenfalls das lokale Element zuerst', async () => {
    const [b, c] = ['b', 'c'].map(mk);
    const t = setupPool({ local: { [c.key]: { url: 'blob:c', offset: 0 } } });
    await ready(t, clip('a', 0, 10), [b, c]);
    let advanced = 0;
    t.deck.onAdvance = () => advanced++;
    (t.deck.element as PEl).tick(10);
    expect(advanced).toBe(1);
    expect(t.deck.clip?.id).toBe('c');
  });

  it('nach dem Tausch gelten die Ereignisse des neuen Elements: Ende im Hintergrund führt zum nächsten Element', async () => {
    const t = setupPool();
    await ready(t, clip('a', 0, 10), [mk('b'), mk('c')]);
    t.deck.swapNext();
    let advanced = 0;
    t.deck.onAdvance = () => advanced++;
    elOf(t, mk('b')).tick(10);
    expect(advanced).toBe(1);
    expect(t.deck.clip?.id).toBe('c');
  });

  it('der Wisch auf einen Moment des Vorrats tauscht in load() statt die Quelle zu wechseln', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB]);
    const [act, sb] = t.els;
    fill(sb);
    // Der Feed pausiert den alten Player, dann lädt der neue
    t.deck.pause(t.sink);
    act.calls.length = 0;
    sb.calls.length = 0;
    const states: number[] = [];
    const next: DeckSink = { state: (x) => states.push(x), error: () => {} };
    t.deck.load(sbB, next, { play: true, muted: false });
    // Das Element meldet "playing" schon synchron im play(): der neue Player bekommt PLAYING trotzdem (der Sink steht vor dem Tausch)
    expect(states).toContain(1);
    expect([...act.calls, ...sb.calls].filter((c) => c === 'load' || c.startsWith('src:'))).toEqual([]);
    expect(sb.calls).toEqual(['play']);
    expect(t.deck.owns(next)).toBe(true);
    expect(t.deck.holds(sbB.key)).toBe(true);
    expect(sb.muted).toBe(false);
  });

  it('der Wisch auf einen anderen Moment startet normal, der Vorrat bleibt bereit', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB, mk('c')]);
    fillAll(t, [sbB, mk('c')]);
    t.deck.load(mk('z'), t.sink, { play: true, muted: false });
    expect(t.deck.clip?.id).toBe('z');
    expect(t.deck.poolReady(sbB.key)).toBe(true);
    expect(t.deck.poolReady(mk('c').key)).toBe(true);
  });

  it('startet der Feed den Ausschnitt eines Vorrats-Elements direkt (ohne Tausch), wird der Eintrag überholt und das Element frei', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB]);
    fill(t.els[1]);
    t.deck.load(sbB, t.sink, { play: false, muted: false });
    expect(t.deck.poolInfo()).toEqual([]);
    expect(t.deck.clip?.id).toBe('b');
  });

  it('ein Ereignis eines Vorrats-Elements stört den laufenden Ausschnitt nicht', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB]);
    const sb = t.els[1];
    t.states.length = 0;
    sb.emit('ended');
    sb.emit('pause');
    sb.emit('playing');
    sb.tick(5);
    expect(t.states).toEqual([]);
    expect(t.deck.clip?.id).toBe('a');
  });

  it('verwirft iOS ein bereites Element (readyState fällt auf 0), meldet das nächste fill es und lädt neu', async () => {
    const t = setupPool();
    const cs = ['b', 'c'].map(mk);
    await boot(t, sbA);
    t.deck.fill(cs);
    fillAll(t, cs);
    expect(t.deck.readyCount()).toBe(2);
    const b = elOf(t, cs[0]);
    b.readyState = 0;
    expect(t.deck.readyCount()).toBe(1);
    expect(t.deck.poolReady(cs[0].key)).toBe(false);
    // Neu laden nur sichtbar, mit Diagnose
    t.deck.fill(cs);
    expect(t.lines).toContain('deck: pool evicted b');
    expect(t.lines.filter((l) => l === 'deck: pool load b src=net')).toHaveLength(2);
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['b', 'c']);
    expect(t.deck.poolReady(cs[0].key)).toBe(false);
  });

  it('verdeckt verworfen: swapNext überspringt das Element, meldet es und nimmt das nächste', async () => {
    const t = setupPool();
    const cs = ['b', 'c'].map(mk);
    await ready(t, sbA, cs);
    elOf(t, cs[0]).readyState = 0;
    t.els.forEach((e) => (e.calls.length = 0));
    expect(t.deck.swapNext()?.id).toBe('c');
    expect(t.lines).toContain('deck: pool evicted b');
    expect(t.els.flatMap((e) => e.calls).filter((c) => c === 'load' || c.startsWith('src:'))).toEqual([]);
  });

  it('ein Element, das nie Daten hatte (readyState bleibt 0 wie in der Testumgebung), gilt nicht als verworfen', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB]);
    const sb = t.els[1];
    sb.emit('loadedmetadata');
    sb.emit('canplaythrough');
    expect(sb.readyState).toBe(0);
    expect(t.deck.poolReady(sbB.key)).toBe(true);
    t.deck.fill([sbB]);
    expect(t.lines.some((l) => l.includes('evicted'))).toBe(false);
  });

  it('nach einem Tausch füllt der nächste sichtbare fill auf, "deck: pool refill n/5" kommt, sobald alle bereit sind', async () => {
    const cs = ['b', 'c', 'd', 'e', 'f'].map(mk);
    const t = setupPool();
    await ready(t, sbA, cs);
    t.deck.swapNext();
    t.setHidden(false);
    const g = mk('g');
    t.deck.fill([...cs.slice(1), g]);
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['c', 'd', 'e', 'f', 'g']);
    expect(t.lines.some((l) => l.startsWith('deck: pool refill'))).toBe(false);
    fill(elOf(t, g));
    expect(t.lines).toContain('deck: pool refill 5/5');
    // Nur einmal je Leerung
    t.deck.fill([...cs.slice(1), g]);
    expect(t.lines.filter((l) => l.startsWith('deck: pool refill'))).toHaveLength(1);
  });

  it('Momente, die aus dem Fenster fallen, verlassen den Vorrat, ihr Element wird frei und nimmt den neuen', async () => {
    const t = setupPool();
    const cs = ['b', 'c', 'd', 'e', 'f'].map(mk);
    await boot(t, sbA);
    t.deck.fill(cs);
    fillAll(t, cs);
    // Die Warteschlange wurde umgestellt: c bis f bleiben, b fällt heraus, g kommt dazu
    const g = mk('g');
    t.deck.fill([...cs.slice(1), g]);
    expect(t.deck.poolInfo().map((x) => x.id)).toEqual(['c', 'd', 'e', 'f', 'g']);
    expect(t.lines).toContain('deck: pool dropped b (left window)');
    expect(t.els).toHaveLength(6);
    expect(t.deck.readyCount()).toBe(4);
  });

  it('Quelle aus dem Speicher nicht abspielbar: Eintrag fällt heraus, der Speicher vergisst sie, der nächste fill lädt vom Netz', async () => {
    const t = setupPool({ local: { [sbB.key]: { url: 'blob:b', offset: 10 } } });
    await boot(t, sbA);
    let need = 0;
    t.deck.onNeedFill = () => need++;
    t.deck.fill([sbB]);
    t.els[1].emit('error');
    expect(t.dropped).toEqual([sbB.key]);
    expect(t.lines).toContain('deck: pool failed b (local)');
    expect(t.deck.poolInfo()).toEqual([]);
    expect(need).toBe(1);
    t.deck.fill([sbB]);
    expect(t.lines).toContain('deck: pool load b src=net');
  });

  it('Fehler eines Elements verdeckt: Eintrag fällt heraus, es wird nichts geladen und kein Rückruf ausgelöst', async () => {
    const t = setupPool({ local: { [sbB.key]: { url: 'blob:b', offset: 10 } } });
    await boot(t, sbA);
    let need = 0;
    t.deck.onNeedFill = () => need++;
    t.deck.fill([sbB]);
    t.setHidden(true);
    t.els[1].emit('error');
    expect(t.dropped).toEqual([sbB.key]);
    expect(t.deck.poolInfo()).toEqual([]);
    expect(need).toBe(0);
    expect(t.els).toHaveLength(2);
  });

  it('onPlayed kommt nach jedem erfüllten play(), auch nach swapNext', async () => {
    const t = setupPool();
    let n = 0;
    t.deck.onPlayed = () => n++;
    await boot(t, sbA);
    expect(n).toBe(1);
    t.deck.fill([sbB]);
    fill(t.els[1]);
    t.deck.swapNext();
    await settle();
    expect(n).toBe(2);
    expect(t.lines.some((l) => /^deck play#\d+ ok$/.test(l))).toBe(true);
  });

  it('Lautheit: die Kette hängt am Element des Vorrats, nach dem Tausch gilt ihr Wert', async () => {
    const t = setupPool({ level: true });
    const a = { ...clip('a', 0, 60), gain: 0 };
    const b = { ...clip('b', 0, 20), gain: 6 };
    await boot(t, a);
    t.deck.fill([b]);
    expect(t.chained).toEqual([6]);
    const lv = t.els.find((e) => e.level) as PEl;
    expect(lv.src).toContain('b.mp3');
    fill(lv);
    expect(t.deck.swapNext()?.id).toBe('b');
    t.deck.load(b, t.sink, { play: true, muted: false });
    expect(t.deck.loud(t.sink)).toEqual({ db: 6, how: 'web audio', linear: 10 ** (6 / 20) });
  });

  it('Lautheit: läuft der Kontext beim Tausch nicht, taugt das geregelte Element nicht, das nächste ungeregelte kommt dran', async () => {
    const t = setupPool({ level: true });
    const a = { ...clip('a', 0, 60), gain: 0 };
    const b = { ...clip('b', 0, 20), gain: 6 };
    const c = clip('c', 0, 20);
    await boot(t, a);
    t.deck.fill([b, c]);
    fillAll(t, [b, c]);
    t.setHidden(true);
    t.setRunning(false);
    expect(t.deck.swapNext()?.id).toBe('c');
    expect(t.lines).toContain('deck: swap b ready=false (context not running)');
    // Nur das geregelte Element übrig und der Kontext läuft nicht: nichts tauscht
    const t2 = setupPool({ level: true });
    await boot(t2, a);
    t2.deck.fill([b]);
    fill(t2.els.find((e) => e.level) as PEl);
    t2.setRunning(false);
    expect(t2.deck.swapNext()).toBeNull();
    expect(t2.deck.clip?.id).toBe('a');
  });

  it('eine Geste schaltet fünf weitere Elemente mit Stille frei, einmal, und lässt das aktive in Ruhe', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.unlock();
    expect(t.els).toHaveLength(POOL + 1);
    const spares = t.els.slice(1);
    for (const sp of spares) {
      expect(sp.src.startsWith('data:audio/wav')).toBe(true);
      expect(sp.calls.filter((c) => c === 'play')).toHaveLength(1);
    }
    t.deck.unlock();
    for (const sp of spares) expect(sp.calls.filter((c) => c === 'play')).toHaveLength(1);
    expect(t.els[0].src).toBe('https://pod.test/a.mp3');
    expect(t.els[0].paused).toBe(false);
    await settle();
    // Nach der Stille gibt das freie Element die Quelle wieder ab, damit der Vorrat sie ersetzt
    expect(spares.every((sp) => sp.src === '')).toBe(true);
  });

  it('release räumt den Vorrat auf', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB]);
    fill(t.els[1]);
    t.deck.release();
    expect(t.deck.readyCount()).toBe(0);
    expect(t.els.every((e) => e.paused)).toBe(true);
  });
});

describe('Hänge-Überwachung verdeckt (Brief 14b, Issue 40, Entscheidung 45)', () => {
  it('sichtbar darf die App den hängenden Moment überspringen, verdeckt nie', async () => {
    const t = setupPool();
    await boot(t, sbA);
    expect(t.deck.hungAction()).toBe('skip');
    t.setHidden(true);
    expect(t.deck.hungAction()).not.toBe('skip');
  });

  it('verdeckt ohne bereites Element: stay, nichts wird geladen, nichts getauscht, das Element bleibt dasselbe', async () => {
    const t = setupPool();
    await boot(t, sbA);
    t.deck.fill([sbB]);
    // b lädt noch (kein canplaythrough): nichts bereit
    t.setHidden(true);
    const act = active(t);
    t.els.forEach((e) => (e.calls.length = 0));
    t.lines.length = 0;
    expect(t.deck.hungAction()).toBe('stay');
    expect(active(t)).toBe(act);
    expect(t.deck.clip?.id).toBe('a');
    expect(t.els.flatMap((e) => e.calls)).toEqual([]);
    expect(t.lines).toEqual([]);
  });

  it('verdeckt mit bereitem Element: swap, und swapNext tauscht darauf (ein hängendes Netz-Element weicht einem lokalen)', async () => {
    const [b, c] = ['b', 'c'].map(mk);
    const t = setupPool({ local: { [c.key]: { url: 'blob:c', offset: 0 } } });
    await ready(t, mk('a'), [b, c]);
    expect(t.deck.hungAction()).toBe('swap');
    expect(t.deck.swapNext(t.sink)?.id).toBe('c');
    expect(t.deck.hungAction()).toBe('swap');
    expect(t.deck.swapNext(t.sink)?.id).toBe('b');
    // Vorrat verbraucht: wieder stay
    expect(t.deck.hungAction()).toBe('stay');
  });

  it('ein von iOS verworfenes Element zählt nicht als bereit', async () => {
    const t = setupPool();
    await ready(t, mk('a'), [sbB]);
    expect(t.deck.hungAction()).toBe('swap');
    elOf(t, sbB).readyState = 0;
    expect(t.deck.hungAction()).toBe('stay');
  });
});
