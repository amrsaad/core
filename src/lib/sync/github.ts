// Einziger Netzwerkzugriff des Syncs: api.github.com, Contents API, eine Datei in core-content.
// Gleiche Regeln in ios/Core/SyncClient.swift. Das Token kommt von außen und steht nie im Code.
export const API_HOST = 'https://api.github.com';
export const REPO = 'amrsaad/core-content';
export const STATE_PATH = 'state/core-state.enc';
/** Core Digest: Wochenkarte, wöchentlich von der Aufgabe geschrieben, von der App nur gelesen */
export const DIGEST_PATH = 'state/digest-latest.enc';

export type SyncErrorKind = 'auth' | 'forbidden' | 'notfound' | 'conflict' | 'rate' | 'offline' | 'server' | 'format' | 'key' | 'setup';

export class SyncError extends Error {
  constructor(public kind: SyncErrorKind, message: string, public status?: number) {
    super(message);
  }
  /** Lohnt sich ein späterer Versuch ohne Zutun des Nutzers? */
  get retry() {
    return this.kind === 'offline' || this.kind === 'server' || this.kind === 'rate';
  }
}

type Fetch = typeof fetch;

const headers = (token: string): Record<string, string> => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' });

const utf8 = (b64: string): string => {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
const toB64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Fehlertext in einer Zeile, ohne Token oder Antwortinhalt */
export function failure(status: number, rateLimited = false): SyncError {
  if (status === 401) return new SyncError('auth', 'GitHub rejected the token (401). Paste a new one.', status);
  if (status === 403 && rateLimited) return new SyncError('rate', 'GitHub rate limit reached (403). Will retry.', status);
  if (status === 429) return new SyncError('rate', 'GitHub rate limit reached (429). Will retry.', status);
  if (status === 403) return new SyncError('forbidden', 'The token cannot write to core-content (403). Check its repository and Contents permission.', status);
  if (status === 404) return new SyncError('notfound', 'core-content not found for this token (404). Check the token’s repository access.', status);
  if (status === 409 || status === 422) return new SyncError('conflict', `The sync file changed (${status}).`, status);
  return new SyncError('server', `GitHub is not available (${status}). Will retry.`, status);
}

const net = (): SyncError => new SyncError('offline', 'No connection to GitHub. Will retry.');

/** Eine Anfrage, die nach einem Netzabbruch hängt, blockiert sonst jeden weiteren Lauf. Nach 20 s zählt sie als kein Netz. */
export const REQUEST_TIMEOUT_MS = 20_000;
async function req(f: Fetch, url: string, init: RequestInit): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await f(url, { ...init, signal: c.signal });
  } catch {
    throw net();
  } finally {
    clearTimeout(t);
  }
}

const rateLimited = (r: Response) => r.headers.get('x-ratelimit-remaining') === '0';

/** null, wenn die Datei noch nicht existiert */
export async function readRemote(token: string, f: Fetch = fetch, path: string = STATE_PATH): Promise<{ text: string; sha: string } | null> {
  const r = await req(f, `${API_HOST}/repos/${REPO}/contents/${path}`, { headers: headers(token), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw failure(r.status, rateLimited(r));
  const j = (await r.json()) as { sha?: string; size?: number; content?: string; encoding?: string };
  if (!j.sha) throw new SyncError('format', 'GitHub sent an unexpected answer.');
  if (j.encoding === 'base64' && typeof j.content === 'string' && (j.content.length > 0 || j.size === 0)) return { text: utf8(j.content), sha: j.sha };
  // Dateien über 1 MB liefert die Contents API ohne Inhalt, dann über den Blob
  const b = await req(f, `${API_HOST}/repos/${REPO}/git/blobs/${j.sha}`, { headers: headers(token), cache: 'no-store' });
  if (!b.ok) throw failure(b.status, rateLimited(b));
  const blob = (await b.json()) as { content?: string; encoding?: string };
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new SyncError('format', 'GitHub sent an unexpected answer.');
  return { text: utf8(blob.content), sha: j.sha };
}

export async function writeRemote(token: string, text: string, sha: string | null, message: string, f: Fetch = fetch): Promise<string> {
  const r = await req(f, `${API_HOST}/repos/${REPO}/contents/${STATE_PATH}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: toB64(text), ...(sha ? { sha } : {}) }),
    cache: 'no-store',
  });
  if (!r.ok) throw failure(r.status, rateLimited(r));
  const j = (await r.json()) as { content?: { sha?: string } };
  return j.content?.sha ?? '';
}
