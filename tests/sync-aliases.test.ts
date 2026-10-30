import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, type Sync } from '../src/lib/sync/controller';
import { decryptDoc } from '../src/lib/sync/crypto';
import { stampChanges } from '../src/lib/sync/merge';
import { buildAliasIndex, migrateDoc } from '../src/moments/aliases';
import { emptyState, type AppState } from '../src/lib/state';
import type { Moment } from '../src/moments/types';
import { fakeApi, type FakeApi } from './sync-fake-api';

const OLD = 'pod-x-1:614.5';
const NEW = 'pod-x-1:586.49';
const mk = (id: string, start: number, extra: Partial<Moment> = {}): Moment => ({ id, videoId: 'pod-x-1', start, end: start + 44, channel: 'c', videoTitle: 't', area: 'body', topic: 'ernaehrung', hook: 'h', kind: 'regel', form: 'audio', hls: 'https://e.org/a.mp3', createdAt: '2026-10-25T00:00:00Z', ...extra });
const idx = buildAliasIndex([mk(NEW, 586.49, { aliases: [OLD] })]);

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const key = () => crypto.subtle.importKey('raw', new Uint8Array(32).fill(5), 'AES-GCM', false, ['encrypt', 'decrypt']);
const running: Sync[] = [];

function device(api: FakeApi, withAliases: boolean) {
  const d = {
    state: emptyState() as AppState,
    sync: undefined as unknown as Sync,
    change(fn: (s: AppState) => AppState) {
      d.state = stampChanges(d.state, fn(d.state), Date.now());
    },
  };
  d.sync = createSync({
    getState: () => d.state,
    adopt: (fn) => (d.state = fn(d.state)),
    getKey: key,
    getToken: async () => TOKEN,
    fetchImpl: api.fetch,
    now: () => Date.now(),
    ...(withAliases ? { resolve: (doc) => migrateDoc(doc, idx) } : {}),
  });
  running.push(d.sync);
  return d;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-30T04:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  running.length = 0;
});

const save = (id: string, start: number) => (s: AppState): AppState => ({ ...s, savedMoments: { ...s.savedMoments, [id]: { moment: mk(id, start), savedAt: '2026-10-28T10:00:00Z' } }, momentSeen: { ...s.momentSeen, [id]: 1_700_000_000_000 } });

describe('Sync mit Alias-Auflösung', () => {
  it('Stand eines alten Geräts kommt mit neuer ID an, und die Datei auf GitHub wird umgestellt', async () => {
    const api = fakeApi();
    const old = device(api, false);
    old.change(save(OLD, 614.5));
    await old.sync.syncNow();
    expect(api.puts).toBe(1);

    const fresh = device(api, true);
    await fresh.sync.syncNow();
    expect(Object.keys(fresh.state.savedMoments)).toEqual([NEW]);
    expect(fresh.state.savedMoments[NEW].moment.id).toBe(NEW);
    expect(Object.keys(fresh.state.momentSeen)).toEqual([NEW]);
    expect(api.puts).toBe(2);
    const file = await decryptDoc(await key(), api.file!.text);
    expect(Object.keys(file.state.savedMoments)).toEqual([NEW]);
    expect(Object.keys(file.state.momentSeen)).toEqual([NEW]);
  });

  it('das alte Gerät bringt die alte ID nicht zurück: das Entfernen am neuen Gerät bleibt bestehen', async () => {
    const api = fakeApi();
    const old = device(api, false);
    old.change(save(OLD, 614.5));
    await old.sync.syncNow();

    vi.setSystemTime(new Date('2026-10-30T04:05:00Z'));
    const fresh = device(api, true);
    await fresh.sync.syncNow();
    vi.setSystemTime(new Date('2026-10-30T04:10:00Z'));
    fresh.change((s) => {
      const { [NEW]: _gone, ...rest } = s.savedMoments;
      return { ...s, savedMoments: rest };
    });
    await fresh.sync.syncNow();

    // Das alte Gerät schreibt erneut (es kennt nur OLD) und lädt danach, was GitHub hat
    old.change((s) => ({ ...s, momentSeen: { ...s.momentSeen, other: 1 } }));
    await old.sync.syncNow();
    await fresh.sync.syncNow();
    expect(fresh.state.savedMoments[NEW]).toBeUndefined();
    expect(fresh.state.savedMoments[OLD]).toBeUndefined();
  });
});
