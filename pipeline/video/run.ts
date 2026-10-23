// Video-Pipeline: Kanal-IDs auflösen, Shorts holen, per /shorts/ bestätigen, Pool ergänzen.
// Aufruf: tsx pipeline/video/run.ts [--seed]
import { join } from 'node:path';
import type { Channel, Video, VideoPool } from '../../src/videoTypes';
import { pool as runPool, sleep } from '../http';
import { readJson, ROOT, writeJson } from '../raw';
import { channelHits, channelIdFromPage, isChannelId, isShort, nameMatches, norm, oembed, parseFeed, shortPublished, shortsTabIds, ytGet, type FeedEntry } from './yt';

const CHANNELS = join(ROOT, 'content', 'channels.json');
const POOL = join(ROOT, 'public', 'videos', 'pool.json');
const INACTIVE_DAYS = 60;

async function resolve(c: Channel): Promise<void> {
  const q = c.query.trim();
  const direct = q.match(/\/channel\/(UC[\w-]{22})/);
  if (direct) {
    const r = await ytGet(`https://www.youtube.com/channel/${direct[1]}`);
    Object.assign(c, r.status === 200 ? { channelId: direct[1], resolvedBy: 'channel-url', resolvedTitle: pageTitle(r.text) } : { status: 'unresolved', note: `Kanalseite HTTP ${r.status}` });
    return;
  }
  if (q.startsWith('http') || q.startsWith('@')) {
    const url = q.startsWith('@') ? `https://www.youtube.com/${q}` : q;
    const r = await ytGet(url);
    const id = r.status === 200 ? channelIdFromPage(r.text) : null;
    if (id) Object.assign(c, { channelId: id, resolvedBy: url, resolvedTitle: pageTitle(r.text) });
    else Object.assign(c, { status: 'unresolved', note: `${url}: HTTP ${r.status}, keine channelId gefunden` });
    return;
  }
  // Suche, nur Kanal-Treffer (sp=EgIQAg%3D%3D), erster Treffer mit passendem Namen, verifizierte bevorzugt
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`;
  const r = await ytGet(url);
  const hits = r.status === 200 ? channelHits(r.text) : [];
  const ok = hits.filter((h) => nameMatches(`${c.name}/${q}`, h.title));
  const exact = (h: (typeof hits)[number]) => `${c.name}/${q}`.split(/[\/,]/).some((p) => norm(p) === norm(h.title));
  const best = ok.find((h) => exact(h) && h.verified) ?? ok.find(exact) ?? ok.find((h) => h.verified) ?? ok[0];
  if (best) Object.assign(c, { channelId: best.channelId, resolvedBy: `search:${q}`, resolvedTitle: best.title, verified: best.verified, note: best.handle });
  else Object.assign(c, { status: 'unresolved', note: `Suche HTTP ${r.status}${r.status ? '' : ` (${r.text.slice(0, 120)})`}, Treffer: ${hits.slice(0, 3).map((h) => h.title).join(' | ') || 'keine'}` });
}

function pageTitle(html: string): string | undefined {
  return html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
}

async function feed(url: string): Promise<{ status: number; entries: FeedEntry[] }> {
  const r = await ytGet(url);
  return { status: r.status, entries: r.status === 200 ? parseFeed(r.text) : [] };
}

async function main() {
  const file = readJson<{ _info?: string; channels: Channel[] }>(CHANNELS, { channels: [] });
  const poolFile = readJson<VideoPool>(POOL, { updatedAt: '', videos: [] });
  const known = new Set(poolFile.videos.map((v) => v.id));
  const added: Video[] = [];
  const report: string[] = [];

  for (const c of file.channels) {
    // Nicht aufgelöste Kanäle bei jedem Lauf erneut versuchen
    if (!c.channelId) {
      delete c.status;
      delete c.note;
      await resolve(c);
      console.log(`resolve ${c.name}: ${c.channelId ?? 'UNRESOLVED'} ${c.resolvedTitle ?? ''} ${c.verified ? '(verifiziert)' : ''} ${c.note ?? ''}`);
      await sleep(2500);
    }
  }

  for (const c of file.channels) {
    if (!c.channelId || !isChannelId(c.channelId)) continue;
    const uush = await feed(`https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH${c.channelId.slice(2)}`);
    let entries = uush.entries;
    let via = `UUSH ${uush.status}`;
    if (!entries.length) {
      const all = await feed(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`);
      entries = all.entries;
      via += `, channel-feed ${all.status}`;
    }
    const byId = new Map(entries.map((e) => [e.id, e]));
    // Die RSS-Feeds liefern derzeit oft 404: der öffentliche Shorts-Tab ist deshalb immer dabei (neueste zuerst)
    let newestTabId: string | undefined;
    {
      const tab = await ytGet(`https://www.youtube.com/channel/${c.channelId}/shorts`);
      const ids = tab.status === 200 ? shortsTabIds(tab.text) : [];
      via += `, shorts-tab ${tab.status} (${ids.length})`;
      newestTabId = ids[0];
      for (const id of ids) if (!byId.has(id)) byId.set(id, { id, title: '', published: '', thumb: '' });
    }
    const fresh = [...byId.values()].filter((e) => !known.has(e.id));
    const checked = await runPool(fresh, 4, async (e) => ({ e, short: await isShort(e.id) }), 120);
    const shorts = checked.filter((x) => x.short).map((x) => x.e);
    // Titel für Einträge aus dem Shorts-Tab über oEmbed
    await runPool(shorts.filter((e) => !e.title), 3, async (e) => {
      const o = await oembed(e.id);
      if (o) Object.assign(e, { title: o.title, thumb: o.thumb });
    }, 120);
    for (const e of shorts) {
      if (!e.title) continue;
      known.add(e.id);
      added.push({ id: e.id, channelId: c.channelId, channelName: c.name, area: c.area, topic: c.topic, lang: c.lang, title: e.title, published: e.published || null, thumb: e.thumb || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg` });
    }
    // Datum des neuesten Shorts aus dem Tab, falls der Feed keines lieferte
    if (newestTabId && !entries.some((e) => e.id === newestTabId)) {
      const pub = await shortPublished(newestTabId);
      if (pub) {
        const v = added.find((x) => x.id === newestTabId) ?? poolFile.videos.find((x) => x.id === newestTabId);
        if (v && !v.published) v.published = pub;
        shorts.filter((e) => e.id === newestTabId).forEach((e) => (e.published = pub));
        if (!shorts.some((e) => e.id === newestTabId)) shorts.push({ id: newestTabId, title: '', published: pub, thumb: '' });
      }
    }
    // Aktivität: jüngstes bestätigtes Short mit Datum (Feed) oder bisheriger Stand
    const dates = [...shorts.map((e) => e.published), ...poolFile.videos.filter((v) => v.channelId === c.channelId).map((v) => v.published ?? '')].filter(Boolean).sort();
    if (dates.length) c.lastShort = dates[dates.length - 1].slice(0, 10);
    const ageDays = c.lastShort ? (Date.now() - Date.parse(c.lastShort)) / 86_400_000 : Infinity;
    const inPool = poolFile.videos.some((v) => v.channelId === c.channelId) || added.some((v) => v.channelId === c.channelId);
    delete c.note;
    if (c.lastShort) {
      c.status = ageDays > INACTIVE_DAYS ? 'inactive' : 'active';
      if (c.status === 'inactive') c.note = `kein neues Short seit ${c.lastShort}`;
    } else if (inPool) {
      // Shorts vorhanden, aber Datum nicht lesbar: nicht als inaktiv werten
      c.status = 'active';
      c.note = 'Datum des neuesten Shorts nicht ermittelbar';
    } else {
      c.status = 'inactive';
      c.note = `keine Shorts gefunden (${via})`;
    }
    const line = `${c.name}: ${via}, ${fresh.length} neu geprüft, ${shorts.length} Shorts, letztes ${c.lastShort ?? 'unbekannt'}, ${c.status}`;
    console.log(line);
    report.push(line);
    await sleep(300);
  }

  writeJson(CHANNELS, file);
  if (added.length || !poolFile.updatedAt) {
    poolFile.videos.push(...added);
    poolFile.updatedAt = new Date().toISOString();
    writeJson(POOL, poolFile);
  }
  const by = (k: 'area') => Object.fromEntries(['brain', 'body', 'beat'].map((a) => [a, poolFile.videos.filter((v) => v[k] === a).length]));
  console.log(JSON.stringify({ added: added.length, pool: poolFile.videos.length, byArea: by('area'), unresolved: file.channels.filter((c) => c.status === 'unresolved').map((c) => c.name), inactive: file.channels.filter((c) => c.status === 'inactive').map((c) => c.name) }, null, 1));
}

main();
