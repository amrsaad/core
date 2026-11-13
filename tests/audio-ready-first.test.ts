// Runde 8: fertig zuerst. Max' Diag 12.11. 18:00 zeigte kalte Starts (Barbell, 2 bis 5 s bis zum ersten Byte), während zwei Iron-Culture-Einträge bereit im Vorrat lagen.
// Der Plan (readyFirstPlan) ist eine reine Umordnung, das Deck hält die Einträge. Die Entscheidung im Feed (goTo, Tipp, Rettung) benutzt beide.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeck, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';
import { readyFirstPlan } from '../src/moments/startHead';

const ALLOWED = new Set(['pointerup', 'touchend', 'click', 'keydown']);
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
  played = false;
  private tok = 0;
  private on = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const f of this.on.get(type) ?? []) f();
  }
  play() {
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

const clip = (id: string): DeckClip => ({ key: `${id}|0|60`, id, url: `https://${id === 'slow' ? 'barbell' : 'iron'}.test/${id}.mp3`, start: 0, end: 60 });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup() {
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
    hidden: () => false,
    lane: () => ({ lane: 'plain', why: 'no value' }),
    chain: () => ({ linear: () => 1 }),
  });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, els, lines, sink };
}
type T = ReturnType<typeof setup>;
const elOf = (t: T, id: string) => t.els.find((x) => x.src.includes(`/${id}.mp3`))!;
/** Eintrag bereit machen: Metadaten und genug Daten */
const makeReady = (t: T, id: string) => {
  const e = elOf(t, id);
  e.emit('loadedmetadata');
  e.readyState = 4;
  e.emit('canplaythrough');
};
async function tap(t: T) {
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click']) {
    ev = type;
    t.deck.unlock(type);
    ev = 'none';
    await flush();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  ev = 'none';
});
afterEach(() => {
  vi.useRealTimers();
});

type M = { id: string };
const q = (...ids: string[]): M[] => ids.map((id) => ({ id }));
const ids = (l: readonly M[]) => l.map((m) => m.id);

describe('readyFirstPlan (Plan)', () => {
  it('(a) nächster nicht bereit, übernächster bereit: der bereite rückt vor, der übergangene steht direkt dahinter, der Rest bleibt', () => {
    const ready = new Set(['c', 'd']);
    const r = readyFirstPlan(q('cur', 'a', 'b', 'c', 'd', 'e'), 1, (m) => ready.has(m.id));
    expect(r.how).toBe('pulled');
    expect(r.id).toBe('c');
    expect(r.over).toBe('a');
    expect(ids(r.queue)).toEqual(['cur', 'c', 'a', 'b', 'd', 'e']);
  });

  it('(b) nächster bereit: nichts ändert sich, auch wenn spätere bereit sind', () => {
    const ready = new Set(['a', 'c']);
    const r = readyFirstPlan(q('cur', 'a', 'b', 'c'), 1, (m) => ready.has(m.id));
    expect(r.how).toBe('planned');
    expect(ids(r.queue)).toEqual(['cur', 'a', 'b', 'c']);
  });

  it('(c) nichts bereit: nichts ändert sich', () => {
    const r = readyFirstPlan(q('cur', 'a', 'b', 'c'), 1, () => false);
    expect(r.how).toBe('none');
    expect(ids(r.queue)).toEqual(['cur', 'a', 'b', 'c']);
  });

  it('keine Stelle in der Warteschlange: none', () => {
    expect(readyFirstPlan(q('cur'), 1, () => true).how).toBe('none');
  });

  it('(d) Rettung: ein schon gerettet-von-Moment ist kein Kandidat (nichts pendelt), sonst wählt der Plan den ersten zulässigen bereiten', () => {
    const ready = new Set(['a', 'b']);
    const rescued = new Set(['a']);
    const r = readyFirstPlan(q('slow', 'x', 'a', 'b'), 0, (m) => ready.has(m.id), (m) => !rescued.has(m.id));
    expect(r.id).toBe('b');
    expect(ids(r.queue)).toEqual(['b', 'slow', 'x', 'a']);
  });

  it('(e) der übergangene Moment bleibt in der Warteschlange, es kommt keiner dazu und keiner fällt weg', () => {
    const input = q('cur', 'a', 'b', 'c', 'd');
    const r = readyFirstPlan(input, 1, (m) => m.id === 'd');
    expect([...ids(r.queue)].sort()).toEqual([...ids(input)].sort());
    expect(r.queue.indexOf(r.queue.find((m) => m.id === 'a')!)).toBe(r.queue.findIndex((m) => m.id === 'd') + 1);
    // die Eingabe bleibt unverändert
    expect(ids(input)).toEqual(['cur', 'a', 'b', 'c', 'd']);
  });
});

describe('Deck und Plan zusammen (Vorrat)', () => {
  async function boot(): Promise<T> {
    const t = setup();
    t.deck.load(clip('now'), t.sink, { play: true, muted: false });
    await flush();
    // Runde 12: der aktive Ausschnitt hat Daten (readyState 3), sonst stellt der Vorrat alle Netz-Abrufe bis auf einen zurück (das prüft audio-pool-adopt.test.ts)
    t.els[0].readyState = 3;
    // Vorrat: der planmäßig nächste ist der langsame Barbell-Moment, dahinter zwei schnelle
    t.deck.fill([clip('slow'), clip('f1'), clip('f2')]);
    return t;
  }

  it('(a) der Wisch spielt den bereiten, der langsame Eintrag lebt weiter und wird nicht verworfen', async () => {
    const t = await boot();
    makeReady(t, 'f1');
    makeReady(t, 'f2');
    const ready = (id: string) => t.deck.poolReady(clip(id).key);
    const plan = readyFirstPlan(q('now', 'slow', 'f1', 'f2'), 1, (m) => ready(m.id));
    expect(ids(plan.queue)).toEqual(['now', 'f1', 'slow', 'f2']);
    t.lines.length = 0;
    // goTo lädt den Moment an Stelle 1 (jetzt f1): Tausch, kein Netzstart
    t.deck.load(clip('f1'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.lines.some((l) => /^deck: swap f1 ready=true/.test(l))).toBe(true);
    expect(t.lines.some((l) => /src net/.test(l))).toBe(false);
    expect(t.lines.some((l) => /pool dropped/.test(l))).toBe(false);
    expect(t.deck.poolInfo().map((p) => p.id)).toContain('slow');
    // Das nächste Füllen mit der neuen Reihenfolge behält ihn
    t.deck.fill([clip('slow'), clip('f2')]);
    expect(t.deck.poolInfo().map((p) => p.id)).toEqual(['slow', 'f2']);
    expect(t.lines.some((l) => /pool dropped slow/.test(l))).toBe(false);
    // Sobald er bereit ist, kommt er dran
    makeReady(t, 'slow');
    expect(t.deck.poolReady(clip('slow').key)).toBe(true);
    const next = readyFirstPlan(plan.queue, 2, (m) => ready(m.id));
    expect(next.how).toBe('planned');
    expect(next.id).toBe('slow');
  });

  it('ohne den Plan wäre der Wisch auf den langsamen Eintrag früher ein kalter Start gewesen (Befund 18:00), Runde 12: das Element des Eintrags wird übernommen, nichts wird verworfen', async () => {
    const t = await boot();
    makeReady(t, 'f1');
    t.lines.length = 0;
    const slowEl = elOf(t, 'slow');
    t.deck.load(clip('slow'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.lines.some((l) => /pool dropped slow/.test(l))).toBe(false);
    expect(t.lines.some((l) => /src net slow/.test(l))).toBe(false);
    expect(t.lines.some((l) => /^deck: pool adopt slow rs=0 meta=false after \d+ ms$/.test(l))).toBe(true);
    expect(t.deck.element).toBe(slowEl);
  });

  it('(b) der planmäßig nächste ist bereit: Plan unverändert, Tausch auf ihn', async () => {
    const t = await boot();
    makeReady(t, 'slow');
    makeReady(t, 'f1');
    const plan = readyFirstPlan(q('now', 'slow', 'f1', 'f2'), 1, (m) => t.deck.poolReady(clip(m.id).key));
    expect(plan.how).toBe('planned');
    t.deck.load(clip('slow'), t.sink, { play: true, muted: false });
    await flush();
    expect(t.lines.some((l) => /^deck: swap slow ready=true/.test(l))).toBe(true);
  });

  it('(c) nichts bereit: der Plan ändert nichts, der Start bleibt wie bisher', async () => {
    const t = await boot();
    const plan = readyFirstPlan(q('now', 'slow', 'f1', 'f2'), 1, (m) => t.deck.poolReady(clip(m.id).key));
    expect(plan.how).toBe('none');
    expect(t.deck.poolReady()).toBe(false);
  });

  it('(d) Rettung auf iOS: nur ein schon freigeschaltetes Element zählt, ein nie gespieltes nicht', async () => {
    const t = setup();
    t.deck.load(clip('now'), t.sink, { play: true, muted: false });
    await flush();
    // Runde 12: aktiver Ausschnitt mit Daten, sonst stellt der Vorrat die Netz-Abrufe bis auf einen zurück
    t.els[0].readyState = 3;
    t.deck.fill([clip('slow'), clip('f1'), clip('f2')]);
    makeReady(t, 'f1');
    makeReady(t, 'f2');
    // Noch keine Geste: bereit, aber nicht freigeschaltet
    expect(t.deck.poolReady(clip('f1').key)).toBe(true);
    expect(t.deck.poolReady(clip('f1').key, true)).toBe(false);
    expect(t.deck.poolReady(undefined, true)).toBe(false);
    await tap(t);
    expect(t.deck.poolReady(clip('f1').key, true)).toBe(true);
    expect(t.deck.poolReady(clip('f2').key, true)).toBe(true);
    // Der Plan der Rettung (Stelle 0 ist der kalte Kopf) nimmt den ersten freigeschalteten bereiten
    const rescued = new Set<string>();
    const ready = (m: M) => t.deck.poolReady(clip(m.id).key, true);
    const r = readyFirstPlan(q('slow', 'f1', 'f2'), 0, ready, (m) => !rescued.has(m.id));
    expect(r.id).toBe('f1');
    expect(r.over).toBe('slow');
    expect(ids(r.queue)).toEqual(['f1', 'slow', 'f2']);
    // Höchstens einmal je Moment: der Feed merkt den Kopf, dann gibt es für ihn keine zweite Rettung
    rescued.add('slow');
    expect(rescued.has('slow')).toBe(true);
  });

  it('Diag: "pool ready" nennt den Host der Quelle', async () => {
    const t = await boot();
    makeReady(t, 'slow');
    makeReady(t, 'f1');
    expect(t.lines.some((l) => /^deck: pool ready slow after \d+ ms host=barbell\.test$/.test(l))).toBe(true);
    expect(t.lines.some((l) => /^deck: pool ready f1 after \d+ ms host=iron\.test$/.test(l))).toBe(true);
  });
});
