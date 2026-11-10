// E2E Video-Tab (Issue 22, Brief 01): Zeit vom Wisch bis zum ersten Bild bei einem 4G-Profil, YouTube-Einblendung, Standbild bei Pause.
// ACHTUNG, was das misst: Die Cloud-Session erreicht YouTube nicht. Der Lauf nutzt den Nachbau der IFrame-API (fakeyt.js) mit einem Latenzmodell:
//   kalter Start eines Moments (loadVideoById bis PLAYING)  600 bis 1200 ms (Annahme für 4G, gleichverteilt, fester Seed)
//   Weiterspielen eines angehaltenen Players (playVideo)      40 bis 100 ms
//   YouTube-Einblendung (Titel oben 60 px, Logo unten 48 px) sichtbar, solange der Player pausiert oder weniger als 3 s gespielt hat
// Dazu begrenzt Chromium über CDP das Netz der Seite (9 Mbit/s, 85 ms Umlaufzeit) und navigator.connection meldet 4g.
// Die Zahlen belegen also die Logik der App (Warmlauf, Abdeckung, Vorladen), nicht das Verhalten des echten YouTube. Echte Werte liefert
// Einstellungen > Copy diagnostics auf dem Gerät (Zeilen "video:" und "first-frame").
// Aufruf: node tests/e2e/video4g.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
// Umgebung: SWIPES=20  DWELLS=4500,1800 (Verweilzeit je Moment in ms)  E2E_INFO=1 (nur messen, kein Fehlercode, z.B. gegen einen älteren Stand)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-video4g'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SWIPES = Number(process.env.SWIPES ?? 20);
const DWELLS = (process.env.DWELLS ?? '4500,1800').split(',').map(Number);
const INFO = !!process.env.E2E_INFO;

// Latenzmodell und Einblendung, eingefügt vor dem Aufruf von onYouTubeIframeAPIReady
const PATCH = `
(() => {
  let seed = 20261103;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const cold = () => 600 + rnd() * 600;
  const warm = () => 40 + rnd() * 60;
  const Orig = window.YT.Player;
  window.YT.Player = function (el, opts) {
    const host = el.parentNode;
    const ev = opts.events;
    let isCold = false, since = 0, plSince = 0, acc = 0, state = -1, curVid = opts.videoId || null;
    // Brief 09: tatsächliche Spielzeit je Video (Zustand PLAYING), damit der Test den seen-Zähler dagegen prüfen kann
    window.__pl = window.__pl || {};
    const flush = () => { if (state === 1 && curVid) { const n = performance.now(); window.__pl[curVid] = (window.__pl[curVid] || 0) + (n - plSince); plSince = n; } };
    window.__plNow = () => Object.fromEntries(Object.keys(window.__pl).map((k) => [k, Math.round(window.__pl[k])]));
    window.__flushAll = () => (window.__flushers || []).forEach((f) => f());
    (window.__flushers = window.__flushers || []).push(flush);
    const on = () => state !== 1 || acc + (performance.now() - since) < 3000;
    let refresh = () => {};
    const emit = (data) => {
      if (state === 1 && data !== 1) flush();
      if (data === 1) plSince = since = performance.now(); else if (state === 1) acc += performance.now() - since;
      state = data;
      refresh();
      ev.onStateChange({ data });
    };
    // Ein Zustand nach PLAYING (Pause, Cue, Ende) macht ein noch ausstehendes PLAYING gegenstandslos, wie beim echten Player
    let pend = 0;
    const wrapped = { ...opts, events: { ...ev, onStateChange: (e) => {
      clearTimeout(pend);
      if (e.data === 1) { const d = isCold ? cold() : warm(); isCold = false; pend = setTimeout(() => emit(1), d); } else emit(e.data);
    } } };
    Orig.call(this, el, wrapped);
    const load = this.loadVideoById, cue = this.cueVideoById, seek = this.seekTo;
    // Wie bei YouTube: ein Sprung im laufenden Player puffert kurz (80 bis 160 ms), dann kommt PLAYING wieder
    this.seekTo = (sec, ahead) => { const was = state === 1; seek(sec, ahead); if (was) { emit(3); setTimeout(() => emit(1), 80 + rnd() * 80); } };
    const vidOf = (a) => (typeof a === 'string' ? a : a.videoId);
    // Brief 09: hängende Videos wie im schlechten Netz: der Player kommt nie auf PLAYING (Zustand bleibt bei CUED), window.__hang(videoId) entscheidet
    let loadAt = 0;
    this.loadVideoById = (a) => { flush(); curVid = vidOf(a); isCold = true; acc = 0; state = -1; loadAt = performance.now(); if (window.__hang && window.__hang(curVid)) { cue(a); return; } load(a); };
    // Brief 23: nach cue lädt der erste Start den Stream erst (kalt, 600 bis 1200 ms), im iOS-Fall kommt PLAYING also erst nach dem Ende der Feder
    this.cueVideoById = (a) => { flush(); curVid = vidOf(a); isCold = !!window.__ytIos; acc = 0; state = -1; loadAt = performance.now(); cue(a); };
    // Brief 12: geladener Anteil wie getVideoLoadedFraction der echten API. Ein hängendes Video liefert 0 (kein Byte), mit window.__trickle wächst der Anteil
    // langsam (Bytes kommen an, aber kein erstes Bild). Ein laufendes Video gilt als geladen.
    this.getVideoLoadedFraction = () => {
      if (curVid && window.__hang && window.__hang(curVid)) return window.__trickle ? Math.min(0.9, (performance.now() - loadAt) / 30000) : 0;
      return state === 1 ? 1 : 0;
    };
    const playV = this.playVideo;
    this.playVideo = () => { if (curVid && window.__hang && window.__hang(curVid)) return; playV(); };
    // Einblendung als echte Elemente im Player-Rahmen, damit der Test prüfen kann, ob etwas Eigenes darüberliegt
    const mk = (pos, h) => { const d = document.createElement('div'); d.className = 'ytfake-overlay'; d.style.cssText = 'position:absolute;left:0;right:0;' + pos + ';height:' + h + 'px;background:#c00;color:#fff;font:14px sans-serif;display:none;z-index:1'; d.textContent = 'YOUTUBE'; return d; };
    const top = mk('top:0', 60), bot = mk('bottom:0', 48);
    host.append(top, bot);
    // Sofort beim Zustandswechsel, dazu alle 20 ms für den Ablauf der 3 s
    refresh = () => { const d = on() ? 'block' : 'none'; top.style.display = d; bot.style.display = d; };
    const iv = setInterval(() => { if (!top.isConnected) clearInterval(iv); else refresh(); }, 20);
  };
  window.YT.Player.prototype = Orig.prototype;
})();
`;
const FAKE_RAW = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const MARK = 'window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();';
if (!FAKE_RAW.includes(MARK)) throw new Error('fakeyt.js hat sich geändert: Einfügestelle fehlt');
const FAKE = FAKE_RAW.replace(MARK, PATCH + MARK);

const mk = (i) => ({ id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20, channel: `Kanal ${i % 5}`, videoTitle: 'Testvideo', area: ['beat', 'brain', 'body'][i % 3], topic: ['islam', 'augen', 'kraft'][i % 3], hook: `Testmoment ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', cues: [[0, 'Untertitel eins'], [2, 'Untertitel zwei']] });
const moments = Array.from({ length: 60 }, (_, i) => mk(i));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
const poolBody = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; };
const waitFor = async (page, fn, arg, timeout = 15000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};

// Liegt über der gerade sichtbaren YouTube-Einblendung etwas Eigenes? Prüft die Mitte der beiden Streifen im aktuellen Slot.
const EXPOSED = () => {
  const cur = document.querySelector('.vslot[aria-hidden=false]');
  if (!cur) return { n: 0, checked: 0 };
  let n = 0, checked = 0;
  const by = [];
  // Die Trefferregeln gelten nur während der Messung, sonst würden sie die Wischgeste abschalten
  document.documentElement.setAttribute('data-probe', '1');
  try {
  for (const el of cur.querySelectorAll('.ytfake-overlay')) {
    if (el.style.display !== 'block') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.bottom < 0 || r.top > innerHeight) continue;
    checked++;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || el === hit || el.contains(hit) || (hit.closest('.vframe') && !hit.closest('.vcover'))) {
      n++;
      const sl = hit?.closest('.vslot');
      by.push({ hit: hit ? (hit.className || hit.tagName) : null, sameSlot: sl === cur, live: cur.hasAttribute('data-live'), top: Math.round(r.top), left: Math.round(r.left) });
    }
  }
  } finally { document.documentElement.removeAttribute('data-probe'); }
  return { n, checked, by };
};

const runScenario = async (browser, sc) => {
  const r = { name: sc.name, dwellMs: sc.dwell, checks: {}, ms: [], appMs: [], exposed: [], reloads: 0, log: {} };
  const c = r.checks;
  const ctx = await browser.newContext(sc.desk ? { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' } : { ...devices['iPhone 15'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__ytSlow = true;
    Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g', downlink: 9, rtt: 85 }, configurable: true });
    // Nur für die Trefferprüfung: Abdeckfläche und Vorschaubild treffbar, die Gestenebene darüber nicht, der Player-Rahmen wieder treffbar.
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'html[data-probe] .vcover, html[data-probe] .vposter{pointer-events:auto !important} html[data-probe] .vgesture, html[data-probe] .vui, html[data-probe] .vui *{pointer-events:none !important} html[data-probe] .vframe, html[data-probe] .vframe *{pointer-events:auto !important}'; document.head.append(s); });
  });
  await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 85, downloadThroughput: (9 * 1e6) / 8, uploadThroughput: (3 * 1e6) / 8 });

  await page.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
  c.feedLoaded = await waitFor(page, () => !!window.__core?.moment());
  c.coldStartPlays = await waitFor(page, () => window.__core.state() === 1);
  const hasVideoHook = await page.evaluate(() => typeof window.__core?.video === 'function');
  // Kaltstart: der aktuelle Moment lädt zuerst
  const firstLoads = await page.evaluate(() => (window.__ytlog || []).filter((x) => x.startsWith('load ')).slice(0, 2));
  const m0 = await page.evaluate(() => window.__core.moment().videoId);
  c.coldStartCurrentLoadsFirst = firstLoads[0]?.startsWith('load ' + m0) ?? false;
  r.firstLoads = firstLoads;
  // Kaltstart: in den ersten 3 s nach dem ersten Bild liegt die Abdeckfläche über der Einblendung (Fallback, Entscheidung 29)
  const coldProbes = [];
  for (const at of [100, 700, 1300, 2000, 2800]) {
    await page.waitForTimeout(at - (coldProbes.length ? [100, 700, 1300, 2000, 2800][coldProbes.length - 1] : 0));
    coldProbes.push(await page.evaluate(EXPOSED));
  }
  r.coldStartProbes = coldProbes;
  c.coldStartNoOverlay = coldProbes.every((x) => x.n === 0);
  // Desktop: die Hilfe beim ersten Start schließen, sie fängt sonst die Tasten ab
  if (sc.desk && (await page.$('[data-testid=desk-help]'))) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  // Erster Tipp schaltet den Ton ein (wie im Betrieb), danach läuft alles weiter
  const vp = page.viewportSize();
  await page.mouse.click(vp.width / 2, vp.height / 2);
  const swipe = async () => {
    if (sc.desk) { await page.keyboard.press('ArrowDown'); return; }
    const y0 = vp.height * 0.75, y1 = vp.height * 0.25;
    await page.mouse.move(vp.width / 2, y0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(vp.width / 2, y0 + ((y1 - y0) * i) / 8); await page.waitForTimeout(12); }
    await page.mouse.up();
  };
  const watch = (idx0) => page.evaluate((i0) => new Promise((resolve) => {
    const res = { t0: null, ms: null };
    const iv = setInterval(() => {
      const now = performance.now();
      if (res.t0 === null && window.__core.idx() !== i0) res.t0 = now;
      if (res.t0 !== null && window.__core.state() === 1) { res.ms = Math.round(now - res.t0); clearInterval(iv); resolve(res); }
    }, 4);
    setTimeout(() => { clearInterval(iv); resolve(res); }, 6000);
  }), idx0);

  // Verweilzeit gilt vom Wisch zum nächsten Wisch (die Proben nach dem Wisch laufen innerhalb dieser Zeit)
  let lastSwipe = 0;
  for (let n = 0; n < SWIPES; n++) {
    await page.waitForTimeout(lastSwipe ? Math.max(0, sc.dwell - (Date.now() - lastSwipe)) : sc.dwell);
    const idx0 = await page.evaluate(() => window.__core.idx());
    const logLen = await page.evaluate(() => window.__ytlog.length);
    const p = watch(idx0);
    await swipe();
    lastSwipe = Date.now();
    // Einblendung in den ersten 3 s: Proben nach 60, 400, 900, 1500, 2200 und 2900 ms
    const probes = [];
    const t0 = Date.now();
    for (const at of [60, 400, 900, 1500, 2200, 2900].filter((x) => x < sc.dwell - 250)) {
      const wait = at - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      probes.push(await page.evaluate(EXPOSED));
    }
    const res = await p;
    const idx1 = await page.evaluate(() => window.__core.idx());
    const vid = await page.evaluate(() => window.__core.moment().videoId);
    const newLogs = await page.evaluate((l) => window.__ytlog.slice(l), logLen);
    // Reload = ein load des Moments, der gerade aktuell wurde, nach dem Wisch (er muss vorher schon geladen sein)
    const reloaded = newLogs.some((x) => x.startsWith('load ' + vid + ' '));
    if (reloaded) r.reloads++;
    r.ms.push(res.ms ?? 99999);
    r.exposed.push({ n, idx0, idx1, by: probes.flatMap((x) => x.by ?? []).slice(0, 2), probes: probes.map((x) => x.n), checked: probes.reduce((s, x) => s + x.checked, 0), reloaded, ms: res.ms });
  }
  if (hasVideoHook) r.appMs = await page.evaluate(() => window.__core.video().frames);
  r.video = hasVideoHook ? await page.evaluate(() => window.__core.video()) : null;
  r.log.videoLines = await page.evaluate(() => (window.__core.diag?.() ?? []).filter((x) => /^video:|^first-frame/.test(x)).slice(-14));
  // Brief 12: Nachbar vorgeladen. Die Zeilen "first-frame N ms buffered" der Wische (ohne den Kaltstart): Median unter 300 ms, und die Mehrheit der Wische traf einen vorgeladenen Slot.
  const ff = await page.evaluate(() => (window.__core.diag?.() ?? []).filter((x) => /^first-frame \d+ms/.test(x)).slice(1).map((x) => ({ ms: Number(/^first-frame (\d+)ms/.exec(x)[1]), buffered: / buffered/.test(x) })));
  r.firstFrames = { n: ff.length, buffered: ff.filter((x) => x.buffered).length, medianBuffered: q(ff.filter((x) => x.buffered).map((x) => x.ms), 0.5) };
  c.neighborPreloadedMostSwipes = ff.length > 0 && r.firstFrames.buffered >= Math.ceil(ff.length * 0.6);
  c.neighborFirstFrameUnder300 = r.firstFrames.medianBuffered !== null && r.firstFrames.medianBuffered < 300;

  // Zweiter Wisch mit vorgeladenem Player (Brief: unter 1 s, IFrame nicht neu geladen)
  const second = r.exposed[1];
  c.secondSwipeUnder1s = !!second && second.ms !== null && second.ms < 1000;
  c.secondSwipeNoReload = !!second && !second.reloaded;
  r.median = q(r.ms, 0.5);
  r.p90 = q(r.ms, 0.9);
  r.n = r.ms.length;
  r.appMedian = r.appMs.length ? q(r.appMs.slice(-20), 0.5) : null;
  r.appP90 = r.appMs.length ? q(r.appMs.slice(-20), 0.9) : null;
  c.allSwipesPlayed = r.ms.every((x) => x < 6000);
  c.medianUnder1s = r.median !== null && r.median < 1000;
  c.noReloadOnSwipe = r.reloads === 0;
  c.noOverlayFirst3s = r.exposed.every((e) => e.probes.every((x) => x === 0));
  r.exposedSwipes = r.exposed.filter((e) => e.probes.some((x) => x > 0)).length;
  r.probesChecked = r.exposed.reduce((s, e) => s + e.checked, 0);
  c.overlayWasMeasured = r.probesChecked > 0 || coldProbes.some((x) => x.checked > 0);

  // Pause: eigenes Standbild mit Hook und Pausensymbol liegt über dem IFrame, nie die YouTube-Pausenansicht
  await page.waitForTimeout(3500);
  // Brief 20 (Issue 46): ein echtes IFrame im Player-Rahmen, wie es YouTube einsetzt (der Nachbau fakeyt.js zeichnet keins). Es muss Zeiger ignorieren und bei Pause unsichtbar sein.
  const ifr = await page.evaluate(() => {
    const host = document.querySelector('.vslot[aria-hidden=false] .vframe > div');
    if (!host) return null;
    const f = document.createElement('iframe');
    f.id = 'e2e-yt-iframe';
    f.src = 'about:blank';
    f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
    host.append(f);
    return { pe: getComputedStyle(f).pointerEvents, vis: getComputedStyle(f).visibility };
  });
  c.iframeIgnoresPointer = !!ifr && ifr.pe === 'none';
  c.iframeVisiblePlaying = !!ifr && ifr.vis === 'visible';
  if (sc.desk) await page.keyboard.press('Space'); else await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(500);
  const ifPaused = await page.evaluate(() => {
    const f = document.getElementById('e2e-yt-iframe');
    const cur = document.querySelector('.vslot[aria-hidden=false]');
    const top = f ? document.elementFromPoint(innerWidth / 2, innerHeight / 2) : null;
    return { vis: f ? getComputedStyle(f).visibility : null, tapTarget: top ? top.className : null, held: !!cur?.hasAttribute('data-hold'), paused: !!cur?.hasAttribute('data-paused') };
  });
  r.iframePaused = ifPaused;
  c.iframeHiddenWhilePaused = ifPaused.vis === 'hidden';
  c.tapGoesToOurSurface = typeof ifPaused.tapTarget === 'string' && !/\bvframe\b/.test(ifPaused.tapTarget) && ifPaused.tapTarget !== '';
  const pz =await page.evaluate((EX) => {
    const cur = document.querySelector('.vslot[aria-hidden=false]');
    const poster = cur?.querySelector('.vposter');
    const hookText = window.__core.moment().hook;
    const vis = (e) => !!e && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
    const ex = new Function('return (' + EX + ')')()();
    const pr = poster?.getBoundingClientRect();
    return { poster: vis(poster), live: !!cur?.hasAttribute('data-live'), hook: [...document.querySelectorAll('[data-testid=hook], h1, h2, h3, [class*=hook]')].some((e) => vis(e) && e.textContent.includes(hookText)), play: !!cur?.querySelector('.vplay'), exposed: ex.n, checked: ex.checked, band: pr ? [Math.round(pr.width), Math.round(pr.height)] : null, left: pr ? Math.round(pr.left) : null, vw: innerWidth };
  }, EXPOSED.toString());
  r.pause = pz;
  c.pauseOwnStill = pz.poster && !pz.live;
  c.pauseHookShown = pz.hook;
  c.pausePlayIcon = pz.play;
  c.pauseNoYoutubeView = pz.exposed === 0;
  c.pauseOverlayMeasured = pz.checked > 0;
  // Geometrie seit Brief 06: Handy und Tablet zeigen die Karte mit 16 px Rand links und rechts (--margin), höchstens 640 px breit und mittig, Verhältnis 16:9
  // (iPhone 15 mit 393 px: 361 x 203 bei x = 16). Desktop: Video höchstens 1280 px breit.
  c.band16by9 = !!pz.band && Math.abs(pz.band[0] / pz.band[1] - 16 / 9) < 0.03 && (sc.desk ? pz.band[0] <= 1280 : Math.abs(pz.band[0] - Math.min(pz.vw - 32, 640)) <= 1 && Math.abs(pz.left - (pz.vw - pz.band[0]) / 2) <= 1 && (pz.vw > 672 || Math.abs(pz.left - 16) <= 1));
  await page.screenshot({ path: `${out}/${sc.name}-pause.png` });
  // Issue 46 (iPhone): Das Standbild deckt die Karte bei Pause auch dann ab, wenn data-live noch steht (Player-Callback kam nicht oder zu spät).
  // Darunter pausiert der Player unsichtbar, die YouTube-Einblendung (Logo, Titel, Avatar, nächste Folge) bleibt verdeckt.
  if (!sc.desk) {
    const nz = await page.evaluate((EX) => {
      const cur = document.querySelector('.vslot[aria-hidden=false]');
      cur?.setAttribute('data-live', '');
      const poster = cur?.querySelector('.vposter');
      const host = cur?.querySelector('.vframe > div');
      const vis = (e) => !!e && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
      const pr = poster?.getBoundingClientRect();
      const hr = host?.getBoundingClientRect();
      const ex = new Function('return (' + EX + ')')()();
      const covers = !!pr && !!hr && pr.left <= hr.left + 0.5 && pr.top <= hr.top + 0.5 && pr.right >= hr.right - 0.5 && pr.bottom >= hr.bottom - 0.5;
      const zp = Number(getComputedStyle(poster).zIndex), zi = Number(getComputedStyle(cur.querySelector('.vplay') ?? poster).zIndex);
      return { paused: cur?.hasAttribute('data-paused'), poster: vis(poster), covers, exposed: ex.n, checked: ex.checked, playAbove: zi > zp, w: Math.round(pr?.width ?? 0), h: Math.round(pr?.height ?? 0), x: Math.round(pr?.left ?? 0), vw: innerWidth };
    }, EXPOSED.toString());
    r.noOverlay = nz;
    c.noOverlayWhenPaused = !!nz.paused && nz.poster && nz.covers && nz.exposed === 0 && nz.checked > 0 && nz.playAbove && nz.x === 16 && Math.abs(nz.w - (nz.vw - 32)) <= 1 && Math.abs(nz.h - (nz.vw - 32) * 9 / 16) <= 1; // iPhone 15 mit 393 px Viewport: 361 x 203 bei x = 16, hier 390 px: 358 x 201
  }
  // Brief 20: Weiterspielen macht das IFrame wieder sichtbar (data-hold weg, data-paused weg)
  await page.evaluate(() => document.querySelector('.vslot[aria-hidden=false]')?.removeAttribute('data-live'));
  if (sc.desk) await page.keyboard.press('Space'); else await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(600);
  const ifPlay = await page.evaluate(() => {
    const f = document.getElementById('e2e-yt-iframe');
    const cur = document.querySelector('.vslot[aria-hidden=false]');
    return { vis: f ? getComputedStyle(f).visibility : null, held: !!cur?.hasAttribute('data-hold'), paused: !!cur?.hasAttribute('data-paused') };
  });
  r.iframeResumed = ifPlay;
  c.iframeVisibleAfterResume = ifPlay.vis === 'visible' && !ifPlay.held && !ifPlay.paused;
  c.pageErrors = errors.length === 0;
  r.errors = errors.slice(0, 3);
  await ctx.close();
  return r;
};

// Brief 09 (Entscheidung 45): Slow 3G, ein Teil der Videos hängt (Player kommt nie auf PLAYING). 20 Wischer: der seen-Zähler steigt nur um
// Momente, die wirklich mindestens eine Sekunde gespielt haben, hängende Momente werden nie gesehen, die Leer-Seite erscheint nicht.
const HANG = (v) => { const n = Number(String(v).slice(4)); return (n * 7) % 5 < 2; };
const runSlow3G = async (browser) => {
  const r = { name: 'slow3g-mobile-20swipes', checks: {}, numbers: {} };
  const c = r.checks;
  const ctx = await browser.newContext({ ...devices['iPhone 15'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((hangSrc) => {
    window.__ytSlow = true;
    window.__hang = new Function('return (' + hangSrc + ')')();
    Object.defineProperty(navigator, 'connection', { value: { effectiveType: '3g', downlink: 0.4, rtt: 400 }, configurable: true });
  }, HANG.toString());
  await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  // Slow 3G wie in den Chrome-DevTools: 400 ms Umlaufzeit, 400 kbit/s
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (400 * 1000) / 8, uploadThroughput: (400 * 1000) / 8 });
  await page.goto(`${url}?now=2026-10-23&seed=5#k=${k}`);
  c.feedLoaded = await waitFor(page, () => !!window.__core?.moment(), null, 30000);
  await page.waitForTimeout(3000);
  // Erst wenn etwas gespielt hat, greift die Hänge-Überwachung (everPlayed). Bis dahin wischen, sonst bleibt der Test an einem hängenden Start stehen.
  const ids = moments.map((m) => m.id);
  const seenIds = () => page.evaluate((all) => all.filter((id) => window.__core.seen(id)), ids);
  const endPage = () => page.evaluate(() => !!document.querySelector('[data-testid=end-page]'));
  const seen0 = (await seenIds()).length;
  let endSeen = false;
  const visited = [];
  for (let n = 0; n < 20; n++) {
    const m = await page.evaluate(() => window.__core.moment());
    visited.push(m.videoId);
    await page.waitForTimeout(2200);
    if (await endPage()) endSeen = true;
    await page.evaluate(() => window.__core.next());
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1500);
  if (await endPage()) endSeen = true;
  await page.evaluate(() => window.__flushAll());
  const pl = await page.evaluate(() => window.__plNow());
  const seen1 = await seenIds();
  const seenVideos = seen1.map((id) => id.split(':')[0]);
  const hungVisited = visited.filter(HANG);
  r.numbers = { seenBefore: seen0, seenAfter: seen1.length, visited: visited.length, hungVisited: hungVisited.length, played1s: Object.values(pl).filter((x) => x >= 1000).length };
  c.slow3gSomeHungVisited = hungVisited.length > 0;
  c.slow3gSomePlayed = seen1.length > seen0;
  // Der Zähler steigt nur um gespielte Momente: jeder gesehene hat mindestens eine Sekunde (mit 100 ms Spielraum) im Zustand PLAYING gehabt
  c.slow3gSeenOnlyPlayed = seenVideos.every((v) => (pl[v] ?? 0) >= 900);
  c.slow3gHungNeverSeen = seenVideos.every((v) => !HANG(v));
  c.slow3gSeenAtMostPlayed = seen1.length - seen0 <= Object.values(pl).filter((x) => x >= 900).length;
  c.slow3gNoEndPage = !endSeen;

  // Hänge-Überwachung: bis zu einem hängenden Moment wischen und die 12 s abwarten. Danach: Sitzungs-Sperre, aber nie gesehen.
  let target = null;
  for (let i = 0; i < 12 && !target; i++) {
    const m = await page.evaluate(() => window.__core.moment());
    if (HANG(m.videoId)) target = m; else { await page.evaluate(() => window.__core.next()); await page.waitForTimeout(300); }
  }
  if (target) {
    // Brief 12: die Überwachung greift erst nach 25 s ohne ein Byte (hier kein __trickle, der Anteil bleibt 0), vorher kein Skip
    const tw = Date.now();
    await page.waitForTimeout(20000);
    c.slow3gNoSkipIn20s = (await page.evaluate(() => window.__core.moment().id)) === target.id && !(await page.evaluate((id) => window.__core.diag().some((x) => x === `watchdog ${id}`), target.id));
    c.slow3gWatchdogFired = await waitFor(page, (id) => window.__core.diag().some((x) => x === `watchdog ${id}`), target.id, 60000);
    r.numbers.watchdogAfterMs = Date.now() - tw;
    c.slow3gWatchdogAfter25s = c.slow3gWatchdogFired && r.numbers.watchdogAfterMs >= 24000;
    c.slow3gGaveUpNoBytes = await page.evaluate((id) => window.__core.diag().some((x) => x.startsWith(`video: gave up ${id} after `) && / s, no bytes$/.test(x)), target.id);
    c.slow3gSkippedNotSeenLine = await page.evaluate((id) => window.__core.diag().some((x) => x === `skipped (not seen) ${id}`), target.id);
    c.slow3gWatchdogNotSeen = !(await page.evaluate((id) => window.__core.seen(id), target.id));
    c.slow3gStillNoEndPage = !(await endPage());
  } else {
    c.slow3gWatchdogFired = false;
  }
  c.pageErrors = errors.length === 0;
  r.errors = errors.slice(0, 3);
  await ctx.close();
  return r;
};

// Brief 12 (Issues 22, 33): Slow 3G, hängende Videos liefern Bytes (window.__trickle), aber kein erstes Bild. 20 s auf dem hängenden Moment: kein Skip,
// kein watchdog, Standbild mit Hook sichtbar, Statuszeile "Loading" oder "Next is ready" (wenn der nächste vorgeladen ist), Diag "slow net, showing still".
// Ist der nächste bereit, geht der Tipp weiter, der hängende Moment bleibt ungesehen.
// Zwei Läufe: iPhone-Kennung (Brief 23: YouTube-Nachbarn nur cue, darum nie "Next is ready" für YouTube, nur "Loading" und kein Skip) und Android-Kennung
// (YouTube-Nachbar läuft stumm warm und ist bereit, "Next is ready" und der Tipp werden geprüft).
const runSlow3GNoSkip = async (browser, ios) => {
  const r = { name: `slow3g-no-skip-bytes-arriving-${ios ? 'ios' : 'android'}`, checks: {}, numbers: {} };
  const c = r.checks;
  const ctx = await browser.newContext(ios ? { ...devices['iPhone 15'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block' } : { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((hangSrc) => {
    window.__ytSlow = true;
    window.__trickle = true;
    window.__hang = new Function('return (' + hangSrc + ')')();
    Object.defineProperty(navigator, 'connection', { value: { effectiveType: '3g', downlink: 0.4, rtt: 400 }, configurable: true });
  }, HANG.toString());
  await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (400 * 1000) / 8, uploadThroughput: (400 * 1000) / 8 });
  await page.goto(`${url}?now=2026-10-23&seed=5#k=${k}`);
  c.feedLoaded = await waitFor(page, () => !!window.__core?.moment(), null, 30000);
  // Erst muss einmal etwas gespielt haben (everPlayed), dann bis zu einem hängenden Moment wischen, dessen Nachfolger nicht hängt
  for (let i = 0; i < 12 && !(await page.evaluate(() => window.__core.state() === 1)); i++) {
    await page.evaluate(() => window.__core.next());
    await page.waitForTimeout(2500);
  }
  c.somethingPlayed = await page.evaluate(() => window.__core.state() === 1);
  const vp = page.viewportSize();
  await page.mouse.click(vp.width / 2, vp.height / 2); // Ton an
  await page.waitForTimeout(400);
  let target = null;
  for (let i = 0; i < 20 && !target; i++) {
    const info = await page.evaluate(() => ({ m: window.__core.moment(), idx: window.__core.idx(), slots: window.__core.slotInfo() }));
    const nextMid = info.slots.find((x) => x.index === info.idx + 1)?.mid ?? '';
    if (HANG(info.m.videoId) && nextMid && !HANG(nextMid.split(':')[0])) target = info.m;
    else { await page.evaluate(() => window.__core.next()); await page.waitForTimeout(HANG(info.m.videoId) ? 300 : 1500); }
  }
  c.hungTargetFound = !!target;
  if (target) {
    const idx0 = await page.evaluate(() => window.__core.idx());
    await page.waitForTimeout(20000);
    const st = await page.evaluate((id) => {
      const cur = document.querySelector('.vslot[aria-hidden=false]');
      const poster = cur?.querySelector('.vposter');
      const vis = (e) => !!e && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
      const hookText = window.__core.moment().hook;
      const status = document.querySelector('.status');
      const d = window.__core.diag();
      return {
        idx: window.__core.idx(), id: window.__core.moment().id, seen: window.__core.seen(id),
        poster: vis(poster), live: !!cur?.hasAttribute('data-live'), hook: [...document.querySelectorAll('[data-testid=hook]')].some((e) => vis(e) && e.textContent.includes(hookText)),
        status: status ? { kind: status.getAttribute('data-status'), text: status.textContent.trim(), testid: status.getAttribute('data-testid') } : null,
        still: d.find((x) => x.startsWith(`video: slow net, showing still ${id}`)) ?? null,
        nextReady: d.some((x) => x.startsWith('video: next ready ') && x.endsWith(` while ${id} loads`)),
        watchdog: d.filter((x) => x === `watchdog ${id}` || x.startsWith(`video: gave up ${id}`)),
        skipped: d.some((x) => x === `skipped (not seen) ${id}`),
        slots: window.__core.video?.().slots ?? null, idxNow: window.__core.idx(),
      };
    }, target.id);
    r.after20s = st;
    c.noSkipIn20s = st.idx === idx0 && st.id === target.id && st.watchdog.length === 0 && !st.skipped;
    c.stillShown = st.poster && !st.live && st.hook;
    c.stillLine = !!st.still && / bytes arriving$/.test(st.still);
    c.statusLoadingOrNext = !!st.status && (st.status.text === 'Loading' || st.status.text === 'Next is ready');
    c.hungNotSeen = !st.seen;
    if (ios) {
      // iPhone: der YouTube-Nachbar ist nur vorbereitet (cue), kein erstes Bild, also ehrlich "Loading" und kein "Next is ready"
      c.iosLoadingOnly = st.status?.text === 'Loading' && !st.nextReady;
    } else {
      c.nextReadyOffered = st.nextReady && st.status?.text === 'Next is ready' && st.status?.testid === 'next-ready';
      // Tipp auf den hängenden Moment geht zum bereiten nächsten, kein automatischer Wechsel vorher
      await page.mouse.click(vp.width / 2, vp.height / 2);
      c.tapGoesNext = await waitFor(page, (n) => window.__core.idx() === n, idx0 + 1, 3000);
      c.tapLine = await page.evaluate((id) => window.__core.diag().some((x) => x === `video: tap on next ready, leaving ${id}`), target.id);
      c.nextPlaysAfterTap = await waitFor(page, () => window.__core.state() === 1, null, 5000);
      c.hungStillNotSeen = !(await page.evaluate((id) => window.__core.seen(id), target.id));
    }
  }
  r.diagTail = await page.evaluate(() => window.__core.diag().filter((x) => /^video: (preload|slow net|next ready|gave up|tap)|^watchdog|^skipped|^first-frame/.test(x)).slice(-30));
  c.pageErrors = errors.length === 0;
  r.errors = errors.slice(0, 3);
  await ctx.close();
  return r;
};

// Brief 23 (Issue 48): iOS-Regeln im Nachbau (window.__ytIos): unMute ohne Geste hält ein stumm gestartetes Video an, ein lauter Start ohne Geste
// läuft an und hält sich nach 800 ms selbst an, danach bleibt jeder laute Start ohne Geste ohne Wirkung. Nach cue ist der erste Start kalt (600 bis 1200 ms),
// PLAYING kommt also erst nach dem Ende der Feder.
// Teil 1 (Variante a): fünf Wische auf YouTube-Momente, jeder spielt 10 s nach dem Wisch (state 1), kein state 2 ohne eigene Pause, kein watchdog,
// kein soundGuard attempt > 0, kein stummer Warmlauf, der Start kommt aus dem Wisch-Handler.
// Teil 2 (Variante c, Sicherheitsnetz): mit window.__ytGestureLost kommt die Geste nicht im Player an (so als trüge postMessage sie auf dem Gerät nicht).
// Dann: Selbstpause erkannt, ein Weiterstart, Tippfläche "Tap to play", kein watchdog-Skip in 13 s, der Tipp startet in der Geste.
// Läuft ohne Netzdrossel (auch in WebKit), die Zeit läuft echt (__ytSlow).
const runIosSwipes = async (browser, name) => {
  const r = { name, checks: {}, swipes: [] };
  const c = r.checks;
  const ctx = await browser.newContext({ ...devices['iPhone 15'], viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__ytSlow = true;
    window.__ytIos = true;
    Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g', downlink: 9, rtt: 85 }, configurable: true });
  });
  await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  await page.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
  c.feedLoaded = await waitFor(page, () => !!window.__core?.moment());
  // Kaltstart: der erste Moment läuft stumm an (erlaubt), der erste Tipp schaltet den Ton ein (Geste). pointerdown allein darf nicht laut schalten (hielte an).
  c.coldStartPlays = await waitFor(page, () => window.__core.state() === 1);
  c.iosModeLine = await page.evaluate(() => window.__core.diag().some((x) => x.startsWith('yt: ios mode')));
  const vp = page.viewportSize();
  await page.waitForTimeout(800);
  await page.mouse.click(vp.width / 2, vp.height / 2);
  c.firstTapSoundPlays = await waitFor(page, () => window.__core.state() === 1 && window.__core.sound() && window.__ytlog.some((x) => x.startsWith('ios play in gesture')));
  await page.waitForTimeout(1500);
  c.noPauseOnUnmuteAtFirstTap = await page.evaluate(() => !window.__ytlog.some((x) => x.startsWith('ios pause on unmute')) && !window.__core.diag().some((x) => x.startsWith('yt: self-pause')));
  const swipe = async () => {
    const y0 = vp.height * 0.75, y1 = vp.height * 0.25;
    await page.mouse.move(vp.width / 2, y0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(vp.width / 2, y0 + ((y1 - y0) * i) / 8); await page.waitForTimeout(12); }
    await page.mouse.up();
  };
  const cur = () => page.evaluate(() => {
    const cur = document.querySelector('.vslot[aria-hidden=false]');
    const poster = cur?.querySelector('.vposter');
    const vis = (e) => !!e && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
    const tap = cur?.querySelector('[data-testid=tap-to-play]');
    return { paused: !!cur?.hasAttribute('data-paused'), held: !!cur?.hasAttribute('data-hold'), tapAttr: !!cur?.hasAttribute('data-tap'), tapText: tap?.textContent ?? '', tapVisible: vis(tap), poster: vis(poster), play: !!cur?.querySelector('.vplay'), st: window.__core.state() };
  });
  for (let n = 0; n < 5; n++) {
    const idx0 = await page.evaluate(() => window.__core.idx());
    const diagLen = await page.evaluate(() => window.__core.diag().length);
    const logLen = await page.evaluate(() => window.__ytlog.length);
    // Issue 54 (3): der nächste YouTube-Moment ist beim Wisch schon vorbereitet (state 5, cue), nicht erst -1
    const cuedBefore = await page.evaluate((i) => window.__core.slotInfo().find((x) => x.index === i + 1)?.st ?? null, idx0);
    await swipe();
    const moved = await waitFor(page, (i0) => window.__core.idx() === i0 + 1, idx0, 5000);
    const m = await page.evaluate(() => window.__core.moment());
    // 10 s nach dem Wisch: der Moment spielt noch
    await page.waitForTimeout(10_000);
    const st = await page.evaluate(() => window.__core.state());
    const lines = await page.evaluate((l) => window.__core.diag().slice(l), diagLen);
    const ylog = await page.evaluate((l) => window.__ytlog.slice(l), logLen);
    const mine = lines.filter((x) => x.includes(m.id) || /^soundGuard|^watchdog/.test(x));
    const sw = {
      n, id: m.id, moved, stateAt10s: st, cuedBefore,
      playInGesture: lines.some((x) => x === `yt: play in gesture ${m.id}`),
      playingAfterGesture: lines.some((x) => x.startsWith(`yt: playing after gesture ${m.id}`)),
      swipeMode: lines.find((x) => x.startsWith('video: swipe→ready'))?.split(', ').pop() ?? '',
      // PLAYING darf erst nach dem Ende der Feder kommen (kalter Start nach cue), dann hat goTo keinen zweiten Startbefehl geschickt
      playCommands: ylog.filter((x) => x.startsWith('ios play in gesture') || x.startsWith('ios play')).length,
      state2: mine.filter((x) => / state 2$/.test(x)).length,
      selfPause: lines.filter((x) => x.startsWith('yt: self-pause')).length,
      guardRetry: lines.filter((x) => /^soundGuard .* attempt=[1-9]/.test(x)).length,
      guardAny: lines.filter((x) => /^soundGuard/.test(x)).length,
      watchdog: lines.filter((x) => x.startsWith('watchdog')).length,
      iosRefused: ylog.filter((x) => /^ios (play refused|play then pause|pause on unmute)/.test(x)).length,
      warmStart: lines.filter((x) => x.startsWith('video: warm start')).length,
      warmCue: lines.filter((x) => x.startsWith('yt: warm cue')).length,
    };
    r.swipes.push(sw);
  }
  const sw = r.swipes;
  c.fiveSwipesMoved = sw.length === 5 && sw.every((x) => x.moved);
  c.playsAt10s = sw.every((x) => x.stateAt10s === 1);
  c.startedInGesture = sw.every((x) => x.playInGesture && x.playingAfterGesture && x.swipeMode === 'gesture');
  c.oneStartPerSwipe = sw.every((x) => x.playCommands === 1 && x.guardAny === 0);
  c.noState2WithoutPause = sw.every((x) => x.state2 === 0 && x.selfPause === 0);
  c.noGuardRetry = sw.every((x) => x.guardRetry === 0);
  c.noWatchdog = sw.every((x) => x.watchdog === 0);
  c.noIosRefusal = sw.every((x) => x.iosRefused === 0);
  c.noMutedWarmStart = sw.every((x) => x.warmStart === 0);
  c.nextCuedNotWarmed = sw.some((x) => x.warmCue > 0);
  c.nextCuedBeforeSwipe = sw.every((x) => x.cuedBefore === 5);
  // Pause durch Tippen: Standbild und Pausensymbol, IFrame unsichtbar (data-hold), kein YouTube-Element
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(600);
  const pz = await cur();
  r.pause = pz;
  c.tapPauseOwnStill = pz.paused && pz.held && pz.poster && pz.play && pz.st === 2;
  // Weiter durch Tippen (Geste): spielt wieder, kein Standbild
  await page.mouse.click(vp.width / 2, vp.height / 2);
  c.tapResumePlays = await waitFor(page, () => window.__core.state() === 1 && !document.querySelector('.vslot[aria-hidden=false]').hasAttribute('data-hold'), null, 5000);
  await page.waitForTimeout(800);
  // Teil 2 (Variante c): die Geste kommt nicht im Player an
  {
    const idx0 = await page.evaluate(() => window.__core.idx());
    const diagLen = await page.evaluate(() => window.__core.diag().length);
    await page.evaluate(() => { window.__ytGestureLost = true; });
    await swipe();
    const moved = await waitFor(page, (i0) => window.__core.idx() === i0 + 1, idx0, 5000);
    const m = await page.evaluate(() => window.__core.moment());
    const tapShown = await waitFor(page, () => !!document.querySelector('.vslot[aria-hidden=false][data-tap]'), null, 8000);
    const atTap = await cur();
    await page.screenshot({ path: `${out}/${name}-tap-to-play.png` });
    // 13 s nach dem Wisch: kein watchdog, kein Skip, Tippfläche steht noch
    await page.waitForTimeout(13_000);
    const idxAfter = await page.evaluate(() => window.__core.idx());
    const lines = await page.evaluate((l) => window.__core.diag().slice(l), diagLen);
    const still = await cur();
    // Der Tipp startet in der Geste
    await page.evaluate(() => { window.__ytGestureLost = false; });
    await page.mouse.click(vp.width / 2, vp.height / 2);
    const playsAfterTap = await waitFor(page, () => window.__core.state() === 1 && !document.querySelector('.vslot[aria-hidden=false]').hasAttribute('data-tap'), null, 5000);
    await page.waitForTimeout(1500);
    const after = await page.evaluate((l) => window.__core.diag().slice(l), diagLen);
    r.variantC = { id: m.id, moved, tapShown, atTap, idxAfter, still, playsAfterTap, lines: after.filter((x) => /^yt:|^soundGuard|^watchdog|state [12]$|^skipped/.test(x)) };
    c.cSelfPauseDetected = lines.some((x) => x.startsWith(`yt: self-pause ${m.id} after`) && x.includes('started in gesture'));
    c.cOneResumeAttempt = lines.filter((x) => x === `yt: resume after self-pause ${m.id}`).length === 1 && !lines.some((x) => x.startsWith('yt: resumed after self-pause'));
    c.cTapSurface = tapShown && atTap.tapAttr && atTap.tapText === 'Tap to play' && atTap.tapVisible && atTap.poster && atTap.play && !atTap.paused;
    c.cNoWatchdogSkip = idxAfter === idx0 + 1 && !lines.some((x) => x.startsWith('watchdog') || x.startsWith('skipped (not seen)')) && still.tapAttr;
    c.cNoGuardRetry = !lines.some((x) => /^soundGuard/.test(x));
    c.cTapPlaysInGesture = playsAfterTap && after.some((x) => x === `yt: play in gesture ${m.id} (tap)`) && after.some((x) => x.startsWith(`yt: playing after gesture ${m.id}`));
  }
  // Teil 3 (Issue 54): der Start in der Geste kommt nie auf PLAYING (state 3, dann -1, window.__ytStartHang). Erwartet: nach 3 s genau ein
  // "yt: retry start", nach weiteren 3 s die Tippfläche "Tap to play", kein soundGuard, kein watchdog, kein Skip in 13 s. Der Tipp (Schalter weg) startet in der Geste.
  {
    await page.waitForTimeout(1500);
    const idx0 = await page.evaluate(() => window.__core.idx());
    const diagLen = await page.evaluate(() => window.__core.diag().length);
    const cuedBefore = await page.evaluate((i) => window.__core.slotInfo().find((x) => x.index === i + 1)?.st ?? null, idx0);
    await page.evaluate(() => { window.__ytStartHang = true; });
    const tSwipe = Date.now();
    await swipe();
    const moved = await waitFor(page, (i0) => window.__core.idx() === i0 + 1, idx0, 5000);
    const m = await page.evaluate(() => window.__core.moment());
    const retried = await waitFor(page, (id) => window.__core.diag().some((x) => x.startsWith(`yt: retry start ${id}`)), m.id, 8000);
    const retryAfterMs = Date.now() - tSwipe;
    const tapBeforeRetry = await page.evaluate(() => !!document.querySelector('.vslot[aria-hidden=false][data-tap]'));
    const tapShown = await waitFor(page, () => !!document.querySelector('.vslot[aria-hidden=false][data-tap]'), null, 8000);
    const tapAfterMs = Date.now() - tSwipe;
    const atTap = await cur();
    await page.screenshot({ path: `${out}/${name}-start-hang-tap.png` });
    await page.waitForTimeout(13_000);
    const idxAfter = await page.evaluate(() => window.__core.idx());
    const lines = await page.evaluate((l) => window.__core.diag().slice(l), diagLen);
    const still = await cur();
    const status = await page.evaluate(() => document.querySelector('.status')?.textContent.trim() ?? '');
    await page.evaluate(() => { window.__ytStartHang = false; });
    await page.mouse.click(vp.width / 2, vp.height / 2);
    const playsAfterTap = await waitFor(page, () => window.__core.state() === 1 && !document.querySelector('.vslot[aria-hidden=false]').hasAttribute('data-tap'), null, 5000);
    await page.waitForTimeout(1500);
    const after = await page.evaluate((l) => window.__core.diag().slice(l), diagLen);
    r.startHang = { id: m.id, cuedBefore, moved, retried, retryAfterMs, tapShown, tapAfterMs, atTap, idxAfter, still, status, playsAfterTap, lines: after.filter((x) => /^yt:|^soundGuard|^watchdog|state |^skipped|^video: gave up/.test(x)) };
    c.hCuedBeforeSwipe = cuedBefore === 5;
    c.hPlayInGesture = moved && lines.some((x) => x === `yt: play in gesture ${m.id}`);
    c.hOneRetryAround3s = retried && lines.filter((x) => x.startsWith(`yt: retry start ${m.id}`)).length === 1 && retryAfterMs >= 2500 && retryAfterMs < 6500;
    c.hTapAfterRetry = tapShown && !tapBeforeRetry && tapAfterMs >= 5500 && tapAfterMs < 10_000 && lines.some((x) => x.startsWith(`yt: no start ${m.id} st=`)) && lines.some((x) => x === `yt: tap to play ${m.id}`);
    c.hTapSurface = tapShown && atTap.tapAttr && atTap.tapText === 'Tap to play' && atTap.tapVisible && atTap.poster && atTap.play && !atTap.paused;
    c.hNoSoundGuard = !lines.some((x) => /^soundGuard/.test(x));
    c.hNoWatchdogSkip = idxAfter === idx0 + 1 && !lines.some((x) => x.startsWith('watchdog') || x.startsWith('skipped (not seen)') || x.startsWith('video: gave up')) && still.tapAttr;
    c.hNoLoadingWhileTap = status !== 'Loading' && status !== 'Next is ready';
    c.hNeverPlayingWhileHung = !lines.some((x) => x.startsWith(`yt: playing after gesture ${m.id}`));
    c.hTapPlaysInGesture = playsAfterTap && after.some((x) => x === `yt: play in gesture ${m.id} (tap)`) && after.some((x) => x.startsWith(`yt: playing after gesture ${m.id}`));
  }
  r.diagTail = await page.evaluate(() => window.__core.diag().filter((x) => /^yt:|^soundGuard|^watchdog|state 2$/.test(x)).slice(-40));
  c.pageErrors = errors.length === 0;
  r.errors = errors.slice(0, 3);
  await ctx.close();
  return r;
};

const scenarios = [];
for (const dwell of DWELLS) {
  scenarios.push({ name: `mobile-390x844-dwell${dwell}`, desk: false, dwell });
  scenarios.push({ name: `desktop-1440x900-dwell${dwell}`, desk: true, dwell });
}
const results = { at: new Date().toISOString(), url, model: 'Nachbau der IFrame-API mit Latenzmodell, kein echtes YouTube', swipes: SWIPES, runs: [] };
const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
for (const sc of scenarios) {
  if (process.env.ONLY && !sc.name.includes(process.env.ONLY)) continue;
  try {
    const r = await runScenario(browser, sc);
    results.runs.push(r);
    console.log(`${sc.name}: n ${r.n}, Median ${r.median} ms, p90 ${r.p90} ms (App-Zähler: ${r.appMedian ?? '-'} / ${r.appP90 ?? '-'}), Einblendung sichtbar bei ${r.exposedSwipes} von ${r.n} Wischen (${r.probesChecked} Proben), Reloads ${r.reloads}`);
  } catch (e) {
    results.runs.push({ name: sc.name, error: String(e), checks: { ran: false } });
    console.log(`${sc.name}: FEHLER ${String(e).slice(0, 200)}`);
  }
}
if (!process.env.ONLY || 'slow3g-mobile-20swipes'.includes(process.env.ONLY)) try {
  const r = await runSlow3G(browser);
  results.runs.push(r);
  console.log(`${r.name}: ${JSON.stringify(r.numbers)}`);
} catch (e) {
  results.runs.push({ name: 'slow3g-mobile-20swipes', error: String(e), checks: { ran: false } });
  console.log(`slow3g: FEHLER ${String(e).slice(0, 300)}`);
}
for (const ios of [true, false]) if (!process.env.ONLY || `slow3g-no-skip-bytes-arriving-${ios ? 'ios' : 'android'}`.includes(process.env.ONLY)) try {
  const r = await runSlow3GNoSkip(browser, ios);
  results.runs.push(r);
  console.log(`${r.name}: ${JSON.stringify(r.after20s ?? r.checks)}`);
} catch (e) {
  results.runs.push({ name: `slow3g-no-skip-bytes-arriving-${ios ? 'ios' : 'android'}`, error: String(e), checks: { ran: false } });
  console.log(`slow3g-no-skip: FEHLER ${String(e).slice(0, 300)}`);
}
// Brief 23: iOS-Fall in Chromium und, wenn E2E_BROWSERS webkit nennt, auch in WebKit (ohne Netzdrossel, darum ohne CDP)
if (!process.env.ONLY || 'ios-youtube-swipes'.includes(process.env.ONLY)) {
  const iosTargets = (process.env.E2E_BROWSERS ?? 'chromium').split(',');
  for (const [bn, type] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => iosTargets.includes(n))) {
    const name = `ios-youtube-swipes-${bn}`;
    try {
      const b = bn === 'chromium' ? browser : await type.launch();
      const r = await runIosSwipes(b, name);
      if (b !== browser) await b.close();
      results.runs.push(r);
      console.log(`${name}: ${JSON.stringify(r.swipes.map((x) => [x.id, x.stateAt10s, x.state2, x.guardRetry]))}`);
    } catch (e) {
      results.runs.push({ name, error: String(e), checks: { ran: false } });
      console.log(`${name}: FEHLER ${String(e).slice(0, 300)}`);
    }
  }
}
await browser.close();
let bad = 0;
for (const r of results.runs) for (const [name, ok] of Object.entries(r.checks)) if (!ok) { bad++; console.log(`FAIL ${r.name} ${name}`); }
results.ok = bad === 0;
writeFileSync(`${out}/video4g.json`, JSON.stringify(results, null, 1));
console.log(results.ok ? 'ALL GREEN' : `${bad} Prüfpunkte rot`);
if (!results.ok && !INFO) process.exit(1);
