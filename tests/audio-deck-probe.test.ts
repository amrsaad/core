// Runde 9, vierte Fassung: Ein Audio-Moment ist seit Runde 9 sofort startbereit, also vor dem Urteil der CORS-Probe seines Hosts. Der Deck wählte die Spur
// für den noch unbekannten Host als Versuch ("cors trial"), der in der geregelten Spur scheiterte ("level lane failed"), obwohl die Probe gleich danach
// "bad" urteilte. Der Test nimmt die echte Verdrahtung (ytApi, audioGraph, laneFor) mit nachgebautem AudioContext, Elementen und Abrufen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const fakeStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

/** Element wie im Browser: ein Element mit crossOrigin bekommt für nocors.test und trial.test beim Laden einen Fehler (20 ms) */
class El {
  tagName = 'AUDIO';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  crossOrigin = '';
  src = '';
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  duration = 600;
  muted = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  textTracks = { length: 0, addEventListener() {} };
  buffered = { length: 0, end: () => 0 };
  private on = new Map<string, (() => void)[]>();
  private n = 0;
  addEventListener(t: string, f: () => void) {
    this.on.set(t, [...(this.on.get(t) ?? []), f]);
  }
  removeEventListener() {}
  emit(t: string) {
    for (const f of this.on.get(t) ?? []) f();
  }
  setAttribute() {}
  getAttribute(k: string) {
    return k === 'src' ? this.src || null : null;
  }
  removeAttribute() {
    this.src = '';
  }
  remove() {}
  pause() {
    this.paused = true;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  load() {
    const n = ++this.n;
    this.error = null;
    if (this.crossOrigin === 'anonymous' && /(nocors|trial)\.test/.test(this.src)) {
      setTimeout(() => {
        if (this.n !== n) return;
        this.error = { code: 4 };
        this.emit('error');
      }, 20);
      return;
    }
    setTimeout(() => {
      if (this.n !== n) return;
      this.readyState = 4;
      this.emit('loadedmetadata');
      this.emit('canplay');
    }, 20);
  }
}

class FakeCtx {
  state: 'suspended' | 'running' = 'suspended';
  private on: (() => void)[] = [];
  static resumeMs = 30;
  destination = {};
  currentTime = 0;
  private node = () => ({ connect() {}, gain: { value: 1 }, threshold: { value: 0 }, ratio: { value: 0 }, knee: { value: 0 }, attack: { value: 0 }, release: { value: 0 } });
  createMediaElementSource = this.node;
  createGain = this.node;
  createDynamicsCompressor = this.node;
  addEventListener(_t: string, f: () => void) {
    this.on.push(f);
  }
  resume() {
    return new Promise<void>((r) =>
      setTimeout(() => {
        this.state = 'running';
        for (const f of this.on) f();
        r();
      }, FakeCtx.resumeMs),
    );
  }
}

type Plan = { cors: 'fail' | 'ok' | 'hang'; noCors: 'opaque' | 'fail' | 'hang'; ms: number };

async function setup(plan: Plan, host: string) {
  store.clear();
  store.set('core.level.on', '1');
  const fetched: string[] = [];
  const fakeFetch = (_u: string, init: RequestInit) =>
    new Promise<Response>((res, rej) => {
      const mode = String(init.mode);
      fetched.push(mode);
      const r = mode === 'cors' ? plan.cors : plan.noCors;
      if (r === 'hang') return void init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      setTimeout(() => (r === 'fail' ? rej(new TypeError('Failed to fetch')) : res({ type: r === 'ok' ? 'cors' : 'opaque', status: 206 } as Response)), plan.ms);
    });
  vi.stubGlobal('localStorage', fakeStorage);
  vi.stubGlobal('location', { href: 'https://app.test/core/', origin: 'https://app.test' });
  vi.stubGlobal('fetch', fakeFetch);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('addEventListener', () => {});
  vi.stubGlobal('document', { visibilityState: 'visible', createElement: () => new El(), body: { appendChild() {} }, addEventListener() {} });
  vi.resetModules();
  const yt = await import('../src/video/ytApi');
  const graph = await import('../src/moments/audioGraph');
  yt.registerHls([{ videoId: 'pod-a', hls: `https://${host}/a.mp3`, form: 'audio' }]);
  const lines: string[] = [];
  yt.audioDeck.diag = (l: string) => lines.push(l);
  const clip = { key: 'pod-a|0|60', id: 'pod-a', url: `https://${host}/a.mp3`, start: 0, end: 60, gain: -4 };
  const sink = { state: () => {}, error: () => {} };
  const corsStore = () => store.get('core.level.cors') ?? '';
  return { yt, graph, lines, clip, sink, fetched, corsStore };
}

describe('erster Start eines Moments mit Messwert auf einem Host, dessen Urteil aussteht (Runde 9, vierte Fassung)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('Host ohne Freigabe, Kontext läuft schon: der Start wartet auf die Probe, kein Fehlversuch, unverändert mit "skipped cors"', async () => {
    const t = await setup({ cors: 'fail', noCors: 'opaque', ms: 40 }, 'nocors.test');
    void t.graph.unlockAudio();
    await vi.advanceTimersByTimeAsync(100); // Kontext läuft
    expect(t.graph.audioRunning()).toBe(true);
    t.yt.audioDeck.load(t.clip, t.sink, { play: true, muted: false });
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.lines.some((l) => l.includes('level lane failed'))).toBe(false);
    expect(t.yt.audioDeck.loud(t.sink)).toMatchObject({ how: 'unchanged: skipped cors', db: 0 });
    expect(t.corsStore()).toContain('"nocors.test":"bad"');
  });

  it('Host ohne Freigabe, Kontext noch im Anlauf: eine gemeinsame Frist, danach ebenfalls ohne Fehlversuch', async () => {
    const t = await setup({ cors: 'fail', noCors: 'opaque', ms: 40 }, 'nocors.test');
    void t.graph.unlockAudio();
    t.yt.audioDeck.load(t.clip, t.sink, { play: true, muted: false });
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.lines.some((l) => l.includes('level lane failed'))).toBe(false);
    expect(t.yt.audioDeck.loud(t.sink)?.how).toBe('unchanged: skipped cors');
  });

  it('Host mit Freigabe: der Start wartet auf das Urteil und läuft dann geregelt', async () => {
    const t = await setup({ cors: 'ok', noCors: 'opaque', ms: 40 }, 'stream.test');
    void t.graph.unlockAudio();
    await vi.advanceTimersByTimeAsync(100);
    t.yt.audioDeck.load(t.clip, t.sink, { play: true, muted: false });
    await vi.advanceTimersByTimeAsync(300);
    expect(t.yt.audioDeck.loud(t.sink)).toMatchObject({ how: 'web audio', db: -4 });
    expect(t.corsStore()).toContain('"stream.test":"ok"');
  });

  it('kein Urteil (beide Abrufe scheitern): sofort der Versuch mit Rückfall wie bisher', async () => {
    const t = await setup({ cors: 'fail', noCors: 'fail', ms: 10 }, 'trial.test');
    void t.graph.unlockAudio();
    await vi.advanceTimersByTimeAsync(100);
    t.yt.audioDeck.load(t.clip, t.sink, { play: true, muted: false });
    await vi.advanceTimersByTimeAsync(300);
    expect(t.lines.some((l) => l.includes('level lane failed'))).toBe(true);
    expect(t.yt.audioDeck.loud(t.sink)?.how).toBe('unchanged: skipped cors');
  });

  it('Probe hängt: der Start wartet höchstens 800 ms, dann Versuch mit Rückfall', async () => {
    const t = await setup({ cors: 'hang', noCors: 'hang', ms: 0 }, 'trial.test');
    void t.graph.unlockAudio();
    await vi.advanceTimersByTimeAsync(100);
    t.yt.audioDeck.load(t.clip, t.sink, { play: true, muted: false });
    await vi.advanceTimersByTimeAsync(700);
    expect(t.lines.some((l) => l.includes('hold pod-a for audio context'))).toBe(true);
    expect(t.lines.some((l) => l.includes('deck: src net'))).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.lines.some((l) => l.includes('deck: src net'))).toBe(true);
  });

  it('Host schon gemerkt: kein Warten, der Start bleibt synchron', async () => {
    const t = await setup({ cors: 'fail', noCors: 'opaque', ms: 40 }, 'nocors.test');
    store.set('core.level.cors', '{"nocors.test":"bad"}');
    void t.graph.unlockAudio();
    await vi.advanceTimersByTimeAsync(100);
    t.yt.audioDeck.load(t.clip, t.sink, { play: true, muted: false });
    expect(t.lines.some((l) => l.includes('deck: src net'))).toBe(true);
    expect(t.fetched).toEqual([]);
  });

  it('erste Berührung bei laufendem Moment (relevel) wartet ebenfalls auf die Probe', async () => {
    const t = await setup({ cors: 'fail', noCors: 'opaque', ms: 40 }, 'nocors.test');
    // Der Moment läuft schon unverändert (vor der Geste kein Kontext)
    t.yt.audioDeck.load(t.clip, t.sink, { play: true, muted: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.yt.audioDeck.loud(t.sink)?.how).toBe('unchanged: no audio context');
    void t.graph.unlockAudio();
    await vi.advanceTimersByTimeAsync(100);
    t.yt.audioDeck.relevel();
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.lines.some((l) => l.includes('level lane failed'))).toBe(false);
    expect(t.yt.audioDeck.loud(t.sink)?.how).toBe('unchanged: no audio context');
    expect(t.corsStore()).toContain('"nocors.test":"bad"');
  });
});
