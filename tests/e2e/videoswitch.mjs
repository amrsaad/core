// E2E Runde 41: Video wartet nicht länger als 3 s auf einen Moment ohne erstes Bild (VIDEO_SWITCH), nur nachgebaute Quellen, kein echtes Netz.
// Pool: HLS-Momente (Form video). Nur ted-2 hängt (kein Bild), die anderen sind bereit (nachgebaut, die Elemente laufen wie in den anderen E2E mit der nachgebauten API).
// Prüft: (a) steht ein hängender Moment vorn, wechselt die App von selbst auf einen bereiten, in unter 5 s nach dem Wechsel auf den hängenden, mit der Zeile
// "video: switch A -> B after N ms" und danach "video: switch ok B", (b) der verlassene Moment bleibt ungesehen und zählt nicht als Skip,
// (c) ein spielender Moment wird nie ersetzt, (d) Ambient: ein weißes Vorschaubild ergibt keinen hellgrauen Schleier (Pixel unter 45).
// Aufruf: node tests/e2e/videoswitch.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices } from 'playwright';
import { onPageError } from './pageerrors.mjs';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-videoswitch'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const YT_POOL = process.env.E2E_YT === '1';
const yt = (i) => ({ id: `vd${String(i).padStart(9, '0')}:100`, videoId: `vd${String(i).padStart(9, '0')}`, start: 0, end: 30, channel: `Kanal ${i}`, videoTitle: 'Talk', area: ['brain', 'body', 'beat'][i % 3], topic: ['augen', 'retina', 'linse'][i % 3], hook: `Hook yt ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z' });
const mk = (i) => YT_POOL && i % 2 === 0 ? yt(i) : ({ id: `ted-${i}:100`, videoId: `ted-${i}`, start: 0, end: 30, channel: `TED ${i}`, videoTitle: 'Talk', area: ['brain', 'body', 'beat'][i % 3], topic: ['augen', 'retina', 'linse'][i % 3], hook: `Hook ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', form: 'video', hls: `https://stream.test/${i}.m3u8`, thumb: 'https://img.test/white.svg' });
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: Array.from({ length: 16 }, (_, i) => mk(i)) })));
const POOL = JSON.stringify({ v: 1, iv: b64u(iv), ct: b64u(ct) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WHITE = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#ffffff"/></svg>';

const results = { at: new Date().toISOString(), checks: {}, notes: {} };
const c = results.checks;
let browser;
try {
  browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
  const ctx = await browser.newContext({ ...devices['iPhone 15'], viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await ctx.route(/fonts\.g/, (x) => x.abort());
  await ctx.route('https://img.test/**', (x) => x.fulfill({ contentType: 'image/svg+xml', body: WHITE }));
  await ctx.route('https://stream.test/**', (x) => x.abort()); // das nachgebaute Element lädt nie von dort
  const page = await ctx.newPage();
  // Nachgebaute Streams: ted-2 liefert nie Daten (kein canplay, play startet nie), alle anderen sind nach 40 ms bereit (readyState 4, canplay) und spielen in Echtzeit
  await page.addInitScript((__YT__) => {
    window.__ytStep = 0.1;
    const HANG = __YT__ ? -1 : 2;
    if (__YT__) { window.__ytIos = true; window.__ytStartHang = true; }
    const t = setInterval(() => {
      const P = HTMLMediaElement.prototype;
      if (!P.__fake) return;
      clearInterval(t);
      const num = (el) => Number((/(\d+)\.m3u8/.exec(el.__src || '') || [])[1] ?? 1);
      const L = P.load;
      P.load = function () {
        L.call(this);
        this.__rs = 0;
        if (num(this) !== HANG) setTimeout(() => { this.__rs = 4; this.dispatchEvent(new Event('canplay')); }, 40);
        else setTimeout(() => { this.__rs = 1; }, 25);
      };
      const Pl = P.play;
      P.play = function () { return num(this) === HANG ? new Promise(() => {}) : Pl.call(this); };
      Object.defineProperty(P, 'readyState', { configurable: true, get() { return this.__rs ?? 0; } });
    }, 5);
  }, YT_POOL);
  const errors = [];
  page.on('pageerror', onPageError(errors));
  await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: POOL }));
  await page.goto(`${url}?now=2026-10-22&seed=3#k=${b64u(raw)}`);
  await page.waitForSelector('[data-testid=form-switch]');
  await page.click('[data-testid=form-switch] >> text=Video');
  const diag = async () => page.evaluate(() => window.__core.diag());
  // Laufen lassen, bis ein Wechsel kam oder ein bereiter Moment spielt (höchstens 40 s), dabei alle Momente auf hängend oder spielend prüfen
  let sw = null;
  const t0 = Date.now();
  let firstId = null;
  while (Date.now() - t0 < 40_000) {
    await sleep(500);
    const m = await page.evaluate(() => window.__core.moment()?.id ?? null);
    firstId ??= m;
    const d = await diag();
    sw = d.find((l) => /video: switch ted-\d+:\d+ -> /.test(l)) ?? null;
    if (sw && d.some((l) => /video: switch ok /.test(l))) break;
  }
  const d = await diag();
  results.notes.first = firstId;
  results.notes.diag = process.env.E2E_FULL ? d : d.filter((l) => /video: (switch|no ready|neighbor|weak|preload)|first-frame|hls canplay|ui: ambient/.test(l)).slice(0, 40);
  if (YT_POOL) {
    // iOS-Nachbau, jeder YouTube-Start hängt (state 3, dann -1): läuft der Feed 40 s, darf nur ein YouTube-Moment ohne Bild durch einen HLS-Moment ersetzt werden
    const all = d.filter((l) => /^video: switch \S+ -> /.test(l));
    results.notes.switches = all;
    const ok = (l) => { const m = /video: switch (\S+) -> (\S+) after (\d+) ms/.exec(l); return !!m && !m[1].startsWith('ted-') && m[2].startsWith('ted-') && Number(m[3]) >= 3000; };
    c.switchesOnlyYtToHls = all.every(ok);
    c.noReadyLineOrSwitch = all.length > 0 || d.some((l) => /video: no ready neighbor after 3\.\d s /.test(l));
    c.noErrors = errors.length === 0;
  } else {
  const startsHanging = firstId === 'ted-2:100';
  results.notes.startsHanging = startsHanging;
  if (startsHanging) {
    c.switched = !!sw;
    const ms = Number(/after (\d+) ms/.exec(sw ?? '')?.[1] ?? 0);
    results.notes.switchMs = ms;
    c.switchBetween3and6s = ms >= 3000 && ms <= 6000;
    c.switchOk = d.some((l) => /video: switch ok ted-\d+:\d+ first frame \d+ ms after the switch/.test(l));
    c.leftNotSeen = !!sw && (await page.evaluate((id) => window.__core.probe(id).seen, /video: switch (ted-\d+:\d+)/.exec(sw)?.[1])) === null;
    c.leftNoSkip = !!sw && (await page.evaluate((id) => window.__core.probe(id).skips, /video: switch (ted-\d+:\d+)/.exec(sw)?.[1])) == null;
  } else {
    // Der erste Moment liefert: nie ersetzen, solange er spielt
    await sleep(6000);
    const d2 = await diag();
    c.playingNeverReplaced = !d2.some((l) => /video: switch /.test(l));
    c.firstPlaying = (await page.evaluate(() => window.__core.state())) === 1;
  }
  // Ambient: das Vorschaubild ist reinweiß, der Bildschirm darf nicht hellgrau werden (ungedeckelt wären es 89 je Kanal)
  await page.screenshot({ path: `${out}/screen.png` });
  // Pixel links neben der Karte (Bühne mit Ambient): aus dem Bildschirmfoto gelesen. Ungedeckelt wäre ein weißes Bild (89, 91, 94).
  const shot = await page.screenshot({ clip: { x: 2, y: 600, width: 4, height: 4 } });
  const rgb = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(1, 1, 1, 1).data.slice(0, 3));
  }, shot.toString('base64'));
  results.notes.stagePixel = rgb;
  c.noWhiteVeil = rgb.every((v) => v < 45);
  c.ambientLogged = (await diag()).some((l) => /^ui: ambient drawn \d+x\d+ in \d+ ms, cap 96$/.test(l));
  c.noErrors = errors.length === 0;
  }
  if (errors.length) results.notes.errors = errors.slice(0, 3);
} catch (e) {
  results.error = String(e);
} finally {
  await browser?.close();
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
const fails = Object.entries(results.checks).filter(([, v]) => v !== true).map(([n]) => n);
console.log(JSON.stringify({ ok: !results.error && !fails.length, fails, error: results.error, notes: results.notes }, null, 1));
process.exit(results.error || fails.length ? 1 : 0);
