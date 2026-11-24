// Öffentliche YouTube-Seiten und Feeds, ohne API-Key, ohne Login.
import { decodeEntities } from '../text';
import { sleep } from '../http';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Accept-Language': 'en-US,en;q=0.9',
  // Consent-Seite in der EU überspringen
  Cookie: 'CONSENT=YES+cb; SOCS=CAI',
};

export interface GetOpts {
  redirect?: RequestRedirect;
  method?: string;
  /** Versuche je Abruf (Standard 3) */
  tries?: number;
  /** Zeitgrenze je Versuch in ms (Standard 30000) */
  timeoutMs?: number;
  /** Absolute Frist (Date.now()-Wert). Danach kein Abruf und kein Warten mehr. */
  deadline?: number;
}

export async function ytGet(url: string, opts: GetOpts = {}): Promise<{ status: number; text: string; location?: string }> {
  const tries = opts.tries ?? 3;
  const left = () => (opts.deadline ?? Infinity) - Date.now();
  for (let i = 0; i < tries; i++) {
    if (left() <= 0) return { status: 0, text: 'Zeitbudget erschöpft' };
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: opts.redirect ?? 'follow', method: opts.method ?? 'GET', signal: AbortSignal.timeout(Math.max(1, Math.min(opts.timeoutMs ?? 30_000, left()))) });
      const text = opts.method === 'HEAD' ? '' : await res.text();
      if (res.status === 429 || res.status >= 500) {
        if (i === tries - 1) return { status: res.status, text, location: res.headers.get('location') ?? undefined };
        await sleep(Math.min(3000 * (i + 1), Math.max(0, left())));
        continue;
      }
      return { status: res.status, text, location: res.headers.get('location') ?? undefined };
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      if (i === tries - 1) return { status: 0, text: `${String(e)} ${cause?.code ?? ''} ${cause?.message ?? ''}`.trim() };
      await sleep(Math.min(4000 * (i + 1), Math.max(0, left())));
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

export type ShortCheck = 'short' | 'no' | 'unknown';

/**
 * 200 = Short. Normale Videos leitet /shorts/<id> per 3xx auf /watch um (404 = Video weg).
 * Alles andere (429, 5xx, Timeout, Fristende) ist "unknown": das Ergebnis darf nicht als "kein Short" gemerkt werden.
 */
export async function isShortCheck(id: string, o: { deadline?: number } = {}): Promise<ShortCheck> {
  const opts = { redirect: 'manual' as const, tries: 2, timeoutMs: 10_000, deadline: o.deadline };
  let r = await ytGet(`https://www.youtube.com/shorts/${id}`, { ...opts, method: 'HEAD' });
  if (r.status === 405 || r.status === 0) r = await ytGet(`https://www.youtube.com/shorts/${id}`, opts);
  if (r.status === 200) return 'short';
  if ((r.status >= 300 && r.status < 400) || r.status === 404) return 'no';
  return 'unknown';
}

export async function isShort(id: string): Promise<boolean> {
  return (await isShortCheck(id)) === 'short';
}

export async function oembed(id: string, deadline?: number): Promise<{ title: string; author: string; thumb: string } | null> {
  const r = await ytGet(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/shorts/${id}`)}&format=json`, { tries: 2, timeoutMs: 10_000, deadline });
  if (r.status !== 200) return null;
  try {
    const d = JSON.parse(r.text) as { title: string; author_name: string; thumbnail_url: string };
    return { title: d.title, author: d.author_name, thumb: d.thumbnail_url };
  } catch {
    return null;
  }
}

/** Veröffentlichungsdatum aus der Seite eines Shorts (für den Aktivitätscheck) */
export async function shortPublished(id: string, deadline?: number): Promise<string | null> {
  const r = await ytGet(`https://www.youtube.com/shorts/${id}`, { tries: 2, timeoutMs: 15_000, deadline });
  if (r.status !== 200) return null;
  return r.text.match(/"publishDate":"([^"]+)"/)?.[1] ?? r.text.match(/itemprop="datePublished" content="([^"]+)"/)?.[1] ?? r.text.match(/"uploadDate":"([^"]+)"/)?.[1] ?? null;
}

export const isChannelId = (s: string) => CHANNEL_ID.test(s);
