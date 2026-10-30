const UA = 'core-feed/1.0 (personal knowledge feed; https://github.com/amrsaad/core)';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function get(url: string, opts: { accept?: string; retries?: number; timeoutMs?: number } = {}): Promise<{ status: number; text: string }> {
  const { accept = 'application/json', retries = 2, timeoutMs = 30_000 } = opts;
  let last: { status: number; text: string } = { status: 0, text: '' };
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      last = { status: res.status, text: await res.text() };
      if (res.status < 500 && res.status !== 429) return last;
    } catch (e) {
      last = { status: 0, text: String(e) };
    }
    await sleep(1500 * (i + 1));
  }
  return last;
}

export async function getJson<T>(url: string): Promise<{ status: number; data?: T }> {
  const r = await get(url);
  if (r.status !== 200) {
    console.warn(`  HTTP ${r.status} ${url}\n  ${r.text.slice(0, 200)}`);
    return { status: r.status };
  }
  try {
    return { status: 200, data: JSON.parse(r.text) as T };
  } catch {
    console.warn(`  Ungültiges JSON von ${url}`);
    return { status: 0 };
  }
}

/** Prüft, ob die Quell-URL HTTP 200 liefert (nach Redirects). */
export async function checkUrl(url: string): Promise<number> {
  const r = await get(url, { accept: 'text/html,*/*', retries: 1, timeoutMs: 20_000 });
  return r.status;
}

/** Status 200 nur, wenn die Antwort 200 ist und den erwarteten Inhalt enthält. */
export async function checkContains(url: string, needle: string): Promise<number> {
  const r = await get(url, { retries: 1, timeoutMs: 20_000 });
  if (r.status !== 200) return r.status;
  return r.text.replace(/\s/g, '').includes(needle.replace(/\s/g, '')) ? 200 : 404;
}

/** Führt fn für alle Elemente mit begrenzter Parallelität aus. */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>, delayMs = 0): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
        if (delayMs) await sleep(delayMs);
      }
    }),
  );
  return out;
}
