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
// Brief 11, Schritt 9: Netz-Momente (m3u8, werden nicht vorgeladen) neben dem Vorrat. Sie liegen im Test vor dem Vorrat in der Warteschlange.
const bgNet = Array.from({ length: 4 }, (_, i) => bgMk(`bgnet${i}`, 'audio', { audio: true, start: 10, end: 14, hls: `https://stream.test/bgnet${i}.m3u8` }));
const poolBgStock = await encPool([...bgStock, ...bgNet]);
const poolBgStockOnly = await encPool(bgStock);
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

    // Fünf Momente in Folge im Hintergrund (Entscheidung 13, Brief 14): der Vorrat hält fünf Elemente fertig, das Ende tauscht nur die Rollen, nie eine neue Quelle, kein Stopp
    const fr = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3');
    const pr = fr.pg;
    await pr.waitForSelector('[data-testid=form-switch]');
    await pr.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pr, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    c.bgRowPoolFilled = await waitFor(pr, () => window.__core.deck().ready >= 5, undefined, 8000);
    const rowLen0 = await pr.evaluate(() => { window.__node = document.querySelector('audio'); return window.__core.diag().length; });
    await setVisibility(pr, 'hidden');
    c.bgFiveInARow = await waitFor(pr, () => window.__core.diag().filter((x) => x.startsWith('bg: next ')).length >= 5 && window.__core.state() === 1, undefined, 45000);
    const row = await pr.evaluate((n0) => ({
      same: window.__node === document.querySelector('audio'),
      count: document.querySelectorAll('audio').length,
      history: window.__core.deck().history,
      diag: window.__core.diag().filter((x) => x.startsWith('bg: ')),
      after: window.__core.diag().slice(n0),
    }), rowLen0);
    r.bgRowLog = row.diag;
    c.bgRowSameNode = row.same;
    // Brief 14: höchstens fünf Elemente im Vorrat plus das aktive
    c.bgRowAtMostPoolElements = row.count <= 6;
    c.bgRowSwapsNotSources = row.after.filter((x) => /^deck: swap \S+ ready=true pool=\d$/.test(x)).length >= 5 && new Set(row.history).size >= 6;
    c.bgRowNoLoadWhileHidden = !row.after.some((x) => /^deck: (src|pool load) /.test(x));
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

    // Brief 14: Weiter am Sperrbildschirm ohne bereites Element im Vorrat (hier kommt kein canplaythrough) tut nichts: kein Netzstart, kein Wechsel, nichts gezählt.
    // Der laufende Moment spielt weiter, die Diagnose sagt es.
    const fn = await freshPage(browser, url, k, poolBgAudio, '?now=2026-10-23&seed=3', [MS_SPY, () => { window.__noCpt = true; }]);
    const pn = fn.pg;
    await pn.waitForSelector('[data-testid=form-switch]');
    await pn.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pn, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    c.bgLockNextHandler = await pn.evaluate(() => typeof window.__ms?.nexttrack === 'function');
    await pn.waitForTimeout(500);
    const nxIdx = await pn.evaluate(() => window.__core.idx());
    const nxNet0 = await pn.evaluate(() => window.__core.diag().filter((x) => /^deck: src net /.test(x)).length);
    await setVisibility(pn, 'hidden');
    await pn.evaluate(() => window.__ms.nexttrack());
    c.bgLockNextStayLine = await waitFor(pn, () => window.__core.diag().some((x) => x === 'lock next: stay (pool empty)'), undefined, 3000);
    await pn.waitForTimeout(500);
    const nx = await pn.evaluate(() => ({ idx: window.__core.idx(), st: window.__core.state(), net: window.__core.diag().filter((x) => /^deck: src net /.test(x)).length, seenNext: window.__core.seen(window.__core.queue()[window.__core.idx() + 1]) }));
    c.bgLockNextNoNetStart = nx.net === nxNet0;
    c.bgLockNextKeepsMoment = nx.idx === nxIdx && nx.st === 1;
    c.bgLockNextCountsNothing = !nx.seenNext;
    await fn.cx.close();

    // Brief 20 (Issue 47): 'stock reaches 6 within 60 s after start' und 'pool fill local >= 3 after stock full'. Zwei Läufe mit lauter Vorrats-Momenten (mp3):
    // einmal normal, einmal so, dass die ersten drei Abrufe des Vorrats (fetch, nicht die Audio-Elemente) nie antworten (hängende Verbindung, wie auf dem Gerät). Der Wächter bricht sie nach 20 s ab,
    // die Plätze werden frei, der Vorrat steht trotzdem binnen 60 s bei 6 von 6, und jedes Ergebnis steht im Protokoll (stock: +1 ..., stock: fail ... / hang).
    let hangHits = 0;
    for (const hang of [false, true]) {
      const tag = hang ? 'bgStockHung' : 'bgStock';
      const fs6 = await freshPage(browser, url, k, poolBgStockOnly, '?now=2026-10-23&seed=3', [MS_SPY, IOS_GATE], async (cx) => {
        await routeMp3(cx);
        if (!hang) return;
        await cx.route('https://stream.test/**', (route) => {
          if (route.request().method() === 'OPTIONS' || route.request().resourceType() !== 'fetch' || hangHits++ >= 3) return route.fallback();
          return undefined; // keine Antwort
        });
      });
      const p6 = fs6.pg;
      const t0 = Date.now();
      await p6.waitForSelector('[data-testid=form-switch]');
      await p6.click('[data-testid=form-switch] >> text=Audio');
      await waitFor(p6, () => window.__core.moment()?.audio === true);
      c[`${tag}SixIn60s`] = await waitFor(p6, () => window.__core.diag().some((x) => x === 'stock: 6 of 6'), undefined, 60000);
      r[`${tag}Seconds`] = Math.round((Date.now() - t0) / 1000);
      c[`${tag}SixOnce`] = (await p6.evaluate(() => window.__core.diag().filter((x) => x === 'stock: 6 of 6').length)) === 1;
      const st = await p6.evaluate(() => {
        const d = window.__core.diag();
        const held = new Set(window.__core.preload().ids);
        const idx = window.__core.idx();
        const next6 = window.__core.queue().slice(idx + 1, idx + 7);
        return { plus: d.filter((x) => /^stock: \+1 \S+ \(\d of 6\)$/.test(x)).length, fails: d.filter((x) => x.startsWith('stock: fail ') || /^stock: (host|defer) /.test(x)), n: held.size, next6: next6.filter((id) => held.has(id)).length };
      });
      r[`${tag}Stats`] = st;
      c[`${tag}PlusLines`] = st.plus >= 6;
      c[`${tag}AllSixHeld`] = st.n >= 6 && st.next6 >= 5;
      // Die drei hängenden Abrufe wurden wirklich ausgelöst und blockieren den Vorrat nicht (ob der Wächter nach 20 s greift oder die Warteschlange den Moment vorher abbricht, hängt von der Reihenfolge ab, der Wächter selbst ist im Unit-Test belegt)
      if (hang) c[`${tag}RequestsHung`] = hangHits >= 3;
      // Pool: nach vollem Vorrat füllt er mindestens 3 der 5 lokal
      c[`${tag}PoolLocalGe3`] = await waitFor(p6, () => {
        const l = window.__core.diag().filter((x) => x.startsWith('deck: pool fill ')).slice(-1)[0] ?? '';
        const m = /^deck: pool fill 5\/5 \(local (\d), net (\d)\)$/.exec(l);
        return !!m && Number(m[1]) >= 3 && window.__core.deck().ready >= 5;
      }, undefined, 15000);
      await fs6.cx.close();
    }

    // Brief 14 (Entscheidung 52, Issue 36) und 14b (Issue 40), 'five nexttrack hidden, all play within 1 s, no prepare while hidden, no skipped': der Vorrat hält die
    // nächsten fünf Momente fertig geladen, aus dem Speicher (Blob) und dem Netz, lokale zuerst. Weiter am Sperrbildschirm tauscht nur die Rollen: fünf Mal
    // hintereinander, verdeckt zuerst die lokalen, dann das Netz, jedes Mal Ton binnen 1 s, ohne Rückkehr in die App, ohne neue Quelle, ohne Laden, ohne
    // "skipped". IOS_GATE sperrt jedes play() außerhalb des Handlers, das tauschende play() läuft im Handler.
    const fk = await freshPage(browser, url, k, poolBgStock, '?now=2026-10-23&seed=3', [MS_SPY, IOS_GATE], routeMp3);
    const pk = fk.pg;
    await pk.waitForSelector('[data-testid=form-switch]');
    await pk.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(pk, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    c.bgNextStockFills = await waitFor(pk, () => window.__core.preload().stats.n >= 8, undefined, 30000);
    // Warteschlange: nur zwei Vorrats-Momente unter den nächsten sechs (Netz, Speicher, Netz, Speicher, Netz, Netz). Die Vorrats-Tiefe (3 von 6) zieht einen dritten nach vorn.
    const arr = await pk.evaluate(() => {
      const held = new Set(window.__core.preload().ids);
      const cur = window.__core.moment().id;
      const q = window.__core.queue();
      const nets = q.filter((id) => id.startsWith('bgnet') && id !== cur).slice(0, 4);
      const stock = q.filter((id) => held.has(id) && id !== cur).slice(0, 2);
      const order = [nets[0], stock[0], nets[1], stock[1], nets[2], nets[3]];
      return { n: window.__core.arrange([...order, ...q.filter((id) => !order.includes(id) && id !== cur)]), order, nets, stock };
    });
    r.bgNextArranged = arr;
    c.bgNextArranged = arr.nets.length === 4 && arr.stock.length === 2 && arr.order.every(Boolean);
    // Sichtbar füllt das Deck den Vorrat: fünf Elemente bereit, lokale zuerst gewählt, der nächste Moment bleibt dabei
    c.bgNextPoolReady = await waitFor(pk, () => window.__core.deck().ready >= 5, undefined, 8000);
    // Vorrats-Momente werden asynchron warm (Blob-URL); der Pool ordnet sich dann neu, lokale zuerst. Danach spielt der erste Moment noch 1,3 s sichtbar,
    // dann folgt ein einziger Schnappschuss von Index und Pool, unmittelbar vor dem Sperren (Entscheidung 45: unter 1 s gespielt bleibt ungesehen).
    const localReady = () => waitFor(pk, () => /\(local ([3-5]),/.test(window.__core.diag().filter((x) => x.startsWith('deck: pool fill ')).slice(-1)[0] ?? '') && window.__core.deck().ready >= 5, undefined, 8000);
    await localReady();
    await pk.waitForTimeout(1300);
    await localReady();
    const kIdx = await pk.evaluate(() => window.__core.idx());
    const curId = await pk.evaluate(() => window.__core.moment().id);
    const poolState = await pk.evaluate(() => {
      const d = window.__core.diag();
      const srcOf = {};
      for (const x of d) { const m = /^deck: pool load (\S+) src=(local|net)$/.exec(x); if (m) srcOf[m[1]] = m[2]; }
      const idx = window.__core.idx();
      return { pool: window.__core.deck().pool.map((x) => x.id), q: window.__core.queue().slice(idx + 1, idx + 7), srcOf, fill: d.filter((x) => x.startsWith('deck: pool fill ')).slice(-1)[0] ?? '' };
    });
    r.bgNextPool = poolState;
    const vid = (id) => id.split(':')[0];
    const poolLocal = poolState.pool.filter((id) => poolState.srcOf[id] === 'local');
    const poolNet = poolState.pool.filter((id) => poolState.srcOf[id] !== 'local');
    c.bgNextPoolFive = poolState.pool.length === 5;
    c.bgNextPoolNearestStays = poolState.pool.includes(vid(poolState.q[0]));
    c.bgNextPoolInWindow = poolState.pool.every((id) => poolState.q.some((m) => vid(m) === id));
    // Brief 14b: mindestens 3 von 5 lokal, und 'pool fill' sagt es
    c.bgNextPoolThreeLocal = poolLocal.length >= 3 && poolNet.length >= 1;
    c.bgNextPoolFillLine = new RegExp(`^deck: pool fill 5/5 \\(local ${poolLocal.length}, net ${poolNet.length}\\)$`).test(poolState.fill);
    // Verdeckt zuerst die lokalen (in Reihenfolge des Vorrats), dann das Netz
    const expected = [...poolLocal, ...poolNet];
    const press = () => pk.evaluate(() => { window.__sync = true; try { window.__ms.nexttrack(); } finally { window.__sync = false; } });
    const hidLen = await pk.evaluate(() => window.__core.diag().length);
    await setVisibility(pk, 'hidden');
    const five = { adv: true, ok: true, swap: true, noSrc: true, noLoad: true, noVisible: true, noStay: true, order: true, ms: [] };
    for (let i = 1; i <= 5; i++) {
      // Jeder Moment spielt vor dem Weiter mindestens 1,3 s, sonst zählt er als nie gespielt und die Diagnose bekäme "skipped (not seen)" (Entscheidung 45)
      if (i > 1) await pk.waitForTimeout(1300);
      const len0 = await pk.evaluate(() => window.__core.diag().length);
      const t0 = Date.now();
      await press();
      const adv = await waitFor(pk, (n) => window.__core.idx() === n && window.__core.state() === 1, kIdx + i, 1000);
      const ok = await waitFor(pk, (n) => window.__core.diag().slice(n).some((x) => /^deck play#\d+ ok$/.test(x)), len0, 1000);
      five.ms.push(Date.now() - t0);
      const lines = (await pk.evaluate(() => window.__core.diag())).slice(len0);
      five.adv &&= adv;
      five.ok &&= ok;
      five.swap &&= lines.some((x) => x === `deck: swap ${expected[i - 1]} ready=true pool=${5 - i}`);
      five.noSrc &&= !lines.some((x) => /^deck: src /.test(x));
      five.noLoad &&= !lines.some((x) => /^deck: pool (load|fill) /.test(x));
      five.noVisible &&= !lines.some((x) => /app: visible|page visible/.test(x));
      five.noStay &&= !lines.some((x) => /^lock next: stay/.test(x));
      five.order &&= (await pk.evaluate(() => window.__core.moment().id)) === `${expected[i - 1]}:0`;
      if (i === 1) r.bgNextFirstLines = lines.filter((x) => /^lock next: |^deck: (swap|pool)|^deck play#/.test(x));
    }
    r.bgNextExpected = expected;
    r.bgNextFiveMs = five.ms;
    c.bgNextFiveAdvance = five.adv;
    c.bgNextFivePlayOk = five.ok && five.ms.every((m) => m < 2500);
    c.bgNextFiveSwapLines = five.swap;
    c.bgNextFiveLocalFirst = five.order;
    c.bgNextFiveNoNewSource = five.noSrc;
    c.bgNextFiveNoLoad = five.noLoad;
    c.bgNextFiveNoVisible = five.noVisible;
    c.bgNextFiveNoStay = five.noStay;
    const all = await pk.evaluate(() => window.__core.diag());
    // Verdeckt wurde nichts vorbereitet und nichts übersprungen (Brief 14b: kein 'skipped', kein Watchdog, kein 'stuck')
    c.bgNextNoPrepareHidden = !all.some((x) => /^deck: prepare /.test(x));
    r.bgNextSkipLines = all.slice(hidLen).filter((x) => /^skipped \(not seen\)|^watchdog |^lock: stuck|^go \d+->\d+$/.test(x));
    // Der Moment, der beim Sperren lief, zählt nicht: er kann vor dem Sperren knapp unter 1 s gespielt haben. Alle Pool-Momente dahinter schon.
    c.bgNextNoSkippedHidden = !all.slice(hidLen).some((x) => (/^skipped \(not seen\) /.test(x) && x !== `skipped (not seen) ${curId}`) || /^watchdog |^lock: stuck/.test(x));
    c.bgNextNoGatedPlay = (await pk.evaluate(() => window.__gated)) === 0;
    c.bgNextColdUnder2 = (await pk.evaluate(() => window.__core.lock().cold)) < 2;
    r.bgNextPlays = await pk.evaluate(() => window.__plays);
    // Der Vorrat ist leer: das sechste Weiter tut nichts, sagt es und der Moment spielt weiter (kein Netzstart verdeckt)
    const len6 = await pk.evaluate(() => window.__core.diag().length);
    await press();
    c.bgNextSixthStays = await waitFor(pk, (n) => window.__core.diag().slice(n).some((x) => x === 'lock next: stay (pool empty)'), len6, 2000);
    c.bgNextSixthKeeps = (await pk.evaluate(() => window.__core.idx())) === kIdx + 5;
    // Die Sperre ist wirksam: ein play() außerhalb des Handlers bleibt verdeckt ausstehend (so scheiterte jeder Wechsel einer Quelle im Hintergrund)
    c.bgNextGateActive = (await pk.evaluate(() => { document.querySelector('audio').play(); return window.__gated; })) === 1;
    // Zurück in die App: der Vorrat füllt sich wieder
    await setVisibility(pk, 'visible');
    c.bgNextRefill = await waitFor(pk, () => window.__core.diag().some((x) => x === 'deck: pool refill 5/5'), undefined, 8000);
    // Aktives Element plus fünf im Vorrat
    c.bgNextAtMostPoolSrc = (await pk.evaluate(() => window.__core.media())) <= 6;
    await fk.cx.close();

    // Brief 14b (Issue 40): ein verdeckt getauschtes Element, das nicht anspielt (das Ziel kommt nicht an), wird nach 12 s nie übersprungen.
    // Ist ein anderes Element bereit, tauscht die Hänge-Überwachung darauf (Zeile "lock: stuck <id>, not seen, swapped to <id>"). Ist keins bereit, bleibt alles
    // stehen ("lock: stuck, stay"): kein Wechsel, kein Laden, nichts gezählt. IOS_GATE: __stallArm lässt das play() des nächsten Tauschs ausstehen,
    // __open erlaubt das play() des Rückfalls aus dem Zeitgeber (das prüft die Logik, nicht iOS).
    const fh = await freshPage(browser, url, k, poolBgStock, '?now=2026-10-23&seed=3', [MS_SPY, IOS_GATE], routeMp3);
    const ph = fh.pg;
    await ph.waitForSelector('[data-testid=form-switch]');
    await ph.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(ph, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
    c.bgHungStockFills = await waitFor(ph, () => window.__core.preload().stats.n >= 8, undefined, 30000);
    c.bgHungPoolReady = await waitFor(ph, () => window.__core.deck().ready >= 5, undefined, 8000);
    await ph.waitForTimeout(1500);
    const hIdx = await ph.evaluate(() => window.__core.idx());
    const hCur = await ph.evaluate(() => window.__core.moment().id);
    const hLen0 = await ph.evaluate(() => window.__core.diag().length);
    const pressH = () => ph.evaluate(() => { window.__sync = true; try { window.__ms.nexttrack(); } finally { window.__sync = false; } });
    await setVisibility(ph, 'hidden');
    await ph.evaluate(() => { window.__stallArm = true; window.__open = true; });
    await pressH();
    c.bgHungSwapped = await waitFor(ph, (n) => window.__core.idx() === n, hIdx + 1, 1500);
    const hungId = await ph.evaluate(() => window.__core.moment().id);
    await ph.waitForTimeout(600);
    c.bgHungNotPlaying = (await ph.evaluate(() => window.__core.state())) !== 1;
    // Nach 12 s ohne Ton: Tausch auf das nächste bereite Element statt Überspringen
    c.bgHungSwapsAway = await waitFor(ph, (id) => window.__core.diag().some((x) => x.startsWith(`lock: stuck ${id}, not seen, swapped to `)), hungId, 22000);
    c.bgHungPlaysAfter = await waitFor(ph, (n) => window.__core.idx() === n && window.__core.state() === 1, hIdx + 2, 3000);
    const hl = (await ph.evaluate(() => window.__core.diag())).slice(hLen0);
    c.bgHungWatchdogHidden = hl.some((x) => x === `watchdog ${hungId} (hidden)`) && !hl.some((x) => x === `watchdog ${hungId}`);
    c.bgHungStaysUnseen = !(await ph.evaluate((id) => window.__core.seen(id), hungId));
    c.bgHungNoSkippedLine = !hl.some((x) => /^skipped \(not seen\)/.test(x) && x !== `skipped (not seen) ${hCur}`);
    c.bgHungTwoGos = hl.filter((x) => /^go \d+->\d+$/.test(x)).length === 2;
    c.bgHungNoAppVisible = !hl.some((x) => /app: visible|page visible/.test(x));
    // Vorrat leerziehen: normale Weiter, das letzte hängt. Dann ist kein Element mehr bereit und die Hänge-Überwachung bleibt stehen.
    const left = await ph.evaluate(() => window.__core.deck().ready);
    for (let i = 0; i < left - 1; i++) {
      await ph.waitForTimeout(1300);
      await pressH();
      await waitFor(ph, (n) => window.__core.idx() === n && window.__core.state() === 1, hIdx + 3 + i, 1500);
    }
    await ph.waitForTimeout(1300);
    await ph.evaluate(() => { window.__stallArm = true; });
    await pressH();
    const sIdx = hIdx + 2 + left;
    c.bgStaySwapped = await waitFor(ph, (n) => window.__core.idx() === n, sIdx, 1500);
    const sLen0 = await ph.evaluate(() => window.__core.diag().length);
    c.bgStayLine = await waitFor(ph, () => window.__core.diag().some((x) => x === 'lock: stuck, stay'), undefined, 22000);
    await ph.waitForTimeout(800);
    const st = await ph.evaluate((n) => ({ idx: window.__core.idx(), state: window.__core.state(), after: window.__core.diag().slice(n) }), sLen0);
    c.bgStayKeepsMoment = st.idx === sIdx && st.state !== 1;
    c.bgStayNoGo = !st.after.some((x) => /^go \d+->\d+$/.test(x));
    c.bgStayNoSkipped = !st.after.some((x) => /^skipped \(not seen\)/.test(x)) && !st.after.some((x) => /^watchdog \S+$/.test(x));
    c.bgStayNoLoad = !st.after.some((x) => /^deck: (src|pool load) /.test(x));
    r.bgHungLog = hl.filter((x) => /^lock: |^watchdog|^go |^deck: swap|^skipped/.test(x));
    r.bgStayLog = st.after.filter((x) => /^lock: |^watchdog|^go |^skipped/.test(x));
    await fh.cx.close();

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
