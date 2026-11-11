import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, PAUSE_MAX_MS, retryDelay, WRITE_DELAY_MS, type Sync } from '../src/lib/sync/controller';
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

describe('Sync-Fehler sind lesbar, ein fehlendes online-Ereignis sperrt nie (Issue 45)', () => {
  function plain(fetchImpl: typeof fetch) {
    const lines: string[] = [];
    const d = { state: emptyState() };
    const s = createSync({ getState: () => d.state, adopt: (fn) => (d.state = fn(d.state)), getKey: () => rawKey(5), getToken: async () => TOKEN, fetchImpl, now: () => Date.now(), log: (l) => lines.push(l) });
    running.push(s);
    return { s, d, lines };
  }
  const status = (code: number, headers: Record<string, string> = {}) => (async () => new Response('{}', { status: code, headers })) as unknown as typeof fetch;

  it('Kontingent aufgebraucht: die Zeile nennt Anfrage, Status und Rate-Limit', async () => {
    const { s, lines } = plain(status(403, { 'x-ratelimit-remaining': '0' }));
    await s.start();
    await advance(10);
    expect(lines).toContain('sync: GET contents 403 rate limit');
    expect(s.status().error).toMatch(/rate limit/);
  });

  it('zweite Sperre (403 mit retry-after) zählt als Rate-Limit und wird wiederholt, nicht als fehlende Berechtigung', async () => {
    const { s, lines } = plain(status(403, { 'retry-after': '60', 'x-ratelimit-remaining': '12' }));
    await s.start();
    await advance(10);
    expect(lines[0]).toBe('sync: GET contents 403 rate limit');
    const before = lines.length;
    await advance(15_100);
    expect(lines.length).toBeGreaterThan(before);
  });

  it('abgelehntes Token und fehlende Berechtigung bleiben getrennt benannt', async () => {
    const a = plain(status(401));
    await a.s.start();
    await advance(10);
    expect(a.lines).toContain('sync: GET contents 401 token rejected');
    const b = plain(status(403));
    await b.s.start();
    await advance(10);
    expect(b.lines).toContain('sync: GET contents 403 no write access');
  });

  it('Netzfehler: die Zeile sagt, dass es ein Netzfehler war, und nennt den Fehlertyp', async () => {
    const api = fakeApi();
    api.offline = true;
    const { s, lines } = plain(api.fetch);
    await s.start();
    await advance(10);
    expect(lines[0]).toMatch(/^sync: GET contents network TypeError/);
    expect(s.status().error).toMatch(/No connection/);
  });

  it('keine Antwort nach 20 s: eigene Meldung und Zeile "timeout 20s", nicht "No connection"', async () => {
    const hang = ((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    const { s, lines } = plain(hang);
    void s.start();
    await advance(20_100);
    expect(lines[0]).toBe('sync: GET contents timeout 20s');
    expect(s.status().error).toMatch(/did not answer/);
    expect(s.status().error).not.toMatch(/No connection/);
  });

  it('scheitert das Schreiben, steht PUT in der Zeile, und nach der Erholung steht "ok again"', async () => {
    const api = fakeApi();
    let failPut = true;
    const f = ((u: string, i?: RequestInit) => (i?.method === 'PUT' && failPut ? Promise.resolve(new Response('{}', { status: 500 })) : api.fetch(u, i))) as unknown as typeof fetch;
    const { s, lines } = plain(f);
    await s.start();
    await advance(10);
    expect(lines).toContain('sync: PUT contents 500 server error');
    failPut = false;
    await advance(15_100);
    expect(lines).toContain('sync: ok again after 1 failed run');
    expect(s.status().error).toBeNull();
  });

  it('kein Token und keine Zeile im Protokoll', async () => {
    const { s, lines } = plain(status(401));
    await s.start();
    await advance(10);
    expect(lines.join('\n')).not.toContain(TOKEN);
    void s;
  });

  it('online-Ereignis bleibt aus: Rückkehr in den Vordergrund beendet die Pause und holt nach', async () => {
    const api = fakeApi();
    const a = device(api);
    await a.sync.start();
    await advance(10);
    expect(api.puts).toBe(1);
    a.sync.offline();
    a.change(saveMoment('v1'));
    await advance(WRITE_DELAY_MS + 60_000);
    expect(api.puts).toBe(1);
    a.sync.visible(false);
    await advance(10);
    expect(api.puts).toBe(1); // verborgen bleibt die Pause
    a.sync.visible(true);
    await advance(10);
    expect(api.puts).toBe(2);
    expect(a.sync.status().error).toBeNull();
  });

  it('online-Ereignis bleibt aus und die App bleibt vorn: nach 5 Minuten läuft der Sync von selbst', async () => {
    const api = fakeApi();
    const a = device(api);
    await a.sync.start();
    await advance(10);
    a.sync.offline();
    a.change(saveMoment('v2'));
    await advance(PAUSE_MAX_MS - 5_000);
    expect(api.puts).toBe(1);
    await advance(5_100);
    expect(api.puts).toBe(2);
    expect(a.sync.status().error).toBeNull();
  });

  it('Rückkehr in den Vordergrund ohne Netz: der Lauf scheitert lesbar und wird mit Wartezeit wiederholt', async () => {
    const api = fakeApi();
    const { s, lines } = plain(api.fetch);
    await s.start();
    await advance(10);
    s.offline();
    api.offline = true;
    s.visible(true);
    await advance(10);
    expect(s.status().error).toMatch(/No connection/);
    expect(lines.some((l) => l.startsWith('sync: GET contents network'))).toBe(true);
    api.offline = false;
    await advance(15_100);
    expect(s.status().error).toBeNull();
  });
});

describe('Nutzungszeit-Tick schiebt die 10-Sekunden-Frist nicht weiter (Issue 55)', () => {
  it('weiche Änderungen im Abstand von 6 s lassen die Frist der echten Änderung unberührt', async () => {
    const api = fakeApi();
    const a = device(api);
    await a.sync.start();
    await advance(10);
    const before = api.puts;
    a.change(saveMoment('x:1'));
    await advance(6000);
    a.sync.poke(true);
    await advance(3900);
    expect(api.puts).toBe(before);
    await advance(300);
    expect(api.puts).toBe(before + 1);
  });
  it('eine harte Änderung nach einem weichen Tick startet die Frist neu', async () => {
    const api = fakeApi();
    const a = device(api);
    await a.sync.start();
    await advance(10);
    const before = api.puts;
    a.sync.poke(true);
    await advance(6000);
    a.change(saveMoment('x:2'));
    await advance(6000);
    expect(api.puts).toBe(before);
    await advance(4100);
    expect(api.puts).toBe(before + 1);
  });
  it('onlyFeedTimeChanged erkennt reine Zeit-Ticks', async () => {
    const { onlyFeedTimeChanged } = await import('../src/lib/sync/merge');
    const s = emptyState();
    expect(onlyFeedTimeChanged(s, { ...s, feedTime: { d: 10 } })).toBe(true);
    expect(onlyFeedTimeChanged(s, { ...s, feedTime: { d: 10 }, momentSeen: { a: 1 } })).toBe(false);
    expect(onlyFeedTimeChanged(s, s)).toBe(false);
  });
});
