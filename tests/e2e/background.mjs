// E2E der Hintergrund-Wiedergabe (Entscheidung 13 in core-content/docs/fundament.md) mit nachgebauter YouTube-API und nachgebautem Medien-Element.
// Der Browser meldet das Sperren als visibilitychange (visibilityState hidden). Echtes Sperren prüft nur ein Gerät (iOS: Diagnose bg:, siehe Settings).
// Erzeugt einen eigenen Testschlüssel und verschlüsselte Testpools, die per route statt pool.enc ausgeliefert werden.
// Aufruf: node tests/e2e/background.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-background'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
const k = Buffer.from(raw).toString('base64url');
const waitFor = async (page, fn, arg, timeout = 8000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};
const freshPage = async (browser, url, k, poolBody, query) => {
  const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const pg = await cx.newPage();
  await pg.addInitScript(() => { window.__ytSlow = true; });
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  await pg.goto(`${url}${query}#k=${k}`);
  return { cx, pg };
};

// Seite verlassen oder zurückkehren, wie es der Browser beim Sperren meldet
const setVisibility = (page, v) => page.evaluate((state) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state }); document.dispatchEvent(new Event('visibilitychange')); }, v);
const bgLog = (page) => page.evaluate(() => window.__core.diag().filter((x) => x.startsWith('bg: ')));

// Hintergrund-Wiedergabe (Entscheidung 13): kurze Momente (4 s), damit das Ende im Test erreicht wird
const bgMk = (id, form, extra = {}) => ({ id: `${id}:0`, videoId: id, start: 0, end: 4, channel: 'Kanal bg', videoTitle: 'Testvideo', area: 'brain', topic: 'augen', hook: `Hintergrund ${id}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', form, ...extra });
const bgAudio = Array.from({ length: 9 }, (_, i) => bgMk(`bgaudio${i}`, 'audio', { audio: true, hls: `https://stream.test/bgaudio${i}.m3u8` }));
const bgVideo = Array.from({ length: 6 }, (_, i) => bgMk(`bgvideo${i}`, 'video', { hls: `https://stream.test/bgvideo${i}.m3u8` }));
const bgYt = Array.from({ length: 6 }, (_, i) => bgMk(`bgyt${String(i).padStart(7, '0')}`, 'video'));
mkdirSync('dist/moments', { recursive: true });
const poolBgAudio = await encPool(bgAudio);
const poolBgVideo = await encPool(bgVideo);
const poolBgYt = await encPool(bgYt);

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    // Audio-Reiter: Ton bleibt, am Ende kommt derselbe Nachfolger wie beim Wisch, Gesehen erst bei ended
    const fa = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3');
    const pa = fa.pg;
    await pa.waitForSelector('[data-testid=form-switch]');
    await pa.click('[data-testid=form-switch] >> text=Audio');
    c.bgAudioPlays = await waitFor(pa, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    c.bgAudioElement = await pa.evaluate(() => !!document.querySelector('audio'));
    const a0 = await pa.evaluate(() => window.__core.moment().id);
    c.bgMediaSession = await pa.evaluate(() => !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || navigator.mediaSession.metadata?.title === window.__core.moment().hook);
    c.bgSeenAtStartInForeground = await pa.evaluate((id) => window.__core.seen(id), a0);
    await setVisibility(pa, 'hidden');
    await pa.waitForTimeout(400);
    c.bgAudioKeepsPlaying = (await pa.evaluate(() => window.__core.state())) === 1;
    c.bgAudioAdvances = await waitFor(pa, () => window.__core.idx() >= 1 && window.__core.state() === 1, undefined, 10000);
    const a1 = await pa.evaluate(() => window.__core.moment().id);
    c.bgNotSeenAtStart = !(await pa.evaluate((id) => window.__core.seen(id), a1)) || (await pa.evaluate(() => window.__core.idx())) > 1;
    c.bgEndedSeen = await pa.evaluate((id) => window.__core.seen(id), a0);
    // Zwei Auto-Weiter im Hintergrund, dann zurück
    await waitFor(pa, () => window.__core.idx() >= 2 && window.__core.state() === 1, undefined, 10000);
    await setVisibility(pa, 'visible');
    await pa.waitForTimeout(200);
    const aBack = await pa.evaluate(() => ({ id: window.__core.moment().id, st: window.__core.state(), seen: window.__core.seen(window.__core.moment().id) }));
    c.bgBackOnRunningMoment = aBack.st === 1 && aBack.seen;
    const aLog = await bgLog(pa);
    r.bgAudioLog = aLog;
    c.bgLogStartedEndedNext = aLog.some((x) => x === `bg: ended ${a0}`) && aLog.some((x) => x === `bg: next ${a1}`) && aLog.some((x) => x === `bg: started ${a1}`) && aLog.some((x) => x.startsWith('bg: left')) && aLog.some((x) => x.startsWith('bg: back'));
    c.bgEndedOnce = aLog.filter((x) => x === `bg: ended ${a0}`).length === 1;
    // Der Nachfolger kommt aus derselben Mischung wie beim Wisch (gleiche Eingaben, gleicher Zufall)
    const bgNext = aLog.filter((x) => x.startsWith('bg: next ')).map((x) => x.slice(9)).slice(0, 2);
    const fs = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3');
    await fs.pg.waitForSelector('[data-testid=form-switch]');
    await fs.pg.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(fs.pg, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    const swipeIds = [];
    for (let i = 0; i < 2; i++) { await fs.pg.evaluate(() => window.__core.next()); await fs.pg.waitForTimeout(250); swipeIds.push(await fs.pg.evaluate(() => window.__core.moment().id)); }
    c.bgAutoNextEqualsSwipe = bgNext.length === 2 && bgNext.every((id, i) => id === swipeIds[i]);
    await fs.cx.close();
    await fa.cx.close();

    // Auto-Weiter scheitert im Hintergrund (Browser verweigert Play): sauber anhalten, bei der Rückkehr weiter
    const fe = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3');
    const pe = fe.pg;
    await pe.waitForSelector('[data-testid=form-switch]');
    await pe.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pe, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    await pe.evaluate(() => { const P = HTMLMediaElement.prototype, o = P.play; P.play = function () { if (window.__denyBg && document.visibilityState === 'hidden') return Promise.reject(new DOMException('blocked', 'NotAllowedError')); return o.call(this); }; window.__denyBg = true; });
    await setVisibility(pe, 'hidden');
    c.bgStallLogged = await waitFor(pe, () => window.__core.diag().some((x) => x.startsWith('bg: stalled at')), undefined, 14000);
    c.bgStallStopsClean = (await pe.evaluate(() => window.__core.state())) !== 1 && (await pe.evaluate(() => window.__core.idx())) === 1;
    await pe.evaluate(() => { window.__denyBg = false; });
    await setVisibility(pe, 'visible');
    c.bgStallResumesOnReturn = await waitFor(pe, () => window.__core.state() === 1 && window.__core.idx() === 1, undefined, 4000);
    await fe.cx.close();

    // Video-Reiter mit eigenem Stream: läuft im Hintergrund bis zum Ende, dann Stopp ohne Auto-Weiter
    const fv = await freshPage(browser, url, k, poolBgVideo, '?now=2026-10-23&seed=3');
    const pv = fv.pg;
    c.bgVideoPlays = await waitFor(pv, () => window.__core?.state() === 1);
    const v0 = await pv.evaluate(() => window.__core.moment().id);
    await setVisibility(pv, 'hidden');
    await pv.waitForTimeout(400);
    c.bgVideoKeepsPlaying = (await pv.evaluate(() => window.__core.state())) === 1;
    c.bgVideoStops = await waitFor(pv, () => window.__core.diag().some((x) => x.startsWith('bg: stop after')), undefined, 10000);
    await pv.waitForTimeout(700);
    c.bgVideoNoAutoNext = (await pv.evaluate(() => window.__core.idx())) === 0 && (await pv.evaluate(() => window.__core.state())) !== 1;
    await setVisibility(pv, 'visible');
    await pv.waitForTimeout(500);
    c.bgVideoStaysStopped = (await pv.evaluate(() => window.__core.idx())) === 0 && (await pv.evaluate(() => window.__core.state())) !== 1 && (await pv.evaluate((id) => window.__core.seen(id), v0));
    c.bgVideoNoMediaSession = await pv.evaluate(() => !('mediaSession' in navigator) || !navigator.mediaSession.metadata || navigator.mediaSession.metadata.title !== window.__core.moment().hook);
    await fv.cx.close();

    // YouTube-Moment: Seite verlassen hält den Player an, Rückkehr setzt ihn fort
    const fy = await freshPage(browser, url, k, poolBgYt, '?now=2026-10-23&seed=3');
    const py = fy.pg;
    c.bgYtPlays = await waitFor(py, () => window.__core?.state() === 1);
    await setVisibility(py, 'hidden');
    c.bgYtPauses = await waitFor(py, () => window.__core.state() === 2, undefined, 2000);
    await py.waitForTimeout(500);
    c.bgYtStaysPaused = (await py.evaluate(() => window.__core.state())) === 2 && (await py.evaluate(() => window.__core.idx())) === 0;
    await setVisibility(py, 'visible');
    c.bgYtResumes = await waitFor(py, () => window.__core.state() === 1, undefined, 2000);
    await fy.cx.close();

  } catch (e) {
    r.error = String(e);
  }
  await browser?.close();
  r.ok = !r.error && Object.values(c).every((v) => v === true);
  console.log(JSON.stringify(r));
}
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
if (results.runs.some((x) => !x.ok)) process.exit(1);
