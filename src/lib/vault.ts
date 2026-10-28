// Schlüssel einmalig aus #k=..., als nicht extrahierbarer CryptoKey in IndexedDB, Fragment danach entfernen (Spike T4).
// Zusätzlich (Max, 26.10.2026): der Schlüsseltext doppelt gesichert, in IndexedDB und im Cache Storage,
// damit ein geleerter Speicher den anderen wiederherstellt und "Unlock another device" den Link bauen kann.
// Geräte-Sync (Max, 28.10.2026): dazu kommt das GitHub-Token, mit dem Pool-Schlüssel verschlüsselt, am selben Ort (IndexedDB und Cache Storage).
// Das Token verlässt das Gerät nur im QR-Code von "Unlock another device", wieder verschlüsselt, und beim Sync zu api.github.com.
import { decryptToken, encryptToken, TOKEN_OK } from './sync/crypto';

const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('core-key', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('k', mode);
    const q = fn(t.objectStore('k'));
    t.oncomplete = () => res(q ? (q.result as T) : undefined);
    t.onerror = () => rej(t.error);
  });
}

const KEY_CACHE = 'core-key';
const keyUrl = () => new URL(`${import.meta.env.BASE_URL}__key`, location.origin).href;
const RAW = /^[A-Za-z0-9_-]{40,}$/;

async function cacheRead(): Promise<string | null> {
  try {
    const r = await (await caches.open(KEY_CACHE)).match(keyUrl());
    const t = r ? (await r.text()).trim() : '';
    return RAW.test(t) ? t : null;
  } catch {
    return null;
  }
}
async function cacheWrite(raw: string) {
  try {
    await (await caches.open(KEY_CACHE)).put(keyUrl(), new Response(raw, { headers: { 'content-type': 'text/plain' } }));
  } catch {
    /* Cache Storage nicht verfügbar (z.B. privater Modus), IndexedDB reicht */
  }
}
async function idbRaw(): Promise<string | null> {
  try {
    const t = await idb<string>('readonly', (s) => s.get('raw'));
    return t && RAW.test(t) ? t : null;
  } catch {
    return null;
  }
}

async function saveRaw(raw: string) {
  // decrypt für den Pool, encrypt für den Sync (Zustand wird mit demselben Schlüssel verschlüsselt)
  const key = await crypto.subtle.importKey('raw', b64u(raw), 'AES-GCM', false, ['decrypt', 'encrypt']);
  await idb('readwrite', (s) => {
    s.put(key, 'main');
    s.put(raw, 'raw');
  });
  await cacheWrite(raw);
}

/** Speichert den Schlüssel aus einem Text, der den Freischalt-Link enthält (Adresse oder eingefügter Link). Ein mitgelieferter Token (t=...) wird entschlüsselt und gespeichert. */
export async function storeKeyFrom(text: string): Promise<boolean> {
  const m = text.match(/k=([A-Za-z0-9_-]{40,})/);
  if (!m) return false;
  await saveRaw(m[1]);
  const t = text.match(/[#&?]t=([A-Za-z0-9_-]{40,})/);
  if (t) {
    const key = await syncKey();
    const token = key ? await decryptToken(key, t[1]) : null;
    if (token) await saveToken(token);
  }
  return true;
}

/** Schlüssel für den Sync aus dem Schlüsseltext (Ver- und Entschlüsseln). null, wenn dieses Gerät nur das alte Format hat. */
export async function syncKey(): Promise<CryptoKey | null> {
  const raw = (await idbRaw()) ?? (await cacheRead());
  return raw ? crypto.subtle.importKey('raw', b64u(raw), 'AES-GCM', false, ['decrypt', 'encrypt']) : null;
}

// ---------- GitHub-Token für den Sync ----------

const TOKEN_CACHE = 'core-token';
const tokenUrl = () => new URL(`${import.meta.env.BASE_URL}__token`, location.origin).href;

async function tokenCacheRead(): Promise<string | null> {
  try {
    const r = await (await caches.open(TOKEN_CACHE)).match(tokenUrl());
    const t = r ? (await r.text()).trim() : '';
    return /^[A-Za-z0-9_-]{40,}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}
async function tokenCacheWrite(enc: string | null) {
  try {
    const c = await caches.open(TOKEN_CACHE);
    if (enc) await c.put(tokenUrl(), new Response(enc, { headers: { 'content-type': 'text/plain' } }));
    else await c.delete(tokenUrl());
  } catch {
    /* Cache Storage nicht verfügbar, IndexedDB reicht */
  }
}
async function tokenIdb(): Promise<string | null> {
  try {
    const t = await idb<string>('readonly', (st) => st.get('gh'));
    return t && /^[A-Za-z0-9_-]{40,}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Token speichern, verschlüsselt mit dem Pool-Schlüssel. false, wenn das Token nicht wie ein GitHub-Token aussieht oder der Schlüssel fehlt. */
export async function saveToken(token: string): Promise<boolean> {
  const t = token.trim();
  const key = await syncKey();
  if (!TOKEN_OK.test(t) || !key) return false;
  const enc = await encryptToken(key, t);
  await idb('readwrite', (st) => {
    st.put(enc, 'gh');
  });
  await tokenCacheWrite(enc);
  return true;
}

/** Verschlüsselter Token für den QR-Code, null ohne Token */
export async function tokenForLink(): Promise<string | null> {
  const a = await tokenIdb();
  if (a) return a;
  const b = await tokenCacheRead();
  if (b) {
    try {
      await idb('readwrite', (st) => {
        st.put(b, 'gh');
      });
    } catch {
      /* nur Wiederherstellung */
    }
  }
  return b;
}

export async function loadToken(): Promise<string | null> {
  const enc = await tokenForLink();
  const key = await syncKey();
  return enc && key ? decryptToken(key, enc) : null;
}

export async function clearToken(): Promise<void> {
  await idb('readwrite', (st) => {
    st.delete('gh');
  });
  await tokenCacheWrite(null);
}

/**
 * Liest einen neuen Schlüssel aus dem Fragment (falls vorhanden) und liefert den gespeicherten.
 * Fehlt er in IndexedDB, kommt er aus dem Cache Storage zurück. Fehlt die Cache-Kopie, wird sie nachgetragen.
 */
export async function unlockKey(): Promise<CryptoKey | null> {
  if (await storeKeyFrom(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  let key: CryptoKey | null = null;
  try {
    key = (await idb<CryptoKey>('readonly', (s) => s.get('main'))) ?? null;
  } catch {
    key = null;
  }
  const [inIdb, inCache] = await Promise.all([idbRaw(), cacheRead()]);
  const raw = inIdb ?? inCache;
  if (raw && (!key || !inIdb)) {
    await saveRaw(raw);
    key = (await idb<CryptoKey>('readonly', (s) => s.get('main'))) ?? null;
  } else if (raw && !inCache) await cacheWrite(raw);
  return key;
}

/** Wo der Schlüsseltext liegt. Ältere Installationen haben nur den nicht exportierbaren Schlüssel. */
export async function keyBackups(): Promise<{ idb: boolean; cache: boolean }> {
  const [a, b] = await Promise.all([idbRaw(), cacheRead()]);
  return { idb: !!a, cache: !!b };
}

/** Freischalt-Link für ein weiteres Gerät, null wenn der Schlüsseltext auf diesem Gerät fehlt. Mit withToken steht der verschlüsselte Sync-Token dabei (nur für den QR-Code). */
export async function unlockLink(withToken = false): Promise<string | null> {
  const raw = (await idbRaw()) ?? (await cacheRead());
  if (!raw) return null;
  const t = withToken ? await tokenForLink() : null;
  return `${new URL(import.meta.env.BASE_URL, location.origin).href}#k=${raw}${t ? `&t=${t}` : ''}`;
}

/** null, wenn die Datei (noch) nicht existiert */
export async function decryptJson<T>(key: CryptoKey, url: string): Promise<T | null> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const enc = (await res.json()) as { iv: string; ct: string };
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u(enc.iv) }, key, b64u(enc.ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
