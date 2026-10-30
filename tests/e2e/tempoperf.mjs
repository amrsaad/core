// E2E Tempo 1x, 1.5x, 2x mit ECHTER Wiedergabe (Issue 13): zählt Stalls, Netzanfragen beim Tempo-Wechsel, Elemente mit Quelle
// und verlorene Frames, je Form (video, audio), Lautheit (aus, an) und Tempo. Kein Nachbau der Media-Elemente (anders als fakeyt.js),
// nur die YouTube-API ist nachgebaut. Stream-Host stream.test liefert tone-cbr.mp3 mit Range.
//
// Last: Chromium mit CPU-Drossel 4x (CDP). WebKit kennt kein CDP, dort laufen Rechen-Worker als Gegenlast (LOAD_WORKERS, Standard 2).
// Beides ist eine Näherung an ein iPhone, kein Ersatz für Copy diagnostics vom Gerät.
//
// Aufruf: node tests/e2e/tempoperf.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
// Umgebung: E2E_BROWSERS=chromium,webkit  FORMS=video,audio  LANES=off,on  RATES=1,1.5,2  MOMENTS=10  CONTENT_S=6  LOAD=1|0
//           CHECK=1 macht aus den Zielwerten einen Testlauf (Exit-Code 1 bei Verfehlung)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-tempoperf'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const list = (k, d) => (process.env[k] ?? d).split(',').map((s) => s.trim()).filter(Boolean);
const BROWSERS = list('E2E_BROWSERS', 'chromium,webkit');
const FORMS = list('FORMS', 'video,audio');
const LANES = list('LANES', 'off,on');
const RATES = list('RATES', '1,1.5,2').map(Number);
const MOMENTS = Number(process.env.MOMENTS ?? 10);
const CONTENT_S = Number(process.env.CONTENT_S ?? 6);
const LOAD = process.env.LOAD !== '0';
const LOAD_WORKERS = Number(process.env.LOAD_WORKERS ?? 2);
const DELAY = Number(process.env.NET_DELAY ?? 120);
const CHECK = process.env.CHECK === '1';

const FILE = new Uint8Array(readFileSync(new URL('../fixtures/media/tone-cbr.mp3', import.meta.url)));
// Nur die YouTube-API, die Media-Elemente bleiben echt
const FAKE_YT = `window.YT={PlayerState:{ENDED:0,PLAYING:1,PAUSED:2,BUFFERING:3,CUED:5},Player:function(el,o){const ev=o.events||{};el.replaceWith(document.createElement('div'));
this.loadVideoById=()=>{};this.cueVideoById=()=>{};this.playVideo=()=>{};this.pauseVideo=()=>{};this.mute=()=>{};this.unMute=()=>{};this.isMuted=()=>true;
this.getCurrentTime=()=>0;this.getDuration=()=>0;this.getPlayerState=()=>-1;this.setPlaybackRate=()=>{};this.destroy=()=>{};setTimeout(()=>ev.onReady&&ev.onReady(),10)}};
window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();`;

const AREAS = ['brain', 'body', 'beat'];
const mk = (i, form) => {
  const start = 4 + ((i * 11) % 100);
  const id = `${form === 'audio' ? 'pod' : 'vid'}-${String(i).padStart(4, '0')}`;
  const gainDb = i % 2 ? -2.5 : 3;
  return {
    id: `${id}:${start}`, videoId: id, start, end: start + 20, channel: `Show ${i % 9}`, videoTitle: 'Test', area: AREAS[Math.floor(i / 3) % 3], topic: `topic${i % 5}`,
    hook: `Tempo ${form} ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', form, ...(form === 'audio' ? { audio: true } : {}),
    hls: `https://stream.test/${id}.mp3`, lufs: -16 - gainDb, gainDb,
  };
};
const POOL = [...Array.from({ length: 40 }, (_, i) => mk(i, 'audio')), ...Array.from({ length: 40 }, (_, i) => mk(i, 'video'))];
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: POOL })));
const POOL_BODY = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-allow-methods': 'GET,OPTIONS' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (page, fn, arg, timeout = 15000) => {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); return true; } catch { return false; }
};

// Messfühler in der Seite: Medienereignisse (Capture am Dokument, sie bubbeln nicht), Bildtakt, Elemente mit Quelle
const PROBE = `(() => {
  const m = (window.__m = { ev: {}, mid: [], wrongRate: [], starts: 0, frames: [], srcMax: 0, srcMaxReal: 0, srcSeries: [], on: false, last: 0 });
  const since = new WeakMap();
  const bump = (k) => (m.ev[k] = (m.ev[k] || 0) + 1);
  for (const t of ['waiting', 'stalled', 'loadstart', 'emptied', 'ratechange', 'error', 'seeking', 'playing', 'pause', 'ended']) {
    document.addEventListener(t, (e) => {
      if (!m.on) return;
      const el = e.target;
      if (!(el instanceof HTMLMediaElement)) return;
      bump(t);
      if (t === 'loadstart' || t === 'emptied') since.delete(el);
      if (t === 'playing') {
        if (!since.has(el)) {
          since.set(el, performance.now());
          m.starts++;
          const want = window.__core?.rate?.() ?? 1;
          if (el.playbackRate !== want) m.wrongRate.push({ have: el.playbackRate, want });
        }
      }
      if (t === 'waiting' || t === 'stalled') {
        const s = since.get(el);
        if (s !== undefined && performance.now() - s > 500) m.mid.push({ t, tag: el.tagName, after: Math.round(performance.now() - s), rs: el.readyState });
      }
    }, true);
  }
  const loop = (t) => { if (m.on) { if (m.last) m.frames.push(t - m.last); m.last = t; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  setInterval(() => {
    if (!m.on) return;
    const els = [...document.querySelectorAll('audio,video')];
    const withSrc = els.filter((e) => (e.getAttribute('src') || '') !== '');
    const real = withSrc.filter((e) => !(e.getAttribute('src') || '').startsWith('data:'));
    m.srcMax = Math.max(m.srcMax, withSrc.length);
    m.srcMaxReal = Math.max(m.srcMaxReal, real.length);
    m.srcSeries.push(withSrc.length);
  }, 250);
  window.__mStart = () => { m.ev = {}; m.mid = []; m.wrongRate = []; m.starts = 0; m.frames = []; m.last = 0; m.srcMax = 0; m.srcMaxReal = 0; m.srcSeries = []; m.on = true; };
  window.__mStop = () => { m.on = false; };
  window.__spin = (n) => { for (let i = 0; i < n; i++) { const w = new Worker(URL.createObjectURL(new Blob(['for(;;){Math.sqrt(Math.random())}']))); (window.__w ||= []).push(w); } };
})();`;

// Dieselbe Rechnung wie src/moments/swipe.ts (hzOf, lostFrames)
const frameStats = (deltas) => {
  const d = deltas.filter((x) => x < 1000);
  if (d.length < 10) return { frames: d.length, lost: 0, lostPct: null, hz: null };
  const s = [...d].sort((a, b) => a - b);
  const hz = s[Math.floor(s.length / 2)] < 12.5 ? 120 : 60;
  const f = 1000 / hz;
  let lost = 0;
  for (const x of d) lost += Math.max(0, Math.round(x / f) - 1);
  return { frames: d.length, lost, lostPct: Math.round((lost / (lost + d.length)) * 1000) / 10, hz };
};

const longPress = async (page, ms = 700) => {
  await page.mouse.move(190, 420);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
};

async function scenario(type, name, form, lane, rate) {
  const res = { browser: name, form, lane, rate, ok: false, notes: {} };
  const net = [];
  let browser;
  try {
    browser = await type.launch(name === 'chromium' ? { args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {}) } : {});
    const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    await ctx.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: POOL_BODY }));
    await ctx.route('https://stream.test/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const range = req.headers().range;
      net.push({ at: Date.now(), range: range ?? null, type: req.resourceType() });
      await sleep(DELAY);
      const m = /bytes=(\d+)-(\d*)/.exec(range ?? '');
      const from = m ? Number(m[1]) : 0;
      const to = m && m[2] ? Math.min(Number(m[2]), FILE.length - 1) : FILE.length - 1;
      if (from >= FILE.length) return route.fulfill({ status: 416, headers: cors });
      return route.fulfill({ status: m ? 206 : 200, headers: { ...cors, 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', ...(m ? { 'content-range': `bytes ${from}-${to}/${FILE.length}` } : {}) }, body: Buffer.from(FILE.subarray(from, to + 1)) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(({ lane }) => { try { if (lane === 'on') localStorage.setItem('core.level.on', '1'); else localStorage.removeItem('core.level.on'); } catch {} }, { lane });
    await page.addInitScript(PROBE);
    await page.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
    await page.waitForSelector('[data-testid=form-switch]', { timeout: 25000 });
    if (form === 'audio') await page.click('[data-testid=form-switch] button:has-text("Audio")');
    res.feed = await waitFor(page, (f) => window.__core?.moment()?.form === f, form, 25000);
    res.firstPlays = await waitFor(page, () => window.__core.state() === 1, null, 30000);
    // Erste Berührung: Ton an, Web Audio starten
    await page.mouse.click(190, 300);
    await sleep(1500);
    // Gegenlast erst jetzt, damit der Start nicht die Messung verfälscht
    let cdp = null;
    if (LOAD) {
      if (name === 'chromium') { cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); res.notes.load = 'cdp cpu throttle 4x'; }
      else { await page.evaluate((n) => window.__spin(n), LOAD_WORKERS); res.notes.load = `${LOAD_WORKERS} spinner workers`; }
    }
    // Tempo setzen (langes Drücken schaltet 1x, 1.5x, 2x im Kreis)
    const presses = rate === 1.5 ? 1 : rate === 2 ? 2 : 0;
    for (let i = 0; i < presses; i++) { await longPress(page); await sleep(200); }
    res.rateSet = await waitFor(page, (r) => window.__core.rate() === r, rate, 4000);
    await sleep(1200);
    await page.evaluate(() => window.__mStart());
    const t0 = Date.now();
    const switches = [];
    for (let i = 0; i < MOMENTS; i++) {
      const info = await page.evaluate(() => ({ idx: window.__core.idx(), start: window.__core.moment().start }));
      const wall = Math.ceil(CONTENT_S / rate) * 1000 + 6000;
      const played = await waitFor(page, ([s, c]) => window.__core.state() === 1 && window.__core.time() - s >= c, [info.start, CONTENT_S], wall);
      if (!played) { res.notes[`stuck${i}`] = await page.evaluate(() => ({ st: window.__core.state(), t: window.__core.time(), idx: window.__core.idx() })); }
      const s0 = Date.now();
      await page.evaluate(() => window.__core.next());
      const moved = await waitFor(page, (n) => window.__core.idx() === n + 1 && window.__core.state() === 1, info.idx, 12000);
      switches.push(moved ? Date.now() - s0 : -1);
    }
    const wallMs = Date.now() - t0;
    const m = await page.evaluate(() => { window.__mStop(); return { ev: window.__m.ev, mid: window.__m.mid, wrongRate: window.__m.wrongRate, starts: window.__m.starts, frames: window.__m.frames, srcMax: window.__m.srcMax, srcMaxReal: window.__m.srcMaxReal, srcSeries: window.__m.srcSeries }; });
    const fs = frameStats(m.frames);
    const ok = switches.filter((x) => x >= 0).sort((a, b) => a - b);
    Object.assign(res, {
      wallS: Math.round(wallMs / 1000),
      stallsMid: m.mid.length,
      waiting: m.ev.waiting ?? 0,
      stalled: m.ev.stalled ?? 0,
      stallsPerMin: Math.round((m.mid.length / (wallMs / 60000)) * 10) / 10,
      starts: m.starts,
      startsWrongRate: m.wrongRate.length,
      ratechange: m.ev.ratechange ?? 0,
      loadstart: m.ev.loadstart ?? 0,
      mediaErrors: m.ev.error ?? 0,
      srcMax: m.srcMax,
      srcMaxReal: m.srcMaxReal,
      framesLostPct: fs.lostPct,
      switchMedianMs: ok.length ? ok[Math.floor(ok.length / 2)] : null,
      switchWorstMs: ok.length ? ok[ok.length - 1] : null,
      switchFailed: switches.filter((x) => x < 0).length,
      swipeFrames: await page.evaluate((n) => (window.__core.swipeFrames?.() ?? []).slice(-n).reduce((a, s) => ({ frames: a.frames + s.frames, lost: a.lost + s.lost }), { frames: 0, lost: 0 }), MOMENTS),
    });
    res.notes.midSample = m.mid.slice(0, 3);

    // Tempo-Wechsel mitten im Lauf: Netzanfragen und Neuladen müssen 0 sein
    if (rate === 1 && lane === 'off') {
      const changes = [];
      for (let step = 0; step < 3; step++) {
        const before = await page.evaluate(() => ({ r: window.__core.rate(), idx: window.__core.idx() }));
        await sleep(500);
        net.length = 0;
        await page.evaluate(() => window.__mStart());
        await longPress(page);
        await waitFor(page, (r) => window.__core.rate() !== r, before.r, 3000);
        await sleep(3000);
        const x = await page.evaluate(() => { window.__mStop(); return { ev: window.__m.ev, mid: window.__m.mid.length }; });
        const after = await page.evaluate(() => ({ r: window.__core.rate(), idx: window.__core.idx(), st: window.__core.state() }));
        changes.push({ from: before.r, to: after.r, requests: net.length, loadstart: x.ev.loadstart ?? 0, emptied: x.ev.emptied ?? 0, waiting: x.ev.waiting ?? 0, stalled: x.ev.stalled ?? 0, ratechange: x.ev.ratechange ?? 0, momentChanged: after.idx !== before.idx, playing: after.st === 1 });
      }
      res.tempoChange = changes;
    }
    res.errors = errors.slice(0, 3);
    res.ok = res.feed && res.firstPlays && res.rateSet && res.switchFailed === 0 && errors.length === 0;
    if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
  } catch (e) {
    res.error = String(e).slice(0, 300);
  } finally {
    await browser?.close();
  }
  return res;
}

const results = { at: new Date().toISOString(), config: { MOMENTS, CONTENT_S, LOAD, LOAD_WORKERS, DELAY }, runs: [] };
for (const [name, type] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => BROWSERS.includes(n))) {
  for (const form of FORMS) for (const lane of LANES) for (const rate of RATES) {
    const r = await scenario(type, name, form, lane, rate);
    results.runs.push(r);
    const { notes, swipeFrames, tempoChange, ...flat } = r;
    console.log(JSON.stringify(flat));
    if (tempoChange) console.log('  tempoChange ' + JSON.stringify(tempoChange));
    writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
  }
}

// Zielwerte (CHECK=1): kein Stall mitten im Lauf, Tempo-Wechsel ohne Netzanfrage und ohne Neuladen, höchstens 3 Elemente mit Quelle
let bad = 0;
if (CHECK) {
  for (const r of results.runs) {
    const fails = [];
    if (r.error || !r.ok) fails.push('run');
    if ((r.stallsMid ?? 0) > 0) fails.push(`stalls ${r.stallsMid}`);
    if ((r.startsWrongRate ?? 0) > 0) fails.push(`starts at wrong rate ${r.startsWrongRate}`);
    // Das stille Entsperr-Element der geregelten Spur (prime) zählt nicht mit, es hält nur kurz eine Quelle (srcMax zeigt es trotzdem)
    if ((r.srcMaxReal ?? 0) > 3) fails.push(`elements with src ${r.srcMaxReal}`);
    // Lautheit an: beim Wechsel von 1x weg verlässt der laufende Moment die Web-Audio-Spur, ein Neuladen ist dort erlaubt (Max 30.10.2026). Sonst null.
    for (const c of r.tempoChange ?? []) {
      const reloadOk = r.lane === 'on' && c.from === 1;
      if ((!reloadOk && (c.requests || c.loadstart || c.emptied)) || c.momentChanged || !c.playing) fails.push(`tempo change ${c.from}->${c.to} ${JSON.stringify(c)}`);
    }
    if (fails.length) { bad++; console.log('FAIL', r.browser, r.form, r.lane, r.rate, fails.join('; ')); }
  }
}
process.exit(bad ? 1 : 0);
