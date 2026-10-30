// Host-Probe (Entscheidung 16): ein winziger Abruf klärt, ob ein Host CORS erlaubt, bevor ein Moment die geregelte Spur versucht.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const fakeStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

type Call = { url: string; mode?: string; range?: string };
function mkFetch(plan: (url: string, mode: string) => 'ok' | 'opaque' | 'fail' | 'hang', calls: Call[] = []): typeof fetch {
  return ((url: string, init: RequestInit & { headers?: Record<string, string> } = {}) => {
    const mode = String(init.mode);
    calls.push({ url, mode, range: init.headers?.Range });
    const r = plan(url, mode);
    if (r === 'ok') return Promise.resolve({ type: 'cors', status: 206 } as Response);
    if (r === 'opaque') return Promise.resolve({ type: 'opaque', status: 0 } as Response);
    if (r === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
    return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  }) as unknown as typeof fetch;
}

describe('probeHost', () => {
  let mod: typeof import('../src/moments/audioGraph');
  beforeEach(async () => {
    store.clear();
    vi.stubGlobal('localStorage', fakeStorage);
    vi.stubGlobal('location', { href: 'https://app.test/core/' });
    vi.resetModules();
    mod = await import('../src/moments/audioGraph');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lesbare Antwort (CORS erlaubt): Host ok, nur ein Byte per Range, Antwort wird nicht geladen', async () => {
    const calls: Call[] = [];
    const v = await mod.probeHost('https://cdn.test/a.mp3', mkFetch(() => 'ok', calls));
    expect(v).toBe('ok');
    expect(calls).toEqual([{ url: 'https://cdn.test/a.mp3', mode: 'cors', range: 'bytes=0-0' }]);
    expect(mod.hostState('https://cdn.test/other.mp3')).toBe('ok');
  });

  it('CORS scheitert, derselbe Abruf ohne CORS erreicht den Host (opaque): Host ohne Freigabe, bad', async () => {
    const calls: Call[] = [];
    const v = await mod.probeHost('https://anchor.test/s/play.m4a', mkFetch((_u, m) => (m === 'cors' ? 'fail' : 'opaque'), calls));
    expect(v).toBe('bad');
    expect(calls.map((c) => c.mode)).toEqual(['cors', 'no-cors']);
    expect(mod.hostState('https://anchor.test/x')).toBe('bad');
  });

  it('beides scheitert (Netzfehler): kein Urteil, nichts gemerkt, der Versuch beim Abspielen entscheidet', async () => {
    const v = await mod.probeHost('https://flaky.test/a.mp3', mkFetch(() => 'fail'));
    expect(v).toBeUndefined();
    expect(mod.hostState('https://flaky.test/a.mp3')).toBeUndefined();
  });

  it('Zeitüberschreitung: kein Urteil, auch wenn ein späterer Abruf ohne CORS durchginge', async () => {
    vi.useFakeTimers();
    const p = mod.probeHost('https://slow.test/a.mp3', mkFetch((_u, m) => (m === 'cors' ? 'hang' : 'opaque')));
    await vi.advanceTimersByTimeAsync(9000);
    expect(await p).toBeUndefined();
    expect(mod.hostState('https://slow.test/a.mp3')).toBeUndefined();
  });

  it('bekannter Host, HLS-Manifest, Blob und Offline: kein Abruf', async () => {
    const calls: Call[] = [];
    const f = mkFetch(() => 'ok', calls);
    await mod.probeHost('https://cdn.test/a.mp3', f);
    await mod.probeHost('https://cdn.test/b.mp3', f);
    await mod.probeHost('https://hls.test/m/master.m3u8?x=1', f);
    await mod.probeHost('blob:https://app.test/abc', f);
    expect(calls.length).toBe(1);
    vi.stubGlobal('navigator', { onLine: false });
    await mod.probeHost('https://other.test/a.mp3', f);
    expect(calls.length).toBe(1);
  });

  it('mehrere Momente desselben Hosts gleichzeitig: ein Abruf', async () => {
    const calls: Call[] = [];
    const f = mkFetch(() => 'ok', calls);
    const all = await Promise.all([1, 2, 3, 4].map((i) => mod.probeHost(`https://cdn.test/${i}.mp3`, f)));
    expect(all).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(calls.length).toBe(1);
  });

  it('das Urteil bleibt zwischen Sitzungen erhalten (localStorage)', async () => {
    await mod.probeHost('https://anchor.test/a.mp3', mkFetch((_u, m) => (m === 'cors' ? 'fail' : 'opaque')));
    vi.resetModules();
    const again = await import('../src/moments/audioGraph');
    const calls: Call[] = [];
    expect(await again.probeHost('https://anchor.test/b.mp3', mkFetch(() => 'ok', calls))).toBe('bad');
    expect(calls.length).toBe(0);
  });
});
