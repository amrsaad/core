// AES-GCM wie pool.enc: Datei ist {"v":1,"iv":"<base64url>","ct":"<base64url, Chiffretext plus 16 Byte Tag>"}.
// Gleiche Form in ios/Core/SyncClient.swift. Der Schlüssel ist der Pool-Schlüssel.
import { canon, SYNC_VERSION, type SyncDoc } from './merge';

export const b64uEncode = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const b64uDecode = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export class CryptoFail extends Error {
  constructor(public kind: 'key' | 'format', message: string) {
    super(message);
  }
}

export async function encryptText(key: CryptoKey, plain: string): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  return { iv, ct };
}

export async function encryptDoc(key: CryptoKey, doc: SyncDoc): Promise<string> {
  const { iv, ct } = await encryptText(key, canon(doc));
  return JSON.stringify({ v: SYNC_VERSION, iv: b64uEncode(iv), ct: b64uEncode(ct) });
}

export async function decryptDoc(key: CryptoKey, text: string): Promise<SyncDoc> {
  let env: { iv?: unknown; ct?: unknown };
  try {
    env = JSON.parse(text);
  } catch {
    throw new CryptoFail('format', 'The sync file has an unexpected format.');
  }
  if (typeof env.iv !== 'string' || typeof env.ct !== 'string') throw new CryptoFail('format', 'The sync file has an unexpected format.');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDecode(env.iv) }, key, b64uDecode(env.ct));
  } catch {
    throw new CryptoFail('key', 'The sync file does not match this unlock key.');
  }
  try {
    const doc = JSON.parse(new TextDecoder().decode(plain)) as SyncDoc;
    if (!doc || typeof doc !== 'object' || typeof doc.v !== 'number' || !doc.state || !doc.ts) throw new Error('shape');
    return doc;
  } catch {
    throw new CryptoFail('format', 'The sync file has an unexpected format.');
  }
}

/** Token für den QR-Code: base64url(iv + Chiffretext), nur mit dem Pool-Schlüssel lesbar */
export async function encryptToken(key: CryptoKey, token: string): Promise<string> {
  const { iv, ct } = await encryptText(key, token);
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv, 0);
  all.set(ct, iv.length);
  return b64uEncode(all);
}

export async function decryptToken(key: CryptoKey, s: string): Promise<string | null> {
  try {
    const all = b64uDecode(s);
    if (all.length < 12 + 16 + 1) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
    const t = new TextDecoder().decode(plain);
    return TOKEN_OK.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Fine-grained (github_pat_...) und klassische Token (ghp_...): keine Leerzeichen, mindestens 20 Zeichen */
export const TOKEN_OK = /^[A-Za-z0-9_]{20,255}$/;
