// Runde 14: Sync-Stand wird vor dem Verschlüsseln mit gzip gepackt. Umschlag {v:1, z:"gzip", iv, ct}, ohne z wie bisher.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { b64uDecode, b64uEncode, canGunzip, canGzip, CryptoFail, decryptDoc, encryptDoc, type PackStats } from '../src/lib/sync/crypto';
import { createSync } from '../src/lib/sync/controller';
import { canon, emptyDoc, toDoc } from '../src/lib/sync/merge';
import { fakeApi } from './sync-fake-api';
import { makeState } from './sync-size-fixture';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const key = (fill = 5) => crypto.subtle.importKey('raw', new Uint8Array(32).fill(fill), 'AES-GCM', false, ['encrypt', 'decrypt']);
afterEach(() => vi.unstubAllGlobals());

/** Umschlag von Hand gebaut, so wie ihn die Pipeline (Node, zlib) oder die alte App schreibt */
async function handBuilt(k: CryptoKey, plain: Uint8Array<ArrayBuffer>, z?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, plain));
  return JSON.stringify({ v: 1, ...(z ? { z } : {}), iv: b64uEncode(iv), ct: b64uEncode(ct) });
}

describe('gzip im Sync-Stand', () => {
  it('Umgebung: CompressionStream und DecompressionStream sind vorhanden (sonst prüfen die Tests nichts)', () => {
    expect(canGzip()).toBe(true);
    expect(canGunzip()).toBe(true);
  });

  it('Stand in realistischer Größe: packen, verschlüsseln, entschlüsseln, entpacken, gleich. Umschlag höchstens 40 Prozent des ungepackten', async () => {
    const doc = toDoc(makeState());
    const k = await key();
    const stats: PackStats = { raw: 0, packed: 0, compressed: false };
    const packedEnv = await encryptDoc(k, doc, stats);
    const j = JSON.parse(packedEnv);
    expect(j.z).toBe('gzip');
    expect(j.v).toBe(1);
    expect(stats.compressed).toBe(true);
    expect(stats.raw).toBe(new TextEncoder().encode(canon(doc)).length);
    expect(stats.packed).toBeLessThan(stats.raw);
    // Gleichheit nach dem Rundlauf
    expect(canon(await decryptDoc(k, packedEnv))).toBe(canon(doc));
    // Vergleich mit dem Umschlag ohne gzip (Browser ohne CompressionStream)
    vi.stubGlobal('CompressionStream', undefined);
    const plainEnv = await encryptDoc(k, doc);
    vi.unstubAllGlobals();
    expect(JSON.parse(plainEnv).z).toBeUndefined();
    const ratio = packedEnv.length / plainEnv.length;
    console.log(`gzip-Messung: roh ${stats.raw} B, gepackt ${stats.packed} B (${((stats.packed / stats.raw) * 100).toFixed(1)} %), Umschlag ungepackt ${plainEnv.length} B, gepackt ${packedEnv.length} B (${(ratio * 100).toFixed(1)} %)`);
    expect(ratio).toBeLessThanOrEqual(0.4);
  });

  it('alter Stand ohne z wird weiter gelesen (JSON-Text als Klartext)', async () => {
    const k = await key();
    const doc = toDoc(makeState({ pool: 700, saved: 3, seen: 20, log: 30, days: 5 }));
    const env = await handBuilt(k, new TextEncoder().encode(canon(doc)));
    expect(JSON.parse(env).z).toBeUndefined();
    expect(canon(await decryptDoc(k, env))).toBe(canon(doc));
  });

  it('Stand, den die Pipeline mit zlib gepackt hat, wird gelesen', async () => {
    const k = await key();
    const doc = toDoc(makeState({ pool: 700, saved: 3, seen: 20, log: 30, days: 5 }));
    const env = await handBuilt(k, new Uint8Array(gzipSync(Buffer.from(canon(doc), 'utf8'))), 'gzip');
    expect(canon(await decryptDoc(k, env))).toBe(canon(doc));
  });

  it('unbekannter Wert von z gibt den Formatfehler mit klarer Meldung', async () => {
    const k = await key();
    const env = await handBuilt(k, new TextEncoder().encode(canon(emptyDoc())), 'br');
    const err = await decryptDoc(k, env).catch((e) => e);
    expect(err).toBeInstanceOf(CryptoFail);
    expect(err).toMatchObject({ kind: 'format', message: 'The sync file uses an unknown compression. Update the app.' });
    // auch ein z, das kein Text ist
    const j = { ...JSON.parse(env), z: 1 };
    await expect(decryptDoc(k, JSON.stringify(j))).rejects.toMatchObject({ kind: 'format', message: 'The sync file uses an unknown compression. Update the app.' });
  });

  it('ohne CompressionStream schreibt encryptDoc unkomprimiert, ohne z, und die Statistik sagt das', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const k = await key();
    const stats: PackStats = { raw: 0, packed: 0, compressed: true };
    const env = await encryptDoc(k, emptyDoc(), stats);
    expect(Object.keys(JSON.parse(env)).sort()).toEqual(['ct', 'iv', 'v']);
    expect(stats.compressed).toBe(false);
    expect(stats.packed).toBe(stats.raw);
    expect(canon(await decryptDoc(k, env))).toBe(canon(emptyDoc()));
  });

  it('komprimierter Stand ohne DecompressionStream gibt einen klaren Fehler statt eines Absturzes', async () => {
    const k = await key();
    const env = await encryptDoc(k, emptyDoc());
    expect(JSON.parse(env).z).toBe('gzip');
    vi.stubGlobal('DecompressionStream', undefined);
    const err = await decryptDoc(k, env).catch((e) => e);
    expect(err).toBeInstanceOf(CryptoFail);
    expect(err).toMatchObject({ kind: 'format' });
    expect(err.message).toMatch(/compressed/);
    // ein unkomprimierter Stand geht weiter
    vi.unstubAllGlobals();
    vi.stubGlobal('DecompressionStream', undefined);
    const plain = await handBuilt(k, new TextEncoder().encode(canon(emptyDoc())));
    expect(canon(await decryptDoc(k, plain))).toBe(canon(emptyDoc()));
  });

  it('beschädigter gzip-Inhalt ist ein Formatfehler, kein Absturz', async () => {
    const k = await key();
    const env = await handBuilt(k, new TextEncoder().encode('das ist kein gzip'), 'gzip');
    await expect(decryptDoc(k, env)).rejects.toMatchObject({ kind: 'format' });
  });

  it('falscher Schlüssel bleibt ein Schlüsselfehler, auch bei gepacktem Stand', async () => {
    const env = await encryptDoc(await key(1), emptyDoc());
    await expect(decryptDoc(await key(2), env)).rejects.toMatchObject({ kind: 'key' });
  });

  it('Diagnose: je Upload eine Zeile "sync: packed <roh> kB to <gepackt> kB", die PUT-Zeile bleibt', async () => {
    const api = fakeApi();
    const lines: string[] = [];
    const s = createSync({ getState: () => makeState(), adopt: () => {}, getKey: () => key(), getToken: async () => TOKEN, fetchImpl: api.fetch as typeof fetch, log: (l) => lines.push(l) });
    await s.start();
    s.stop();
    const packed = lines.filter((l) => l.startsWith('sync: packed'));
    expect(packed).toEqual([expect.stringMatching(/^sync: packed \d+ kB to \d+ kB$/)]);
    const [, raw, gz] = /packed (\d+) kB to (\d+) kB/.exec(packed[0])!.map(Number);
    expect(gz).toBeLessThan(raw);
    expect(lines.filter((l) => l.startsWith('sync: PUT ok'))).toEqual([expect.stringMatching(/^sync: PUT ok \d+ kB in \d+\.\d s$/)]);
    // der hochgeladene Stand ist gepackt und lesbar
    expect(JSON.parse(api.file!.text).z).toBe('gzip');
    expect((await decryptDoc(await key(), api.file!.text)).state).toHaveProperty('momentSeen');
  });

  it('Base64-Helfer: b64uDecode(b64uEncode(x)) bleibt gleich (Packen ändert die Kodierung nicht)', () => {
    const x = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(b64uDecode(b64uEncode(x)))).toEqual(Array.from(x));
  });
});
