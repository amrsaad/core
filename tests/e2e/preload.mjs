// E2E des Offline-Vorrats mit echter mp3-Wiedergabe in Chromium und gedrosseltem Netz (Playwright route mit Verzögerung).
// Der Stream-Host stream.test wird von Playwright bedient: Range-Abrufe wie bei echten Podcast-Hosts (206, Content-Range nicht lesbar
// über CORS), jede Antwort kommt um DELAY ms verspätet. Die YouTube-API ist nachgebaut (kein Netz im Runner).
// Aufruf: node tests/e2e/preload.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices } from 'playwright';

const [url = 'http://127.0.0.1:4177/core/', out = 'pipeline/out/e2e-preload'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FILE = new Uint8Array(readFileSync(new URL('../fixtures/media/tone-cbr.mp3', import.meta.url)));
const DELAY = Number(process.env.PRELOAD_DELAY ?? 1500);

const FAKE_YT = `window.YT={PlayerState:{ENDED:0,PLAYING:1,PAUSED:2,BUFFERING:3,CUED:5},Player:function(el,o){const ev=o.events||{};el.replaceWith(document.createElement('div'));
this.loadVideoById=()=>{};this.cueVideoById=()=>{};this.playVideo=()=>{};this.pauseVideo=()=>{};this.mute=()=>{};this.unMute=()=>{};this.isMuted=()=>true;
this.getCurrentTime=()=>0;this.getDuration=()=>0;this.getPlayerState=()=>-1;this.setPlaybackRate=()=>{};this.destroy=()=>{};setTimeout(()=>ev.onReady&&ev.onReady(),10)}};
window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();`;

// ---- Testpool ----
const AREAS = ['brain', 'body', 'beat'];
const audio = (i) => {
  const start = 10 + (i % 7) * 12;
  return { id: `pod-${String(i).padStart(4, '0')}:${start}`, videoId: `pod-${String(i).padStart(4, '0')}`, start, end: start + 25, channel: `Show ${i % 9}`, videoTitle: 'Test episode', area: AREAS[Math.floor(i / 3) % 3], topic: `topic${i % 5}`, hook: `Test audio moment ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', form: 'audio', audio: true, hls: `https://stream.test/ep${i}.mp3` };
};
const ytId = (i) => `ytvid${String(i).padStart(6, '0')}`;
const video = (i) => {
  const yt = i % 2 === 0;
  return { id: `${yt ? ytId(i) : `vid-${i}`}:100`, videoId: yt ? ytId(i) : `vid-${i}`, start: 100, end: 130, channel: `Chan ${i % 7}`, videoTitle: 'Test video', area: AREAS[Math.floor(i / 2) % 3], topic: `v${i % 5}`, hook: `Test video moment ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', form: 'video', ...(yt ? {} : { hls: `https://stream.test/v${i}.mp4` }) };
};
const audioPool = Array.from({ length: 48 }, (_, i) => audio(i));
const videoPool = Array.from({ length: 36 }, (_, i) => video(i));

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
const poolBody = await encPool([...audioPool, ...videoPool]);
const k = Buffer.from(raw).toString('base64url');

// ---- Netz ----
const net = { delay: DELAY, down: false, ytDown: false, log: [] };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-allow-methods': 'GET,OPTIONS' };
const routes = async (ctx) => {
  await ctx.route('https://www.youtube.com/iframe_api', (x) => (net.ytDown ? x.abort('internetdisconnected') : x.fulfill({ contentType: 'text/javascript', body: FAKE_YT })));
  await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  await ctx.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  await ctx.route('https://stream.test/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (net.down) return route.abort('internetdisconnected');
    const range = req.headers().range;
    net.log.push({ url: req.url(), range, at: Date.now() });
    await new Promise((r) => setTimeout(r, net.delay));
    if (net.down) return route.abort('internetdisconnected');
    const m = /bytes=(\d+)-(\d*)/.exec(range ?? '');
    const from = m ? Number(m[1]) : 0;
    const to = m && m[2] ? Math.min(Number(m[2]), FILE.length - 1) : FILE.length - 1;
    if (from >= FILE.length) return route.fulfill({ status: 416, headers: cors });
    // Content-Range wird wie bei den meisten Podcast-Hosts nicht über CORS freigegeben (kein access-control-expose-headers)
    return route.fulfill({ status: m ? 206 : 200, headers: { ...cors, 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', ...(m ? { 'content-range': `bytes ${from}-${to}/${FILE.length}` } : {}) }, body: Buffer.from(FILE.subarray(from, to + 1)) });
  });
};

const waitFor = async (page, fn, arg, timeout = 15000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pre = (page) => page.evaluate(() => window.__core.preload());
const latency = (page) => page.evaluate(() => window.__core.latency());
const firstFrames = (page) => page.evaluate(() => window.__core.diagAll().filter((x) => x.startsWith('first-frame')));

const results = { at: new Date().toISOString(), delayMs: DELAY, runs: [] };
const r = { browser: 'chromium', checks: {}, numbers: {} };
results.runs.push(r);
const c = r.checks;
const num = r.numbers;
let browser;
try {
  browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await routes(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // ---- 1. Kalter Start im gedrosselten Netz ----
  await page.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
  await page.waitForSelector('[data-testid=form-switch]', { timeout: 20000 });
  const t0 = Date.now();
  await page.click('[data-testid=form-switch] button:has-text("Audio")');
  c.audioFeedShown = await waitFor(page, () => window.__core?.moment()?.form === 'audio', null, 20000);
  c.firstPlaysCold = await waitFor(page, () => window.__core.state() === 1, null, 30000);
  num.coldStartMs = Date.now() - t0;
  c.coldStartSlow = num.coldStartMs > 1000;
  await page.screenshot({ path: `${out}/chromium-1-cold-start.png` });

  // ---- 2. Vorrat füllt sich im Hintergrund ----
  const queue0 = await page.evaluate(() => window.__core.queue());
  c.queueIs32Deep = queue0.length >= 32;
  c.filled = await waitFor(page, () => window.__core.preload().stats.n >= 30, null, 150000);
  const p1 = await pre(page);
  num.preloadedMoments = p1.stats.n;
  num.preloadedBytes = p1.stats.bytes;
  num.bytesPerMoment = Math.round(p1.stats.bytes / Math.max(1, p1.stats.n));
  c.only30 = p1.stats.n >= 30 && p1.stats.n <= 31;
  // Nur der Ausschnitt (etwa 26 s bei 8 kB/s), nie die ganze Datei (1,2 MB)
  c.slicesOnly = num.bytesPerMoment > 150_000 && num.bytesPerMoment < 280_000;
  c.underCap = p1.stats.bytes <= 60 * 1024 * 1024;
  const rangeReqs = net.log.filter((x) => /^bytes=\d+-\d+$/.test(x.range ?? ''));
  c.allPreloadFetchesRanged = rangeReqs.length >= 60;
  // Die 30 nächsten der Warteschlange sind die vorgeladenen (das Fenster wandert mit der Wiedergabe, kurz warten bis es wieder voll ist)
  c.windowMatchesQueue = await waitFor(page, () => {
    const q = window.__core.queue();
    const i = window.__core.idx();
    const ids = window.__core.preload().ids;
    return q.slice(i + 1, i + 31).every((id) => ids.includes(id));
  }, null, 60000);
  // Schlechtes Netz erkannt (Antwortzeiten über 1 s), Rest der Warteschlange wurde neu geplant
  const ev1 = await page.evaluate(() => window.__core.diagAll());
  c.poorNetDetected = ev1.some((x) => x.startsWith('net poor=true'));
  c.reordered = ev1.some((x) => x.startsWith('reorder'));
  await page.screenshot({ path: `${out}/chromium-2-feed-after-preload.png` });

  // ---- 3. Wischen: Start aus dem Vorrat, gemessen als playLatency (buffered true) ----
  const n0 = (await latency(page)).length;
  // Ein echter Wisch mit der Maus, die übrigen über den Test-Hook
  const idxBefore = await page.evaluate(() => window.__core.idx());
  await page.mouse.move(200, 600);
  await page.mouse.down();
  await page.mouse.move(200, 380, { steps: 8 });
  await page.mouse.up();
  c.realSwipeMoves = await waitFor(page, (i) => window.__core.idx() === i + 1, idxBefore, 5000);
  await waitFor(page, () => window.__core.state() === 1, null, 5000);
  for (let i = 0; i < 9; i++) {
    await sleep(900);
    await page.evaluate(() => window.__core.next());
    await waitFor(page, () => window.__core.state() === 1, null, 5000);
  }
  await sleep(500);
  const lat = (await latency(page)).slice(n0);
  num.swipes = lat.length;
  num.cachedStartMs = lat.map((x) => x.ms);
  num.cachedStartMax = Math.max(...lat.map((x) => x.ms));
  num.cachedStartMedian = [...lat.map((x) => x.ms)].sort((a, b) => a - b)[Math.floor(lat.length / 2)];
  c.tenSwipesMeasured = lat.length === 10;
  c.allBuffered = lat.length > 0 && lat.every((x) => x.buffered === true);
  c.allUnder100 = lat.length > 0 && lat.every((x) => x.ms < 100);
  const ff = await firstFrames(page);
  num.firstFrames = ff.slice(-12);
  // Die ersten beiden Wischer treffen Momente, die schon vor dem Vorrat per Netz in den Vorlade-Playern lagen. Ab dem dritten kommt alles aus dem Vorrat.
  c.startedFromBlob = ff.slice(-8).every((x) => / local$/.test(x));
  await page.screenshot({ path: `${out}/chromium-3-playing-from-cache.png` });
  const pos = await page.evaluate(() => ({ t: window.__core.time(), m: window.__core.moment() }));
  // Die Wiedergabe steht im Moment (Quellzeit zwischen start und end), nicht bei 0 des Ausschnitts
  c.playbackTimeIsSourceTime = pos.t >= pos.m.start - 0.5 && pos.t <= pos.m.end + 0.5;

  // Während der Wiedergabe aus dem Vorrat geht kein Abruf für den laufenden Moment ins Netz (Medienelement liest den Blob)
  const mediaLike = net.log.slice(-5).every((x) => /^bytes=\d+-\d+$/.test(x.range ?? ''));
  c.noMediaStreamRequests = mediaLike;

  // ---- 4. Settings ----
  await page.click('nav [aria-label=Settings]');
  c.settingsLine = await waitFor(page, () => /^Preloaded: \d+ moments?, \d+\.\d MB$/.test(document.querySelector('[data-testid=preloaded]')?.textContent ?? ''));
  num.settingsText = await page.evaluate(() => document.querySelector('[data-testid=preloaded]')?.textContent);
  await page.locator('[data-testid=preloaded]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/chromium-4-settings.png` });
  c.settingsMatchesStore = await page.evaluate((s) => {
    const m = /Preloaded: (\d+) moments?, ([\d.]+) MB/.exec(document.querySelector('[data-testid=preloaded]')?.textContent ?? '');
    return !!m && Number(m[1]) === s.n && Math.abs(Number(m[2]) - s.bytes / 1048576) < 0.06;
  }, (await pre(page)).stats);
  await page.click('nav [aria-label=Moments], nav button:first-child');

  // ---- 5. Offline mitten in der Sitzung ----
  const reqBefore = net.log.length;
  net.down = true;
  await ctx.setOffline(true);
  c.offlineIcon = await waitFor(page, () => !!document.querySelector('[data-testid=offline]'));
  await page.screenshot({ path: `${out}/chromium-5-offline-icon.png` });
  const nOff = (await latency(page)).length;
  for (let i = 0; i < 4; i++) {
    await sleep(800);
    await page.evaluate(() => window.__core.next());
    await waitFor(page, () => window.__core.state() === 1, null, 5000);
  }
  const latOff = (await latency(page)).slice(nOff);
  num.offlineStartMs = latOff.map((x) => x.ms);
  c.offlineSwipesFromCache = latOff.length === 4 && latOff.every((x) => x.buffered && x.ms < 100);
  c.offlineNoRequests = net.log.length === reqBefore;
  c.poorWhenOffline = (await pre(page)).poor === true;
  await ctx.setOffline(false);
  net.down = false;
  c.offlineIconGoes = await waitFor(page, () => !document.querySelector('[data-testid=offline]'));

  // ---- 6. Neustart ohne Netz: Warteschlange wiederhergestellt, Vorgeladenes zuerst, keine Fehlerseite ----
  const savedStats = (await pre(page)).stats;
  const page2 = await ctx.newPage();
  await page2.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { get: () => false }); });
  net.down = true;
  net.ytDown = true;
  const reqBefore2 = net.log.length;
  page2.on('pageerror', (e) => errors.push(String(e)));
  await page2.goto(`${url}?now=2026-10-23&seed=3`);
  c.offlineRestartFeed = await waitFor(page2, () => !!window.__core?.moment(), null, 20000);
  c.noErrorPage = await page2.evaluate(() => !/Moments need internet/.test(document.body.innerText));
  c.offlineRestartIcon = await waitFor(page2, () => !!document.querySelector('[data-testid=offline]'));
  c.offlineRestartPlays = await waitFor(page2, () => window.__core.state() === 1, null, 8000);
  const st2 = await page2.evaluate(() => ({ ids: window.__core.preload().ids, q: window.__core.queue(), poor: window.__core.preload().poor, local: window.__core.preload().local, idx: window.__core.idx() }));
  c.offlineRestartPoor = st2.poor === true;
  c.offlineRestartStoreKept = st2.ids.length === savedStats.n;
  c.offlineFirstIsCached = st2.ids.includes(st2.q[st2.idx]);
  c.offlineFirstFromBlob = st2.local.some(Boolean);
  c.offlineQueueCachedFirst = st2.q.slice(st2.idx, st2.idx + 15).every((id) => st2.ids.includes(id));
  await page2.screenshot({ path: `${out}/chromium-6-offline-restart.png` });
  const nOff2 = (await page2.evaluate(() => window.__core.latency())).length;
  for (let i = 0; i < 3; i++) {
    await sleep(800);
    await page2.evaluate(() => window.__core.next());
    await waitFor(page2, () => window.__core.state() === 1, null, 5000);
  }
  const lat2 = (await page2.evaluate(() => window.__core.latency())).slice(nOff2);
  num.offlineRestartStartMs = lat2.map((x) => x.ms);
  c.offlineRestartSwipes = lat2.length === 3 && lat2.every((x) => x.buffered && x.ms < 100);
  c.offlineRestartNoRequests = net.log.length === reqBefore2;
  net.down = false;
  net.ytDown = false;
  await page2.close();

  // ---- 7. Netz-bewusste Mischung (Video-Form: Streams vor YouTube im schlechten Netz, Regeln bleiben) ----
  const mixCase = async (offline, name) => {
    const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await routes(cx);
    const pg = await cx.newPage();
    if (offline) await pg.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { get: () => false }); });
    net.ytDown = offline;
    net.down = offline;
    await pg.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
    await waitFor(pg, () => !!window.__core?.moment(), null, 20000);
    const q = await pg.evaluate(() => window.__core.queue());
    await pg.screenshot({ path: `${out}/chromium-7-mix-${name}.png` });
    await cx.close();
    net.ytDown = false;
    net.down = false;
    const byId = new Map(videoPool.map((m) => [m.id, m]));
    return q.slice(0, 12).map((id) => byId.get(id));
  };
  const poorQ = await mixCase(true, 'poor');
  const normalQ = await mixCase(false, 'normal');
  const isYt = (m) => !m.hls;
  num.poorFirst12Youtube = poorQ.filter(isYt).length;
  num.normalFirst12Youtube = normalQ.filter(isYt).length;
  c.poorPushesYoutubeBack = poorQ.length === 12 && num.poorFirst12Youtube === 0;
  c.normalMixKeepsYoutube = normalQ.length === 12 && num.normalFirst12Youtube > 0;
  const blocksOk = (q) => [0, 3, 6, 9].every((i) => new Set(q.slice(i, i + 3).map((m) => m.area)).size === 1);
  c.poorBlocksOf3SameArea = blocksOk(poorQ);
  c.poorBeatFirst = poorQ[0]?.area === 'beat';
  c.normalBlocksOf3SameArea = blocksOk(normalQ);

  c.pageErrors = errors.length === 0 ? true : errors.length;
  if (errors.length) num.pageErrors = errors.slice(0, 5);
} catch (e) {
  r.error = String(e?.stack ?? e);
} finally {
  await browser?.close();
}
r.ok = !r.error && Object.entries(r.checks).every(([, v]) => v === true);
results.ok = results.runs.every((x) => x.ok);
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
process.exit(results.ok ? 0 : 1);
