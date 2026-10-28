import { describe, expect, it } from 'vitest';
import { b64uEncode, decryptDoc, decryptToken, encryptDoc, encryptToken, TOKEN_OK } from '../src/lib/sync/crypto';
import { readRemote, writeRemote } from '../src/lib/sync/github';
import { emptyDoc } from '../src/lib/sync/merge';
import { fakeApi } from './sync-fake-api';

const TOKEN = 'ghp_TESTTOKENTESTTOKEN1234';
const key = async (fill = 7) => crypto.subtle.importKey('raw', new Uint8Array(32).fill(fill), 'AES-GCM', false, ['encrypt', 'decrypt']);

describe('Sync Krypto', () => {
  it('Dokument: Hin und zurück, Format wie pool.enc', async () => {
    const d = emptyDoc();
    d.state.momentDay = '2026-10-28';
    const text = await encryptDoc(await key(), d);
    const j = JSON.parse(text);
    expect(Object.keys(j).sort()).toEqual(['ct', 'iv', 'v']);
    expect(j.v).toBe(1);
    expect(text).not.toContain('2026-10-28');
    expect((await decryptDoc(await key(), text)).state.momentDay).toBe('2026-10-28');
  });
  it('falscher Schlüssel und kaputte Datei sind eigene Fehler', async () => {
    const text = await encryptDoc(await key(1), emptyDoc());
    await expect(decryptDoc(await key(2), text)).rejects.toMatchObject({ kind: 'key' });
    await expect(decryptDoc(await key(1), '{"v":1}')).rejects.toMatchObject({ kind: 'format' });
    await expect(decryptDoc(await key(1), 'kein json')).rejects.toMatchObject({ kind: 'format' });
  });
  it('Token: Hin und zurück, falscher Schlüssel gibt null, Klartext steht nicht im Ergebnis', async () => {
    const enc = await encryptToken(await key(1), TOKEN);
    expect(enc).not.toContain(TOKEN);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decryptToken(await key(1), enc)).toBe(TOKEN);
    expect(await decryptToken(await key(2), enc)).toBeNull();
    expect(await decryptToken(await key(1), 'xx')).toBeNull();
  });
  it('Token-Muster nimmt echte Formen an und lehnt Fremdes ab', () => {
    expect(TOKEN_OK.test('github_pat_11ABCDEFG0abcdefghij_klmnopqrstuvwxyz0123456789')).toBe(true);
    expect(TOKEN_OK.test(TOKEN)).toBe(true);
    expect(TOKEN_OK.test('zu kurz')).toBe(false);
    expect(TOKEN_OK.test('mit leerzeichen und so weiter xxxxxxxx')).toBe(false);
    expect(b64uEncode(new Uint8Array([251, 255]))).toBe('-_8');
  });
});

describe('GitHub Client', () => {
  it('404 heißt keine Datei, dann Anlegen ohne sha', async () => {
    const api = fakeApi();
    expect(await readRemote(TOKEN, api.fetch)).toBeNull();
    const sha = await writeRemote(TOKEN, 'äöü ✓', null, 'm', api.fetch);
    expect(sha).toBeTruthy();
    expect(await readRemote(TOKEN, api.fetch)).toEqual({ text: 'äöü ✓', sha });
  });
  it('Schreiben mit alter sha ist ein Konflikt', async () => {
    const api = fakeApi();
    const s1 = await writeRemote(TOKEN, 'a', null, 'm', api.fetch);
    await writeRemote(TOKEN, 'b', s1, 'm', api.fetch);
    await expect(writeRemote(TOKEN, 'c', s1, 'm', api.fetch)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(writeRemote(TOKEN, 'c', null, 'm', api.fetch)).rejects.toMatchObject({ kind: 'conflict' });
  });
  it('große Datei kommt über den Blob', async () => {
    const api = fakeApi();
    await writeRemote(TOKEN, 'groß', null, 'm', api.fetch);
    api.big = true;
    expect((await readRemote(TOKEN, api.fetch))?.text).toBe('groß');
    expect(api.calls.some((c) => c.url.includes('/git/blobs/'))).toBe(true);
  });
  it('Fehlertexte: eine Zeile, ohne Token, richtige Art', async () => {
    const api = fakeApi();
    const kinds: Record<number, string> = { 401: 'auth', 403: 'forbidden', 429: 'rate', 500: 'server', 503: 'server' };
    for (const [status, kind] of Object.entries(kinds)) {
      api.failNext.push(Number(status));
      const e = await readRemote(TOKEN, api.fetch).catch((x) => x);
      expect(e.kind).toBe(kind);
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).not.toContain('\n');
    }
    api.offline = true;
    await expect(readRemote(TOKEN, api.fetch)).rejects.toMatchObject({ kind: 'offline', retry: true });
  });
  it('falsches Token wird abgelehnt, nur api.github.com, Token nur im Header', async () => {
    const api = fakeApi();
    await expect(readRemote('ghp_ANDERESTOKENANDERES999', api.fetch)).rejects.toMatchObject({ kind: 'auth', retry: false });
    await readRemote(TOKEN, api.fetch);
    for (const c of api.calls) {
      expect(new URL(c.url).host).toBe('api.github.com');
      expect(c.url).not.toContain('ghp_');
    }
  });
});

describe('Datei für die iOS-Tests', () => {
  it('tests/fixtures/sync-file.json lässt sich mit dem festen Schlüssel lesen (Swift liest dieselbe Datei)', async () => {
    const { readFileSync } = await import('node:fs');
    const f = JSON.parse(readFileSync(new URL('./fixtures/sync-file.json', import.meta.url), 'utf8'));
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(f.key.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt']);
    expect(await decryptDoc(key, f.file)).toEqual(f.doc);
    expect(await decryptToken(key, f.encToken)).toBe(f.token);
  });
});
