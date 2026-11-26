// E2E Runde 42 (START_NO_YT_WAIT): ein aktiver Moment ohne YouTube (Audio, HLS-Video) startet, ohne auf die YouTube-IFrame-API zu warten.
// Die API wird im Test um 10 s verzögert (Gerätediag 26.11.: 9334 ms Warten, der aktive Audio-Moment bekam seine Quelle erst danach).
// Prüft: (a) Audio-Reiter: Quelle des aktiven Moments und erster Ton unter 1,5 s nach dem Öffnen, Zeile "start: <id> first sound N ms after tab open (yt api waited 0 ms)",
// (b) HLS-Video im Video-Reiter ebenso, (c) bei einem YouTube-Moment vorn läuft der Start nach höchstens 3 s ohne API weiter ("late after 3000 ms"),
// danach spielt er, sobald die API da ist. Nur nachgebaute Quellen, kein echtes Netz.
// Aufruf: node tests/e2e/startnoyt.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';
import { onPageError } from './pageerrors.mjs';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-startnoyt'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const FAKE_MEDIA = FAKE.slice(FAKE.indexOf('// Eigene Streams'));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const k = Buffer.from(raw).toString('base64url');
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (page, fn, arg, timeout = 8000) => {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); return true; } catch { return false; }
};
const base = { end: 30, channel: 'Kanal sn', videoTitle: 'Testvideo', area: 'brain', topic: 'augen', kind: 'regel', createdAt: '2026-10-20T00:00:00Z', start: 0 };
const audio = (i) => ({ ...base, id: `snaudio${i}:0`, videoId: `snaudio${i}`, hook: `Audio ${i}`, form: 'audio', audio: true, hls: `https://stream.test/snaudio${i}.m3u8` });
const hlsv = (i) => ({ ...base, id: `snhls${i}:0`, videoId: `snhls${i}`, hook: `Video ${i}`, form: 'video', hls: `https://stream.test/snhls${i}.m3u8`, thumb: 'https://img.test/white.svg' });
const ytv = (i) => ({ ...base, id: `snyt${String(i).padStart(5, '0')}ab:0`, videoId: `snyt${String(i).padStart(5, '0')}ab`, hook: `YT ${i}` });
const N = 14;
const pools = {
  audio: await encPool(Array.from({ length: N }, (_, i) => audio(i))),
  hls: await encPool(Array.from({ length: N }, (_, i) => hlsv(i))),
  yt: await encPool(Array.from({ length: N }, (_, i) => ytv(i))),
};
const WHITE = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#ffffff"/></svg>';
const API_DELAY = 10_000;

const open = async (browser, poolBody, apiDelay) => {
  const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  const api = { servedAt: 0 };
  await cx.route('https://www.youtube.com/iframe_api', async (x) => {
    await sleep(apiDelay);
    api.servedAt = Date.now();
    await x.fulfill({ contentType: 'text/javascript', body: FAKE });
  });
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  await cx.route('https://img.test/**', (x) => x.fulfill({ contentType: 'image/svg+xml', body: WHITE }));
  const pg = await cx.newPage();
  const errors = [];
  pg.on('pageerror', onPageError(errors));
  await pg.addInitScript(() => { window.__ytSlow = true; window.__cont = true; window.__tuMs = 250; });
  await pg.addInitScript(FAKE_MEDIA);
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  await pg.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
  await pg.waitForSelector('[data-testid=form-switch]');
  return { cx, pg, errors, api };
};
const startLine = (d) => d.find((l) => /^start: \S+ first sound \d+ ms after tab open \(yt api waited \d+ ms\)$/.test(l)) ?? null;
const num = (l, re) => Number(re.exec(l ?? '')?.[1] ?? NaN);

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {}, notes: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : process.env.E2E_WEBKIT && type === webkit ? { executablePath: process.env.E2E_WEBKIT } : {});

    // (a) Audio-Reiter, API 10 s verspätet
    {
      const f = await open(browser, pools.audio, API_DELAY);
      const t0 = Date.now();
      await f.pg.click('[data-testid=form-switch] >> text=Audio');
      c.audioPlays = await waitFor(f.pg, () => window.__core.state() === 1 && window.__core.moment()?.audio === true, undefined, 6000);
      r.notes.audioWallMs = Date.now() - t0;
      c.audioWallUnder3s = c.audioPlays && r.notes.audioWallMs < 3000;
      c.audioApiStillPending = f.api.servedAt === 0 || f.api.servedAt > t0 + r.notes.audioWallMs;
      await sleep(300);
      const d = await f.pg.evaluate(() => window.__core.diag());
      const line = startLine(d);
      r.notes.audioStartLine = line;
      r.notes.audioFirstSoundMs = num(line, /first sound (\d+) ms/);
      c.audioStartLine = !!line;
      c.audioFirstSoundUnder1500 = r.notes.audioFirstSoundMs < 1500;
      c.audioApiWaitedZero = num(line, /waited (\d+) ms/) <= 50; // Messung kann 1 bis 2 ms zeigen, der Fehlerfall liegt bei Sekunden
      c.audioSrcLine = d.some((x) => /^deck: src net snaudio\d+/.test(x)) || d.some((x) => /^deck: src local snaudio\d+/.test(x));
      c.audioNoApiWaitLine = !d.some((x) => /^video: youtube api (ready|missing) after/.test(x));
      c.audioStartWithoutApiLine = d.some((x) => /^video: start without youtube api /.test(x));
      c.audioNoStub = !d.includes('yt stub');
      // Die API kommt später und stört nichts: der Moment spielt weiter, keine Fehler
      await sleep(Math.max(0, API_DELAY + 1500 - (Date.now() - t0)));
      c.audioStillPlayingAfterApi = (await f.pg.evaluate(() => window.__core.state())) === 1;
      c.audioNoErrors = f.errors.length === 0;
      r.notes.audioDiag = (await f.pg.evaluate(() => window.__core.diag())).filter((x) => /^(start|video: (start|youtube)|deck: (src|start|play|ready|all))/.test(x)).slice(0, 14);
      await f.cx.close();
    }

    // (b) HLS-Video im Video-Reiter (Start der App im Video-Reiter), API 10 s verspätet
    {
      const f = await open(browser, pools.hls, API_DELAY);
      const t0 = Date.now();
      c.hlsPlays = await waitFor(f.pg, () => window.__core.state() === 1 && !!window.__core.moment()?.hls, undefined, 6000);
      r.notes.hlsWallMs = Date.now() - t0;
      await sleep(300);
      const d = await f.pg.evaluate(() => window.__core.diag());
      const line = startLine(d);
      r.notes.hlsStartLine = line;
      r.notes.hlsFirstSoundMs = num(line, /first sound (\d+) ms/);
      c.hlsStartLine = !!line;
      c.hlsFirstSoundUnder1500 = r.notes.hlsFirstSoundMs < 1500;
      c.hlsApiWaitedZero = num(line, /waited (\d+) ms/) <= 50;
      c.hlsNoStub = !d.includes('yt stub');
      await sleep(Math.max(0, API_DELAY + 1500 - (Date.now() - t0)));
      c.hlsStillPlayingAfterApi = (await f.pg.evaluate(() => window.__core.state())) === 1;
      c.hlsNoErrors = f.errors.length === 0;
      await f.cx.close();
    }

    // (c) YouTube-Moment vorn, API 6 s verspätet: Start läuft nach 3 s ohne sie weiter, der Moment spielt, sobald die API da ist
    {
      const f = await open(browser, pools.yt, 6000);
      const t0 = Date.now();
      c.ytLateLine = await waitFor(f.pg, () => window.__core.diag().some((x) => x === 'video: youtube api late after 3000 ms, start continues'), undefined, 5000);
      r.notes.ytLateMs = Date.now() - t0;
      c.ytLateBetween3and5s = c.ytLateLine && r.notes.ytLateMs >= 2500 && r.notes.ytLateMs <= 5000;
      c.ytPlaysAfterApi = await waitFor(f.pg, () => window.__core.state() === 1, undefined, 12000);
      const d = await f.pg.evaluate(() => window.__core.diag());
      const line = startLine(d);
      r.notes.ytStartLine = line;
      c.ytStartLine = !!line;
      c.ytNoStub = !d.includes('yt stub');
      c.ytNoErrors = f.errors.length === 0;
      await f.cx.close();
    }
  } catch (e) {
    r.error = String(e);
  }
  await browser?.close();
  r.ok = !r.error && Object.values(c).every((v) => v === true);
  console.log(JSON.stringify(r));
}
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
if (results.runs.some((x) => !x.ok)) process.exit(1);
