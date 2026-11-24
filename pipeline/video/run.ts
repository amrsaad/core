// Video-Pipeline: Kanal-IDs auflösen, Shorts holen, per /shorts/ bestätigen, Pool ergänzen.
// Aufruf: tsx pipeline/video/run.ts [--seed]
import { join } from 'node:path';
import type { Video, VideoPool } from '../../src/videoTypes';
import { pool as runPool, sleep } from '../http';
import { readJson, ROOT, writeJson } from '../raw';
import { budget, CHANNEL_BUDGET_MS, mergeChecked, noteResolveResult, orderChannels, RESOLVE_MAX_FAILS, shouldResolve, streak, TOTAL_BUDGET_MS, type PipeChannel } from './limits';
import { channelHits, channelIdFromPage, isChannelId, isShortCheck, nameMatches, norm, oembed, parseFeed, shortPublished, shortsTabIds, ytGet, type FeedEntry } from './yt';

const CHANNELS = join(ROOT, 'content', 'channels.json');
const POOL = join(ROOT, 'public', 'videos', 'pool.json');
const INACTIVE_DAYS = 60;

async function resolve(c: PipeChannel): Promise<void> {
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

async function feed(url: string, deadline?: number): Promise<{ status: number; entries: FeedEntry[] }> {
  const r = await ytGet(url, { tries: 2, timeoutMs: 15_000, deadline });
  return { status: r.status, entries: r.status === 200 ? parseFeed(r.text) : [] };
}

async function main() {
  const file = readJson<{ _info?: string; channels: PipeChannel[] }>(CHANNELS, { channels: [] });
  const poolFile = readJson<VideoPool>(POOL, { updatedAt: '', videos: [] });
  const known = new Set(poolFile.videos.map((v) => v.id));
  const added: Video[] = [];
  const report: string[] = [];
  const total = budget(TOTAL_BUDGET_MS);
  const skipped: string[] = [];

  for (const c of file.channels) {
    // Nicht aufgelöste Kanäle erneut versuchen, nach RESOLVE_MAX_FAILS Fehlversuchen nur noch einmal pro Woche
    if (!c.channelId) {
      if (!shouldResolve(c)) {
        console.log(`resolve ${c.name}: UEBERSPRUNGEN, ${c.resolveFails} Fehlversuche, naechster Versuch ab ${new Date(Date.parse(c.resolveTried!) + 7 * 86_400_000).toISOString().slice(0, 10)} (${c.note ?? ''})`);
        continue;
      }
      if (total.expired()) {
        console.log(`resolve ${c.name}: Zeitbudget erschoepft, nicht versucht`);
        continue;
      }
      delete c.status;
      delete c.note;
      await resolve(c);
      noteResolveResult(c, !!c.channelId);
      if (!c.channelId && (c.resolveFails ?? 0) >= RESOLVE_MAX_FAILS) c.note = `${c.note ?? ''} (Fehlversuch ${c.resolveFails}, jetzt nur noch woechentlich)`.trim();
      console.log(`resolve ${c.name}: ${c.channelId ?? 'UNRESOLVED'} ${c.resolvedTitle ?? ''} ${c.verified ? '(verifiziert)' : ''} ${c.note ?? ''}`);
      await sleep(2500);
    }
  }

  for (const c of orderChannels(file.channels)) {
    if (!c.channelId || !isChannelId(c.channelId)) continue;
    if (total.expired()) {
      skipped.push(c.name);
      continue;
    }
    // Frist je Kanal, nie länger als das Restbudget des Schritts
    const deadline = Date.now() + Math.min(CHANNEL_BUDGET_MS, total.left());
    const uush = await feed(`https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH${c.channelId.slice(2)}`, deadline);
    let entries = uush.entries;
    let via = `UUSH ${uush.status}`;
    if (!entries.length) {
      const all = await feed(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`, deadline);
      entries = all.entries;
      via += `, channel-feed ${all.status}`;
    }
    const byId = new Map(entries.map((e) => [e.id, e]));
    // Die RSS-Feeds liefern derzeit oft 404: der öffentliche Shorts-Tab ist deshalb immer dabei (neueste zuerst)
    let newestTabId: string | undefined;
    {
      const tab = await ytGet(`https://www.youtube.com/channel/${c.channelId}/shorts`, { tries: 2, timeoutMs: 15_000, deadline });
      const ids = tab.status === 200 ? shortsTabIds(tab.text) : [];
      via += `, shorts-tab ${tab.status} (${ids.length})`;
      newestTabId = ids[0];
      for (const id of ids) if (!byId.has(id)) byId.set(id, { id, title: '', published: '', thumb: '' });
    }
    // Bereits als "kein Short" geprüfte IDs nicht erneut abrufen (sonst wächst die Laufzeit mit jedem Kanal)
    const seen = new Set(c.checked ?? []);
    const fresh = [...byId.values()].filter((e) => !known.has(e.id) && !seen.has(e.id));
    const brk = streak();
    const checked = await runPool(fresh, 4, async (e) => {
      if (brk.tripped() || Date.now() >= deadline) return { e, res: 'unknown' as const, skipped: true };
      const res = await isShortCheck(e.id, { deadline });
      brk.add(res === 'unknown');
      return { e, res, skipped: false };
    }, 120);
    const shorts = checked.filter((x) => x.res === 'short').map((x) => x.e);
    const notShort = checked.filter((x) => x.res === 'no').map((x) => x.e.id);
    const unknown = checked.filter((x) => x.res === 'unknown');
    if (unknown.length) via += `, ${unknown.length} Pruefungen ohne klares Ergebnis (${brk.tripped() ? 'gedrosselt' : 'Zeitfrist'}), spaeter erneut`;
    c.checked = mergeChecked(c.checked, notShort);
    // Titel für Einträge aus dem Shorts-Tab über oEmbed
    await runPool(shorts.filter((e) => !e.title), 3, async (e) => {
      const o = await oembed(e.id, deadline);
      if (o) Object.assign(e, { title: o.title, thumb: o.thumb });
    }, 120);
    for (const e of shorts) {
      if (!e.title) continue;
      known.add(e.id);
      added.push({ id: e.id, channelId: c.channelId, channelName: c.name, area: c.area, topic: c.topic, lang: c.lang, title: e.title, published: e.published || null, thumb: e.thumb || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg` });
    }
    // Datum des neuesten Shorts aus dem Tab, falls der Feed keines lieferte
    if (newestTabId && !entries.some((e) => e.id === newestTabId)) {
      const pub = await shortPublished(newestTabId, deadline);
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
    const partial = unknown.length > 0 || Date.now() >= deadline;
    delete c.note;
    if (partial && !c.status) c.status = 'active';
    if (partial) {
      // Unvollständiger Abruf (Frist oder Drosselung): bisherigen Status behalten, nichts als inaktiv werten
    } else if (c.lastShort) {
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
    // Nur vollständig verarbeitete Kanäle rücken in der Reihenfolge nach hinten
    if (!partial) c.lastRun = new Date().toISOString();
    const line = `${c.name}: ${via}, ${fresh.length} neu geprüft, ${shorts.length} Shorts, letztes ${c.lastShort ?? 'unbekannt'}, ${c.status}`;
    console.log(line);
    report.push(line);
    await sleep(300);
  }

  if (skipped.length) console.log(`ZEITBUDGET: ${skipped.length} Kanaele nicht bearbeitet, kommen im naechsten Lauf zuerst: ${skipped.join(', ')}`);
  writeJson(CHANNELS, file);
  if (added.length || !poolFile.updatedAt) {
    poolFile.videos.push(...added);
    poolFile.updatedAt = new Date().toISOString();
    writeJson(POOL, poolFile);
  }
  const by = (k: 'area') => Object.fromEntries(['brain', 'body', 'beat'].map((a) => [a, poolFile.videos.filter((v) => v[k] === a).length]));
  console.log(JSON.stringify({ added: added.length, pool: poolFile.videos.length, byArea: by('area'), skipped,
    unresolved: file.channels.filter((c) => c.status === 'unresolved').map((c) => c.name), inactive: file.channels.filter((c) => c.status === 'inactive').map((c) => c.name) }, null, 1));
}

main();
