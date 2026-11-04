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
const FAKE_MEDIA = FAKE.slice(FAKE.indexOf('// Eigene Streams'));

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
const k = Buffer.from(raw).toString('base64url');
const waitFor = async (page, fn, arg, timeout = 8000) => {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); return true; } catch { return false; }
};
// Media-Session-Handler mitschreiben (Chromium legt sie nicht offen), wie in audiotab.mjs
const MS_SPY = () => {
  window.__ms = {};
  const ms = navigator.mediaSession;
  const orig = ms.setActionHandler.bind(ms);
  ms.setActionHandler = (a, f) => { if (f) window.__ms[a] = f; else delete window.__ms[a]; return orig(a, f); };
};
// Brief 10: iOS startet im Hintergrund eine neue Quelle nur synchron im Media-Session-Handler. Jedes play() danach (React-Render, Zeitgeber) bleibt
// verdeckt für immer ausstehend und startet nichts. window.__sync markiert den Handler-Aufruf, window.__gated zählt die ausgesperrten play().
// window.__stallArm = true: die Quelle des nächsten play() im Handler bleibt verdeckt dauerhaft ausstehend (das Ziel kommt nicht an, Rückfall prüfen),
// window.__open = true: alle anderen play() sind erlaubt (der Rückfall startet verdeckt aus einem Zeitgeber, das prüft die Logik, nicht iOS).
const IOS_GATE = () => {
  const P = HTMLMediaElement.prototype;
  const orig = P.play;
  window.__sync = false;
  window.__gated = 0;
  window.__plays = [];
  P.play = function () {
    if (document.visibilityState === 'hidden') window.__plays.push({ sync: window.__sync, src: String(this.src).slice(0, 40), stack: new Error().stack.split('\n').slice(1, 7).map((l) => l.trim().slice(0, 60)).join(' < ') });
    if (document.visibilityState === 'hidden') {
      if (window.__stallArm && window.__sync) { window.__stallArm = false; window.__stallSrc = this.src; }
      if (window.__stallSrc && this.src === window.__stallSrc) { window.__gated++; return new Promise(() => {}); }
      if (!window.__sync && !window.__open) { window.__gated++; return new Promise(() => {}); }
    }
    return orig.call(this);
  };
};
const freshPage = async (browser, url, k, poolBody, query, extraInit, onCx) => {
  const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  await onCx?.(cx);
  const pg = await cx.newPage();
  await pg.addInitScript(() => { window.__ytSlow = true; });
  // Das nachgebaute Medien-Element muss vor dem ersten Gebrauch da sein: die Freischaltung per Geste spielt schon vor dem ersten Moment, ein echtes Element würde danach ein spätes ended liefern
  await pg.addInitScript(FAKE_MEDIA);
  for (const f of [].concat(extraInit ?? [])) await pg.addInitScript(f);
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
// Brief 10: Momente mit echter mp3 (Ausschnitt 10 bis 14 s), damit der Vorrat sich füllt und Blob-URLs entstehen
const bgStock = Array.from({ length: 12 }, (_, i) => bgMk(`bgstock${i}`, 'audio', { audio: true, start: 10, end: 14, hls: `https://stream.test/bgstock${i}.mp3` }));
const poolBgStock = await encPool(bgStock);
const MP3 = new Uint8Array(readFileSync(new URL('../fixtures/media/tone-cbr.mp3', import.meta.url)));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-allow-methods': 'GET,OPTIONS' };
const routeMp3 = (cx) => cx.route('https://stream.test/**', (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers().range ?? '');
  const from = m ? Number(m[1]) : 0;
  const to = m && m[2] ? Math.min(Number(m[2]), MP3.length - 1) : MP3.length - 1;
  if (from >= MP3.length) return route.fulfill({ status: 416, headers: CORS });
  return route.fulfill({ status: m ? 206 : 200, headers: { ...CORS, 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', ...(m ? { 'content-range': `bytes ${from}-${to}/${MP3.length}` } : {}) }, body: Buffer.from(MP3.subarray(from, to + 1)) });
});
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
    // Entscheidung 45: gesehen erst nach einer Sekunde Wiedergabe, nicht beim Ankommen
    c.bgSeenAtStartInForeground = await waitFor(pa, (id) => window.__core.seen(id), a0, 4000);
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
    // Der laufende Moment zählt als gesehen, sobald er in diesem Lauf mindestens eine Sekunde gespielt hat (Entscheidung 45)
    await waitFor(pa, () => window.__core.seen(window.__core.moment().id), undefined, 4000);
    const aBack = await pa.evaluate(() => ({ id: window.__core.moment().id, st: window.__core.state(), seen: window.__core.seen(window.__core.moment().id) }));
    c.bgBackOnRunningMoment = aBack.st === 1 && aBack.seen;
    const aLog = await bgLog(pa);
    r.bgAudioLog = aLog;
    c.bgLogStartedEndedNext = aLog.some((x) => x === `bg: ended ${a0}`) && aLog.some((x) => x === `bg: next ${a1}`) && aLog.some((x) => x === `bg: started ${a1}`) && aLog.some((x) => x.startsWith('bg: left')) && aLog.some((x) => x.startsWith('bg: back'));
    c.bgEndedOnce = aLog.filter((x) => x === `bg: ended ${a0}`).length === 1;
    // Der Nachfolger kommt aus derselben Mischung wie beim Wisch (gleiche Eingaben, gleicher Zufall)
    const bgNext = aLog.filter((x) => x.startsWith('bg: next ')).map((x) => x.slice(9)).slice(0, 2);
    let fs, swipeIds;
    for (let attempt = 0; attempt < 4; attempt++) {
      fs = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3');
      await fs.pg.waitForSelector('[data-testid=form-switch]');
      await fs.pg.click('[data-testid=form-switch] >> text=Audio');
      await waitFor(fs.pg, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
      swipeIds = [];
      for (let i = 0; i < 2; i++) { await fs.pg.evaluate(() => window.__core.next()); await fs.pg.waitForTimeout(250); swipeIds.push(await fs.pg.evaluate(() => window.__core.idx() + ':' + window.__core.moment().id)); }
      // Lief der erste Moment im Vordergrund schon von selbst weiter (langsamer Runner), zählt der Versuch nicht
      if (swipeIds[0].startsWith('1:') && swipeIds[1].startsWith('2:')) break;
      await fs.cx.close();
    }
    swipeIds = swipeIds.map((x) => x.slice(2));
    c.bgAutoNextEqualsSwipe = bgNext.length === 2 && bgNext.every((id, i) => id === swipeIds[i]);
    await fs.cx.close();
    await fa.cx.close();

    // Fünf Momente in Folge im Hintergrund (Entscheidung 13): dasselbe Audio-Element, die Quelle wechselt, nie ein zweites Element, kein Stopp
    const fr = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3');
    const pr = fr.pg;
    await pr.waitForSelector('[data-testid=form-switch]');
    await pr.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pr, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    await pr.evaluate(() => { window.__node = document.querySelector('audio'); window.__srcs = new Set(); setInterval(() => window.__srcs.add(window.__node.src), 20); });
    await setVisibility(pr, 'hidden');
    c.bgFiveInARow = await waitFor(pr, () => window.__core.diag().filter((x) => x.startsWith('bg: next ')).length >= 5 && window.__core.state() === 1, undefined, 45000);
    const row = await pr.evaluate(() => ({
      same: window.__node === document.querySelector('audio'),
      count: document.querySelectorAll('audio').length,
      srcs: window.__srcs.size,
      history: window.__core.deck().history,
      diag: window.__core.diag().filter((x) => x.startsWith('bg: ')),
    }));
    r.bgRowLog = row.diag;
    c.bgRowSameNode = row.same;
    c.bgRowOneAudioElement = row.count === 1;
    c.bgRowSrcChanges = row.srcs >= 5 && new Set(row.history).size >= 6;
    c.bgRowEndedNext = row.diag.filter((x) => x.startsWith('bg: ended ')).length >= 5 && row.diag.filter((x) => x.startsWith('bg: next ')).length >= 5;
    // Issue 35: nach mehreren Trackwechseln sind Weiter und Zurück noch registriert, keine Sprung-Aktionen, Handler wurden nach playing neu gesetzt
    const lh = await pr.evaluate(() => ({ h: window.__core.lockHandlers(), d: window.__core.diag().filter((x) => x.startsWith('lock: handlers set')), prevNull: window.__ms ? Object.keys(window.__ms).sort() : null }));
    c.bgRowLockHandlers = ['nexttrack', 'previoustrack', 'play', 'pause'].every((a) => lh.h.includes(a)) && !lh.h.some((a) => /^seek/.test(a));
    c.bgRowHandlersReset = lh.d.some((x) => x === 'lock: handlers set (mount)') && lh.d.some((x) => x === 'lock: handlers set (playing)');
    c.bgRowNoRejected = !row.diag.some((x) => x.startsWith('bg: play rejected'));
    await setVisibility(pr, 'visible');
    await pr.waitForTimeout(200);
    c.bgRowStillPlayingBack = (await pr.evaluate(() => window.__core.state())) === 1;
    await fr.cx.close();

    // Browser verweigert play() im Hintergrund: kein Stopp nach Zeit, Diagnose mit Fehlername, bei der Rückkehr sofort weiter
    const fe = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3');
    const pe = fe.pg;
    await pe.waitForSelector('[data-testid=form-switch]');
    await pe.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pe, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    await pe.evaluate(() => { window.__denyBg = true; const P = HTMLMediaElement.prototype, o = P.play; P.play = function () { if (window.__denyBg && document.visibilityState === 'hidden') return Promise.reject(new DOMException('blocked', 'NotAllowedError')); return o.call(this); }; });
    await setVisibility(pe, 'hidden');
    c.bgRejectLogged = await waitFor(pe, () => window.__core.diag().some((x) => x === 'bg: play rejected NotAllowedError'), undefined, 14000);
    const atReject = await pe.evaluate(() => window.__core.idx());
    await pe.waitForTimeout(6000);
    const held = await pe.evaluate(() => ({ st: window.__core.state(), idx: window.__core.idx(), diag: window.__core.diag() }));
    c.bgRejectNoTimerStop = !held.diag.some((x) => x.startsWith('bg: stalled') || x.startsWith('bg: stop after'));
    c.bgRejectStaysOnNext = atReject >= 1 && held.idx === atReject && held.st !== 1;
    await pe.evaluate(() => { window.__denyBg = false; });
    await setVisibility(pe, 'visible');
    c.bgRejectResumesOnReturn = await waitFor(pe, (idx) => window.__core.state() === 1 && window.__core.idx() === idx, atReject, 4000);
    await fe.cx.close();

    // Brief 09, Ergänzung: Weiter am Sperrbildschirm startet bei verdecktem Bildschirm nie per Netz (iOS lädt dann erst nach der Rückkehr weiter).
    // Ohne Vorrat bleibt der laufende Moment, die Diagnose sagt es. Das Ziehen eines Vorrats-Moments prüft audiotab.mjs mit echtem Vorrat.
    const fn = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3', MS_SPY);
    const pn = fn.pg;
    await pn.waitForSelector('[data-testid=form-switch]');
    await pn.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pn, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    c.bgLockNextHandler = await pn.evaluate(() => typeof window.__ms?.nexttrack === 'function');
    const nxIdx = await pn.evaluate(() => window.__core.idx());
    const nxNet0 = await pn.evaluate(() => window.__core.diag().filter((x) => /^deck: src net /.test(x)).length);
    await setVisibility(pn, 'hidden');
    await pn.evaluate(() => window.__ms.nexttrack());
    c.bgLockNextStayLine = await waitFor(pn, () => window.__core.diag().some((x) => /^lock next: stay /.test(x)), undefined, 3000);
    await pn.waitForTimeout(500);
    const nx = await pn.evaluate(() => ({ idx: window.__core.idx(), st: window.__core.state(), net: window.__core.diag().filter((x) => /^deck: src net /.test(x)).length }));
    c.bgLockNextNoNetStart = nx.net === nxNet0;
    c.bgLockNextKeepsMoment = nx.idx === nxIdx && nx.st === 1;
    await fn.cx.close();

    // Brief 10 (Issue 36), 'nexttrack hidden plays within 2 s': Weiter am Sperrbildschirm mit Vorrat. Der Ziel-Moment startet synchron im Handler (iOS erlaubt
    // verdeckt nur das), 'deck play#N ok' kommt binnen 2 s, ohne Rückkehr in die App. Zweimal Weiter hintereinander, beide spielen.
    const fk = await freshPage(browser, url, k, poolBgStock, '?now=2026-10-23&seed=3', [MS_SPY, IOS_GATE], routeMp3);
    const pk = fk.pg;
    await pk.waitForSelector('[data-testid=form-switch]');
    await pk.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pk, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    c.bgNextStockFills = await waitFor(pk, () => window.__core.preload().stats.n >= 4, undefined, 20000);
    await pk.waitForTimeout(600);
    const kIdx = await pk.evaluate(() => window.__core.idx());
    const press = () => pk.evaluate(() => { window.__sync = true; try { window.__ms.nexttrack(); } finally { window.__sync = false; } });
    await setVisibility(pk, 'hidden');
    const kLen0 = await pk.evaluate(() => window.__core.diag().length);
    const kT0 = Date.now();
    await press();
    c.bgNextHiddenAdvances = await waitFor(pk, (i) => window.__core.idx() === i + 1 && window.__core.state() === 1, kIdx, 3000);
    c.bgNextHiddenPlayOk = await waitFor(pk, (n) => window.__core.diag().slice(n).some((x) => /^deck play#\d+ ok$/.test(x)), kLen0, 2000);
    r.bgNextHiddenMs = Date.now() - kT0;
    const kLines = (await pk.evaluate(() => window.__core.diag())).slice(kLen0);
    r.bgNextHiddenLines = kLines.filter((x) => /^lock next: |^deck: src |^deck play#/.test(x));
    c.bgNextStartNowLine = kLines.some((x) => /^lock next: startNow \S+ src=blob$/.test(x));
    c.bgNextPlayingLine = await waitFor(pk, (n) => window.__core.diag().slice(n).some((x) => /^lock next: playing after \d+ ms$/.test(x)), kLen0, 2000);
    c.bgNextNoVisibleBetween = !kLines.some((x) => /app: visible|page visible/.test(x));
    // Eine Quelle für das Ziel, kein zweites Laden durch die Buchführung
    c.bgNextOneSrcLine = kLines.filter((x) => /^deck: src /.test(x)).length === 1;
    c.bgNextNoGatedPlay = (await pk.evaluate(() => window.__gated)) === 0;
    r.bgNextPlays = await pk.evaluate(() => window.__plays);
    // Zweiter Druck gleich danach: beide Momente spielen
    await press();
    c.bgNextTwiceAdvances = await waitFor(pk, (i) => window.__core.idx() === i + 2 && window.__core.state() === 1, kIdx, 3000);
    c.bgNextTwicePlays = await waitFor(pk, (n) => window.__core.diag().slice(n).filter((x) => /^deck play#\d+ ok$/.test(x)).length >= 2, kLen0, 2000);
    c.bgNextTwiceNoGated = (await pk.evaluate(() => window.__gated)) === 0;
    // Die Sperre ist wirksam: ein play() außerhalb des Handlers bleibt verdeckt ausstehend (so scheiterte der Weg vor Brief 10)
    c.bgNextGateActive = (await pk.evaluate(() => { document.querySelector('audio').play(); return window.__gated; })) === 1;
    await fk.cx.close();

    // Brief 10, Schritt 4: kommt das Ziel nicht binnen 3 s an, zurück zum laufenden Moment, das Ziel bleibt ungesehen, nie stumm weiter
    const fb = await freshPage(browser, url, k, poolBgStock, '?now=2026-10-23&seed=3', [MS_SPY, IOS_GATE], routeMp3);
    const pb = fb.pg;
    await pb.waitForSelector('[data-testid=form-switch]');
    await pb.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pb, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    await waitFor(pb, () => window.__core.preload().stats.n >= 4, undefined, 20000);
    await pb.waitForTimeout(600);
    const bIdx = await pb.evaluate(() => window.__core.idx());
    const bRun = await pb.evaluate(() => window.__core.moment().id);
    await setVisibility(pb, 'hidden');
    await pb.evaluate(() => { window.__stallArm = true; window.__open = true; window.__sync = true; try { window.__ms.nexttrack(); } finally { window.__sync = false; } });
    c.bgRevertLine = await waitFor(pb, () => window.__core.diag().some((x) => /^lock next: reverted /.test(x)), undefined, 5000);
    c.bgRevertBackOnRunning = await waitFor(pb, (a) => window.__core.idx() === a.i && window.__core.moment().id === a.id && window.__core.state() === 1, { i: bIdx, id: bRun }, 3000);
    const bDiag = await pb.evaluate(() => window.__core.diag());
    const bTarget = /^lock next: startNow (\S+) src=/.exec(bDiag.find((x) => /^lock next: startNow /.test(x)) ?? '')?.[1];
    r.bgRevertLines = bDiag.filter((x) => /^lock next: /.test(x));
    c.bgRevertTargetUnseen = !!bTarget && !(await pb.evaluate((id) => window.__core.seen(id), bTarget));
    c.bgRevertNotPlayedLine = !bDiag.some((x) => /^lock next: playing after /.test(x));
    await fb.cx.close();

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
