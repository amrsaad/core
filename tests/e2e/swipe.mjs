// E2E Wischübergang: Frames während 10 Wischen zählen (requestAnimationFrame), Ziel unter 2 Prozent verlorene Frames bei 60 Hz.
// Messfenster je Wisch: vom Aufsetzen bis 600 ms nach dem Loslassen (Ziehen, Auslaufen, Player-Arbeit danach).
// Nachgebaute YouTube-API wie in moments.mjs, also misst der Test die Animation des Feeds, nicht den echten IFrame.
// Aufruf: node tests/e2e/swipe.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
// Umgebung: E2E_BROWSERS=webkit,chromium  E2E_THROTTLE=4,8 (CPU-Drosselung nur Chromium, nur Information)  SWIPES=10  E2E_NOGATE=1 (nur messen)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-swipe'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const SWIPES = Number(process.env.SWIPES ?? 10);
const WARM = 2;
const GATE_PCT = 2;
const FRAME = 1000 / 60;

// Testpool: nur Video, keine Abrufkarten, genug Momente für Aufwärmen, 10 Wische vor, 2 zurück
const mk = (i) => ({ id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20, channel: `Kanal ${i % 5}`, videoTitle: 'Testvideo', area: ['beat', 'brain', 'body'][i % 3], topic: ['islam', 'augen', 'kraft'][i % 3], hook: `Testmoment ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', cues: [[0, 'Untertitel eins'], [2, 'Untertitel zwei']] });
const moments = Array.from({ length: 60 }, (_, i) => mk(i));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
const poolBody = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');

// Frame-Zähler im Seitenkontext, unabhängig vom Code der App. Ein Frame gilt als verloren, wenn der Abstand zweier rAF-Aufrufe
// länger als ein halber Takt über dem Soll liegt: verloren = round(Abstand / Takt) - 1.
const METER = `
  window.__fm = (() => {
    const FR = ${FRAME};
    let on = false, last = 0, t0 = 0, lost = 0, frames = 0, longest = 0, lt = [], trace = [];
    const loop = (t) => {
      if (on) {
        if (last) { const d = t - last; trace.push([Math.round(t - t0), Math.round(d)]); frames++; lost += Math.max(0, Math.round(d / FR) - 1); longest = Math.max(longest, d); }
        last = t;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try { new PerformanceObserver((l) => { if (on) for (const e of l.getEntries()) lt.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch {}
    return {
      start() { on = true; last = 0; t0 = performance.now(); lost = 0; frames = 0; longest = 0; lt = []; trace = []; },
      stop() { on = false; return { lost, frames, ms: performance.now() - t0, longest: Math.round(longest), longTasks: lt.slice(), trace: ${process.env.E2E_TRACE ? 'true' : 'false'} ? trace : undefined }; },
      idle(ms) { return new Promise((res) => { const ds = []; let p = 0; const s = performance.now(); const f = (t) => { if (p) ds.push(t - p); p = t; if (performance.now() - s < ms) requestAnimationFrame(f); else res(ds); }; requestAnimationFrame(f); }); },
    };
  })();
`;

const waitFor = async (page, fn, arg, timeout = 8000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};
// Bezugswert (Boden): eine leere Seite mit drei Vollbild-Seiten, die per requestAnimationFrame 700 ms lang um eine Höhe verschoben wird, Fenster
// 1300 ms wie beim Wisch. Zeigt, was der Runner selbst schafft. WebKit im Linux-Runner zeichnet ohne GPU in Software und verliert dort schon bei einer
// leeren Seite viele Frames, Chromium nicht. Darum gilt für WebKit der Abstand zum Boden, für Chromium die absolute Grenze.
const FLOOR_HTML = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>
html,body{margin:0;height:100%;overflow:hidden;background:#000}.f{position:relative;height:100dvh;overflow:hidden}
.s{position:absolute;inset:0;will-change:transform}.p{position:absolute;inset:0;background:linear-gradient(#123,#456);color:#fff;font:30px sans-serif}
</style><div class=f><div class=s id=s>${[0, 1, 2].map((i) => `<div class=p style="transform:translateY(${(i - 1) * 100}%)">page ${i}</div>`).join('')}</div></div>`;
const measureFloor = async (ctx) => {
  const pg = await ctx.newPage();
  await pg.setContent(FLOOR_HTML);
  await pg.waitForTimeout(400);
  const res = await pg.evaluate((FR) => new Promise((resolve) => {
    const el = document.getElementById('s');
    let last = 0, t0 = 0, lost = 0, frames = 0;
    const f = (t) => {
      if (!t0) t0 = t;
      const e = t - t0;
      if (last) { frames++; lost += Math.max(0, Math.round((t - last) / FR) - 1); }
      last = t;
      el.style.transform = `translate3d(0,${-Math.min(1, e / 700) * innerHeight}px,0)`;
      if (e < 1300) requestAnimationFrame(f); else resolve({ lost, frames });
    };
    requestAnimationFrame(f);
  }), FRAME);
  await pg.close();
  return res.lost + res.frames ? Math.round((res.lost / (res.lost + res.frames)) * 1000) / 10 : null;
};
const MARGIN_PTS = 20; // WebKit: höchstens so viele Prozentpunkte über dem Boden
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

const variants = [];
for (const name of (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',')) {
  variants.push({ name, type: name === 'webkit' ? webkit : chromium, throttle: 1 });
  // Gedrosselte CPU nur zur Information (ein schwächeres Gerät): macht Unterschiede sichtbar, wo der Runner ohnehin 0 Prozent zeigt
  if (name === 'chromium') for (const t of (process.env.E2E_THROTTLE ?? '4,8').split(',').map(Number).filter((x) => x > 1)) variants.push({ name: 'chromium-x' + t, type: chromium, throttle: t });
}

const results = { at: new Date().toISOString(), swipes: SWIPES, windowMs: 'down bis 600 ms nach up', runs: [] };
let failed = false;
for (const v of variants) {
  const r = { variant: v.name, checks: {}, samples: [] };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await v.type.launch(process.env.E2E_CHROME && v.type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { window.__ytSlow = true; });
    await page.addInitScript(METER);
    await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
    if (v.throttle > 1) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: v.throttle });
    }
    await page.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
    c.feedLoaded = await waitFor(page, () => !!window.__core?.moment());
    c.firstPlaying = await waitFor(page, () => window.__core.state() === 1);
    if (process.env.E2E_CSS) await page.addStyleTag({ content: process.env.E2E_CSS }); // nur zum Suchen von Ursachen
    const vp = page.viewportSize();
    // Takt der Seite ermitteln (headless: 60 Hz)
    const idle = await page.evaluate(() => window.__fm.idle(1000));
    r.idleFrameMs = Math.round(median(idle) * 10) / 10;
    r.hz = Math.round(1000 / median(idle));
    c.refresh60 = r.hz >= 55 && r.hz <= 65;

    // Ein Wisch wie ein Finger: Aufsetzen bei 75 %, 10 Schritte im Takt von 16 ms bis 25 %, Loslassen
    const swipe = async (dir = 'next', measure = true) => {
      const y0 = vp.height * (dir === 'next' ? 0.75 : 0.25);
      const y1 = vp.height * (dir === 'next' ? 0.25 : 0.75);
      const before = await page.evaluate(() => window.__core.idx());
      await page.mouse.move(vp.width / 2, y0);
      if (measure) await page.evaluate(() => window.__fm.start());
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(vp.width / 2, y0 + ((y1 - y0) * i) / 10);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      const changed = await waitFor(page, (b) => window.__core.idx() !== b, before, 4000);
      await page.waitForTimeout(600);
      const s = measure ? await page.evaluate(() => window.__fm.stop()) : null;
      return { changed, s };
    };

    for (let i = 0; i < WARM; i++) await swipe('next', false);
    await page.waitForTimeout(500);
    let okAll = true;
    for (let i = 0; i < SWIPES; i++) {
      const { changed, s } = await swipe('next', true);
      okAll &&= changed;
      r.samples.push({ ...s, changed });
      await page.waitForTimeout(300);
    }
    c.allSwipesChanged = okAll;
    const lost = r.samples.reduce((a, s) => a + s.lost, 0);
    const frames = r.samples.reduce((a, s) => a + s.frames, 0);
    const expected = frames + lost;
    r.lost = lost;
    r.frames = frames;
    r.lostPct = expected ? Math.round((lost / expected) * 1000) / 10 : null;
    r.worstSwipePct = Math.max(...r.samples.map((s) => (s.frames + s.lost ? (s.lost / (s.frames + s.lost)) * 100 : 0)));
    r.longestFrameMs = Math.max(...r.samples.map((s) => s.longest));
    r.longTasks = r.samples.flatMap((s) => s.longTasks);
    c.noPageErrors = errors.length === 0;
    if (errors.length) r.errors = errors.slice(0, 5);
    // Bei CPU-Drosselung nur Information, kein Tor
    r.gated = v.throttle === 1;
    r.floorPct = await measureFloor(ctx);
    // Absolute Grenze (unter 2 Prozent). Schafft schon die leere Seite im Runner die Grenze nicht (Software-Zeichnen), zählt der Abstand zum Boden.
    r.floorLimited = r.floorPct !== null && r.floorPct >= GATE_PCT;
    c.underGate = r.lostPct !== null && (r.floorLimited ? r.lostPct <= r.floorPct + MARGIN_PTS : r.lostPct < GATE_PCT);
    if (v.throttle === 1) {
      // Bilder zur Geste: mitten im Zug (Nachbar unten sichtbar, Moment folgt dem Finger 1:1) und am Anfang des Feeds (Gummiband)
      const stageY = () => page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.vstage')).transform).m42);
      const hold = async (dy, from = 0.7) => {
        await page.mouse.move(vp.width / 2, vp.height * from);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) { await page.mouse.move(vp.width / 2, vp.height * from + (dy * i) / 8); await page.waitForTimeout(16); }
        await page.waitForTimeout(60);
      };
      await hold(-vp.height * 0.4);
      const yMid = await stageY();
      const nextTop = await page.evaluate(() => { const sl = [...document.querySelectorAll('.vslot')].find((x) => x.getAttribute('aria-hidden') !== 'false' && x.getBoundingClientRect().top > 0 && x.getBoundingClientRect().top < innerHeight); return sl ? Math.round(sl.getBoundingClientRect().top) : null; });
      await page.screenshot({ path: `${out}/${v.name}-mid-drag.png` });
      c.dragFollowsFinger1to1 = Math.abs(yMid + vp.height * 0.4) <= 2;
      c.neighborRenderedDuringDrag = nextTop !== null && nextTop < vp.height;
      r.midDrag = { yMid, expected: -vp.height * 0.4, nextTop };
      await page.mouse.move(vp.width / 2, vp.height * 0.7, { steps: 4 });
      await page.mouse.up();
      await waitFor(page, () => !document.querySelector('.vfeed[data-moving]'), undefined, 3000);
      let guard = 0;
      while ((await page.evaluate(() => window.__core.idx())) > 0 && guard++ < 30) await swipe('prev', false);
      await page.waitForTimeout(400);
      await hold(vp.height * 0.5, 0.2); // ganz im Bild: ein Finger endet nie außerhalb des Schirms
      const yRub = await stageY();
      await page.screenshot({ path: `${out}/${v.name}-rubber-band.png` });
      r.rubber = { shown: Math.round(yRub), raw: Math.round(vp.height * 0.5) };
      c.rubberBandAtStart = yRub > 0 && yRub < vp.height * 0.5 * 0.75;
      await page.mouse.up();
      await waitFor(page, () => !document.querySelector('.vfeed[data-moving]'), undefined, 3000);
      const movingGone = await waitFor(page, () => !document.querySelector('.vfeed[data-moving]'), undefined, 3000);
      r.rubberEnd = { movingGone, idx: await page.evaluate(() => window.__core.idx()), y: await stageY() };
      c.rubberBandBackAtRest = movingGone && r.rubberEnd.idx === 0 && Math.abs(r.rubberEnd.y) < 1;
    }
    await page.screenshot({ path: `${out}/${v.name}-after.png` });
  } catch (e) {
    r.fatal = String(e);
    c.noFatal = false;
  } finally {
    await browser?.close();
  }
  const bad = Object.entries(c).filter(([k2, x]) => x === false && !(k2 === 'underGate' && !r.gated));
  console.log(`${v.name}: ${r.hz ?? '?'} Hz, ${SWIPES} Wische, ${r.frames ?? '?'} Frames, ${r.lost ?? '?'} verloren = ${r.lostPct ?? '?'} % (schlechtester Wisch ${r.worstSwipePct?.toFixed(1) ?? '?'} %, längster Frame ${r.longestFrameMs ?? '?'} ms)${r.floorPct !== undefined ? ` [leere Seite: ${r.floorPct} %${r.floorLimited ? `, Runner zu langsam für ${GATE_PCT} %, Tor: höchstens ${MARGIN_PTS} Punkte darüber` : ''}]` : ''}${r.gated ? '' : ' [Information, kein Tor]'}${bad.length ? ' FEHLER: ' + bad.map(([k2]) => k2).join(', ') : ''}`);
  if (bad.length) failed = true;
}
writeFileSync(`${out}/swipe-frames.json`, JSON.stringify(results, null, 2));
if (failed && !process.env.E2E_NOGATE) process.exit(1);
