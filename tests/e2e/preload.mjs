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
  // Standardtempo ist 1x (Pfeiler 17): der erste Moment endet später und kann mitten in den Wisch laufen. Erst abwarten, bis die Bühne ruht.
  await waitFor(page, () => !window.__core.motion().busy && window.__core.state() === 1, null, 20000);
  await sleep(400);
  await waitFor(page, () => !window.__core.motion().busy, null, 5000);
  const idxBefore = await page.evaluate(() => window.__core.idx());
  // Mitte der Bühne statt der unteren Textzeilen: dort liegen je nach Untertitel Tippflächen (Sprecherzeile), der Wisch muss auf der Gesten-Ebene beginnen
  await page.mouse.move(200, 420);
  await page.mouse.down();
  await page.mouse.move(200, 200, { steps: 8 });
  await page.mouse.up();
  c.realSwipeMoves = await waitFor(page, (i) => window.__core.idx() === i + 1, idxBefore, 5000);
  await waitFor(page, () => window.__core.state() === 1, null, 5000);
  // Geprüft wird der Start aus dem Vorrat. Ob der nächste Moment im Vorrat liegt, hängt von der Mischung ab (Regeln gehen vor, im schlechten Netz zählt der Vorrat
  // nur dreifach, Entscheidung 42 und 45) und je nach Seed liegt ein Moment außerhalb. Der Test wischt deshalb erst, wenn der Nachfolger im Vorrat liegt, und zählt die Wartefälle.
  num.waitedForVault = 0;
  for (let i = 0; i < 9; i++) {
    await sleep(900);
    const nextHeld = () => window.__core.preload().ids.includes(window.__core.queue()[window.__core.idx() + 1]);
    if (!(await page.evaluate(nextHeld))) {
      num.waitedForVault++;
      await waitFor(page, () => window.__core.preload().ids.includes(window.__core.queue()[window.__core.idx() + 1]), null, 20000);
    }
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
  // Wie beim Neustart ohne Netz (Entscheidung 42): ein Wisch auf einen Moment außerhalb des Vorrats kann offline nicht spielen und zählt nicht.
  // Jeder Wisch auf einen Moment im Vorrat muss gepuffert unter 100 ms starten, mindestens drei der vier Wische landen im Vorrat.
  const trailOff = [];
  for (let i = 0; i < 4; i++) {
    await sleep(800);
    const heldNext = await page.evaluate(() => window.__core.preload().ids.includes(window.__core.queue()[window.__core.idx() + 1]));
    await page.evaluate(() => window.__core.next());
    const ok = await waitFor(page, () => window.__core.state() === 1, null, heldNext ? 5000 : 1500);
    trailOff.push({ heldNext, ok });
  }
  num.offlineTrail = trailOff;
  const latOff = (await latency(page)).slice(nOff);
  num.offlineStartMs = latOff.map((x) => x.ms);
  const heldLandings = trailOff.filter((x) => x.heldNext);
  c.offlineSwipesFromCache = heldLandings.length >= 3 && heldLandings.every((x) => x.ok) && latOff.length === heldLandings.length && latOff.every((x) => x.buffered && x.ms < 100);
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
  // Entscheidung 42: erster Moment im Vorrat, mindestens die Hälfte der ersten 15 im Vorrat (nicht alle, die Mischregeln aus Entscheidung 33 gehen vor)
  const cachedOf15 = st2.q.slice(st2.idx, st2.idx + 15).filter((id) => st2.ids.includes(id)).length;
  num.offlineCachedOfFirst15 = cachedOf15;
  c.offlineQueueCachedFirst = st2.ids.includes(st2.q[st2.idx]) && cachedOf15 >= 8;
  await page2.screenshot({ path: `${out}/chromium-6-offline-restart.png` });
  const nOff2 = (await page2.evaluate(() => window.__core.latency())).length;
  const trail2 = [];
  for (let i = 0; i < 3; i++) {
    await sleep(800);
    await page2.evaluate(() => window.__core.next());
    const ok = await waitFor(page2, () => window.__core.state() === 1, null, 5000);
    trail2.push(await page2.evaluate((ok) => ({ ok, idx: window.__core.idx(), id: window.__core.queue()[window.__core.idx()], cached: window.__core.preload().ids.includes(window.__core.queue()[window.__core.idx()]), st: window.__core.state(), n: window.__core.latency().length }), ok));
  }
  num.offlineSwipeTrail = trail2;
  const lat2 = (await page2.evaluate(() => window.__core.latency())).slice(nOff2);
  num.offlineRestartStartMs = lat2.map((x) => x.ms);
  // Entscheidung 42: Nur die Hälfte der ersten 15 liegt im Vorrat. Ein Wisch auf einen Moment außerhalb des Vorrats kann offline nicht spielen und zählt nicht.
  // Jeder Wisch auf einen Moment im Vorrat muss gepuffert starten und unter 100 ms bleiben, mindestens zwei der drei Wische landen im Vorrat.
  const cachedLandings = trail2.filter((x) => x.cached);
  c.offlineRestartSwipes = cachedLandings.length >= 2 && cachedLandings.every((x) => x.ok) && lat2.length === cachedLandings.length && lat2.every((x) => x.buffered && x.ms < 100);
  c.offlineRestartNoRequests = net.log.length === reqBefore2;
  net.down = false;
  net.ytDown = false;
  await page2.close();

  // ---- 7. Netz-bewusste Mischung (Video-Form: Streams vor YouTube im schlechten Netz, Regeln bleiben) ----
  const mixCase = async (offline, name, seed = 3) => {
    const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await routes(cx);
    const pg = await cx.newPage();
    if (offline) await pg.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { get: () => false }); });
    net.ytDown = offline;
    net.down = offline;
    await pg.goto(`${url}?now=2026-10-23&seed=${seed}#k=${k}`);
    await waitFor(pg, () => !!window.__core?.moment(), null, 20000);
    // Im schlechten Netz zuerst abwarten, bis das Neuplanen durch ist. Davor ist die Warteschlange noch die vom Aufbau (Entscheidung 42).
    if (offline) await waitFor(pg, () => window.__core.diag().some((x) => /replan from/.test(x)), null, 8000);
    await pg.waitForTimeout(300);
    const q = await pg.evaluate(() => window.__core.queue());
    if (name) await pg.screenshot({ path: `${out}/chromium-7-mix-${name}.png` });
    await cx.close();
    net.ytDown = false;
    net.down = false;
    const byId = new Map(videoPool.map((m) => [m.id, m]));
    return q.slice(0, 12).map((id) => byId.get(id));
  };
  // Seit Entscheidung 33 (Issue 24) ist der Netzrang ein weiches Gewicht und die Mischung wählt je Moment mit harten Regeln. Zehn Seeds mit je 12 Momenten
  // (120 je Netzlage), weil 12 Momente allein vom Zufall kippen. Im Testpool ist im Video-Reiter nichts vorgeladen, das Gewicht (nur Rang 0) greift hier nicht.
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const poorBy = {};
  const normalBy = {};
  for (const sd of SEEDS) {
    poorBy[sd] = await mixCase(true, sd === 3 ? 'poor' : null, sd);
    normalBy[sd] = await mixCase(false, sd === 3 ? 'normal' : null, sd);
  }
  const poorQ = poorBy[3];
  const normalQ = normalBy[3];
  const isYt = (m) => !m.hls;
  const ytCount = (by) => SEEDS.reduce((n, sd) => n + by[sd].filter(isYt).length, 0);
  num.poorYoutubeOf120 = ytCount(poorBy);
  num.normalYoutubeOf120 = ytCount(normalBy);
  num.poorFirst12Youtube = poorQ.filter(isYt).length;
  num.normalFirst12Youtube = normalQ.filter(isYt).length;
  // Erwartung: im schlechten Netz nicht mehr YouTube als im normalen. Spielraum 12 Momente (10 Prozentpunkte), das ist gut eine Standardabweichung des Zufalls bei 120 Ziehungen je Seite.
  c.poorPushesYoutubeBack = SEEDS.every((sd) => poorBy[sd].length === 12 && normalBy[sd].length === 12) && num.poorYoutubeOf120 <= num.normalYoutubeOf120 + 12;
  c.normalMixKeepsYoutube = SEEDS.every((sd) => normalBy[sd].length === 12) && num.normalYoutubeOf120 > 0;
  // Seit Issue 24 gibt es keine Dreierblöcke mehr: nie zweimal derselbe Bereich hintereinander, nie dieselbe Folge innerhalb 10 (harte Regeln, gelten in jedem Seed)
  // Zeigt der Feed offline einen YouTube-Moment, scheitert er und pruneBad nimmt ihn aus dem Rest. Die Lücke vorn (die Slots idx+1 und idx+2) kann dann zwei gleiche Bereiche
  // nebeneinander setzen. Entscheidung 45 (Brief 09): pruneBad füllt die Lücke mit dem nächsten Moment, dessen Bereich von Vorgänger und Nachfolger abweicht.
  // Die Bereichsregel gilt deshalb im schlechten Netz wieder ab Stelle 2, nicht erst ab 4. Die Folgenregel gilt überall.
  const blocksOk = (q, areaFrom = 1) => q.every((m, i) => i === 0 || ((i < areaFrom || m.area !== q[i - 1].area) && !q.slice(Math.max(0, i - 10), i).some((x) => x.videoId === m.videoId)));
  const clumps = (by) => SEEDS.flatMap((sd) => by[sd].flatMap((m, i, q) => (i === 0 ? [] : i >= 1 && m.area === q[i - 1].area ? [`seed${sd} i${i} area ${m.area}`] : q.slice(Math.max(0, i - 10), i).some((x) => x.videoId === m.videoId) ? [`seed${sd} i${i} episode`] : [])));
  num.poorClumps = clumps(poorBy);
  num.normalClumps = clumps(normalBy);
  c.poorNoClump = SEEDS.every((sd) => blocksOk(poorBy[sd], 1));
  c.poorBeatFirst = poorQ[0]?.area === 'beat';
  c.normalNoClump = SEEDS.every((sd) => blocksOk(normalBy[sd]));

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
