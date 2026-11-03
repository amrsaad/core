// Entscheidung 31, Baustein 1: Diagnose-Zeilen eines Geräts stehen im entschlüsselten Sync-Stand und kommen auf dem zweiten Gerät an.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, DIAG_FLUSH_MS, WRITE_DELAY_MS, type Sync } from '../src/lib/sync/controller';
import { decryptDoc } from '../src/lib/sync/crypto';
import { stampChanges } from '../src/lib/sync/merge';
import { emptyState, type AppState } from '../src/lib/state';
import type { DiagEntry } from '../src/lib/diag';
import { fakeApi, type FakeApi } from './sync-fake-api';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const rawKey = (fill: number) => crypto.subtle.importKey('raw', new Uint8Array(32).fill(fill), 'AES-GCM', false, ['encrypt', 'decrypt']);

interface Dev {
  id: string;
  state: AppState;
  sync: Sync;
  session: DiagEntry[];
  log(line: string): void;
  change(fn: (s: AppState) => AppState): void;
}

const running: Sync[] = [];
function device(api: FakeApi, id: string): Dev {
  const d: Dev = {
    id,
    state: emptyState(),
    session: [],
    log: (l) => d.session.push({ t: Date.now(), d: id, l }),
    change(fn) {
      d.state = stampChanges(d.state, fn(d.state), Date.now());
      d.sync.poke();
    },
    sync: undefined as unknown as Sync,
  };
  d.sync = createSync({
    getState: () => d.state,
    adopt: (fn) => (d.state = fn(d.state)),
    getKey: () => rawKey(5),
    getToken: async () => TOKEN,
    fetchImpl: api.fetch,
    now: () => Date.now(),
    diag: () => d.session,
  });
  running.push(d.sync);
  return d;
}

const tick = () => new Promise((r) => setImmediate(r));
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  const end = performance.now() + 10_000;
  for (let i = 0; i < 20; i++) await tick();
  while (running.some((x) => x.status().running) && performance.now() < end) await tick();
  for (let i = 0; i < 20; i++) await tick();
};
const remoteDiag = async (api: FakeApi) => (await decryptDoc(await rawKey(5), api.file!.text)).state.diag ?? [];
const seen = (id: string) => (s: AppState): AppState => ({ ...s, momentSeen: { ...s.momentSeen, [id]: 1_700_000_000_000 } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-03T04:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  running.length = 0;
});

describe('Diagnose reist im Sync', () => {
  it('Zeilen eines Geräts stehen im entschlüsselten Stand und kommen auf dem zweiten Gerät an', async () => {
    const api = fakeApi();
    const a = device(api, 'aaaa');
    const b = device(api, 'bbbb');
    a.log('bg: ended pod-0001');
    a.log('bg: next pod-0002');
    a.change(seen('m1'));
    await advance(WRITE_DELAY_MS + 1);
    expect(api.puts).toBe(1);
    expect((await remoteDiag(api)).map((x) => `${x.d} ${x.l}`)).toEqual(['aaaa bg: ended pod-0001', 'aaaa bg: next pod-0002']);
    // zweites Gerät lädt, hat die Zeilen im Zustand, schreibt eigene dazu
    b.log('deck: src local pod-0003');
    await b.sync.syncNow();
    expect(b.state.diag?.map((x) => `${x.d} ${x.l}`)).toEqual(['aaaa bg: ended pod-0001', 'aaaa bg: next pod-0002', 'bbbb deck: src local pod-0003']);
    expect((await remoteDiag(api)).map((x) => x.d)).toEqual(['aaaa', 'aaaa', 'bbbb']);
  });

  it('der Ringpuffer im Stand hat nie mehr als 500 Zeilen, die ältesten fallen heraus', async () => {
    const api = fakeApi();
    const a = device(api, 'aaaa');
    for (let i = 0; i < 700; i++) {
      a.log(`z ${i}`);
      vi.setSystemTime(Date.now() + 1);
    }
    await a.sync.syncNow();
    const d = await remoteDiag(api);
    expect(d.length).toBe(500);
    expect(d[0].l).toBe('z 200');
    expect(d[499].l).toBe('z 699');
  });

  it('nur das Protokoll ist neu: kein Schreiben bei Start oder Rückkehr, Schreiben beim Verlassen und nach 5 Minuten', async () => {
    const api = fakeApi();
    const a = device(api, 'aaaa');
    a.log('erste');
    await a.sync.syncNow();
    expect(api.puts).toBe(1);
    // neue Zeile, sonst nichts geändert: Rückkehr in die App (visible true) schreibt nicht
    vi.setSystemTime(Date.now() + 1000);
    a.log('zweite');
    a.sync.visible(true);
    await advance(100);
    expect(api.puts).toBe(1);
    // Verlassen der App spült sofort, auch ohne weitere Änderung
    a.sync.visible(false);
    await advance(100);
    expect(api.puts).toBe(2);
    expect((await remoteDiag(api)).map((x) => x.l)).toEqual(['erste', 'zweite']);
    // wieder nur Protokoll, Rückkehr schreibt erst nach DIAG_FLUSH_MS
    vi.setSystemTime(Date.now() + 1000);
    a.log('dritte');
    a.sync.visible(true);
    await advance(100);
    expect(api.puts).toBe(2);
    await advance(DIAG_FLUSH_MS);
    a.sync.visible(true);
    await advance(100);
    expect(api.puts).toBe(3);
    expect((await remoteDiag(api)).map((x) => x.l)).toEqual(['erste', 'zweite', 'dritte']);
  });

  it('Verlassen ohne neue Zeilen und ohne Änderung tut nichts', async () => {
    const api = fakeApi();
    const a = device(api, 'aaaa');
    a.log('nur');
    await a.sync.syncNow();
    const calls = api.calls.length;
    a.sync.visible(false);
    await advance(100);
    expect(api.calls.length).toBe(calls);
  });

  it('ohne diag-Abhängigkeit verhält sich der Sync wie vorher, im Dokument steht kein Feld diag', async () => {
    const api = fakeApi();
    const state = { s: emptyState() };
    const sync = createSync({ getState: () => state.s, adopt: (fn) => (state.s = fn(state.s)), getKey: () => rawKey(5), getToken: async () => TOKEN, fetchImpl: api.fetch, now: () => Date.now() });
    running.push(sync);
    await sync.syncNow();
    expect(api.puts).toBe(1);
    const doc = await decryptDoc(await rawKey(5), api.file!.text);
    expect('diag' in doc.state).toBe(false);
  });
});
