// Befund 13.11.: Der Stand war rund 1,09 MB groß, im Mobilnetz scheiterte das Schreiben am Zeitlimit von 20 s.
// Hier: Größe je Feld, Zeitlimit nach Größe, schnelle Wiederholung, Diagnose-Zeile mit Größe und Dauer, Kompatibilität mit dem alten Stand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, uploadRetryDelay, UPLOAD_RETRY_DELAYS } from '../src/lib/sync/controller';
import { b64uDecode, decryptDoc, encryptDoc } from '../src/lib/sync/crypto';
import { REQUEST_TIMEOUT_MS, uploadTimeoutMs, UPLOAD_TIMEOUT_MAX_MS } from '../src/lib/sync/github';
import { canon, LOG_MAX, mergeDocs, toDoc } from '../src/lib/sync/merge';
import { DIAG_MAX } from '../src/lib/diag';
import { emptyState, type AppState } from '../src/lib/state';
import { fakeApi } from './sync-fake-api';
import { makeState } from './sync-size-fixture';
import fixture from './fixtures/sync-file.json';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const key = () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(5), 'AES-GCM', false, ['encrypt', 'decrypt']);

describe('Größe des Stands', () => {
  it('Aufschlüsselung: savedMoments, momentLog und diag sind die drei größten Felder, Umschlag und Anfrage wie erwartet', async () => {
    // Runde 14: hier der ungepackte Weg (Browser ohne CompressionStream), gepackt misst tests/sync-gzip.test.ts
    vi.stubGlobal('CompressionStream', undefined);
    const d = toDoc(makeState());
    const sizes = Object.entries(d.state)
      .map(([k, v]) => [k, canon(v).length] as const)
      .sort((a, b) => b[1] - a[1]);
    expect(sizes.slice(0, 3).map(([k]) => k)).toEqual(['savedMoments', 'momentLog', 'diag']);
    const plain = canon(d).length;
    const env = await encryptDoc(await key(), d);
    // Umschlag: Chiffretext als base64url, also rund 4/3 des Klartexts
    expect(env.length / plain).toBeGreaterThan(1.3);
    expect(env.length / plain).toBeLessThan(1.4);
    // Anfrage an die Contents API: der Umschlag noch einmal als base64 (die API verlangt das), nochmals rund 4/3
    const api = fakeApi();
    let bytes = 0;
    const f = ((u: string, i?: RequestInit) => {
      if (i?.method === 'PUT') bytes = String(i.body).length;
      return api.fetch(u, i);
    }) as typeof fetch;
    const s = createSync({ getState: () => makeState(), adopt: () => {}, getKey: key, getToken: async () => TOKEN, fetchImpl: f, log: () => {} });
    await s.start();
    expect(bytes / env.length).toBeGreaterThan(1.3);
    expect(bytes / env.length).toBeLessThan(1.4);
    // Das Zeitlimit wächst mit der Größe, das Ergebnis dieser Messung braucht mehr als 20 s
    expect(uploadTimeoutMs(bytes)).toBeGreaterThan(REQUEST_TIMEOUT_MS);
    vi.unstubAllGlobals();
  });

  it('die unbegrenzten Listen haben eine Obergrenze: Protokoll 3000, Diagnose 500', () => {
    expect(LOG_MAX).toBe(3000);
    expect(DIAG_MAX).toBe(500);
    const s = makeState({ pool: 1400, saved: 10, seen: 100, log: 5000, days: 40 });
    const m = mergeDocs(toDoc(s), toDoc(s));
    expect(m.state.momentLog.length).toBe(LOG_MAX);
    expect(m.state.diag!.length).toBe(DIAG_MAX);
  });
});

describe('Zeitlimit fürs Schreiben', () => {
  it('bis 100 kB wie bisher 20 s, darüber je 20 kB eine Sekunde mehr, höchstens 90 s', () => {
    expect(uploadTimeoutMs(1_000)).toBe(20_000);
    expect(uploadTimeoutMs(100_000)).toBe(20_000);
    expect(uploadTimeoutMs(100_001)).toBe(21_000);
    expect(uploadTimeoutMs(500_000)).toBe(40_000);
    expect(uploadTimeoutMs(1_350_000)).toBe(83_000);
    expect(uploadTimeoutMs(50_000_000)).toBe(UPLOAD_TIMEOUT_MAX_MS);
  });
  it('Wiederholung: 3 s, 10 s, 30 s, danach 1 min und 5 min', () => {
    expect(UPLOAD_RETRY_DELAYS.slice(0, 3)).toEqual([3_000, 10_000, 30_000]);
    expect([1, 2, 3, 4, 5, 9].map(uploadRetryDelay)).toEqual([3_000, 10_000, 30_000, 60_000, 300_000, 300_000]);
  });
});

describe('Steuerung: Schreiben scheitert', () => {
  const running: { stop(): void; status(): { running: boolean } }[] = [];
  const tick = () => new Promise((r) => setImmediate(r));
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 30; i++) await tick();
    // Läuft ein Sync mit echter WebCrypto-Arbeit, darauf warten (hängende Anfragen zählen nicht: dort steht running bis zum Abbruch, höchstens 300 ms echte Zeit)
    const end = performance.now() + 300;
    while (running.some((x) => x.status().running) && performance.now() < end) await tick();
    for (let i = 0; i < 30; i++) await tick();
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  });
  afterEach(() => {
    running.forEach((s) => s.stop());
    running.length = 0;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Gerät mit kleinem Stand, PUT über `onPut` gesteuert, alles andere über die nachgebaute API */
  function dev(onPut: (n: number, init: RequestInit, api: ReturnType<typeof fakeApi>, url: string) => Promise<Response> | null, state: AppState = emptyState()) {
    const api = fakeApi();
    const lines: string[] = [];
    let n = 0;
    const f = ((u: string, i?: RequestInit) => {
      if (i?.method === 'PUT') {
        n++;
        return onPut(n, i, api, u) ?? api.fetch(u, i);
      }
      return api.fetch(u, i);
    }) as typeof fetch;
    const d: { state: AppState } = { state: { ...state, momentSeen: { ...state.momentSeen, m1: 1_700_000_000_000 } } };
    const s = createSync({ getState: () => d.state, adopt: (fn) => (d.state = fn(d.state)), getKey: key, getToken: async () => TOKEN, fetchImpl: f, now: () => Date.now(), log: (l) => lines.push(l) });
    running.push(s);
    return { s, api, lines, puts: () => n };
  }
  const hang = (i: RequestInit) => new Promise<Response>((_res, rej) => i.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));

  it('Zeitlimit: nach 3 s, dann 10 s, dann 30 s noch einmal, Zeile mit Größe und Versuch, bei Erfolg Größe und Dauer', async () => {
    const t = dev((n, i) => (n <= 3 ? hang(i) : null));
    void t.s.start();
    await advance(50);
    await advance(20_100);
    expect(t.lines.find((l) => l.startsWith('sync: PUT contents'))).toMatch(/^sync: PUT contents timeout 20s \(\d+ kB, try 1\)$/);
    expect(t.puts()).toBe(1);
    await advance(3_000);
    expect(t.puts()).toBe(2);
    await advance(20_100);
    expect(t.lines.filter((l) => l.startsWith('sync: PUT contents timeout')).length).toBe(2);
    expect(t.lines[t.lines.length - 1]).toMatch(/try 2\)$/);
    await advance(9_000);
    expect(t.puts()).toBe(2); // 10 s noch nicht um
    await advance(1_500);
    expect(t.puts()).toBe(3);
    await advance(20_000 + 30_000 + 100);
    expect(t.puts()).toBe(4);
    expect(t.lines).toContain('sync: ok again after 3 failed runs');
    const ok = t.lines.find((l) => l.startsWith('sync: PUT ok'))!;
    expect(ok).toMatch(/^sync: PUT ok \d+ kB in \d+\.\d s \(try 4\)$/);
    expect(t.s.status().error).toBeNull();
    expect(t.api.puts).toBe(1);
  });

  it('Erfolg im ersten Versuch: "sync: PUT ok 1 kB in 0.0 s" ohne Versuchsnummer', async () => {
    const t = dev(() => null);
    await t.s.start();
    await advance(10);
    expect(t.lines.filter((l) => l.startsWith('sync: PUT ok'))).toEqual([expect.stringMatching(/^sync: PUT ok \d+ kB in \d+\.\d s$/)]);
  });

  it('Netzfehler (TypeError) beim Schreiben wird nach 3 s wiederholt', async () => {
    const t = dev((n) => (n === 1 ? Promise.reject(new TypeError('Load failed')) : null));
    void t.s.start();
    await advance(50);
    expect(t.lines.find((l) => l.startsWith('sync: PUT contents'))).toMatch(/^sync: PUT contents network TypeError.* \(\d+ kB, try 1\)$/);
    await advance(2_900);
    expect(t.puts()).toBe(1);
    await advance(200);
    expect(t.puts()).toBe(2);
    expect(t.api.puts).toBe(1);
    expect(t.s.status().error).toBeNull();
  });

  it('401 und 403 beim Schreiben: keine Wiederholung', async () => {
    for (const code of [401, 403]) {
      const t = dev(() => Promise.resolve(new Response('{}', { status: code })));
      await t.s.start();
      await advance(10);
      expect(t.puts()).toBe(1);
      await advance(10 * 60_000);
      expect(t.puts()).toBe(1);
      expect(t.lines.some((l) => l.startsWith(`sync: PUT contents ${code}`))).toBe(true);
    }
  });

  it('Rate-Limit beim Schreiben bleibt bei der alten Folge (15 s), nicht 3 s', async () => {
    const t = dev((n) => (n === 1 ? Promise.resolve(new Response('{}', { status: 429 })) : null));
    await t.s.start();
    await advance(10);
    await advance(5_000);
    expect(t.puts()).toBe(1);
    await advance(10_500);
    expect(t.puts()).toBe(2);
  });

  it('verborgen keine schnelle Wiederholung, beim Sichtbarwerden sofort', async () => {
    const t = dev((n) => (n === 1 ? Promise.reject(new TypeError('Load failed')) : null));
    t.s.visible(false);
    await t.s.start();
    await advance(50);
    expect(t.puts()).toBe(1);
    await advance(10 * 60_000);
    expect(t.puts()).toBe(1);
    t.s.visible(true);
    await advance(50);
    expect(t.puts()).toBe(2);
    expect(t.api.puts).toBe(1);
  });

  it('großer Stand: das Zeitlimit liegt über 20 s und die Zeile nennt die Größe in kB', async () => {
    // ohne gzip, damit die Anfrage so groß ist wie im Befund vom 13.11. (gepackt rechnet das Limit mit der kleineren, tatsächlich gesendeten Größe)
    vi.stubGlobal('CompressionStream', undefined);
    const t = dev((n, i) => (n === 1 ? hang(i) : null), makeState());
    void t.s.start();
    await advance(500);
    await advance(25_000);
    expect(t.lines.some((l) => l.startsWith('sync: PUT contents timeout'))).toBe(false);
    await advance(70_000);
    const line = t.lines.find((l) => l.startsWith('sync: PUT contents timeout'))!;
    const [, secs, kb] = /timeout (\d+)s \((\d+) kB/.exec(line)!;
    expect(Number(secs)).toBeGreaterThan(60);
    expect(Number(secs)).toBeLessThanOrEqual(90);
    expect(Number(kb)).toBeGreaterThan(1000);
  });

  it('Netzfehler beim Schreiben, dazwischen holt ein Sichtbarwerden sofort nach', async () => {
    const t = dev((n) => (n <= 2 ? Promise.reject(new TypeError('Load failed')) : null));
    void t.s.start();
    await advance(50);
    expect(t.puts()).toBe(1);
    t.s.visible(true);
    await advance(50);
    expect(t.puts()).toBe(2);
    await advance(3_100); // Folge beginnt beim Sichtbarwerden von vorn: 3 s
    expect(t.puts()).toBe(3);
    expect(t.api.puts).toBe(1);
  });
});

describe('Kompatibilität', () => {
  it('der alte Stand auf dem Server wird gelesen und zusammengeführt, die entschlüsselte Datei bleibt einfaches JSON mit denselben Feldern', async () => {
    const raw = await crypto.subtle.importKey('raw', b64uDecode(fixture.key), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const old = await decryptDoc(raw, fixture.file);
    const mine = toDoc(makeState());
    const merged = mergeDocs(mine, old);
    for (const k of Object.keys(old.state)) expect(Object.keys(merged.state)).toContain(k);
    expect(merged.v).toBe(old.v);
    // Alles aus dem alten Stand bleibt erhalten
    for (const id of Object.keys(old.state.momentSeen)) expect(merged.state.momentSeen[id]).toBeLessThanOrEqual(old.state.momentSeen[id]);
    // Hochgeladen wird der Umschlag {"v","z","iv","ct"} (z nur mit gzip), entschlüsselt ein JSON mit den Feldern, die die Pipeline liest
    const env = JSON.parse(await encryptDoc(raw, merged));
    expect(Object.keys(env).sort()).toEqual(['ct', 'iv', 'v', 'z']);
    expect(env.z).toBe('gzip');
    const back = await decryptDoc(raw, JSON.stringify(env));
    for (const k of ['momentSeen', 'diag', 'feedbackNotes', 'mutedChannels', 'momentRejected', 'momentSwipes', 'momentLog', 'savedMoments', 'momentWeights']) expect(back.state).toHaveProperty(k);
    expect(canon(back)).toBe(canon(merged));
  });
});
