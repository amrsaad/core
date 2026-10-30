import { describe, expect, it } from 'vitest';
import { createSync } from '../src/lib/sync/controller';
import { b64uEncode, decryptLatest, encryptText } from '../src/lib/sync/crypto';
import { emptyState, type AppState } from '../src/lib/state';
import type { DigestLatest } from '../src/moments/digest';
import { fakeApi, newSha, type FakeApi } from './sync-fake-api';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const rawKey = (fill: number) => crypto.subtle.importKey('raw', new Uint8Array(32).fill(fill), 'AES-GCM', false, ['encrypt', 'decrypt']);

const latest = (week: string): DigestLatest => ({
  v: 1,
  week,
  generatedAt: '2026-10-29T17:19:16.000Z',
  saves: 13,
  counts: { action: 2, habit: 0, rule: 4, know: 9, research: 1, content: 1, script: 1, source: 1, contradiction: 0 },
  actions: [{ id: 'm1', title: 'Record a short talk opening twice, once from the chest', metric: 'Both recordings exist', due: '2026-11-09', url: null }],
  contradictions: [],
});

/** Datei wie apply.ts sie schreibt: {v, iv, ct}, AES-GCM mit dem Pool-Schlüssel, Inhalt ist latest.json */
async function envelope(fill: number, plain: unknown): Promise<string> {
  const { iv, ct } = await encryptText(await rawKey(fill), typeof plain === 'string' ? plain : JSON.stringify(plain));
  return JSON.stringify({ v: 1, iv: b64uEncode(iv), ct: b64uEncode(ct) });
}

function device(api: FakeApi, fill = 5) {
  const d = { state: emptyState() as AppState, adopted: [] as DigestLatest[] };
  const sync = createSync({
    getState: () => d.state,
    adopt: (fn) => (d.state = fn(d.state)),
    adoptDigest: (l) => d.adopted.push(l),
    getKey: () => rawKey(fill),
    getToken: async () => TOKEN,
    fetchImpl: api.fetch,
  });
  return { d, sync };
}

describe('Core Digest: Wochenkarte laden', () => {
  it('decryptLatest liest die Datei der Aufgabe, falscher Schlüssel und kaputte Form werden abgelehnt', async () => {
    const text = await envelope(5, latest('2026-W44'));
    expect((await decryptLatest(await rawKey(5), text)).week).toBe('2026-W44');
    await expect(decryptLatest(await rawKey(6), text)).rejects.toMatchObject({ kind: 'key' });
    await expect(decryptLatest(await rawKey(5), 'kein json')).rejects.toMatchObject({ kind: 'format' });
    await expect(decryptLatest(await rawKey(5), await envelope(5, { v: 1 }))).rejects.toMatchObject({ kind: 'format' });
    await expect(decryptLatest(await rawKey(5), await envelope(5, 'kein json'))).rejects.toMatchObject({ kind: 'format' });
  });

  it('der Sync holt die Wochenkarte nach dem Abgleich, dieselbe Fassung nur einmal', async () => {
    const api = fakeApi();
    api.digest = { text: await envelope(5, latest('2026-W44')), sha: newSha() };
    const { d, sync } = device(api);
    await sync.syncNow();
    expect(d.adopted.map((l) => l.week)).toEqual(['2026-W44']);
    await sync.syncNow();
    expect(d.adopted).toHaveLength(1);
    // neue Woche, neue Datei
    api.digest = { text: await envelope(5, latest('2026-W45')), sha: newSha() };
    await sync.syncNow();
    expect(d.adopted.map((l) => l.week)).toEqual(['2026-W44', '2026-W45']);
    // nur lesen: die Datei wird nie geschrieben
    expect(api.calls.filter((c) => c.method !== 'GET' && c.url.includes('digest'))).toEqual([]);
  });

  it('fehlende, fremde oder kaputte Datei stören den Sync nicht', async () => {
    const api = fakeApi();
    const { d, sync } = device(api);
    await sync.syncNow(); // keine Datei: 404
    expect(sync.status().error).toBeNull();
    api.digest = { text: await envelope(9, latest('2026-W44')), sha: newSha() }; // anderer Schlüssel
    await sync.syncNow();
    expect(sync.status().error).toBeNull();
    api.digest = { text: 'kaputt', sha: newSha() };
    await sync.syncNow();
    expect(sync.status().error).toBeNull();
    expect(d.adopted).toEqual([]);
    expect(sync.status().lastSync).not.toBeNull();
  });

  it('ohne adoptDigest wird die Datei nicht angefragt', async () => {
    const api = fakeApi();
    api.digest = { text: await envelope(5, latest('2026-W44')), sha: newSha() };
    const d = { state: emptyState() as AppState };
    const sync = createSync({ getState: () => d.state, adopt: (fn) => (d.state = fn(d.state)), getKey: () => rawKey(5), getToken: async () => TOKEN, fetchImpl: api.fetch });
    await sync.syncNow();
    expect(api.calls.some((c) => c.url.includes('digest-latest'))).toBe(false);
  });
});
