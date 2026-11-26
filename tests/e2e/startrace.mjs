// E2E Runde 46: Start im Audio-Reiter bei langsamem Netz. Nachgebaute Quellen, kein echtes Netz (Gerätelog 26.11.: der ganze Netzpfad war langsam, der Start hing an EINER Datei).
// Prüft:
// (i-a) Wettlauf: drei Kandidaten mit Ladezeit 12 s (aktiv), 5 s und 9 s: erster Ton nach höchstens 6,5 s statt 12 s, der überholte Moment bleibt ungesehen und kommt wieder, Zeile "race: ...",
//       nie zwei Elemente zugleich hörbar.
// (i-b) Der zweite Kandidat ist ebenfalls langsam (12 s), der dritte schnell (5 s): der dritte Platz öffnet sich nach 3 s ohne Metadaten, erster Ton nach höchstens 9,5 s (ohne Wettlauf: 12 s).
// (iii) Zweites Element: der aktive Moment hängt 8 s beim ersten Versuch, der zweite Versuch derselben Quelle auf einem anderen Element ist nach 2 s bereit: Ton nach höchstens 6,5 s, kein "fresh reload".
// (iv) Sync: kein Upload in den ersten 20 s stabiler Wiedergabe, danach ja (Zeile "released (stable 20 s)"); beim Verlassen der App sofort ("released (app left)").
// (v) Audio-Reiter: kein Request an YouTube-Hosts, kein Player im DOM. Nach dem Wechsel in den Video-Reiter spielt ein YouTube-Moment wie bisher.
// Die Entscheidungslogik für "Schalter aus" prüfen die Unit-Tests (tests/audio-start-race.test.ts, tests/sync-stable.test.ts, tests/audio-no-yt.test.ts).
// Aufruf: node tests/e2e/startrace.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';
import { onPageError } from './pageerrors.mjs';
import { navTo } from './phonenav.mjs';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-startrace'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const FAKE_MEDIA = FAKE.slice(FAKE.indexOf('// Eigene Streams'));
const TOKEN = 'github_pat_E2ETESTTOKEN0123456789_abcdefghijklmnopqrstuvwxyz';
const STATE_PATH = '/repos/amrsaad/core-content/contents/state/core-state.enc';
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
const base = { end: 60, channel: 'Kanal sr', videoTitle: 'Testvideo', area: 'brain', topic: 'augen', kind: 'regel', createdAt: '2026-10-20T00:00:00Z', start: 0 };
const audio = (i) => ({ ...base, id: `srau${i}:0`, videoId: `srau${i}`, hook: `Audio ${i}`, form: 'audio', audio: true, hls: `https://stream.test/srau${i}.m3u8` });
const ytv = (i) => ({ ...base, id: `sryt${String(i).padStart(5, '0')}ab:0`, videoId: `sryt${String(i).padStart(5, '0')}ab`, hook: `YT ${i}` });
const N = 14;
const poolAudio = await encPool(Array.from({ length: N }, (_, i) => audio(i)));
const poolMixed = await encPool([...Array.from({ length: N }, (_, i) => audio(i)), ...Array.from({ length: N }, (_, i) => ytv(i))]);

/**
 * Langsame Quellen: load() eines Netz-Elements wirkt erst nach der eingestellten Zeit, play() davor wartet wie im Browser (das Versprechen hängt, kein "playing"), pause() oder ein neues load()
 * bricht es ab. Die Zeit hängt von der Stelle des Moments in der Warteschlange beim Start ab (ranks[Abstand zum ersten Moment]) und von der Nummer des Versuchs für dieselbe Quelle (Liste, der
 * letzte Wert gilt weiter). rest: alle übrigen Stellen. Ein Wächter zählt, wie viele Netz-Elemente zugleich spielen (window.__maxAudible).
 */
const SHIM = (cfg) => {
  const P = HTMLMediaElement.prototype;
  const origLoad = P.load;
  const origPlay = P.play;
  const origPause = P.pause;
  const calls = {};
  let baseIdx = null;
  window.__loads = [];
  window.__maxAudible = 0;
  const idOf = (s) => (/\/([^/.]+)\.(?:m3u8|mp3)/.exec(s) ?? [])[1] ?? '';
  const abort = (el) => { const w = el.__wait; el.__wait = null; if (w) for (const x of w) x.rej(new DOMException('aborted', 'AbortError')); };
  P.load = function () {
    const src = String(this.__src || '');
    clearTimeout(this.__lt);
    this.__lt = 0;
    abort(this);
    if (!src || src.startsWith('data:')) { this.__loading = false; return origLoad.call(this); }
    const id = idOf(src);
    const n = (calls[id] = (calls[id] ?? 0) + 1);
    const t0 = performance.now();
    this.__loading = true;
    let logged = false;
    const run = () => {
      const c = window.__core;
      const q = c && c.queue();
      if (baseIdx === null && c && q && q.length) baseIdx = c.idx();
      if (baseIdx === null) { this.__lt = setTimeout(run, 10); return; }
      const off = q.findIndex((x) => x.split(':')[0] === id) - baseIdx;
      const arr = cfg.ranks[off] ?? cfg.rest;
      const d = arr[Math.min(n - 1, arr.length - 1)];
      if (!logged) { logged = true; window.__loads.push({ id, n, off, d, at: Math.round(t0) }); }
      this.__lt = setTimeout(() => {
        this.__lt = 0;
        if (this.__src !== src) return;
        this.__loading = false;
        origLoad.call(this);
        const w = this.__wait;
        this.__wait = null;
        if (w) for (const x of w) x.go();
      }, Math.max(0, d - (performance.now() - t0)));
    };
    run();
  };
  P.play = function () {
    if (this.__loading) return new Promise((res, rej) => { (this.__wait ??= []).push({ go: () => origPlay.call(this).then(res, rej), rej }); });
    return origPlay.call(this);
  };
  P.pause = function () { abort(this); return origPause.call(this); };
  // Der Nachbau feuert noch anstehende Ereignisse eines früheren load() (Entsperr-Probe) auch nach load() mit neuer Quelle; ein echter Browser verwirft sie. Hier werden sie verschluckt, solange die Quelle noch lädt.
  for (const ev of ['loadedmetadata', 'canplaythrough']) window.addEventListener(ev, (e) => { if (e.target.__loading) e.stopImmediatePropagation(); }, true);
  setInterval(() => {
    const n = [...document.querySelectorAll('audio')].filter((e) => e.__p === false && String(e.__src || '').startsWith('http')).length;
    if (n > window.__maxAudible) window.__maxAudible = n;
  }, 10);
};

const open = async (browser, poolBody, cfg, { api } = {}) => {
  const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  const reqs = [];
  cx.on('request', (q) => reqs.push({ host: new URL(q.url()).host, at: Date.now() }));
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  if (api) await cx.route('https://api.github.com/**', (route, request) => api.handle(route, request));
  const pg = await cx.newPage();
  const errors = [];
  pg.on('pageerror', onPageError(errors));
  await pg.addInitScript(() => { window.__ytSlow = true; window.__cont = true; window.__tuMs = 250; window.__srcTrack = true; });
  await pg.addInitScript(FAKE_MEDIA);
  if (cfg) await pg.addInitScript(SHIM, cfg);
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  await pg.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
  await pg.waitForSelector('[data-testid=form-switch]');
  return { cx, pg, errors, reqs };
};
const swipeUp = async (pg) => {
  const vp = pg.viewportSize();
  const y0 = vp.height * 0.75; const y1 = vp.height * 0.25;
  await pg.mouse.move(vp.width / 2, y0);
  await pg.mouse.down();
  for (let i = 1; i <= 8; i++) { await pg.mouse.move(vp.width / 2, y0 + ((y1 - y0) * i) / 8); await pg.waitForTimeout(16); }
  await pg.mouse.up();
};
/** Tipp auf den Reiter Audio (die erste Geste), dann Zeit bis zum ersten Ton und Warteschlange beim Start */
const startAudio = async (pg, within) => {
  const t0 = Date.now();
  await pg.click('[data-testid=form-switch] >> text=Audio');
  const ok = await waitFor(pg, () => window.__core.state() === 1 && window.__core.moment()?.audio === true, undefined, within);
  const ms = Date.now() - t0;
  const q = await pg.evaluate(() => ({ idx: window.__core.idx(), queue: window.__core.queue(), id: window.__core.moment()?.id }));
  return { ok, ms, ...q };
};
const diagOf = (pg) => pg.evaluate(() => window.__core.diag());
const idOf = (m) => (m ?? '').split(':')[0];

/** Nachgebaute GitHub Contents API (eine Datei), nur für den Sync-Teil */
function mockApi() {
  const api = { file: null, n: 0, puts: [], gets: 0 };
  api.handle = async (route, request) => {
    const u = new URL(request.url());
    if (!u.pathname.endsWith(STATE_PATH)) return route.fulfill({ status: 404, body: '{}' });
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, accept, content-type, x-github-api-version', 'access-control-allow-methods': '*' };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.method() === 'GET') {
      api.gets++;
      if (!api.file) return json(404, {});
      return json(200, { sha: api.file.sha, size: api.file.text.length, encoding: 'base64', content: Buffer.from(api.file.text).toString('base64') });
    }
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData());
      if ((api.file?.sha ?? undefined) !== body.sha) return json(api.file ? 409 : 422, {});
      api.file = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha${++api.n}` };
      api.puts.push({ at: Date.now(), sha: api.file.sha });
      return json(200, { content: { sha: api.file.sha } });
    }
    return json(405, {});
  };
  return api;
}
const poll = async (fn, timeout = 20000) => { const t = Date.now(); while (Date.now() - t < timeout) { if (await fn()) return true; await sleep(100); } return false; };

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {}, notes: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : process.env.E2E_WEBKIT && type === webkit ? { executablePath: process.env.E2E_WEBKIT } : {});

    // (i-a) Wettlauf: aktiv 12 s (zweiter Versuch ebenfalls langsam), erster Kandidat 5 s, zweiter 9 s
    {
      const f = await open(browser, poolAudio, { ranks: { 0: [12000, 12000, 30], 1: [5000], 2: [9000] }, rest: [30] });
      const s = await startAudio(f.pg, 14000);
      r.notes.raceMs = s.ms;
      c.raceStarts = s.ok;
      c.raceFirstSoundUnder6500 = s.ok && s.ms <= 6500;
      c.raceNotInstant = s.ms >= 3500; // der Nachbau hält die Quellen wirklich zurück: der aktive Moment allein bräuchte 12 s
      const planned = { a: idOf(s.queue[s.idx > 0 ? s.idx : 0]), };
      const d = await diagOf(f.pg);
      const first = await f.pg.evaluate(() => window.__loads.filter((x) => x.n === 1).sort((a, b) => a.off - b.off).map((x) => ({ id: x.id, off: x.off, d: x.d })));
      r.notes.raceLoads = first;
      const A = first.find((x) => x.off === 0)?.id;
      const B = first.find((x) => x.off === 1)?.id;
      c.raceWinnerIsFirstCandidate = !!B && idOf(s.id) === B;
      const line = d.find((l) => /^race: start n=\d+ first ready \S+ after \d+ ms \((active|pool|hedge)\), losers \d+$/.test(l));
      r.notes.raceLine = line ?? null;
      c.raceLine = !!line;
      c.raceLineNamesWinner = !!line && !!B && line.includes(` first ready ${B} `) && line.includes('(pool)');
      c.readyFirstRaceLine = !!A && !!B && (d.includes(`deck: ready first ${B}:0 over ${A}:0 (race)`) || d.includes(`deck: ready first ${B}:0 over ${A}:0 (rescue)`));
      c.loadLinePool = d.some((l) => new RegExp(`^load: ${B} pool ls=\\S+ fb=\\S+ md=\\S+ cp=\\S+ sk=\\S+ total=\\d+ conc=\\d+ result=ready$`).test(l));
      c.loadLineActiveLost = d.some((l) => new RegExp(`^load: ${A} (active|hedge) .* result=(lost|dropped)$`).test(l));
      c.oneStartLine = d.filter((l) => /^start: \S+ first sound \d+ ms after tab open/.test(l)).length === 1;
      // Der überholte Moment bleibt ungesehen, kein Skip, steht direkt hinter dem laufenden und kommt als nächster
      const after = await f.pg.evaluate((a) => ({ seen: window.__core.seen(a + ':0'), queue: window.__core.queue(), idx: window.__core.idx() }), A);
      c.raceOvertakenUnseen = after.seen === false && !d.some((l) => l.includes(`skipped (not seen) ${A}`));
      c.raceOvertakenNext = after.queue[after.idx + 1] === `${A}:0`;
      c.raceNeverTwoAudible = (await f.pg.evaluate(() => window.__maxAudible)) <= 1;
      // Kein "fresh reload" des aktiven Moments in dieser Zeit mit dem zweiten Element (Hedge) als Ersatz
      c.raceNoFreshReload = !d.some((l) => l.includes('fresh reload'));
      // Der übergangene Moment kommt dran: sobald sein Vorrat bereit ist, spielt ihn spätestens der dritte Wisch (der schnelle Nachbar davor darf dazwischen laufen)
      c.raceOvertakenStillUnseenBeforeSwipe = (await f.pg.evaluate((a) => window.__core.seen(a + ':0'), A)) === false;
      await poll(async () => (await diagOf(f.pg)).some((l) => l.startsWith(`deck: pool ready ${A} `)), 14000);
      let back = false;
      for (let i = 0; i < 3 && !back; i++) {
        await f.pg.waitForTimeout(700);
        await swipeUp(f.pg);
        back = await waitFor(f.pg, (id) => window.__core.moment()?.id === id && window.__core.state() === 1, `${A}:0`, 3000);
      }
      c.raceOvertakenComesBack = back;
      c.raceNeverTwoAudibleAfter = (await f.pg.evaluate(() => window.__maxAudible)) <= 1;
      c.raceNoErrors = f.errors.length === 0;
      r.notes.raceDiag = d.filter((l) => /^(race|load|hedge|deck: (ready first|pool load|pool ready|swap|src)|start:)/.test(l)).slice(0, 30);
      void planned;
      await f.cx.close();
    }

    // (i-b) der zweite Kandidat ist ebenfalls langsam (12 s), der dritte schnell (5 s): der dritte Platz öffnet sich nach 3 s ohne Metadaten
    {
      const f = await open(browser, poolAudio, { ranks: { 0: [12000, 12000, 30], 1: [12000], 2: [5000] }, rest: [30] });
      const s = await startAudio(f.pg, 16000);
      r.notes.raceThirdMs = s.ms;
      c.thirdStarts = s.ok;
      c.thirdFirstSoundUnder9500 = s.ok && s.ms <= 9500;
      c.thirdNotInstant = s.ms >= 5500;
      const first = await f.pg.evaluate(() => window.__loads.filter((x) => x.n === 1).sort((a, b) => a.off - b.off).map((x) => ({ id: x.id, off: x.off, d: x.d, at: x.at })));
      const C = first.find((x) => x.off === 2)?.id;
      const d = await diagOf(f.pg);
      c.thirdWinnerIsThirdCandidate = !!C && idOf(s.id) === C;
      c.thirdRaceLine = d.some((l) => new RegExp(`^race: start n=\\d+ first ready ${C} after \\d+ ms \\(pool\\), losers \\d+$`).test(l));
      // Der dritte Abruf begann erst nach der Frist von 3 s (nicht gleichzeitig mit dem Start): sein load()-Aufruf liegt mehr als 2,5 s nach dem des aktiven Moments
      const t0 = first.find((x) => x.off === 0)?.at ?? 0;
      const tC = first.find((x) => x.off === 2)?.at ?? 0;
      r.notes.thirdOpenedAfterMs = tC - t0;
      c.thirdOpensAfterStagger = tC - t0 >= 2500;
      c.thirdNeverTwoAudible = (await f.pg.evaluate(() => window.__maxAudible)) <= 1;
      r.notes.thirdDiag = d.filter((l) => /^(race|load|hedge|deck: (ready first|pool|swap|src))/.test(l)).slice(0, 30);
      r.notes.thirdLoads = first;
      c.thirdNoErrors = f.errors.length === 0;
      await f.cx.close();
    }

    // (iii) zweites Element: der aktive Moment hängt 8 s beim ersten Versuch, der zweite Versuch derselben Quelle ist nach 2 s bereit, kein Kandidat wird bereit
    {
      const f = await open(browser, poolAudio, { ranks: { 0: [8000, 2000, 30] }, rest: [60000] });
      const s = await startAudio(f.pg, 12000);
      r.notes.hedgeMs = s.ms;
      c.hedgeStarts = s.ok;
      c.hedgeSoundUnder6500 = s.ok && s.ms <= 6500;
      c.hedgeNotInstant = s.ms >= 3500;
      const d = await diagOf(f.pg);
      c.hedgeLine = d.some((l) => /^hedge: \S+ active rs=\d+ after \d+ ms, second element loads the same source, active load kept/.test(l));
      c.hedgeWonLine = d.some((l) => /^hedge: won \S+ after \d+ ms, active rs=\d+ released$/.test(l));
      c.hedgeNoFreshReload = !d.some((l) => l.includes('fresh reload'));
      c.hedgeLoadLines = d.some((l) => /^load: \S+ hedge .* result=ready$/.test(l)) && d.some((l) => /^load: \S+ active .* result=lost$/.test(l));
      const sameSrc = await f.pg.evaluate(() => (window.__fakeMedia ? window.__fakeMedia() : []).filter((x) => x.src.includes(window.__core.moment().videoId)).length);
      c.hedgeOneElementKeepsSource = sameSrc === 1;
      // Der alte Versuch (8 s) läuft aus, ohne zu stören: der Moment spielt weiter, nie zwei hörbar
      await f.pg.waitForTimeout(Math.max(0, 9500 - s.ms));
      c.hedgeStillPlaying = (await f.pg.evaluate(() => window.__core.state())) === 1;
      c.hedgeNeverTwoAudible = (await f.pg.evaluate(() => window.__maxAudible)) <= 1;
      c.hedgeSameMomentPlays = idOf(s.id) === idOf(s.queue[s.idx]);
      c.hedgeNoErrors = f.errors.length === 0;
      r.notes.hedgeDiag = d.filter((l) => /^(hedge|load|race|deck: (src|swap|play|active))/.test(l)).slice(0, 20);
      await f.cx.close();
    }

    // (iv) Sync: kein Upload in den ersten 20 s stabiler Wiedergabe, beim Verlassen der App sofort
    for (const mode of ['stable', 'left']) {
      const api = mockApi();
      const f = await open(browser, poolAudio, null, { api });
      const tag = mode === 'stable' ? 'sync' : 'syncLeft';
      await navTo(f.pg, 'Settings');
      await f.pg.waitForSelector('[data-testid=sync-card]');
      await f.pg.fill('[data-testid=sync-token]', TOKEN);
      await f.pg.click('[data-testid=sync-save]');
      c[`${tag}TokenSaved`] = await waitFor(f.pg, () => !!document.querySelector('[data-testid=sync-last]'), undefined, 10000);
      // Der Abruf (GET) läuft sofort, der erste Upload wartet
      c[`${tag}GetImmediate`] = await poll(() => api.gets >= 1, 5000);
      await navTo(f.pg, 'Feed');
      await f.pg.waitForSelector('[data-testid=form-switch]');
      const s = await startAudio(f.pg, 8000);
      const tPlay = Date.now() - 0;
      c[`${tag}Plays`] = s.ok;
      if (mode === 'stable') {
        await sleep(Math.max(0, 15000 - (Date.now() - tPlay)));
        c.syncNoPutIn15s = api.puts.length === 0;
        const got = await poll(() => api.puts.length >= 1, 14000);
        const dt = got ? api.puts[0].at - tPlay : -1;
        r.notes.syncPutAfterMs = dt;
        c.syncPutAfterStable = got && dt >= 17000 && dt <= 30000;
        const d = await diagOf(f.pg);
        c.syncWaitsLine = d.includes('sync: first upload waits for stable playback');
        c.syncReleasedStableLine = d.some((l) => /^sync: first upload released \(stable 20 s\) after \d+\.\d s$/.test(l));
        c.syncNoReleasedPlaying = !d.some((l) => l.includes('released (playing)'));
        c.syncStillPlaying = (await f.pg.evaluate(() => window.__core.state())) === 1;
      } else {
        await sleep(4000);
        c.syncLeftNoPutYet = api.puts.length === 0;
        const t1 = Date.now();
        await f.pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
        const got = await poll(() => api.puts.length >= 1, 6000);
        r.notes.syncLeftPutMs = got ? api.puts[0].at - t1 : -1;
        c.syncLeftPutAtOnce = got && api.puts[0].at - t1 <= 3000;
        await f.pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
        const d = await diagOf(f.pg);
        c.syncLeftLine = d.some((l) => /^sync: first upload released \(app left\) after \d+\.\d s$/.test(l));
      }
      c[`${tag}NoErrors`] = f.errors.length === 0;
      await f.cx.close();
    }

    // (v) Audio-Reiter ohne YouTube: nach dem Wechsel (und Neuladen im Audio-Reiter) kein Request an YouTube-Hosts, kein Player im DOM. Dann spielt ein YouTube-Moment im Video-Reiter wie bisher.
    {
      const f = await open(browser, poolMixed, null);
      await f.pg.click('[data-testid=form-switch] >> text=Audio');
      await waitFor(f.pg, () => window.__core.moment()?.audio === true, undefined, 8000);
      // Der Zustand (Reiter Audio) wird verzögert gespeichert
      await f.pg.waitForTimeout(2500);
      f.reqs.length = 0;
      await f.pg.reload();
      await waitFor(f.pg, () => window.__core?.moment()?.audio === true, undefined, 10000);
      // Erste Geste: der Tipp startet den Moment
      const vp = f.pg.viewportSize();
      await sleep(1200);
      await f.pg.mouse.click(vp.width / 2, vp.height / 2);
      c.noYtAudioPlays = await waitFor(f.pg, () => window.__core.state() === 1 && window.__core.moment()?.audio === true, undefined, 8000);
      await sleep(2500);
      const yt = f.reqs.filter((q) => /(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|ggpht\.com|gstatic\.com)$/.test(q.host));
      r.notes.noYtRequests = yt.map((q) => q.host);
      c.noYtNoRequest = yt.filter((q) => q.host !== 'i.ytimg.com').length === 0; // Vorschaubilder (img) sind keine Player und kein Skript, sie bleiben wie bisher
      const dom = await f.pg.evaluate(() => ({ iframes: document.querySelectorAll('iframe').length, players: [...document.querySelectorAll('*')].filter((e) => e.__player).length, api: !!window.YT?.Player, scripts: [...document.scripts].filter((s) => /youtube/.test(s.src)).length }));
      r.notes.noYtDom = dom;
      c.noYtNoIframe = dom.iframes === 0 && dom.players === 0 && dom.scripts === 0 && dom.api === false;
      const d = await diagOf(f.pg);
      c.noYtLine = d.some((l) => /^video: audio tab without youtube /.test(l));
      c.noYtNoStub = !d.includes('yt stub');
      // Wechsel in den Video-Reiter: die API lädt, ein YouTube-Moment spielt wie bisher
      await f.pg.click('[data-testid=form-switch] >> text=Video');
      c.noYtVideoPlays = await waitFor(f.pg, () => window.__core.state() === 1 && !window.__core.moment()?.audio && /^sryt/.test(window.__core.moment()?.videoId ?? ''), undefined, 10000);
      c.noYtVideoApiLoaded = await f.pg.evaluate(() => !!window.YT?.Player);
      c.noYtVideoPlayerInDom = (await f.pg.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.__player).length)) >= 1;
      c.noYtVideoRequested = f.reqs.some((q) => q.host === 'www.youtube.com');
      // und zurück in den Audio-Reiter: wieder ohne neuen Player
      await f.pg.click('[data-testid=form-switch] >> text=Audio');
      c.noYtBackAudioPlays = await waitFor(f.pg, () => window.__core.moment()?.audio === true, undefined, 8000);
      await sleep(800);
      c.noYtBackNoPlayer = (await f.pg.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.__player).length)) === 0;
      c.noYtNoErrors = f.errors.length === 0;
      await f.cx.close();
    }
  } catch (e) {
    r.error = String(e?.stack ?? e);
  } finally {
    await browser?.close();
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
let bad = 0;
for (const run of results.runs) {
  const fails = Object.entries(run.checks).filter(([, v]) => v !== true).map(([n]) => n);
  console.log(run.browser, run.error ? `FEHLER ${run.error.split('\n')[0]}` : fails.length ? `ROT: ${fails.join(', ')}` : `grün (${Object.keys(run.checks).length} Prüfungen)`);
  if (run.error || fails.length) bad++;
}
console.log(JSON.stringify(results.runs.map((x) => x.notes)));
process.exit(bad ? 1 : 0);
