// Schlüssel einmalig aus #k=..., als nicht extrahierbarer CryptoKey in IndexedDB, Fragment danach entfernen (Spike T4).
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

/** Liest einen neuen Schlüssel aus dem Fragment (falls vorhanden) und liefert den gespeicherten. */
export async function unlockKey(): Promise<CryptoKey | null> {
  const m = location.hash.match(/k=([A-Za-z0-9_-]{40,})/);
  if (m) {
    const key = await crypto.subtle.importKey('raw', b64u(m[1]), 'AES-GCM', false, ['decrypt']);
    await idb('readwrite', (s) => {
      s.put(key, 'main');
    });
    history.replaceState(null, '', location.pathname + location.search);
  }
  return (await idb<CryptoKey>('readonly', (s) => s.get('main'))) ?? null;
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
