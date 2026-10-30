// arXiv API (Atom). Höchstens 1 Request alle 3 s.
import { decodeEntities, normalizeWs } from '../text';
import { get, sleep } from '../http';
import type { RawRecord } from '../raw';
import type { FetchContext } from './context';

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? normalizeWs(decodeEntities(m[1])) : '';
}

export function parseAtom(xml: string): { id: string; title: string; summary: string; published: string; abs: string }[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const idUrl = tag(e, 'id');
    const id = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    return { id, title: tag(e, 'title'), summary: tag(e, 'summary'), published: tag(e, 'published'), abs: `https://arxiv.org/abs/${id}` };
  });
}

export async function fetchArxiv(ctx: FetchContext): Promise<RawRecord[]> {
  const now = new Date().toISOString();
  const out: RawRecord[] = [];
  const pages = ctx.seed ? 2 : 1;
  for (let p = 0; p < pages; p++) {
    const url = `https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL&sortBy=submittedDate&sortOrder=descending&start=${p * 30}&max_results=30`;
    let res = await get(url, { accept: 'application/atom+xml' });
    // arXiv drosselt geteilte Runner-IPs: bei 429 zweimal mit langer Pause erneut
    for (let i = 0; res.status === 429 && i < 2; i++) {
      await sleep(20_000);
      res = await get(url, { accept: 'application/atom+xml', retries: 0 });
    }
    const entries = res.status === 200 ? parseAtom(res.text) : [];
    console.log(`  arxiv p${p + 1}: HTTP ${res.status}, ${entries.length} Einträge`);
    for (const e of entries) {
      const sourceId = `arxiv:${e.id}`;
      if (!e.id || ctx.known.has(sourceId) || out.some((r) => r.sourceId === sourceId)) continue;
      out.push({
        sourceId,
        source: 'arxiv',
        area: 'brain',
        topic: 'ki-allgemein',
        url: e.abs,
        urlStatus: 0,
        api: { url, status: res.status },
        title: e.title,
        publisher: 'arXiv',
        year: Number(e.published.slice(0, 4)) || undefined,
        content: { title: e.title, abstract: e.summary },
        meta: { kind: 'fresh', published: e.published },
        fetchedAt: now,
      });
    }
    await sleep(3100);
  }
  return out;
}
