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
import { chromium, devices } from 'playwright';

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
    let isCold = false, since = 0, acc = 0, state = -1;
    const on = () => state !== 1 || acc + (performance.now() - since) < 3000;
    let refresh = () => {};
    const emit = (data) => {
      if (data === 1) since = performance.now(); else if (state === 1) acc += performance.now() - since;
      state = data;
      refresh();
      ev.onStateChange({ data });
    };
    const wrapped = { ...opts, events: { ...ev, onStateChange: (e) => {
      if (e.data === 1) { const d = isCold ? cold() : warm(); isCold = false; setTimeout(() => emit(1), d); } else emit(e.data);
    } } };
    Orig.call(this, el, wrapped);
    const load = this.loadVideoById, cue = this.cueVideoById, seek = this.seekTo;
    // Wie bei YouTube: ein Sprung im laufenden Player puffert kurz (80 bis 160 ms), dann kommt PLAYING wieder
    this.seekTo = (sec, ahead) => { const was = state === 1; seek(sec, ahead); if (was) { emit(3); setTimeout(() => emit(1), 80 + rnd() * 80); } };
    this.loadVideoById = (a) => { isCold = true; acc = 0; state = -1; load(a); };
    this.cueVideoById = (a) => { acc = 0; state = -1; cue(a); };
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
  if (sc.desk) await page.keyboard.press('Space'); else await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(500);
  const pz = await page.evaluate((EX) => {
    const cur = document.querySelector('.vslot[aria-hidden=false]');
    const poster = cur?.querySelector('.vposter');
    const hookText = window.__core.moment().hook;
    const vis = (e) => !!e && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
    const ex = new Function('return (' + EX + ')')()();
    const pr = poster?.getBoundingClientRect();
    return { poster: vis(poster), live: !!cur?.hasAttribute('data-live'), hook: [...document.querySelectorAll('[data-testid=hook], h1, h2, h3, [class*=hook]')].some((e) => vis(e) && e.textContent.includes(hookText)), play: !!cur?.querySelector('.vplay'), exposed: ex.n, checked: ex.checked, band: pr ? [Math.round(pr.width), Math.round(pr.height)] : null, vw: innerWidth };
  }, EXPOSED.toString());
  r.pause = pz;
  c.pauseOwnStill = pz.poster && !pz.live;
  c.pauseHookShown = pz.hook;
  c.pausePlayIcon = pz.play;
  c.pauseNoYoutubeView = pz.exposed === 0;
  c.pauseOverlayMeasured = pz.checked > 0;
  c.band16by9 = !!pz.band && Math.abs(pz.band[0] / pz.band[1] - 16 / 9) < 0.03 && (sc.desk ? pz.band[0] <= 1280 : pz.band[0] === pz.vw);
  await page.screenshot({ path: `${out}/${sc.name}-pause.png` });
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
await browser.close();
let bad = 0;
for (const r of results.runs) for (const [name, ok] of Object.entries(r.checks)) if (!ok) { bad++; console.log(`FAIL ${r.name} ${name}`); }
results.ok = bad === 0;
writeFileSync(`${out}/video4g.json`, JSON.stringify(results, null, 1));
console.log(results.ok ? 'ALL GREEN' : `${bad} Prüfpunkte rot`);
if (!results.ok && !INFO) process.exit(1);
