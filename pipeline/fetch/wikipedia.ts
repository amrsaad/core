// Wikimedia Feed (de): Artikel des Tages und "Was geschah am".
import { getJson, sleep } from '../http';
import type { RawRecord } from '../raw';
import { daysAgo, type FetchContext } from './context';

interface WikiPage {
  title?: string;
  normalizedtitle?: string;
  titles?: { normalized?: string };
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  type?: string;
}

interface FeaturedResponse {
  tfa?: WikiPage;
  onthisday?: { text?: string; year?: number; pages?: WikiPage[] }[];
}

const ENDPOINTS = [
  (d: string) => `https://api.wikimedia.org/feed/v1/wikipedia/de/featured/${d.replaceAll('-', '/')}`,
  (d: string) => `https://de.wikipedia.org/api/rest_v1/feed/featured/${d.replaceAll('-', '/')}`,
];

function record(p: WikiPage, api: { url: string; status: number }, now: string, kind: string): RawRecord | null {
  const title = p.titles?.normalized ?? p.normalizedtitle ?? p.title?.replaceAll('_', ' ');
  const url = p.content_urls?.desktop?.page ?? (title ? `https://de.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}` : '');
  if (!title || !p.extract || !url || p.type === 'disambiguation') return null;
  return {
    sourceId: `wiki:de:${title}`,
    source: 'wikipedia',
    area: 'brain',
    topic: 'varia',
    url,
    urlStatus: 0,
    api,
    title,
    publisher: 'Wikipedia',
    content: { extract: p.extract },
    meta: { kind },
    fetchedAt: now,
  };
}

export async function fetchWikipedia(ctx: FetchContext): Promise<RawRecord[]> {
  const now = new Date().toISOString();
  const out = new Map<string, RawRecord>();
  const days = ctx.seed ? 40 : 1;
  for (let i = 0; i < days; i++) {
    const d = daysAgo(ctx.date, i);
    let res: { status: number; data?: FeaturedResponse } = { status: 0 };
    let url = '';
    for (const ep of ENDPOINTS) {
      url = ep(d);
      res = await getJson<FeaturedResponse>(url);
      if (res.status === 200) break;
    }
    const api = { url, status: res.status };
    const pages: [WikiPage, string][] = [];
    if (res.data?.tfa) pages.push([res.data.tfa, 'tfa']);
    // Pro Tag höchstens zwei "Was geschah am"-Artikel, damit Varia nicht dominiert
    for (const e of (res.data?.onthisday ?? []).slice(0, 2)) if (e.pages?.[0]) pages.push([e.pages[0], 'onthisday']);
    for (const [p, kind] of pages) {
      const r = record(p, api, now, kind);
      if (r && !ctx.known.has(r.sourceId)) out.set(r.sourceId, r);
    }
    console.log(`  wikipedia ${d}: HTTP ${res.status}, ${pages.length} Artikel`);
    await sleep(200);
  }
  return [...out.values()];
}
