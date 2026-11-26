// Runde 46 (Gerätelog 26.11., der ganze Netzpfad war langsam, der Start hing an EINER Datei): Wettlauf beim Start (START_RACE), zweites Element statt Abbruch (START_HEDGE),
// Messzeilen "load: ..." und "race: ...". Reine Entscheidungslogik (raceBudget, startBudget, hedgeChoice) und das Deck mit nachgebauten Elementen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, FRESH_RELOAD_MS, HEDGE_FAIL_MS, RACE_STAGGER_MS, START_HEDGE, START_RACE, START_RACE_N, hedgeChoice, poolBudget, raceBudget, startBudget, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';

describe('raceBudget und startBudget', () => {
  it('Voreinstellungen: Wettlauf und zweites Element an, drei Ladevorgänge zugleich (das aktive zählt mit)', () => {
    expect(START_RACE).toBe(true);
    expect(START_HEDGE).toBe(true);
    expect(START_RACE_N).toBe(3);
    expect(RACE_STAGGER_MS).toBe(3000);
  });
  it('vor der Frist höchstens zwei zugleich (der Stand von Runde 18), danach n', () => {
    const b = (inflight: number, stuckMs: number, n = 3) => raceBudget({ n, activeLoads: 1, inflight, stuckMs });
    expect([b(0, 0), b(1, 0), b(2, 0)]).toEqual([1, 0, 0]);
    expect([b(0, 2999), b(1, 2999)]).toEqual([1, 0]);
    expect([b(0, 3000), b(1, 3000), b(2, 3000), b(3, 3000)]).toEqual([2, 1, 0, 0]);
  });
  it('n = 2 bleibt immer beim Stand von Runde 18', () => {
    expect(raceBudget({ n: 2, activeLoads: 1, inflight: 0, stuckMs: 60_000 })).toBe(1);
    expect(raceBudget({ n: 2, activeLoads: 1, inflight: 1, stuckMs: 60_000 })).toBe(0);
  });
  it('kein aktiver Ladevorgang: ein Platz mehr, nie negativ', () => {
    expect(raceBudget({ n: 3, activeLoads: 0, inflight: 0, stuckMs: 0 })).toBe(2);
    expect(raceBudget({ n: 3, activeLoads: 1, inflight: 9, stuckMs: 9999 })).toBe(0);
    expect(raceBudget({ n: 3, activeLoads: 1, inflight: -4, stuckMs: 9999 })).toBe(2);
  });
  it('startBudget: Wettlauf aus oder Ton läuft: genau poolBudget (Runde 18)', () => {
    for (const weakNet of [false, true]) {
      for (const inflight of [0, 1, 2]) {
        for (const activePlaying of [false, true]) {
          expect(startBudget({ race: false, n: 3, activePlaying, weakNet, inflight, stuckMs: 99_999 })).toBe(poolBudget({ activePlaying, weakNet, inflight }));
        }
        expect(startBudget({ race: true, n: 3, activePlaying: true, weakNet, inflight, stuckMs: 99_999 })).toBe(poolBudget({ activePlaying: true, weakNet, inflight }));
      }
    }
  });
  it('startBudget: kein Ton, Wettlauf an: der Merker "schwaches Netz" drosselt nicht, nie weniger als poolBudget', () => {
    const f = (weakNet: boolean, inflight: number, stuckMs: number) => startBudget({ race: true, n: 3, activePlaying: false, weakNet, inflight, stuckMs });
    expect(f(true, 0, 3500)).toBe(f(false, 0, 3500));
    expect(f(true, 0, 3500)).toBe(2);
    expect(f(true, 1, 3500)).toBe(1);
    expect(f(true, 0, 100)).toBe(1);
    expect(f(true, 5, 3500)).toBe(0);
  });
});

describe('hedgeChoice', () => {
  const base = { on: true, error: false, local: false, lane: 'plain' as const, hasHedge: false, freeUnlocked: 2 };
  it('zweites Element, wenn eines frei und freigeschaltet ist', () => {
    expect(hedgeChoice(base)).toEqual({ kind: 'hedge', why: 'ok' });
  });
  it('aus, Ladefehler, lokale Quelle, geregelte Spur, läuft schon, kein freigeschaltetes Element: frisches Neuladen', () => {
    expect(hedgeChoice({ ...base, on: false }).kind).toBe('fresh');
    expect(hedgeChoice({ ...base, error: true })).toEqual({ kind: 'fresh', why: 'load error' });
    expect(hedgeChoice({ ...base, local: true }).kind).toBe('fresh');
    expect(hedgeChoice({ ...base, lane: 'level' }).kind).toBe('fresh');
    expect(hedgeChoice({ ...base, hasHedge: true }).kind).toBe('fresh');
    expect(hedgeChoice({ ...base, freeUnlocked: 0 })).toEqual({ kind: 'fresh', why: 'no unlocked element free' });
  });
});

class El implements DeckEl {
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 600;
  muted = false;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  quiet = true;
  private on = new Map<string, (() => void)[]>();
  get buffered() {
    return { length: 0, end: () => 0 };
  }
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
    this.paused = false;
    if (!this.quiet) this.emit('playing');
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
}

const clip = (id: string): DeckClip => ({ key: `${id}|0|60`, id, url: `https://pod.test/${id}.mp3`, start: 0, end: 60 });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup(opts: { startRace?: boolean; startRaceN?: number; startHedge?: boolean; unlocked?: boolean; hidden?: boolean } = {}) {
  const els: El[] = [];
  const deck = new AudioDeck({
    neverMuted: false,
    standby: true,
    unlockSilent: false,
    startRace: opts.startRace,
    startRaceN: opts.startRaceN,
    startHedge: opts.startHedge,
    local: () => undefined,
    dropLocal: () => {},
    make: () => {
      const e = new El();
      els.push(e);
      return e;
    },
    hidden: () => !!opts.hidden,
    running: () => true,
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink };
}
type T = ReturnType<typeof setup>;

const loaded = (t: T) => t.lines.filter((l) => l.startsWith('deck: pool load ')).map((l) => l.split(' ')[3]);
const elsOf = (t: T, id: string) => t.els.filter((x) => x.src.includes(`/${id}.mp3`));
const ready = (el: El) => {
  el.emit('loadedmetadata');
  el.readyState = 4;
  el.emit('canplaythrough');
};
const net = (t: T) => t.els.filter((e) => e.src.startsWith('https:'));
const audible = (t: T) => net(t).filter((e) => !e.paused);
/** Geste: alle Elemente werden freigeschaltet (probe, play() wird angenommen), danach startet der aktive Moment ohne Ton */
async function open(t: T, unlocked = true) {
  if (unlocked) {
    t.deck.unlock('click');
    await flush();
  }
  t.deck.load(clip('a'), t.sink, { play: true, muted: false });
  await flush();
}
const cs = ['b', 'c', 'd', 'e', 'f'].map(clip);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Wettlauf beim Start (START_RACE)', () => {
  it('kein Ton: der erste Kandidat lädt gleich, der zweite erst nach RACE_STAGGER_MS ohne Metadaten, nie ein dritter', async () => {
    const t = setup({ startHedge: false });
    await open(t);
    t.deck.fill(cs);
    expect(loaded(t)).toEqual(['b']);
    vi.advanceTimersByTime(RACE_STAGGER_MS - 500);
    expect(loaded(t)).toEqual(['b']);
    vi.advanceTimersByTime(700);
    expect(loaded(t)).toEqual(['b', 'c']);
    vi.advanceTimersByTime(2000);
    expect(loaded(t)).toEqual(['b', 'c']);
    // Messzeilen: aktives Element und beide Kandidaten laufen zugleich
    expect(t.deck.startRacing()).toBe(true);
  });

  it('ein Ladevorgang mit Metadaten macht Fortschritt: der dritte Platz öffnet sich nicht (Runde 18: ein Netz, das liefert, bekommt keinen weiteren Abruf)', async () => {
    const t = setup({ startHedge: false });
    await open(t);
    t.deck.fill(cs);
    elsOf(t, 'b')[0].emit('loadedmetadata');
    vi.advanceTimersByTime(RACE_STAGGER_MS + 2000);
    expect(loaded(t)).toEqual(['b']);
  });

  it('Schalter aus: bei jedem Stand ein Abruf neben dem aktiven, startRacing ist false', async () => {
    const t = setup({ startRace: false, startHedge: false });
    await open(t);
    t.deck.fill(cs);
    vi.advanceTimersByTime(RACE_STAGGER_MS * 3);
    expect(loaded(t)).toEqual(['b']);
    expect(t.deck.startRacing()).toBe(false);
    expect(t.deck.startRace).toBe(false);
    expect(t.lines.some((l) => l.startsWith('race: '))).toBe(false);
  });

  it('n = 2: ein Abruf neben dem aktiven, wie Runde 18', async () => {
    const t = setup({ startRaceN: 2, startHedge: false });
    await open(t);
    t.deck.fill(cs);
    vi.advanceTimersByTime(RACE_STAGGER_MS * 3);
    expect(loaded(t)).toEqual(['b']);
  });

  it('drei Kandidaten mit Bereitschaft nach 12 s (aktiv), 5 s und 9 s: der zweite ist zuerst bereit, "race: ..." nennt ihn, die anderen sind Verlierer', async () => {
    const t = setup({ startHedge: false });
    await open(t);
    t.deck.fill(cs);
    vi.advanceTimersByTime(RACE_STAGGER_MS + 200);
    expect(loaded(t)).toEqual(['b', 'c']);
    vi.advanceTimersByTime(2000);
    ready(elsOf(t, 'c')[0]);
    const race = t.lines.filter((l) => l.startsWith('race: '));
    expect(race).toHaveLength(1);
    expect(race[0]).toMatch(/^race: start n=3 first ready c after 5\d{3} ms \(pool\), losers 2$/);
    expect(t.deck.poolReady('c|0|60')).toBe(true);
    expect(t.deck.poolReady('b|0|60')).toBe(false);
    expect(t.lines.some((l) => /^load: c pool ls=- fb=- md=\d+ cp=\d+ sk=- total=\d+ conc=3 result=ready$/.test(l))).toBe(true);
    // höchstens eine Zeile je Wettlauf
    vi.advanceTimersByTime(5000);
    ready(elsOf(t, 'b')[0]);
    expect(t.lines.filter((l) => l.startsWith('race: '))).toHaveLength(1);
  });

  it('nie zwei Elemente zugleich hörbar: der Verlierer (aktives Element) bleibt pausiert, sobald der Gewinner spielt, nur das neue spielt', async () => {
    const t = setup({ startHedge: false });
    await open(t);
    // der aktive Moment hat play() gerufen, aber ohne Daten: es ist kein Ton zu hören (Nachbau: paused false, kein playing)
    t.deck.fill(cs);
    vi.advanceTimersByTime(RACE_STAGGER_MS + 200);
    ready(elsOf(t, 'c')[0]);
    // der Host stellt um: c wird der aktive Moment (adopt eines bereiten Eintrags, derselbe Weg wie "ready first ... (rescue)")
    const peak: number[] = [];
    const watch = () => peak.push(audible(t).length);
    t.deck.load(clip('c'), t.sink, { play: true, muted: false });
    watch();
    await flush();
    watch();
    vi.advanceTimersByTime(200);
    watch();
    const playing = audible(t);
    expect(playing).toHaveLength(1);
    expect(playing[0].src).toContain('/c.mp3');
    expect(Math.max(...peak)).toBeLessThanOrEqual(1);
    // das überholte aktive Element a ist angehalten, die Messung meldet es als verloren oder verlassen
    expect(elsOf(t, 'a').every((e) => e.paused)).toBe(true);
    expect(t.lines.some((l) => /^load: a active .* result=(lost|dropped)$/.test(l))).toBe(true);
  });

  it('Verlierer des Wettlaufs sind nach dem Wechsel angehalten und frei: kein Element außer dem Gewinner spielt, der überholte Moment lädt als Vorrat neu', async () => {
    const t = setup({ startHedge: false });
    await open(t);
    t.deck.fill(cs);
    vi.advanceTimersByTime(RACE_STAGGER_MS + 200);
    ready(elsOf(t, 'c')[0]);
    t.deck.load(clip('c'), t.sink, { play: true, muted: false });
    await flush();
    vi.advanceTimersByTime(500);
    // genau ein Element hört man, das mit der Quelle des Gewinners
    expect(audible(t).map((e) => e.src)).toEqual(expect.arrayContaining([expect.stringContaining('/c.mp3')]));
    expect(audible(t)).toHaveLength(1);
    // jedes andere Element mit Netz-Quelle ist angehalten (der Verlierer b lädt weiter als Vorrat, a ist wieder Vorrat oder leer)
    expect(net(t).filter((e) => !e.src.includes('/c.mp3')).every((e) => e.paused)).toBe(true);
    // kein Verlierer bleibt als Wettlauf-Ladevorgang offen: die Zeilen "load:" sind abgeschlossen oder laufen als Vorrat
    expect(t.lines.some((l) => /^load: a active .* result=(lost|dropped)$/.test(l))).toBe(true);
  });

  it('im Hintergrund (hidden) startet der Wettlauf keinen Abruf über den Stand von Runde 45 hinaus (gleich viele Ladevorgänge wie mit START_RACE aus), startRacing ist false', async () => {
    const run = async (startRace: boolean) => {
      const t = setup({ startRace, startHedge: false, hidden: true });
      await open(t);
      t.deck.fill(cs);
      vi.advanceTimersByTime(RACE_STAGGER_MS * 3);
      return { t, n: loaded(t).length };
    };
    const on = await run(true);
    const off = await run(false);
    expect(on.n).toBe(off.n);
    expect(on.n).toBeLessThanOrEqual(1);
    expect(on.t.deck.startRacing()).toBe(false);
  });

  it('Weak-Merker (nach langem Warten auf den ersten Ton) drosselt den Wettlauf des nächsten Moments nicht', async () => {
    const t = setup({ startHedge: false });
    await open(t);
    vi.advanceTimersByTime(6000);
    t.els[0].emit('playing');
    expect(t.lines).toContain('deck: weak net, pool one at a time');
    // neuer Moment, noch kein Ton: Wettlauf trotz Merker
    t.deck.load(clip('x'), t.sink, { play: true, muted: false });
    await flush();
    t.els[0].quiet = true;
    t.deck.fill(cs);
    expect(loaded(t)).toEqual(['b']);
    vi.advanceTimersByTime(RACE_STAGGER_MS + 200);
    expect(loaded(t)).toEqual(['b', 'c']);
  });

  it('Elemente ohne bestätigte Freischaltung: das erste Vorrats-Element lädt wie bisher, jeder weitere Wettlauf-Abruf wird gehalten und im Protokoll genannt', async () => {
    const t = setup({ startHedge: false });
    await open(t, false);
    t.deck.fill(cs);
    vi.advanceTimersByTime(RACE_STAGGER_MS + 1000);
    expect(loaded(t)).toEqual(['b']);
    expect(t.lines.filter((l) => /^race: extra load held \(no unlocked element free, \d+\/\d+ unlocked\), n=3$/.test(l))).toHaveLength(1);
  });

  it('nach dem ersten Ton gilt wieder poolBudget: spielend zwei in Arbeit, nicht mehr', async () => {
    const t = setup({ startHedge: false });
    await open(t);
    t.els[0].quiet = false;
    t.els[0].emit('playing');
    t.els[0].readyState = 4;
    t.deck.fill(cs);
    vi.advanceTimersByTime(RACE_STAGGER_MS * 2);
    expect(loaded(t)).toEqual(['b', 'c']);
    expect(t.deck.startRacing()).toBe(false);
  });
});

describe('zweites Element statt Abbruch (START_HEDGE)', () => {
  it('aktives Element nach FRESH_RELOAD_MS noch rs=0: kein Abbruch, dieselbe Quelle lädt in einem freien freigeschalteten Element, Zeile "hedge: ..."', async () => {
    const t = setup();
    await open(t);
    vi.advanceTimersByTime(FRESH_RELOAD_MS + 100);
    expect(t.lines.some((l) => l.includes('fresh reload'))).toBe(false);
    expect(t.lines.some((l) => /^hedge: a active rs=0 after 3\d{3} ms, second element loads the same source, active load kept \(unlocked \d+\/\d+\)/.test(l))).toBe(true);
    const same = elsOf(t, 'a');
    expect(same).toHaveLength(2);
    expect(t.lines.some((l) => /^load: a hedge /.test(l))).toBe(false);
  });

  it('das zweite Element ist zuerst bereit: es übernimmt, das aktive Element wird freigegeben und bleibt stumm, nie zwei hörbar', async () => {
    const t = setup();
    await open(t);
    vi.advanceTimersByTime(FRESH_RELOAD_MS + 100);
    const [first, second] = elsOf(t, 'a');
    vi.advanceTimersByTime(2000);
    ready(second);
    expect(t.lines.some((l) => /^hedge: won a after \d+ ms, active rs=0 released$/.test(l))).toBe(true);
    expect(t.lines.some((l) => /^race: start n=\d+ first ready a after \d+ ms \(hedge\), losers \d+$/.test(l))).toBe(true);
    expect(t.lines.some((l) => /^load: a hedge .* result=ready$/.test(l))).toBe(true);
    expect(t.lines.some((l) => /^load: a active .* result=lost$/.test(l))).toBe(true);
    await flush();
    vi.advanceTimersByTime(100);
    expect(first.paused).toBe(true);
    expect(first.src).toBe('');
    expect(audible(t)).toHaveLength(1);
    expect(audible(t)[0]).toBe(second);
    expect(t.lines.some((l) => l.includes('fresh reload'))).toBe(false);
  });

  it('das aktive Element ist zuerst bereit und spielt: das zweite Element gibt auf, seine Quelle wird freigegeben', async () => {
    const t = setup();
    await open(t);
    vi.advanceTimersByTime(FRESH_RELOAD_MS + 100);
    const [first, second] = elsOf(t, 'a');
    first.quiet = false;
    first.emit('loadedmetadata');
    first.readyState = 4;
    first.emit('canplaythrough');
    first.emit('playing');
    expect(t.lines.some((l) => /^hedge: released a \(active first\)$/.test(l))).toBe(true);
    expect(second.src).toBe('');
    expect(t.lines.some((l) => /^load: a hedge .* result=lost$/.test(l))).toBe(true);
    expect(t.lines.some((l) => /^load: a active .* result=ready$/.test(l))).toBe(true);
    expect(audible(t).every((e) => e === first)).toBe(true);
  });

  it('kein freies freigeschaltetes Element: es bleibt beim frischen Neuladen, der Grund steht im Protokoll', async () => {
    const t = setup();
    await open(t, false);
    vi.advanceTimersByTime(FRESH_RELOAD_MS + 100);
    expect(t.lines.some((l) => /^hedge: skipped a \(no unlocked element free, \d+\/\d+ unlocked\), fresh reload$/.test(l))).toBe(true);
    expect(t.lines.some((l) => /^deck: active not loading a rs=0 after \d+ ms, fresh reload$/.test(l))).toBe(true);
  });

  it('Schalter aus: frisches Neuladen wie Runde 45, kein zweites Element', async () => {
    const t = setup({ startHedge: false });
    await open(t);
    vi.advanceTimersByTime(FRESH_RELOAD_MS + 100);
    expect(t.lines.some((l) => /^deck: active not loading a rs=0 after \d+ ms, fresh reload$/.test(l))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('hedge:'))).toBe(false);
    expect(elsOf(t, 'a')).toHaveLength(1);
  });

  it('Ladefehler des aktiven Elements: der Weg fresh reload bleibt (kein zweites Element)', async () => {
    const t = setup();
    await open(t);
    t.els[0].error = { code: 2 };
    t.els[0].emit('error');
    expect(t.lines.some((l) => l.startsWith('deck: active has load error a, fresh reload'))).toBe(true);
    expect(t.lines.some((l) => l.startsWith('hedge:'))).toBe(false);
  });

  it('beide ohne Metadaten bis HEDGE_FAIL_MS: das zweite gibt auf, die Quelle gilt als tot wie nach "fresh reload failed"', async () => {
    const t = setup();
    await open(t);
    vi.advanceTimersByTime(FRESH_RELOAD_MS + 100);
    vi.advanceTimersByTime(HEDGE_FAIL_MS + 100);
    expect(t.lines.some((l) => /^hedge: released a \(no metadata\)$/.test(l))).toBe(true);
    expect(t.lines.some((l) => /^hedge: failed a after \d+ ms, neither element has metadata$/.test(l))).toBe(true);
    expect(elsOf(t, 'a')).toHaveLength(1);
  });

  it('Moment wechselt, während das zweite Element lädt: es gibt auf', async () => {
    const t = setup();
    await open(t);
    vi.advanceTimersByTime(FRESH_RELOAD_MS + 100);
    t.deck.load(clip('z'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.lines.some((l) => /^hedge: released a \(moment changed\)$/.test(l))).toBe(true);
  });
});
