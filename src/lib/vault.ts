// Schlüssel einmalig aus #k=..., als nicht extrahierbarer CryptoKey in IndexedDB, Fragment danach entfernen (Spike T4).
// Zusätzlich (Max, 26.10.2026): der Schlüsseltext doppelt gesichert, in IndexedDB und im Cache Storage,
// damit ein geleerter Speicher den anderen wiederherstellt und "Unlock another device" den Link bauen kann.
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
  const key = await crypto.subtle.importKey('raw', b64u(raw), 'AES-GCM', false, ['decrypt']);
  await idb('readwrite', (s) => {
    s.put(key, 'main');
    s.put(raw, 'raw');
  });
  await cacheWrite(raw);
}

/** Speichert den Schlüssel aus einem Text, der den Freischalt-Link enthält (Adresse oder eingefügter Link). */
export async function storeKeyFrom(text: string): Promise<boolean> {
  const m = text.match(/k=([A-Za-z0-9_-]{40,})/);
  if (!m) return false;
  await saveRaw(m[1]);
  return true;
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

/** Freischalt-Link für ein weiteres Gerät, null wenn der Schlüsseltext auf diesem Gerät fehlt */
export async function unlockLink(): Promise<string | null> {
  const raw = (await idbRaw()) ?? (await cacheRead());
  return raw ? `${new URL(import.meta.env.BASE_URL, location.origin).href}#k=${raw}` : null;
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
