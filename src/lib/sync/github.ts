// Einziger Netzwerkzugriff des Syncs: api.github.com, Contents API, eine Datei in core-content.
// Gleiche Regeln in ios/Core/SyncClient.swift. Das Token kommt von außen und steht nie im Code.
export const API_HOST = 'https://api.github.com';
export const REPO = 'amrsaad/core-content';
export const STATE_PATH = 'state/core-state.enc';
/** Core Digest: Wochenkarte, wöchentlich von der Aufgabe geschrieben, von der App nur gelesen */
export const DIGEST_PATH = 'state/digest-latest.enc';

export type SyncErrorKind = 'auth' | 'forbidden' | 'notfound' | 'conflict' | 'rate' | 'offline' | 'server' | 'format' | 'key' | 'setup';

/** Kurzer Zusatz hinter dem Status in der Diagnose-Zeile (Issue 45) */
const STATUS_TEXT: Partial<Record<SyncErrorKind, string>> = {
  rate: 'rate limit',
  auth: 'token rejected',
  forbidden: 'no write access',
  notfound: 'repo not found',
  conflict: 'file changed',
  server: 'server error',
};

export class SyncError extends Error {
  /** Anfrage, die gescheitert ist: 'GET contents', 'GET blob', 'GET digest' oder 'PUT contents' (nur für die Diagnose) */
  where?: string;
  /** Bei Abbruch ohne Antwort: 'timeout 20s' oder 'network TypeError online=true' (nur für die Diagnose) */
  detail?: string;
  constructor(public kind: SyncErrorKind, message: string, public status?: number) {
    super(message);
  }
  /** Lohnt sich ein späterer Versuch ohne Zutun des Nutzers? */
  get retry() {
    return this.kind === 'offline' || this.kind === 'server' || this.kind === 'rate';
  }
  /** Eine Zeile für das Diagnose-Protokoll, z. B. "sync: GET contents 403 rate limit". Nie Token, nie Antwortinhalt. */
  get diagLine(): string {
    const what = this.status ? `${this.status} ${STATUS_TEXT[this.kind] ?? ''}`.trim() : (this.detail ?? this.kind);
    return `sync: ${this.where ?? 'run'} ${what}`;
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

/** Fehlertext in einer Zeile, ohne Token oder Antwortinhalt. where nennt die Anfrage für die Diagnose. */
export function failure(status: number, rateLimited = false, where?: string): SyncError {
  const e = failureOf(status, rateLimited);
  e.where = where;
  return e;
}

function failureOf(status: number, rateLimited: boolean): SyncError {
  if (status === 401) return new SyncError('auth', 'GitHub rejected the token (401). Paste a new one.', status);
  if (status === 403 && rateLimited) return new SyncError('rate', 'GitHub rate limit reached (403). Will retry.', status);
  if (status === 429) return new SyncError('rate', 'GitHub rate limit reached (429). Will retry.', status);
  if (status === 403) return new SyncError('forbidden', 'The token cannot write to core-content (403). Check its repository and Contents permission.', status);
  if (status === 404) return new SyncError('notfound', 'core-content not found for this token (404). Check the token’s repository access.', status);
  if (status === 409 || status === 422) return new SyncError('conflict', `The sync file changed (${status}).`, status);
  return new SyncError('server', `GitHub is not available (${status}). Will retry.`, status);
}

/** Eine Anfrage, die nach einem Netzabbruch hängt, blockiert sonst jeden weiteren Lauf. Nach 20 s zählt sie als kein Netz. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Kein Ergebnis von GitHub: Zeitlimit oder Netzfehler. Beides heißt "offline" (Wiederholung), aber die Diagnose sagt, was es war (Issue 45). */
function noAnswer(where: string, timedOut: boolean, e: unknown): SyncError {
  const err = new SyncError('offline', timedOut ? 'GitHub did not answer in 20 s. Will retry.' : 'No connection to GitHub. Will retry.');
  err.where = where;
  const online = typeof navigator !== 'undefined' ? ` online=${navigator.onLine}` : '';
  const name = e instanceof Error ? e.name : typeof e;
  err.detail = timedOut ? `timeout ${REQUEST_TIMEOUT_MS / 1000}s` : `network ${name}${online}`;
  return err;
}

async function req(f: Fetch, url: string, init: RequestInit, where: string): Promise<Response> {
  const c = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => {
    timedOut = true;
    c.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    return await f(url, { ...init, signal: c.signal });
  } catch (e) {
    throw noAnswer(where, timedOut, e);
  } finally {
    clearTimeout(t);
  }
}

/** Ausgeschöpftes Kontingent (remaining 0) oder zweite Sperre mit retry-after (GitHub antwortet dann ebenfalls mit 403): beides später noch einmal versuchen */
const rateLimited = (r: Response) => r.headers.get('x-ratelimit-remaining') === '0' || r.headers.has('retry-after');

/** null, wenn die Datei noch nicht existiert */
export async function readRemote(token: string, f: Fetch = fetch, path: string = STATE_PATH): Promise<{ text: string; sha: string } | null> {
  const where = path === DIGEST_PATH ? 'GET digest' : 'GET contents';
  const r = await req(f, `${API_HOST}/repos/${REPO}/contents/${path}`, { headers: headers(token), cache: 'no-store' }, where);
  if (r.status === 404) return null;
  if (!r.ok) throw failure(r.status, rateLimited(r), where);
  const j = (await r.json()) as { sha?: string; size?: number; content?: string; encoding?: string };
  if (!j.sha) throw new SyncError('format', 'GitHub sent an unexpected answer.');
  if (j.encoding === 'base64' && typeof j.content === 'string' && (j.content.length > 0 || j.size === 0)) return { text: utf8(j.content), sha: j.sha };
  // Dateien über 1 MB liefert die Contents API ohne Inhalt, dann über den Blob
  const b = await req(f, `${API_HOST}/repos/${REPO}/git/blobs/${j.sha}`, { headers: headers(token), cache: 'no-store' }, 'GET blob');
  if (!b.ok) throw failure(b.status, rateLimited(b), 'GET blob');
  const blob = (await b.json()) as { content?: string; encoding?: string };
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new SyncError('format', 'GitHub sent an unexpected answer.');
  return { text: utf8(blob.content), sha: j.sha };
}

export async function writeRemote(token: string, text: string, sha: string | null, message: string, f: Fetch = fetch): Promise<string> {
  const r = await req(
    f,
    `${API_HOST}/repos/${REPO}/contents/${STATE_PATH}`,
    {
      method: 'PUT',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: toB64(text), ...(sha ? { sha } : {}) }),
      cache: 'no-store',
    },
    'PUT contents',
  );
  if (!r.ok) throw failure(r.status, rateLimited(r), 'PUT contents');
  const j = (await r.json()) as { content?: { sha?: string } };
  return j.content?.sha ?? '';
}
