// Nachgebaute GitHub Contents API für Unit-Tests: eine Datei, SHA-Prüfung, Fehler einschaltbar
import { API_HOST, DIGEST_PATH, REPO, STATE_PATH } from '../src/lib/sync/github';

export interface FakeApi {
  fetch: typeof fetch;
  file: { text: string; sha: string } | null;
  /** Core Digest: state/digest-latest.enc, nur lesbar */
  digest: { text: string; sha: string } | null;
  calls: { method: string; url: string; auth: string | null }[];
  puts: number;
  /** Nächste Anfragen mit diesem Status beantworten */
  failNext: number[];
  offline: boolean;
  /** Vor dem nächsten PUT ändert ein anderes Gerät die Datei */
  beforePut?: () => void;
  big: boolean;
}

const b64 = (t: string) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
let n = 0;
export const newSha = () => `sha${++n}`;

export function fakeApi(token = 'ghp_TESTTOKENTESTTOKEN1234'): FakeApi {
  const api: FakeApi = {
    file: null,
    digest: null,
    calls: [],
    puts: 0,
    failNext: [],
    offline: false,
    big: false,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const h = (init?.headers ?? {}) as Record<string, string>;
      api.calls.push({ method, url, auth: h.Authorization ?? null });
      if (api.offline) throw new TypeError('Failed to fetch');
      if (!url.startsWith(API_HOST + '/')) throw new Error(`unexpected host ${url}`);
      const f = api.failNext.shift();
      if (f) return new Response('{}', { status: f });
      if (h.Authorization !== `Bearer ${token}`) return new Response('{}', { status: 401 });
      const path = `${API_HOST}/repos/${REPO}/contents/${STATE_PATH}`;
      if (url === `${API_HOST}/repos/${REPO}/contents/${DIGEST_PATH}` && method === 'GET') {
        if (!api.digest) return new Response('{}', { status: 404 });
        return Response.json({ sha: api.digest.sha, size: api.digest.text.length, content: b64(api.digest.text), encoding: 'base64' });
      }
      if (url === path && method === 'GET') {
        if (!api.file) return new Response('{}', { status: 404 });
        return Response.json(api.big ? { sha: api.file.sha, size: 2_000_000, content: '', encoding: 'none' } : { sha: api.file.sha, size: api.file.text.length, content: b64(api.file.text), encoding: 'base64' });
      }
      if (api.file && url === `${API_HOST}/repos/${REPO}/git/blobs/${api.file.sha}`) return Response.json({ content: b64(api.file.text), encoding: 'base64' });
      if (url === path && method === 'PUT') {
        api.beforePut?.();
        api.beforePut = undefined;
        const body = JSON.parse(String(init?.body)) as { content: string; sha?: string };
        if ((api.file?.sha ?? undefined) !== body.sha) return new Response('{}', { status: api.file ? 409 : 422 });
        api.file = { text: unb64(body.content), sha: newSha() };
        api.puts++;
        return Response.json({ content: { sha: api.file.sha } });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch,
  };
  return api;
}
