// AES-GCM wie pool.enc: Datei ist {"v":1,"iv":"<base64url>","ct":"<base64url, Chiffretext plus 16 Byte Tag>"}.
// Der Sync-Stand trägt ab Runde 14 meist zusätzlich "z":"gzip" (Klartext vor dem Verschlüsseln ist dann gzip-gepackt).
// Gleiche Form in ios/Core/SyncClient.swift. Der Schlüssel ist der Pool-Schlüssel.
import { canon, SYNC_VERSION, type SyncDoc } from './merge';
import { parseLatest, type DigestLatest } from '../../moments/digest';

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

/** gzip steht in Safari ab 16.4, in Chromium und in WebKit (Tests) zur Verfügung. Ohne diese Klassen schreibt die App unkomprimiert wie bisher. */
export const canGzip = (): boolean => typeof CompressionStream === 'function';
export const canGunzip = (): boolean => typeof DecompressionStream === 'function';

async function throughStream(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Größen eines Schreibvorgangs für die Diagnose: canon(doc) in Bytes und danach (nach gzip), bei unkomprimiertem Schreiben gleich groß */
export interface PackStats {
  raw: number;
  packed: number;
  compressed: boolean;
}

/**
 * Umschlag {v, iv, ct}, bei komprimiertem Stand zusätzlich z: "gzip". Klartext ist dann gzip(UTF-8 von canon(doc)),
 * ohne z wie bisher der JSON-Text. SYNC_VERSION bleibt 1, damit ältere App-Stände nicht ausgesperrt werden.
 */
export async function encryptDoc(key: CryptoKey, doc: SyncDoc, stats?: PackStats): Promise<string> {
  const text = canon(doc);
  const raw = new TextEncoder().encode(text);
  let z = false;
  let body: Uint8Array<ArrayBuffer> = raw;
  if (canGzip()) {
    try {
      body = await throughStream(raw, new CompressionStream('gzip'));
      z = true;
    } catch {
      // Packen schlägt fehl: unkomprimiert schreiben, wie bisher
      body = raw;
    }
  }
  if (stats) {
    stats.raw = raw.length;
    stats.packed = body.length;
    stats.compressed = z;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
  return JSON.stringify({ v: SYNC_VERSION, ...(z ? { z: 'gzip' } : {}), iv: b64uEncode(iv), ct: b64uEncode(ct) });
}

export async function decryptDoc(key: CryptoKey, text: string): Promise<SyncDoc> {
  let env: { iv?: unknown; ct?: unknown; z?: unknown };
  try {
    env = JSON.parse(text);
  } catch {
    throw new CryptoFail('format', 'The sync file has an unexpected format.');
  }
  if (!env || typeof env !== 'object' || typeof env.iv !== 'string' || typeof env.ct !== 'string') throw new CryptoFail('format', 'The sync file has an unexpected format.');
  if (env.z !== undefined && env.z !== 'gzip') throw new CryptoFail('format', 'The sync file uses an unknown compression. Update the app.');
  if (env.z === 'gzip' && !canGunzip()) throw new CryptoFail('format', 'The sync file is compressed and this browser cannot unpack it. Update the browser.');
  let plain: Uint8Array<ArrayBuffer>;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDecode(env.iv) }, key, b64uDecode(env.ct)));
  } catch {
    throw new CryptoFail('key', 'The sync file does not match this unlock key.');
  }
  try {
    if (env.z === 'gzip') plain = await throughStream(plain, new DecompressionStream('gzip'));
    const doc = JSON.parse(new TextDecoder().decode(plain)) as SyncDoc;
    if (!doc || typeof doc !== 'object' || typeof doc.v !== 'number' || !doc.state || !doc.ts) throw new Error('shape');
    return doc;
  } catch {
    throw new CryptoFail('format', 'The sync file has an unexpected format.');
  }
}

/** state/digest-latest.enc (Core Digest): gleicher Umschlag, Inhalt ist die Wochenkarte */
export async function decryptLatest(key: CryptoKey, text: string): Promise<DigestLatest> {
  let env: { iv?: unknown; ct?: unknown };
  try {
    env = JSON.parse(text);
  } catch {
    throw new CryptoFail('format', 'The digest file has an unexpected format.');
  }
  if (typeof env.iv !== 'string' || typeof env.ct !== 'string') throw new CryptoFail('format', 'The digest file has an unexpected format.');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDecode(env.iv) }, key, b64uDecode(env.ct));
  } catch {
    throw new CryptoFail('key', 'The digest file does not match this unlock key.');
  }
  let latest: DigestLatest | null = null;
  try {
    latest = parseLatest(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    /* unten */
  }
  if (!latest) throw new CryptoFail('format', 'The digest file has an unexpected format.');
  return latest;
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
