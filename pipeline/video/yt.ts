// Öffentliche YouTube-Seiten und Feeds, ohne API-Key, ohne Login.
import { decodeEntities } from '../text';
import { sleep } from '../http';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Accept-Language': 'en-US,en;q=0.9',
  // Consent-Seite in der EU überspringen
  Cookie: 'CONSENT=YES+cb; SOCS=CAI',
};

export async function ytGet(url: string, opts: { redirect?: RequestRedirect; method?: string } = {}): Promise<{ status: number; text: string; location?: string }> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: opts.redirect ?? 'follow', method: opts.method ?? 'GET', signal: AbortSignal.timeout(30_000) });
      const text = opts.method === 'HEAD' ? '' : await res.text();
      if (res.status === 429 || res.status >= 500) {
        await sleep(3000 * (i + 1));
        continue;
      }
      return { status: res.status, text, location: res.headers.get('location') ?? undefined };
    } catch (e) {
      if (i === 2) return { status: 0, text: String(e) };
      await sleep(2000);
    }
  }
  return { status: 429, text: '' };
}

const CHANNEL_ID = /UC[\w-]{22}/;

/** channelId aus einer Kanalseite: canonical-Link, sonst externalId */
export function channelIdFromPage(html: string): string | null {
  const canon = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
  if (canon) return canon[1];
  const ext = html.match(/"externalId":"(UC[\w-]{22})"/);
  return ext ? ext[1] : null;
}

export interface SearchHit { channelId: string; title: string; verified: boolean; handle?: string }

/** Kanal-Treffer aus einer YouTube-Suchseite (ytInitialData) */
export function channelHits(html: string): SearchHit[] {
  const re = /"channelRenderer":\{"channelId":"(UC[\w-]{22})","title":\{"simpleText":"((?:[^"\\]|\\.)*)"\}/g;
  const ms = [...html.matchAll(re)];
  return ms.map((m, i) => {
    // Abschnitt bis zum nächsten Kanal-Treffer: dort stehen Badge und Handle dieses Kanals
    const chunk = html.slice(m.index!, ms[i + 1]?.index ?? m.index! + 6000);
    return {
      channelId: m[1],
      title: JSON.parse(`"${m[2]}"`) as string,
      verified: /BADGE_STYLE_TYPE_VERIFIED/.test(chunk),
      handle: chunk.match(/"canonicalBaseUrl":"\/(@[^"]+)"/)?.[1],
    };
  });
}

export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

/** Name passt, wenn der normalisierte Kanaltitel im Namen steckt oder umgekehrt */
export function nameMatches(name: string, title: string): boolean {
  const parts = name.split(/[\/,]/).map((p) => norm(p)).filter(Boolean);
  const t = norm(title);
  if (!t) return false;
  return parts.some((p) => p === t || p.includes(t) || t.includes(p));
}

export interface FeedEntry { id: string; title: string; published: string; thumb: string }

export function parseFeed(xml: string): FeedEntry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1] ?? '',
    title: decodeEntities(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim(),
    published: e.match(/<published>([^<]+)<\/published>/)?.[1] ?? '',
    thumb: e.match(/<media:thumbnail url="([^"]+)"/)?.[1] ?? '',
  })).filter((x) => x.id);
}

/** Video-IDs aus dem öffentlichen Shorts-Tab eines Kanals */
export function shortsTabIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/"reelWatchEndpoint":\{"videoId":"([\w-]{11})"/g)) ids.add(m[1]);
  for (const m of html.matchAll(/"url":"\/shorts\/([\w-]{11})"/g)) ids.add(m[1]);
  return [...ids];
}

/** 200 = Short. Normale Videos leitet /shorts/<id> per 3xx auf /watch um. */
export async function isShort(id: string): Promise<boolean> {
  let r = await ytGet(`https://www.youtube.com/shorts/${id}`, { redirect: 'manual', method: 'HEAD' });
  if (r.status === 405 || r.status === 0) r = await ytGet(`https://www.youtube.com/shorts/${id}`, { redirect: 'manual' });
  return r.status === 200;
}

export async function oembed(id: string): Promise<{ title: string; author: string; thumb: string } | null> {
  const r = await ytGet(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/shorts/${id}`)}&format=json`);
  if (r.status !== 200) return null;
  try {
    const d = JSON.parse(r.text) as { title: string; author_name: string; thumbnail_url: string };
    return { title: d.title, author: d.author_name, thumb: d.thumbnail_url };
  } catch {
    return null;
  }
}

export const isChannelId = (s: string) => CHANNEL_ID.test(s);
