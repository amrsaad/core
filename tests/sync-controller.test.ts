import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, retryDelay, WRITE_DELAY_MS, type Sync } from '../src/lib/sync/controller';
import { decryptDoc, encryptDoc } from '../src/lib/sync/crypto';
import { emptyDoc } from '../src/lib/sync/merge';
import { stampChanges } from '../src/lib/sync/merge';
import { emptyState, type AppState } from '../src/lib/state';
import { fakeApi, newSha, type FakeApi } from './sync-fake-api';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const rawKey = (fill: number) => crypto.subtle.importKey('raw', new Uint8Array(32).fill(fill), 'AES-GCM', false, ['encrypt', 'decrypt']);

interface Dev {
  state: AppState;
  sync: Sync;
  change(fn: (s: AppState) => AppState): void;
}

function device(api: FakeApi, fill = 5, token: string | null = TOKEN): Dev {
  const d: Dev = {
    state: emptyState(),
    change(fn) {
      d.state = stampChanges(d.state, fn(d.state), Date.now());
      d.sync.poke();
    },
    sync: undefined as unknown as Sync,
  };
  d.sync = createSync({
    getState: () => d.state,
    adopt: (fn) => (d.state = fn(d.state)),
    getKey: () => rawKey(fill),
    getToken: async () => token,
    fetchImpl: api.fetch,
    now: () => Date.now(),
  });
  running.push(d.sync);
  return d;
}

/** Zeit vorrücken und dazwischen echte WebCrypto-Arbeit abwarten */
const running: Sync[] = [];
const tick = () => new Promise((r) => setImmediate(r));
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  // Läuft ein Sync, auf die echte WebCrypto-Arbeit warten (auf langsamen Läufern dauert sie länger), höchstens 10 s echte Zeit
  const end = performance.now() + 10_000;
  for (let i = 0; i < 20; i++) await tick();
  while (running.some((x) => x.status().running) && performance.now() < end) await tick();
  for (let i = 0; i < 20; i++) await tick();
};

const saveMoment = (id: string) => (s: AppState): AppState => ({ ...s, momentSeen: { ...s.momentSeen, [id]: 1_700_000_000_000 } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  running.length = 0;
});

describe('Sync Steuerung', () => {
  it('schreibt erst 10 s nach der letzten Änderung', async () => {
    const api = fakeApi();
    const a = device(api);
    a.change(saveMoment('m1'));
    await advance(WRITE_DELAY_MS - 1);
    expect(api.puts).toBe(0);
    a.change(saveMoment('m2'));
    await advance(WRITE_DELAY_MS - 1);
    expect(api.puts).toBe(0);
    await advance(2);
    expect(api.puts).toBe(1);
    const doc = await decryptDoc(await rawKey(5), api.file!.text);
    expect(Object.keys(doc.state.momentSeen).sort()).toEqual(['m1', 'm2']);
    expect(Math.abs(Date.now() - (a.sync.status().lastSync ?? 0))).toBeLessThan(1000);
    expect(a.sync.status().error).toBeNull();
  });

  it('zwei Geräte: Start lädt und führt zusammen, beide Richtungen', async () => {
    const api = fakeApi();
    const a = device(api);
    const b = device(api);
    a.change(saveMoment('von-a'));
    await a.sync.syncNow();
    b.change(saveMoment('von-b'));
    await b.sync.start();
    expect(Object.keys(b.state.momentSeen).sort()).toEqual(['von-a', 'von-b']);
    await a.sync.start();
    expect(Object.keys(a.state.momentSeen).sort()).toEqual(['von-a', 'von-b']);
  });

  it('Konflikt: anderes Gerät schreibt dazwischen, erst laden, mergen, dann schreiben', async () => {
    const api = fakeApi();
    const a = device(api);
    const b = device(api);
    a.change(saveMoment('a1'));
    await a.sync.syncNow();
    b.change(saveMoment('b1'));
    await b.sync.syncNow();
    // a ändert, in der Zwischenzeit schreibt b erneut
    a.change(saveMoment('a2'));
    b.change(saveMoment('b2'));
    // b schreibt zuerst (direkt), danach ist a mit alter sha dran
    await b.sync.syncNow();
    await a.sync.syncNow();
    const doc = await decryptDoc(await rawKey(5), api.file!.text);
    expect(Object.keys(doc.state.momentSeen).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(Object.keys(a.state.momentSeen).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('Konflikt mitten im Schreiben: 409 führt zu Neuladen und erneutem Schreiben', async () => {
    const api = fakeApi();
    const a = device(api);
    const other = device(api);
    other.change(saveMoment('x'));
    await other.sync.syncNow();
    a.change(saveMoment('y'));
    // während a zwischen Lesen und Schreiben ist, ändert ein anderes Gerät die Datei
    api.beforePut = () => {
      api.file = { text: api.file!.text, sha: newSha() };
    };
    await a.sync.syncNow();
    expect(a.sync.status().error).toBeNull();
    // ein PUT von other, dann der abgewiesene und der wiederholte von a
    expect(api.calls.filter((c) => c.method === 'PUT').length).toBe(3);
    const doc = await decryptDoc(await rawKey(5), api.file!.text);
    expect(Object.keys(doc.state.momentSeen).sort()).toEqual(['x', 'y']);
  });

  it('offline sammeln, bei Netz nachholen', async () => {
    const api = fakeApi();
    const a = device(api);
    api.offline = true;
    a.change(saveMoment('o1'));
    await advance(WRITE_DELAY_MS + 1);
    expect(a.sync.status().error).toMatch(/No connection/);
    expect(api.puts).toBe(0);
    a.change(saveMoment('o2'));
    api.offline = false;
    a.sync.online();
    await advance(10);
    expect(a.sync.status().error).toBeNull();
    const doc = await decryptDoc(await rawKey(5), api.file!.text);
    expect(Object.keys(doc.state.momentSeen).sort()).toEqual(['o1', 'o2']);
  });

  it('Serverfehler wird mit Wartezeit wiederholt', async () => {
    const api = fakeApi();
    const a = device(api);
    a.change(saveMoment('s1'));
    api.failNext.push(503);
    await advance(WRITE_DELAY_MS + 1);
    expect(a.sync.status().error).toMatch(/503/);
    await advance(retryDelay(1) + 10);
    expect(api.puts).toBe(1);
    expect(a.sync.status().error).toBeNull();
    expect([retryDelay(1), retryDelay(2), retryDelay(3), retryDelay(4), retryDelay(9)]).toEqual([15_000, 60_000, 300_000, 300_000, 300_000]);
  });

  it('ungültiges Token: eine Zeile Fehler, keine automatische Wiederholung', async () => {
    const api = fakeApi();
    const a = device(api, 5, 'ghp_FALSCHESTOKENFALSCHES1');
    a.change(saveMoment('t1'));
    await advance(WRITE_DELAY_MS + 1);
    const err = a.sync.status().error!;
    expect(err).toMatch(/401/);
    expect(err).not.toContain('ghp_');
    const n = api.calls.length;
    await advance(10 * 60_000);
    expect(api.calls.length).toBe(n);
  });

  it('Datei mit anderem Schlüssel wird nie überschrieben', async () => {
    const api = fakeApi();
    const fremd = device(api, 9);
    fremd.change(saveMoment('fremd'));
    await fremd.sync.syncNow();
    const vorher = api.file!.text;
    const a = device(api, 5);
    a.change(saveMoment('a1'));
    await a.sync.syncNow();
    expect(a.sync.status().error).toBeTruthy();
    expect(api.file!.text).toBe(vorher);
    expect(api.puts).toBe(1);
  });

  it('ohne Token: keine Netzzugriffe', async () => {
    const api = fakeApi();
    const a = device(api, 5, null);
    a.change(saveMoment('k'));
    await advance(WRITE_DELAY_MS + 1);
    await a.sync.start();
    expect(api.calls.length).toBe(0);
    expect(a.sync.status().hasToken).toBe(false);
  });

  it('nichts zu schreiben, wenn Stand schon gleich ist', async () => {
    const api = fakeApi();
    const a = device(api);
    a.change(saveMoment('g'));
    await a.sync.syncNow();
    await a.sync.syncNow();
    await a.sync.start();
    expect(api.puts).toBe(1);
  });

  it('Datei von neuerer Version wird nicht angefasst', async () => {
    const api = fakeApi();
    const d = emptyDoc();
    d.v = 99;
    api.file = { text: await encryptDoc(await rawKey(5), d), sha: newSha() };
    const a = device(api);
    a.change(saveMoment('v'));
    await a.sync.syncNow();
    expect(a.sync.status().error).toMatch(/newer version/);
    expect(api.puts).toBe(0);
  });
});

describe('Netzabbruch (Issue 9)', () => {
  it('Wiederholung nach 15 s, 1 min, 5 min, Token und Last sync bleiben', async () => {
    const api = fakeApi();
    const a = device(api);
    await a.sync.start();
    await advance(10);
    const first = a.sync.status().lastSync;
    expect(first).not.toBeNull();
    expect(api.puts).toBe(1);
    api.failNext.push(503, 503, 503);
    a.change(saveMoment('r1'));
    await advance(WRITE_DELAY_MS + 1);
    const n = api.calls.length;
    expect(a.sync.status().error).toMatch(/503/);
    expect(a.sync.status().hasToken).toBe(true);
    expect(a.sync.status().lastSync).toBe(first);
    await advance(14_000);
    expect(api.calls.length).toBe(n);
    await advance(1_100);
    expect(api.calls.length).toBe(n + 1);
    await advance(59_000);
    expect(api.calls.length).toBe(n + 1);
    await advance(1_100);
    expect(api.calls.length).toBe(n + 2);
    await advance(299_000);
    expect(api.calls.length).toBe(n + 2);
    expect(a.sync.status().lastSync).toBe(first);
    await advance(1_100);
    expect(api.puts).toBe(2);
    expect(a.sync.status().error).toBeNull();
    expect(a.sync.status().lastSync).toBeGreaterThan(first!);
  });

  it('Offline pausiert den Sync, online startet ihn sofort wie Sync now', async () => {
    const api = fakeApi();
    const a = device(api);
    await a.sync.start();
    await advance(10);
    const ls = a.sync.status().lastSync;
    a.sync.offline();
    a.change(saveMoment('p1'));
    const calls = api.calls.length;
    await advance(WRITE_DELAY_MS + 60_000);
    expect(api.calls.length).toBe(calls);
    expect(a.sync.status().lastSync).toBe(ls);
    expect(a.sync.status().hasToken).toBe(true);
    a.sync.online();
    await advance(10);
    expect(api.puts).toBe(2);
    expect(a.sync.status().lastSync).toBeGreaterThan(ls!);
    expect(a.sync.status().error).toBeNull();
  });

  it('Kein Netz löscht weder Token noch Last sync noch den lokalen Stand', async () => {
    const api = fakeApi();
    const a = device(api);
    await a.sync.start();
    await advance(10);
    const ls = a.sync.status().lastSync;
    api.offline = true;
    a.change(saveMoment('k1'));
    await advance(WRITE_DELAY_MS + 1);
    expect(a.sync.status().error).toMatch(/No connection/);
    expect(a.sync.status().hasToken).toBe(true);
    expect(a.sync.status().lastSync).toBe(ls);
    expect(a.state.momentSeen.k1).toBeDefined();
    api.offline = false;
    a.sync.online();
    await advance(10);
    expect(api.puts).toBe(2);
    expect(a.sync.status().error).toBeNull();
    expect(a.state.momentSeen.k1).toBeDefined();
  });

  it('Ein Token, das kurz nicht lesbar ist, gilt nie als entfernt', async () => {
    const api = fakeApi();
    let tok: string | null = TOKEN;
    const s = createSync({ getState: () => emptyState(), adopt: () => {}, getKey: () => rawKey(5), getToken: async () => tok, fetchImpl: api.fetch, now: () => Date.now() });
    running.push(s);
    await s.start();
    await advance(10);
    const ls = s.status().lastSync;
    expect(s.status().hasToken).toBe(true);
    tok = null;
    s.poke();
    await advance(WRITE_DELAY_MS + 1);
    expect(s.status().hasToken).toBe(true);
    expect(s.status().error).toMatch(/token could not be read/);
    expect(s.status().lastSync).toBe(ls);
    tok = TOKEN;
    await advance(15_100);
    expect(s.status().error).toBeNull();
    expect(s.status().hasToken).toBe(true);
  });
});
