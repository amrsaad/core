import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL } from '../src/video/ytApi';
import { CACHE_NAME, Preloader, type CacheLike, type PreloaderDeps } from '../src/moments/preloader';
import { PRELOAD_CAP_BYTES } from '../src/moments/preload';
import { keyOf } from '../src/moments/preload';
import type { Moment } from '../src/moments/types';
import { synthMp3 } from './mp3-synth';

class FakeCache implements CacheLike {
  map = new Map<string, Uint8Array>();
  async put(k: string, r: Response) { this.map.set(k, new Uint8Array(await r.arrayBuffer())); }
  async match(k: string) { const b = this.map.get(k); return b ? new Response(new Blob([b as BlobPart])) : undefined; }
  async delete(k: string) { return this.map.delete(k); }
  async keys() { return [...this.map.keys()].map((url) => ({ url })); }
}

interface World {
  files: Map<string, Uint8Array>;
  calls: { url: string; range: string; priority?: string }[];
  bytesServed: number;
  online: boolean;
  failHosts: Set<string>;
  clock: number;
  perf: number;
  delayMs: number;
  /** Die nächsten so vielen Abrufe antworten nie (iOS hält sie zurück), reagieren aber auf den Abbruch */
  hang: number;
  /** Netz weg mitten in der Antwort: Länge angekündigt, aber weniger Bytes geliefert */
  truncate?: boolean;
}

function setup(extra: Partial<PreloaderDeps> = {}): { w: World; cache: FakeCache; store: Map<string, string>; make: () => Preloader; revoked: string[] } {
  const w: World = { files: new Map(), calls: [], bytesServed: 0, online: true, failHosts: new Set(), clock: 1000, perf: 0, delayMs: 0, hang: 0 };
  const cache = new FakeCache();
  const store = new Map<string, string>();
  const revoked: string[] = [];
  let n = 0;
  const fetchFn = (async (input: string, init: RequestInit) => {
    const url = String(input);
    const range = (init.headers as Record<string, string>).Range;
    w.calls.push({ url, range, priority: (init as RequestInit & { priority?: string }).priority });
    const host = new URL(url).host;
    if (w.failHosts.has(host)) throw new TypeError('Failed to fetch');
    if (w.hang > 0) {
      w.hang--;
      return new Promise<Response>((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    }
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const file = w.files.get(url);
    if (!file) return new Response('', { status: 404 });
    const m = /bytes=(\d+)-(\d+)/.exec(range)!;
    const from = +m[1];
    const to = Math.min(file.length - 1, +m[2]);
    if (from >= file.length) return new Response('', { status: 416 });
    const body = file.slice(from, to + 1);
    w.bytesServed += body.length;
    w.perf += w.delayMs;
    if (w.truncate && body.length > 100) return new Response(body.slice(0, body.length - 50), { status: 206, headers: { 'content-length': String(body.length) } });
    return new Response(body, { status: 206 });
  }) as unknown as typeof fetch;
  const deps: PreloaderDeps = {
    openCache: async () => cache,
    fetchFn,
    now: () => w.clock++,
    perfNow: () => w.perf,
    online: () => w.online,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    createObjectURL: () => `blob:fake/${++n}`,
    revokeObjectURL: (u) => void revoked.push(u),
    keyBase: 'https://app.test/core/',
    ...extra,
  };
  return { w, cache, store, make: () => new Preloader(deps), revoked };
}

const mom = (i: number, o: Partial<Moment> = {}): Moment => ({ id: 'm' + i, videoId: 'pod-' + i, start: 100, end: 147, channel: 'c', videoTitle: '', area: 'brain', topic: 't', hook: '', kind: 'story', createdAt: '', form: 'audio', hls: `https://cdn${o.hls ?? ''}.test/ep${i}.mp3`, ...o });
const settle = async (p: Preloader, ms = 60) => {
  for (let i = 0; i < ms; i++) await new Promise((r) => setTimeout(r, 2));
  await p.whenReady();
};
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('Preloader: Ausschnitte in die Cache API', () => {
  beforeEach(() => LOCAL.clear());

  it('lädt nur den Ausschnitt per Range, in Reihenfolge der Warteschlange, ohne Text, YouTube, m3u8', async () => {
    const { w, cache, make } = setup();
    const file = synthMp3({ frames: 60_000, id3: 300 }).bytes; // etwa 26 Minuten bei 128 kbps
    const q: Moment[] = [mom(0), mom(1), { ...mom(2), form: 'text', hls: undefined, videoId: 'txt-2' }, { ...mom(3), hls: undefined, videoId: 'abcdefghi03', form: 'video' }, mom(4, { hls: 'https://cdn.test/x.m3u8' }), mom(5)];
    for (const m of q) if (m.hls?.endsWith('.mp3')) w.files.set(m.hls, file);
    const p = make();
    p.setQueue(q, 0);
    await until(() => p.ids().length === 2);
    await settle(p, 5);
    expect(p.ids().sort()).toEqual(['m1', 'm5']);
    // nur die Ausschnitte, nicht die 26 Minuten (je Moment 16 kB Kopf plus etwa 48 s)
    expect(w.bytesServed).toBeLessThan(2 * (16384 + 49 * 16000 * 1.1));
    expect(w.calls.every((c) => /^bytes=\d+-\d+$/.test(c.range))).toBe(true);
    expect(cache.map.size).toBe(2);
    expect(p.stats().n).toBe(2);
    // 2 Ausschnitte à etwa 49 s bei 16 kB/s
    expect(p.stats().bytes).toBeGreaterThan(1_400_000);
    expect(p.stats().bytes).toBeLessThan(1_700_000);
  });

  it('Tempo 2x: der Vorrat reicht doppelt so weit voraus (Zeitfenster), bei 1x bleibt es bei 30', async () => {
    const file = synthMp3({ frames: 20_000, bitrate: 128 }).bytes;
    const q = Array.from({ length: 80 }, (_, i) => mom(i));
    const ids = async (rate: number) => {
      const { w, make } = setup();
      for (const m of q) w.files.set(m.hls!, file);
      const p = make();
      p.setQueue(q, 0, rate);
      await until(() => p.ids().length >= (rate === 1 ? 30 : 60));
      await settle(p, 70);
      return p.ids().length;
    };
    expect(await ids(1)).toBe(30);
    expect(await ids(2)).toBe(60);
  });

  it('Warmset wächst mit dem Tempo: 5 Momente voraus bei 1x, 10 bei 2x', () => {
    const { make } = setup();
    const p = make();
    const q = Array.from({ length: 30 }, (_, i) => mom(i));
    expect(p.warmSet(q, 10).map((m) => m.id)).toEqual(['m7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15']);
    expect(p.warmSet(q, 10, 2)).toHaveLength(3 + 1 + 10);
  });

  it('Obergrenze 60 MB: nie darüber, das Nächste bleibt, das Ferne wird nicht für Nahes geopfert', async () => {
    const { w, make } = setup();
    const file = synthMp3({ frames: 20_000, bitrate: 320, sampleRate: 44100 }).bytes; // 320 kbps, etwa 8 Minuten
    const q = Array.from({ length: 36 }, (_, i) => mom(i));
    for (const m of q) w.files.set(m.hls!, file);
    const p = make();
    p.setQueue(q, 0);
    await until(() => p.ids().length >= 30);
    await settle(p, 40);
    const st = p.stats();
    expect(st.bytes).toBeLessThanOrEqual(PRELOAD_CAP_BYTES);
    expect(p.has('m1')).toBe(true);
    // 36 Momente à etwa 1,9 MB passen nicht, die hinteren fehlen, nicht die vorderen
    expect(p.ids().length).toBeLessThan(31);
    const have = new Set(p.ids());
    const maxHave = Math.max(...[...have].map((id) => +id.slice(1)));
    for (let i = 1; i <= maxHave; i++) expect(have.has('m' + i)).toBe(true);
  });

  it('wandert das Fenster weiter, geht Gespieltes zuerst, das Älteste', async () => {
    const { w, make } = setup();
    const file = synthMp3({ frames: 20_000, bitrate: 320 }).bytes;
    const q = Array.from({ length: 80 }, (_, i) => mom(i));
    for (const m of q) w.files.set(m.hls!, file);
    const p = make();
    p.setQueue(q, 0);
    await until(() => p.ids().length >= 28);
    await settle(p, 40);
    const before = p.ids();
    expect(before).toContain('m1');
    p.setQueue(q, 20); // 1 bis 20 gespielt
    await until(() => p.has('m45'));
    await settle(p, 40);
    expect(p.stats().bytes).toBeLessThanOrEqual(PRELOAD_CAP_BYTES);
    expect(p.has('m21')).toBe(true);
    expect(p.has('m1')).toBe(false);
    // die Neuen im Fenster 21 bis 50 sind da, soweit Platz ist
    expect(p.has('m22')).toBe(true);
  });

  it('Host ohne CORS wird nach zwei Fehlschlägen gesperrt, andere laufen weiter', async () => {
    const { w, make } = setup();
    const file = synthMp3({ frames: 20_000 }).bytes;
    const q = [mom(0), mom(1, { hls: 'https://blocked.test/a.mp3' }), mom(2, { hls: 'https://blocked.test/b.mp3' }), mom(3, { hls: 'https://blocked.test/c.mp3' }), mom(4)];
    for (const m of q) w.files.set(m.hls!, file);
    w.failHosts.add('blocked.test');
    const p = make();
    p.setQueue(q, 0);
    await until(() => p.has('m4'));
    await settle(p, 10);
    expect(p.ids()).toEqual(['m4']);
    // drei laufen gleichzeitig los, mehr als diese drei Fehlschläge gibt es nicht
    expect(w.calls.filter((c) => c.url.includes('blocked.test')).length).toBeLessThanOrEqual(3);
    expect(p.whyNot(q[3])).toBe('host');
  });

  it('VBR wird nicht vorgeladen und hält die anderen nicht auf', async () => {
    const { w, make } = setup();
    w.files.set('https://cdn.test/ep1.mp3', synthMp3({ frames: 3000, tag: 'xing' }).bytes);
    w.files.set('https://cdn.test/ep2.mp3', synthMp3({ frames: 20_000 }).bytes);
    const q = [mom(0), mom(1), mom(2)];
    const p = make();
    p.setQueue(q, 0);
    await until(() => p.has('m2'));
    expect(p.whyNot(q[1])).toBe('vbr');
    expect(p.has('m1')).toBe(false);
  });

  it('offline wird nicht geladen, online geht es weiter', async () => {
    const { w, make } = setup();
    w.files.set('https://cdn.test/ep1.mp3', synthMp3({ frames: 20_000 }).bytes);
    w.online = false;
    const p = make();
    p.setQueue([mom(0), mom(1)], 0);
    await settle(p, 10);
    expect(w.calls).toHaveLength(0);
    expect(p.poor()).toBe(true);
    w.online = true;
    p.resume();
    await until(() => p.has('m1'));
    expect(p.has('m1')).toBe(true);
    expect(p.poor()).toBe(false);
  });

  it('abgebrochene Antwort wird nie als Teilstück abgelegt und zählt nicht gegen den Host (Issue 9)', async () => {
    const { w, cache, make } = setup();
    w.files.set('https://cdn.test/ep1.mp3', synthMp3({ frames: 20_000 }).bytes);
    w.truncate = true;
    const p = make();
    p.setQueue([mom(0), mom(1)], 0);
    await settle(p, 40);
    expect(p.has('m1')).toBe(false);
    expect(cache.map.size).toBe(0);
    expect(p.log.some((l) => /fail m1 truncated/.test(l))).toBe(true);
    // Der Host bleibt offen: ein abgebrochener Abruf ist kein CORS- oder Range-Problem
    expect(p.whyNot(mom(1))).not.toBe('host');
  });

  it('Index und Cache überleben einen Neustart, Verwaiste werden geräumt', async () => {
    const { w, cache, store, make } = setup();
    w.files.set('https://cdn.test/ep1.mp3', synthMp3({ frames: 20_000 }).bytes);
    const p1 = make();
    p1.setQueue([mom(0), mom(1)], 0);
    await until(() => p1.has('m1'));
    cache.map.set('https://app.test/core/__preload/orphan', new Uint8Array(10));
    const p2 = make();
    await p2.whenReady();
    expect(p2.ids()).toEqual(['m1']);
    expect(cache.map.has('https://app.test/core/__preload/orphan')).toBe(false);
    expect(store.get('core.preload.v1')).toContain('m1');
    // kein neuer Abruf nötig
    const n = w.calls.length;
    p2.setQueue([mom(0), mom(1)], 0);
    await settle(p2, 10);
    expect(w.calls.length).toBe(n);
  });

  it('warm legt Blob-URL mit Versatz für den Player an, trimWarm gibt sie wieder frei', async () => {
    const { w, make, revoked } = setup();
    w.files.set('https://cdn.test/ep1.mp3', synthMp3({ frames: 20_000 }).bytes);
    const q = [mom(0), mom(1)];
    const p = make();
    p.setQueue(q, 0);
    await until(() => p.has('m1'));
    await p.warm([q[1]]);
    const loc = LOCAL.get(keyOf(q[1]));
    expect(loc?.url).toMatch(/^blob:fake\//);
    expect(loc!.offset).toBeGreaterThan(99.7);
    expect(loc!.offset).toBeLessThan(100);
    p.trimWarm(new Set());
    expect(LOCAL.has(keyOf(q[1]))).toBe(false);
    expect(revoked).toEqual([loc!.url]);
  });

  it('Antwortzeiten der Abrufe fließen ins Netzmaß, Starts aus dem Vorrat nicht', async () => {
    const { w, make } = setup();
    w.files.set('https://cdn.test/ep1.mp3', synthMp3({ frames: 20_000 }).bytes);
    w.files.set('https://cdn.test/ep3.mp3', synthMp3({ frames: 20_000 }).bytes);
    w.delayMs = 1500;
    const p = make();
    p.recordStart(40, true);
    expect(p.netSamples()).toHaveLength(0);
    p.setQueue([mom(0), mom(1), mom(3)], 0);
    await until(() => p.has('m3'));
    expect(p.netSamples().filter((s) => s.k === 'probe').length).toBeGreaterThanOrEqual(3);
    expect(p.poor()).toBe(true);
    w.delayMs = 50;
    p.setQueue([mom(0), mom(1), mom(2, { hls: 'https://cdn.test/ep1.mp3' })], 0);
    await until(() => p.has('m2'));
    expect(p.poor()).toBe(false);
  });

  it('Cache-Name', () => expect(CACHE_NAME).toBe('core-preload-v1'));
});

describe('Preloader: der Vorrat füllt sich auch bei hängenden Abrufen und Netzfehlern am Start (Brief 20, Issue 47)', () => {
  beforeEach(() => LOCAL.clear());
  const file = synthMp3({ frames: 20_000 }).bytes;
  const queue = (n: number) => Array.from({ length: n }, (_, i) => mom(i));
  const prime = (w: World, q: Moment[]) => {
    for (const m of q) if (m.hls?.endsWith('.mp3')) w.files.set(m.hls, file);
  };

  it('drei hängende Abrufe belegen die Plätze nicht für immer: der Wächter bricht sie ab, der Vorrat steht auf 6 von 6', async () => {
    const { w, make } = setup({ stallMs: 60 });
    const q = queue(8);
    prime(w, q);
    w.hang = 3;
    const lines: string[] = [];
    const p = make();
    p.setDiag((l) => lines.push(l));
    p.setQueue(q, 0);
    await until(() => p.depth() >= 6);
    expect(p.depth()).toBeGreaterThanOrEqual(6);
    expect(p.busy() || p.stats().n >= 6).toBe(true);
    // Jeder hängende Abruf steht mit Grund im Protokoll, jedes Ergebnis auch
    expect(lines.filter((l) => /^stock: fail m\d+ stall 60 ms$/.test(l)).length).toBe(3);
    expect(lines.some((l) => /^stock: \+1 m\d+ \(\d of 6\)$/.test(l))).toBe(true);
    expect(lines).toContain('stock: 6 of 6');
    expect(lines.filter((l) => l === 'stock: 6 of 6')).toHaveLength(1);
  });

  it('ein hängender Abruf zählt als Fehlversuch des Moments, nie gegen den Host', async () => {
    const { w, make } = setup({ stallMs: 40 });
    const q = queue(2);
    prime(w, q);
    w.hang = 1;
    const p = make();
    p.setQueue(q, 0);
    await until(() => p.has('m1'));
    // m1 hing einmal, kam beim zweiten Versuch: der Host ist nicht gesperrt
    expect(p.has('m1')).toBe(true);
    expect(p.whyNot(q[1])).toBeNull();
  });

  it('Netzfehler am Start sperren den Host nur für RETRY_MS, danach füllt sich der Vorrat', async () => {
    const { w, make } = setup({ retryMs: 100_000 });
    const q = queue(5);
    prime(w, q);
    w.failHosts.add('cdn.test');
    const lines: string[] = [];
    const p = make();
    p.setDiag((l) => lines.push(l));
    p.setQueue(q, 0);
    await settle(p, 20);
    expect(p.stats().n).toBe(0);
    expect(p.whyNot(q[1])).toBe('host');
    expect(lines.some((l) => /^stock: host cdn\.test paused 100 s after 2 network errors$/.test(l))).toBe(true);
    // Das Netz ist wieder da, die Aussetzung läuft ab: der nächste resume holt alles
    w.failHosts.clear();
    w.clock += 150_000;
    p.resume();
    await until(() => p.depth() >= 4);
    expect(p.depth()).toBeGreaterThanOrEqual(4);
    expect(p.whyNot(q[1])).toBeNull();
  });

  it('ein Moment mit zwei Fehlversuchen bekommt nach RETRY_MS einen neuen Versuch', async () => {
    const { w, make } = setup({ retryMs: 100_000 });
    const q = queue(2);
    // Die Datei fehlt: 404, zwei Fehlversuche, dann ausgesetzt
    const p = make();
    p.setQueue(q, 0);
    await settle(p, 20);
    p.resume();
    await settle(p, 20);
    expect(p.whyNot(q[1])).toBe('failed');
    prime(w, q);
    w.clock += 150_000;
    p.resume();
    await until(() => p.has('m1'));
    expect(p.has('m1')).toBe(true);
  });

  it('verdeckt scheiternde Abrufe zählen weder gegen den Moment noch gegen den Host', async () => {
    let hidden = true;
    const { w, make } = setup({ hidden: () => hidden });
    const q = queue(4);
    prime(w, q);
    w.failHosts.add('cdn.test');
    const lines: string[] = [];
    const p = make();
    p.setDiag((l) => lines.push(l));
    p.setQueue(q, 0);
    await settle(p, 20);
    // Nicht gezählt: weder gesperrter Host noch ausgesetzter Moment, nur eine kurze Wartezeit. Und keine enge Schleife: wenige Abrufe, nicht Tausende.
    expect(p.whyNot(q[1])).toBe('paused');
    expect(w.calls.length).toBeLessThanOrEqual(6);
    expect(lines.some((l) => /^stock: fail m\d+ .*\(hidden, not counted\)$/.test(l))).toBe(true);
    hidden = false;
    w.failHosts.clear();
    w.clock += 10_000;
    p.resume();
    await until(() => p.depth() >= 3);
    expect(p.depth()).toBeGreaterThanOrEqual(3);
    expect(p.whyNot(q[1])).toBeNull();
  });

  it('dünner Vorrat lädt mit hoher Priorität, ein gefüllter leise im Hintergrund', async () => {
    const { w, make } = setup();
    const q = queue(12);
    prime(w, q);
    const p = make();
    p.setQueue(q, 0);
    await until(() => p.stats().n >= 8);
    const first = w.calls.slice(0, 3).map((c) => c.priority);
    expect(first.every((x) => x === 'high')).toBe(true);
    expect(w.calls.some((c) => c.priority === 'low')).toBe(true);
  });

  it('Fehler beim Öffnen des Speichers steht im Protokoll, auch wenn sich der Feed erst danach anmeldet', async () => {
    const { make } = setup({ openCache: async () => { throw new Error('quota'); } });
    const p = make();
    await p.whenReady();
    const lines: string[] = [];
    p.setDiag((l) => lines.push(l));
    expect(lines).toContain('stock: fail init quota');
  });
});
