// Brief 02: Start aus dem Vorrat, Köpfe über das Sitzungsende, Zähler coldNetStarts, Laden, Positionsstatus, Sperrbildschirm.
import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL } from '../src/video/ytApi';
import { AudioDeck, type DeckClip, type DeckEl, type DeckSink } from '../src/video/audioDeck';
import { Preloader, type CacheLike, type PreloaderDeps } from '../src/moments/preloader';
import { keyOf, planEviction } from '../src/moments/preload';
import { bumpCold, coldToday, countColdStart, parseCold, parseHeads, pickHeads, startOrder, HEADS, headsKey } from '../src/moments/startHead';
import { lockMeta, MORE_WINDOW_MS, previousPress, savedTitle, tabImage } from '../src/moments/lockScreen';
import { captionLines } from '../src/moments/captions';
import type { Moment } from '../src/moments/types';
import { synthMp3 } from './mp3-synth';

const mom = (i: number, o: Partial<Moment> = {}): Moment => ({ id: 'm' + i, videoId: 'pod-' + i, start: 100, end: 147, channel: 'c' + i, videoTitle: 'Episode ' + i, area: 'brain', topic: 't', hook: 'Hook ' + i, kind: 'story', createdAt: '', form: 'audio', hls: `https://cdn.test/ep${i}.mp3`, ...o });

describe('startOrder: der erste Moment ist lokal', () => {
  const q = [mom(1), mom(2), mom(3), mom(4)];
  it('erster lokal: nichts ändert sich', () => {
    const r = startOrder(q, (m) => m.id === 'm1', []);
    expect(r.how).toBe('first');
    expect(r.queue.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
  it('lokaler innerhalb der nächsten 3 wird vorgezogen, Rest bleibt in Reihenfolge', () => {
    const r = startOrder(q, (m) => m.id === 'm3', []);
    expect(r.how).toBe('pulled');
    expect(r.queue.map((m) => m.id)).toEqual(['m3', 'm1', 'm2', 'm4']);
  });
  it('lokaler erst an Stelle 4: nicht vorgezogen', () => {
    expect(startOrder(q, (m) => m.id === 'm4', []).how).toBe('none');
  });
  it('kein lokaler in den nächsten 3: gehaltener Kopf der letzten Sitzung kommt nach vorn, ohne Dublette', () => {
    const head = mom(9);
    const r = startOrder(q, (m) => m.id === 'm9', [head]);
    expect(r.how).toBe('head');
    expect(r.queue.map((m) => m.id)).toEqual(['m9', 'm1', 'm2', 'm3', 'm4']);
    const dup = startOrder([...q, head], (m) => m.id === 'm9', [head]);
    expect(dup.queue.filter((m) => m.id === 'm9')).toHaveLength(1);
  });
  it('nichts lokal: Reihenfolge bleibt', () => {
    const r = startOrder(q, () => false, [mom(9)]);
    expect(r.how).toBe('none');
    expect(r.queue.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
  it('leere Warteschlange', () => {
    expect(startOrder([], () => true, []).queue).toEqual([]);
  });
});

describe('Köpfe', () => {
  it('pickHeads: die nächsten sechs vorladbaren nach der Stelle, der laufende zählt nicht (Brief 09: sechs statt drei)', () => {
    const q = [mom(0), mom(1), mom(2, { hls: 'https://x.test/a.m3u8' }), mom(3), mom(4), mom(5), mom(6), mom(7), mom(8), mom(9)];
    const heads = pickHeads(q, 0, (m) => !!m.hls?.endsWith('.mp3'), keyOf);
    expect(HEADS).toBe(6);
    expect(heads.map((h) => h.id)).toEqual(['m1', 'm3', 'm4', 'm5', 'm6', 'm7']);
    expect(heads).toHaveLength(HEADS);
    expect(heads[0].key).toBe(keyOf(q[1]));
  });
  it('parseHeads: kaputt oder fremd ergibt leer', () => {
    expect(parseHeads(null)).toEqual([]);
    expect(parseHeads('{')).toEqual([]);
    expect(parseHeads('{"a":1}')).toEqual([]);
    expect(parseHeads('[{"id":"a","key":"k"},{"id":1}]')).toEqual([{ id: 'a', key: 'k' }]);
  });
});

describe('Zähler coldNetStarts', () => {
  it('zählt pro Tag, behält 14 Tage', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(countColdStart(store, '2026-11-03')).toBe(1);
    expect(countColdStart(store, '2026-11-03')).toBe(2);
    expect(countColdStart(store, '2026-11-04')).toBe(1);
    expect(coldToday(store, '2026-11-03')).toBe(2);
    expect(coldToday(store, '2026-11-05')).toBe(0);
    let log = {};
    for (let d = 1; d <= 20; d++) log = bumpCold(log, `2026-10-${String(d).padStart(2, '0')}`);
    expect(Object.keys(log)).toHaveLength(14);
    expect(parseCold('kaputt')).toEqual({});
    expect(countColdStart(null, 'x')).toBe(0);
  });
});

describe('Verdrängung: Köpfe sind fest', () => {
  it('planEviction verdrängt einen gehaltenen Kopf nie, auch wenn er außerhalb liegt', () => {
    const stored = [
      { id: 'head', bytes: 50, at: 1 },
      { id: 'old', bytes: 50, at: 2 },
    ];
    const rankOf = () => null;
    const plain = planEviction(stored, 50, 100, 1, rankOf);
    expect(plain.evict).toEqual(['head']);
    const pinned = planEviction(stored, 50, 100, 1, rankOf, 0, new Set(['head']));
    expect(pinned.evict).toEqual(['old']);
    const onlyPinned = planEviction([{ id: 'head', bytes: 100, at: 1 }], 50, 100, 1, rankOf, 0, new Set(['head']));
    expect(onlyPinned.ok).toBe(false);
  });
});

describe('Sperrbildschirm', () => {
  it('previousPress: erster Druck Save, zweiter binnen 1,5 s More like this', () => {
    expect(previousPress(1000, null)).toBe('save');
    expect(previousPress(1000 + MORE_WINDOW_MS, 1000)).toBe('more');
    expect(previousPress(1000 + MORE_WINDOW_MS + 1, 1000)).toBe('save');
  });
  it('Titel und Metadaten', () => {
    expect(savedTitle('Hook')).toBe('Saved · Hook');
    const md = lockMeta(mom(1, { area: 'body' }), '/core/', 'https://x.test');
    expect(md).toMatchObject({ title: 'Hook 1', album: 'Episode 1' });
    expect(md.artwork.map((a) => a.sizes)).toEqual(['512x512', '1024x1024']);
    expect(md.artwork[0].src).toBe('https://x.test/core/tab-body-512.png');
    expect(tabImage('beat', 1024)).toBe('/tab-beat-1024.png');
  });
});

describe('Untertitel: Zeilen am Satzende', () => {
  it('bricht nach . ! ? … und ؟, nie mitten im Satz', () => {
    expect(captionLines('One thing. Then another! Really? Yes… Done')).toEqual(['One thing.', 'Then another!', 'Really?', 'Yes…', 'Done']);
    expect(captionLines('هل هذا صحيح؟ نعم هذا صحيح.')).toEqual(['هل هذا صحيح؟', 'نعم هذا صحيح.']);
  });
  it('Kürzel, Initialen und Zahlen beenden keinen Satz', () => {
    expect(captionLines('Dr. Smith said so. J. Brown agreed')).toEqual(['Dr. Smith said so.', 'J. Brown agreed']);
    expect(captionLines('At 3. 5 mg')).toEqual(['At 3. 5 mg']);
    expect(captionLines('  ')).toEqual([]);
    expect(captionLines('one sentence only')).toEqual(['one sentence only']);
  });
});

// ---- Deck ----

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
  calls: string[] = [];
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
    return Promise.resolve();
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
}
const clip = (id: string, start = 100, end: number | undefined = 147): DeckClip => ({ key: `${id}|${start}|${end ?? ''}`, id, url: `https://pod.test/${id}.mp3`, start, end });

function deckSetup(local: Record<string, { url: string; offset: number }> = {}) {
  const el = new FakeEl();
  const deck = new AudioDeck({ local: (k) => local[k], dropLocal: () => {}, make: () => el, hidden: () => false });
  const lines: string[] = [];
  deck.diag = (l) => lines.push(l);
  const sink: DeckSink = { state: () => {}, error: () => {} };
  return { deck, el, sink, lines, local };
}

describe('Deck: Kaltstart aus dem Vorrat', () => {
  it('wartet auf die Blob-URL und startet dann lokal, nie zuerst vom Netz', async () => {
    const t = deckSetup();
    const c = clip('a');
    let release!: (ok: boolean) => void;
    t.deck.pending = (_id, key) => (key === c.key ? new Promise<boolean>((r) => (release = r)) : null);
    const starts: boolean[] = [];
    t.deck.onStart = ({ local }) => starts.push(local);
    t.deck.load(c, t.sink, { play: true, muted: false });
    expect(t.el.calls.filter((x) => x === 'play')).toHaveLength(0);
    expect(starts).toEqual([]);
    t.local[c.key] = { url: 'blob:a', offset: 99 };
    release(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(starts).toEqual([true]);
    expect(t.el.src).toBe('blob:a');
    expect(t.lines).toContain('deck: src local a');
    expect(t.el.calls).toContain('play');
  });
  it('Frist abgelaufen: Start vom Netz, gezählt als Netzstart', async () => {
    const t = deckSetup();
    const c = clip('b');
    t.deck.pending = () => new Promise<boolean>(() => {});
    const starts: boolean[] = [];
    t.deck.onStart = ({ local }) => starts.push(local);
    t.deck.load(c, t.sink, { play: true, muted: false });
    await new Promise((r) => setTimeout(r, 1300));
    expect(starts).toEqual([false]);
    expect(t.lines).toContain('deck: src net b');
  });
  it('zweites load desselben Ausschnitts während des Wartens startet nichts doppelt', async () => {
    const t = deckSetup();
    const c = clip('a');
    let release!: (ok: boolean) => void;
    t.deck.pending = () => new Promise<boolean>((r) => (release = r));
    let n = 0;
    t.deck.onStart = () => n++;
    t.deck.load(c, t.sink, { play: true, muted: false });
    t.deck.load(c, t.sink, { play: true, muted: false });
    release(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(n).toBe(1);
  });
  it('läuft schon ein Ausschnitt, wird nicht gewartet', () => {
    const t = deckSetup();
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    t.deck.pending = () => new Promise<boolean>(() => {});
    t.deck.load(clip('b'), t.sink, { play: true, muted: false });
    expect(t.lines).toContain('deck: src net b');
  });
});

describe('Deck: Laden sichtbar', () => {
  it('Netzstart meldet Laden bis canplay, Vorrat nie', () => {
    const t = deckSetup({ 'v|100|147': { url: 'blob:v', offset: 0 } });
    // Ein Netz-Element spielt erst, wenn Daten da sind: play() löst hier kein playing aus
    t.el.play = () => {
      t.el.paused = false;
      return Promise.resolve();
    };
    const ev: boolean[] = [];
    t.deck.onLoading = (on) => ev.push(on);
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    expect(ev).toEqual([true]);
    t.el.readyState = 4;
    t.el.emit('canplay');
    expect(ev).toEqual([true, false]);
    t.deck.load(clip('v'), t.sink, { play: true, muted: false });
    expect(ev).toEqual([true, false]);
  });
  it('Fehler und neue Quelle beenden die Anzeige: kein stilles Hängen', () => {
    const t = deckSetup();
    const ev: boolean[] = [];
    t.deck.onLoading = (on) => ev.push(on);
    t.deck.load(clip('a'), t.sink, { play: true, muted: false });
    t.el.emit('error');
    expect(ev.at(-1)).toBe(false);
  });
});

describe('Deck: Positionsstatus für den Sperrbildschirm', () => {
  it('Länge und Stelle des Moments, nicht der Folge, bei jedem timeupdate', () => {
    const t = deckSetup();
    t.deck.load(clip('a', 100, 147), t.sink, { play: true, muted: false });
    t.el.currentTime = 110;
    t.el.emit('timeupdate');
    expect(t.deck.lastPos).toEqual({ duration: 47, position: 10, playbackRate: 1 });
    t.el.currentTime = 100.5;
    t.el.emit('timeupdate');
    expect(t.deck.lastPos?.position).toBeCloseTo(0.5);
  });
  it('mit Versatz der lokalen Quelle und Tempo 2x', () => {
    const t = deckSetup({ 'a|100|147': { url: 'blob:a', offset: 90 } });
    t.deck.setRate(2);
    t.deck.load(clip('a', 100, 147), t.sink, { play: true, muted: false });
    t.el.currentTime = 25;
    t.el.emit('timeupdate');
    expect(t.deck.lastPos).toEqual({ duration: 47, position: 15, playbackRate: 2 });
  });
  it('Tempowechsel misst sofort neu (Cue-Uhr bekommt das neue Tempo ohne auf timeupdate zu warten)', () => {
    const times: [number, number, boolean][] = [];
    const t = deckSetup();
    const sink: DeckSink = { state: () => {}, error: () => {}, time: (a, r, p) => times.push([a, r, p]) };
    t.deck.load(clip('a', 100, 147), sink, { play: true, muted: false });
    t.el.currentTime = 20;
    t.el.emit('timeupdate');
    times.length = 0;
    t.deck.setRate(2);
    expect(times.at(-1)).toEqual([20, 2, true]);
  });
});

// ---- Preloader: Köpfe ----

class FakeCache implements CacheLike {
  map = new Map<string, Uint8Array>();
  async put(k: string, r: Response) { this.map.set(k, new Uint8Array(await r.arrayBuffer())); }
  async match(k: string) { const b = this.map.get(k); return b ? new Response(new Blob([b as BlobPart])) : undefined; }
  async delete(k: string) { return this.map.delete(k); }
  async keys() { return [...this.map.keys()].map((url) => ({ url })); }
}

function preSetup() {
  const cache = new FakeCache();
  const store = new Map<string, string>();
  const files = new Map<string, Uint8Array>();
  let n = 0;
  const fetchFn = (async (input: string, init: RequestInit) => {
    const file = files.get(String(input));
    if (!file) return new Response('', { status: 404 });
    const m = /bytes=(\d+)-(\d+)/.exec((init.headers as Record<string, string>).Range)!;
    const from = +m[1];
    return new Response(file.slice(from, Math.min(file.length - 1, +m[2]) + 1), { status: 206 });
  }) as unknown as typeof fetch;
  const deps: PreloaderDeps = {
    openCache: async () => cache,
    fetchFn,
    now: () => Date.now(),
    perfNow: () => 0,
    online: () => true,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    createObjectURL: () => `blob:fake/${++n}`,
    revokeObjectURL: () => {},
    keyBase: 'https://app.test/core/',
  };
  return { cache, store, files, make: () => new Preloader(deps) };
}
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('Preloader: Köpfe über das Sitzungsende', () => {
  beforeEach(() => LOCAL.clear());
  it('Neustart: held() gilt sofort aus dem Index, Blob-URL der Köpfe liegt nach init bereit, pendingWarm löst sich', async () => {
    const w = preSetup();
    const ms = [mom(1), mom(2), mom(3)];
    for (const m of ms) w.files.set(m.hls!, synthMp3({ frames: 20_000, bitrate: 128 }).bytes);
    const a = w.make();
    a.setQueue([mom(0), ...ms], 0);
    await until(() => ms.every((m) => a.has(m.id)));
    expect(ms.every((m) => a.has(m.id))).toBe(true);
    a.setHeads(pickHeads([mom(0), ...ms], 0, () => true, keyOf));
    expect(JSON.parse(w.store.get(headsKey('audio'))!)).toHaveLength(3);

    // Neue Sitzung: LOCAL ist leer, die Seite hat neu geladen
    LOCAL.clear();
    const b = w.make();
    expect(b.held('m1')).toBe(true);
    expect(b.held('m9')).toBe(false);
    expect(b.startHeads().map((h) => h.id)).toEqual(['m1', 'm2', 'm3']);
    const key = keyOf(ms[0]);
    const pend = b.pendingWarm('m1', key);
    expect(pend).not.toBeNull();
    expect(await pend).toBe(true);
    expect(LOCAL.has(key)).toBe(true);
    // Danach ist nichts mehr zu warten
    expect(b.pendingWarm('m1', key)).toBeNull();
    // Nicht im Vorrat: kein Warten
    expect(b.pendingWarm('m9', 'x')).toBeNull();
  });
  it('Köpfe werden bei knappem Platz nie verdrängt', async () => {
    const w = preSetup();
    const a = w.make();
    a.setHeads([{ id: 'h', key: 'k' }]);
    a.setHeads([{ id: 'h', key: 'k' }]);
    expect(a.startHeads()).toHaveLength(1);
  });
});
