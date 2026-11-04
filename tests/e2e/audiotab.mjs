// E2E Audio-Reiter (Issue 11, 13 Punkt 1, 14, 15) mit nachgebautem Medien-Element, dessen Zeit stetig mit playbackRate läuft (window.__cont)
// und timeupdate nur alle 250 ms meldet, wie ein echter Browser.
// Prüft: erste Geste auf dem Reiter, kein Symbol "Ton aus"; fünf Momente in Folge im Hintergrund am selben Element;
// Tempo 2x über zehn Momente ohne Warten und Pause; höchstens drei Medien-Elemente mit Quelle; Untertitel folgen der Elementzeit (10 s bei 2x).
// Brief 02: Kaltstart aus dem Vorrat (echte mp3, Chromium), Sperrbildschirm (Media Session), Laden-Pille, Untertitel über den Tempowechsel.
// Aufruf: node tests/e2e/audiotab.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-audiotab'] = process.argv.slice(2);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freshPage = async (browser, poolBody) => {
  const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const pg = await cx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  await pg.addInitScript(() => { window.__ytSlow = true; window.__cont = true; window.__tuMs = 250; });
  await pg.addInitScript(FAKE_MEDIA);
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  await pg.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
  return { cx, pg, errors };
};
const setVisibility = (page, v) => page.evaluate((state) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state }); document.dispatchEvent(new Event('visibilitychange')); }, v);
const longPress = async (page, ms = 700) => {
  await page.mouse.move(190, 420);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
};

const mk = (id, end, cues) => ({
  id: `${id}:0`, videoId: id, start: 0, end, channel: 'Kanal at', videoTitle: 'Testvideo', area: 'brain', topic: 'augen', hook: `Audio ${id}`, kind: 'regel',
  createdAt: '2026-10-20T00:00:00Z', form: 'audio', audio: true, hls: `https://stream.test/${id}.m3u8`, ...(cues ? { cues } : {}),
});
// Untertitel alle 0,1 s Inhalt: der Cue-Index entspricht damit der Elementzeit auf 0,1 s genau
const dense = (end) => Array.from({ length: Math.floor(end * 10) }, (_, i) => [Math.round(i * 10) / 100, `Zeile ${i}`]);
const poolShort = await encPool(Array.from({ length: 14 }, (_, i) => mk(`atshort${i}`, 4)));
const poolTempo = await encPool(Array.from({ length: 14 }, (_, i) => mk(`attempo${i}`, 6)));
const recallOf = (i) => ({ question: `Question for ${i}?`, options: [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`], correct: 0, why: `Because ${i}.` });
const poolRecall = await encPool(Array.from({ length: 16 }, (_, i) => ({ ...mk(`atrecall${i}`, 4), recall: recallOf(i) })));
const poolCue = await encPool(Array.from({ length: 6 }, (_, i) => mk(`atcue${i}`, 40, dense(40))));

const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
const want = (n) => !only.length || only.includes(n);
const startAudio = async (page) => {
  await page.waitForSelector('[data-testid=form-switch]');
  // Erste Geste im Dokument ist der Tipp auf den Reiter
  await page.click('[data-testid=form-switch] >> text=Audio');
  return waitFor(page, () => window.__core.state() === 1 && window.__core.moment()?.audio === true);
};

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {}, notes: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : process.env.E2E_WEBKIT && type === webkit ? { executablePath: process.env.E2E_WEBKIT } : {});

    if (want('gesture')) {
    // 1. Erste Geste auf dem Reiter, kein Symbol
    const f1 = await freshPage(browser, poolShort);
    const p1 = f1.pg;
    c.playsAfterTabTap = await startAudio(p1);
    await p1.waitForTimeout(800);
    c.noSymbolInState = (await p1.evaluate(() => window.__core.hint())) === false;
    c.noSymbolOnScreen = (await p1.locator('[data-testid=sound-off]').count()) === 0;
    c.deckElementUnmuted = await p1.evaluate(() => { const a = document.querySelector('audio'); return !!a && a.muted === false; });
    // Deck nimmt die Quelle: je Start eine Zeile "deck: src local|net"
    c.deckSrcLine = await p1.evaluate(() => window.__core.diag().some((x) => /^deck: src (local|net) /.test(x)));
    // Ein Nachfolger ist vor dem Ende bestimmt (arm)
    c.nextIsArmed = await p1.evaluate(() => !!window.__core.deck().armed);
    c.atMostThreeMedia = (await p1.evaluate(() => window.__core.media())) <= 3;
    await f1.cx.close();
    }

    if (want('bg')) {
    // 2. Fünf Momente in Folge im Hintergrund, dasselbe Element, kein Stopp, kein Symbol danach
    const f2 = await freshPage(browser, poolShort);
    const p2 = f2.pg;
    await startAudio(p2);
    await p2.evaluate(() => { window.__node = document.querySelector('audio'); });
    await setVisibility(p2, 'hidden');
    c.fiveInARow = await waitFor(p2, () => window.__core.diag().filter((x) => x.startsWith('bg: next ')).length >= 5 && window.__core.state() === 1, undefined, 60000);
    const row = await p2.evaluate(() => ({ same: window.__node === document.querySelector('audio'), count: document.querySelectorAll('audio').length, media: window.__core.media(), diag: window.__core.diag() }));
    r.notes.bgLines = row.diag.filter((x) => x.startsWith('bg: ')).slice(0, 60);
    // Brief 11: höchstens zwei Elemente (aktiv und Standby), das aktive bleibt beim automatischen Weiter dasselbe
    c.rowSameNode = row.same && row.count <= 2;
    c.rowEndedNext = row.diag.filter((x) => x.startsWith('bg: ended ')).length >= 5 && row.diag.filter((x) => x.startsWith('bg: next ')).length >= 5;
    c.rowNoRejected = !row.diag.some((x) => x.startsWith('bg: play rejected'));
    // Der Wechsel setzt Quelle und play() im Ende-Handler: je Wechsel eine Zeile "advance" und keine Pause dazwischen
    c.rowAdvanceLines = row.diag.filter((x) => /^bg: deck advance \S+ to \S+: src and play\(\) in this handler, same element true/.test(x)).length >= 5;
    c.rowNoPausedState = !row.diag.some((x) => /slot\d+ \S+ state 2$/.test(x));
    c.rowMediaLimit = row.media <= 3 && !row.diag.some((x) => x.startsWith('media: '));
    await setVisibility(p2, 'visible');
    await p2.waitForTimeout(300);
    c.rowStillPlayingBack = (await p2.evaluate(() => window.__core.state())) === 1;
    c.rowNoSymbolBack = (await p2.evaluate(() => window.__core.hint())) === false;
    await f2.cx.close();
    }

    if (want('tempo')) {
    // 3. Tempo 2x über zehn Momente: nie Warten, nie Pause
    const f3 = await freshPage(browser, poolTempo);
    const p3 = f3.pg;
    await startAudio(p3);
    await longPress(p3);
    await longPress(p3);
    c.rate2 = await waitFor(p3, () => window.__core.rate() === 2, null, 3000);
    const before = await p3.evaluate(() => window.__core.diag().length);
    c.tenAtTwice = await waitFor(p3, () => window.__core.idx() >= 10 && window.__core.state() === 1, undefined, 70000);
    const log3 = await p3.evaluate((n) => window.__core.diag().slice(n), before);
    r.notes.tempoWaiting = log3.filter((x) => /state 3$/.test(x)).length;
    r.notes.tempoPaused = log3.filter((x) => /state 2$/.test(x)).length;
    c.tempoNoWaiting = r.notes.tempoWaiting === 0;
    c.tempoNoSymbol = (await p3.evaluate(() => window.__core.hint())) === false;
    c.tempoMediaLimit = (await p3.evaluate(() => window.__core.media())) <= 3;
    c.tempoNoPageErrors = f3.errors.length === 0;
    await f3.cx.close();
    }

    if (want('cue')) {
    // 4. Untertitel: 10 s bei 2x, die gezeigte Cue folgt der Elementzeit (Cues alle 0,1 s, höchstens 3 Cues = 0,3 s Abstand)
    const f4 = await freshPage(browser, poolCue);
    const p4 = f4.pg;
    await startAudio(p4);
    await longPress(p4);
    await longPress(p4);
    c.cueRate2 = await waitFor(p4, () => window.__core.rate() === 2, null, 3000);
    await waitFor(p4, () => window.__core.cue().rel > 1, undefined, 5000);
    const sample = await p4.evaluate(() => new Promise((res) => {
      const t0 = performance.now();
      const gaps = [];
      let worst = 0, n = 0, shownNow = 0, shownLate = 0;
      const frame = () => {
        const q = window.__core.cue();
        if (q.shown >= 0) {
          const gap = q.byElement - q.shown;
          worst = Math.max(worst, Math.abs(gap));
          if (gap > 3) shownLate++;
          if (gap < -3) shownNow++;
          n++;
          if (gaps.length < 12 && n % 40 === 0) gaps.push([q.rel.toFixed(2), q.shown, q.byElement]);
        }
        if (performance.now() - t0 < 10000) requestAnimationFrame(frame); else res({ worst, n, shownLate, shownNow, gaps, rate: window.__core.cue().rate });
      };
      requestAnimationFrame(frame);
    }));
    r.notes.cue = sample;
    c.cueSamples = sample.n > 200;
    c.cueWithin300ms = sample.worst <= 3;
    c.cueNeverLate = sample.shownLate === 0 && sample.shownNow === 0;
    c.cueAt2x = sample.rate === 2;
    c.captionOnScreen = (await p4.locator('[data-testid=caption]').count()) === 1;
    await f4.cx.close();
    }

    // 4b. Untertitel über den Tempowechsel (Brief 02, Issue 15): Start bei 1x, die Messung läuft schon, dann 1.5x und 2x. Keine Cue darf je 0,3 s abweichen.
    if (want('cue')) {
      const f4b = await freshPage(browser, poolCue);
      const p4b = f4b.pg;
      await startAudio(p4b);
      await waitFor(p4b, () => window.__core.cue().rel > 1.5, undefined, 8000);
      await p4b.evaluate(() => {
        window.__cs = { worst: 0, n: 0, done: false, rates: new Set() };
        const t0 = performance.now();
        const frame = () => {
          const q = window.__core.cue();
          if (q.shown >= 0) {
            window.__cs.worst = Math.max(window.__cs.worst, Math.abs(q.byElement - q.shown));
            window.__cs.n++;
            window.__cs.rates.add(q.rate);
          }
          if (performance.now() - t0 < 9000) requestAnimationFrame(frame); else window.__cs.done = true;
        };
        requestAnimationFrame(frame);
      });
      await sleep(1500);
      await longPress(p4b);
      await longPress(p4b);
      c.cueTempoChanged = await waitFor(p4b, () => window.__core.rate() === 2, null, 3000);
      c.cueTempoDone = await waitFor(p4b, () => window.__cs.done, undefined, 12000);
      const cs = await p4b.evaluate(() => ({ worst: window.__cs.worst, n: window.__cs.n, rates: [...window.__cs.rates] }));
      r.notes.cueTempo = cs;
      c.cueTempoSamples = cs.n > 150;
      c.cueTempoSawBothRates = cs.rates.includes(1) && cs.rates.includes(2);
      // Gleiche Toleranz wie über 10 s bei 2x: höchstens 3 Cues (0,3 s). Der Sprung der Messung beim Wechsel darf nicht darüber liegen.
      c.cueTempoWithin300ms = cs.worst <= 3;
      await f4b.cx.close();
    }

    // 5. Fällige Abrufkarte im Auto-Weiter des Audio-Reiters (Pfeiler 19, Issue 11): im Hintergrund nur in recallQueue, Ton läuft durch, Karte erst bei Rückkehr
    if (want('recall')) {
      const f5 = await freshPage(browser, poolRecall);
      const p5 = f5.pg;
      await startAudio(p5);
      for (let i = 0; i < 3; i++) { await p5.evaluate(() => window.__core.next()); await sleep(350); }
      c.recallThreeSwiped = (await p5.evaluate(() => window.__core.recall().sessionSeen)) === 3;
      c.recallNoCardYet = (await p5.locator('[data-testid=recall-card]').count()) === 0;
      await waitFor(p5, () => window.__core.state() === 1, undefined, 4000);
      await setVisibility(p5, 'hidden');
      c.recallBgThree = await waitFor(p5, () => window.__core.diag().filter((x) => x.startsWith('bg: next ')).length >= 3 && window.__core.state() === 1, undefined, 40000);
      const st = await p5.evaluate(() => ({ q: window.__core.recallQueue(), open: window.__core.recall().open, card: !!document.querySelector('[data-testid=recall-card]'), state: window.__core.state(), idx: window.__core.idx(), playing: [...document.querySelectorAll('audio')].filter((a) => !a.paused).length, diag: window.__core.diag() }));
      r.notes.recall = { q: st.q, idx: st.idx, lines: st.diag.filter((x) => x.startsWith('recall:') || x.startsWith('bg: ')).slice(-40) };
      c.recallQueuedOne = st.q.length === 1;
      c.recallNotOpenInBg = !st.open && !st.card;
      // Brief 11: der Standby kann das aktive Element geworden sein, es spielt genau eines von höchstens zwei
      c.recallAudioKeepsPlaying = st.state === 1 && st.playing === 1;
      c.recallDiagBg = st.diag.some((x) => /^recall: queued \S+ \(bg\)$/.test(x));
      c.recallNoStall = !st.diag.some((x) => x.startsWith('bg: stalled'));
      const idBg = st.q[0]?.id;
      await setVisibility(p5, 'visible');
      c.recallCardOnReturn = await waitFor(p5, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 3000);
      c.recallQueueEmptiedOnReturn = (await p5.evaluate(() => window.__core.recallQueue())).length === 0;
      c.recallCardIsQueued = !!idBg && (await p5.evaluate(() => document.querySelector('[data-testid=recall-question]')?.textContent ?? '')).length > 0;
      await f5.cx.close();
    }

    // 6. Karte ist im Vordergrund schon offen (Ton angehalten), dann Sperren: Karte zurück in die Warteschlange, Ton läuft weiter, Rückkehr zeigt sie
    if (want('recall')) {
      const f6 = await freshPage(browser, poolRecall);
      const p6 = f6.pg;
      await startAudio(p6);
      for (let i = 0; i < 3; i++) { await p6.evaluate(() => window.__core.next()); await sleep(350); }
      // Der vierte Moment endet im Vordergrund von selbst, die Karte erscheint
      c.openCardAppears = await waitFor(p6, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 15000);
      c.openCardHoldsAudio = (await p6.evaluate(() => window.__core.state())) !== 1;
      const idx0 = await p6.evaluate(() => window.__core.idx());
      await setVisibility(p6, 'hidden');
      c.openCardGoneInBg = await waitFor(p6, () => !document.querySelector('[data-testid=recall-card]') && !window.__core.recall().open, undefined, 2000);
      c.openCardAudioResumes = await waitFor(p6, () => window.__core.state() === 1, undefined, 4000);
      c.openCardQueued = (await p6.evaluate(() => window.__core.recallQueue())).length === 1 && (await p6.evaluate(() => window.__core.diag())).some((x) => /^recall: queued \S+ \(bg\)$/.test(x));
      c.openCardBgAdvances = await waitFor(p6, (i) => window.__core.idx() >= i + 2 && window.__core.state() === 1, idx0, 30000);
      await setVisibility(p6, 'visible');
      c.openCardBackOnReturn = await waitFor(p6, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 3000);
      await f6.cx.close();
    }
  } catch (e) {
    r.error = String(e);
  }
  await browser?.close();
  r.ok = !r.error && Object.values(c).every((v) => v === true);
  console.log(JSON.stringify(r));
}

// ---- Brief 02: Kaltstart aus dem Vorrat und Sperrbildschirm mit echter mp3 (Chromium, gedrosseltes Netz) ----
if (want('cold') && targets.includes('chromium')) {
  const r = { browser: 'chromium-cold', checks: {}, notes: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    const FILE = new Uint8Array(readFileSync(new URL('../fixtures/media/tone-cbr.mp3', import.meta.url)));
    const AREAS = ['brain', 'body', 'beat'];
    const pod = (i) => {
      const start = 10 + (i % 7) * 12;
      return { id: `pod-${String(i).padStart(4, '0')}:${start}`, videoId: `pod-${String(i).padStart(4, '0')}`, start, end: start + 25, channel: `Show ${i % 9}`, videoTitle: `Episode ${i}`, area: AREAS[Math.floor(i / 3) % 3], topic: `topic${i % 5}`, hook: `Cold audio moment ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', form: 'audio', audio: true, hls: `https://stream.test/ep${i}.mp3` };
    };
    const FAKE_YT = `window.YT={PlayerState:{ENDED:0,PLAYING:1,PAUSED:2,BUFFERING:3,CUED:5},Player:function(el,o){const ev=o.events||{};el.replaceWith(document.createElement('div'));
this.loadVideoById=()=>{};this.cueVideoById=()=>{};this.playVideo=()=>{};this.pauseVideo=()=>{};this.mute=()=>{};this.unMute=()=>{};this.isMuted=()=>true;
this.getCurrentTime=()=>0;this.getDuration=()=>0;this.getPlayerState=()=>-1;this.setPlaybackRate=()=>{};this.destroy=()=>{};setTimeout(()=>ev.onReady&&ev.onReady(),10)}};
window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();`;
    const poolCold = await encPool(Array.from({ length: 48 }, (_, i) => pod(i)));
    const net = { delay: 300, log: [] };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-allow-methods': 'GET,OPTIONS' };
    const routes = async (cx) => {
      // Nur die YouTube-Schnittstelle ist nachgebaut, das Audio-Element bleibt echt (echte mp3 über stream.test)
      await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
      await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
      await cx.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolCold }));
      await cx.route('https://stream.test/**', async (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const range = req.headers().range;
        net.log.push({ url: req.url(), range });
        await sleep(net.delay);
        const m = /bytes=(\d+)-(\d*)/.exec(range ?? '');
        const from = m ? Number(m[1]) : 0;
        const to = m && m[2] ? Math.min(Number(m[2]), FILE.length - 1) : FILE.length - 1;
        if (from >= FILE.length) return route.fulfill({ status: 416, headers: cors });
        return route.fulfill({ status: m ? 206 : 200, headers: { ...cors, 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', ...(m ? { 'content-range': `bytes ${from}-${to}/${FILE.length}` } : {}) }, body: Buffer.from(FILE.subarray(from, to + 1)) });
      });
    };
    // Media-Session-Handler mitschreiben (Chromium legt sie nicht offen)
    const MS_SPY = () => {
      window.__ms = {};
      const ms = navigator.mediaSession;
      const orig = ms.setActionHandler.bind(ms);
      ms.setActionHandler = (a, f) => { if (f) window.__ms[a] = f; else delete window.__ms[a]; return orig(a, f); };
    };
    browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
    const open = async (cx, query) => {
      const pg = await cx.newPage();
      const errors = [];
      pg.on('pageerror', (e) => errors.push(String(e)));
      await pg.addInitScript(MS_SPY);
      await pg.goto(`${url}?${query}#k=${k}`);
      await pg.waitForSelector('[data-testid=form-switch]', { timeout: 20000 });
      return { pg, errors };
    };
    const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await routes(cx);

    // Sitzung 1: Vorrat füllt sich, die nächsten drei Momente werden als Köpfe gehalten
    const s1 = await open(cx, 'now=2026-10-23&seed=3');
    await s1.pg.click('[data-testid=form-switch] button:has-text("Audio")');
    c.coldS1Plays = await waitFor(s1.pg, () => window.__core.state() === 1, null, 30000);
    c.coldS1Filled = await waitFor(s1.pg, () => window.__core.preload().stats.n >= 6, null, 60000);
    c.coldS1Heads = await waitFor(s1.pg, () => window.__core.heads().length === 6, null, 10000);
    const heads1 = await s1.pg.evaluate(() => window.__core.heads().map((h) => h.id));
    const held1 = await s1.pg.evaluate((ids) => ids.map((id) => window.__core.preload().ids.includes(id)), heads1);
    c.coldHeadsInVault = held1.every(Boolean);
    r.notes.heads = heads1;
    await s1.pg.close();

    // Neustart an einem neuen Tag mit anderer Mischung (die Warteschlange der letzten Sitzung gilt nicht mehr), das Netz ist jetzt langsam
    net.delay = 2500;
    const t0 = Date.now();
    const s2 = await open(cx, 'now=2026-10-24&seed=7');
    await s2.pg.click('[data-testid=form-switch] button:has-text("Audio")');
    c.coldS2Plays = await waitFor(s2.pg, () => window.__core.state() === 1, null, 20000);
    r.notes.firstSoundMs = Date.now() - t0;
    // Ein Netzstart hätte mindestens die Verzögerung des Hosts gedauert
    c.coldFirstSoundBeforeNet = r.notes.firstSoundMs < net.delay;
    const d2 = await s2.pg.evaluate(() => window.__core.diag());
    const srcLines = d2.filter((x) => /^deck: src (local|net) /.test(x));
    r.notes.diag = d2.filter((x) => /^deck: (src|hold|start order)|^signals:/.test(x)).slice(0, 10);
    c.coldFirstSrcLocal = /^deck: src local /.test(srcLines[0] ?? '');
    c.coldNoNetStart = !srcLines.some((x) => /^deck: src net /.test(x));
    c.coldCounterZero = (await s2.pg.evaluate(() => window.__core.lock().cold)) === 0;
    c.coldSignalsZero = (await s2.pg.evaluate(() => window.__core.lock().cloud)) === 0;
    c.coldNoSystemPause = !d2.some((x) => /pause event by=system/.test(x));
    c.coldNoPill = (await s2.pg.locator('[data-testid=loading-pill]').count()) === 0;

    // Sperrbildschirm: Handler, Positionsstatus, Metadaten, Zurück = Save, zweiter Druck = More like this
    const hs = await s2.pg.evaluate(() => Object.keys(window.__ms).sort());
    r.notes.handlers = hs;
    c.lockHandlers = ['nexttrack', 'pause', 'play', 'previoustrack'].every((a) => hs.includes(a));
    c.lockNoSeekHandlers = !hs.includes('seekbackward') && !hs.includes('seekforward');
    const m0 = await s2.pg.evaluate(() => window.__core.moment());
    c.lockPositionIsMomentLength = await waitFor(s2.pg, (len) => window.__core.lock().pos?.duration === len, m0.end - m0.start, 8000);
    const lk = await s2.pg.evaluate(() => window.__core.lock());
    r.notes.lock = lk;
    c.lockPositionInside = !!lk.pos && lk.pos.position >= 0 && lk.pos.position <= lk.pos.duration;
    c.lockMetadata = lk.title === m0.hook && !!lk.artist;
    c.lockAlbumIsEpisode = lk.album === m0.videoTitle;
    c.lockArtwork = lk.artwork.length === 2 && /512x512 .*tab-\w+-512\.png$/.test(lk.artwork[0]) && /1024x1024 .*tab-\w+-1024\.png$/.test(lk.artwork[1]);
    const art = await s2.pg.evaluate(async (list) => Promise.all(list.map(async (a) => { const u = a.split(' ')[1]; const res = await fetch(u); const b = await res.blob(); const bmp = await createImageBitmap(b); return [res.status, bmp.width]; })), lk.artwork);
    c.lockArtworkFilesExist = art[0][0] === 200 && art[0][1] === 512 && art[1][0] === 200 && art[1][1] === 1024;
    // Zurück: Save, Titel "Saved · Hook", kurz danach wieder der Hook
    await s2.pg.evaluate(() => window.__ms.previoustrack());
    c.lockBackSaves = await waitFor(s2.pg, (id) => window.__core.saved(id), m0.id, 3000);
    c.lockSavedTitle = (await s2.pg.evaluate(() => window.__core.lock().title)) === `Saved · ${m0.hook}`;
    c.lockNotLiked = !(await s2.pg.evaluate((id) => window.__core.liked(id), m0.id));
    // Zweiter Druck binnen 1,5 s: More like this, Save bleibt (keine Rücknahme)
    await sleep(500);
    await s2.pg.evaluate(() => window.__ms.previoustrack());
    c.lockSecondBackLikes = await waitFor(s2.pg, (id) => window.__core.liked(id), m0.id, 3000);
    c.lockStillSaved = await s2.pg.evaluate((id) => window.__core.saved(id), m0.id);
    c.lockTitleBack = await waitFor(s2.pg, () => window.__core.lock().title === window.__core.moment().hook, undefined, 4000);
    if (process.env.DEBUG_COLD) r.notes.titleNow = await s2.pg.evaluate(() => window.__core.lock().title);
    c.lockBackLines = (await s2.pg.evaluate(() => window.__core.diag())).filter((x) => x.startsWith('lock: back ')).length === 2;
    // Weiter: nächster Moment, Ton läuft
    const i0 = await s2.pg.evaluate(() => window.__core.idx());
    await s2.pg.evaluate(() => window.__ms.nexttrack());
    c.lockNextAdvances = await waitFor(s2.pg, (i) => window.__core.idx() === i + 1 && window.__core.state() === 1, i0, 8000);
    // Brief 11: Weiter am Sperrbildschirm (Bildschirm verdeckt) tauscht auf das zweite Element, das den Nachfolger schon fertig hält. Nichts wird geladen,
    // kein Netzstart, der Ton kommt innerhalb einer Sekunde. Echte mp3 und echtes Audio-Element: hier fällt canplaythrough und die Position wirklich an.
    const netBefore = (await s2.pg.evaluate(() => window.__core.diag())).filter((x) => /^deck: src net /.test(x)).length;
    const stock = await s2.pg.evaluate(() => { const q = window.__core.queue(), i = window.__core.idx(), h = window.__core.preload().ids; return q.slice(i + 1).filter((id) => h.includes(id)).length; });
    r.notes.stockBehind = stock;
    c.lockStandbyReadyBeforeHidden = await waitFor(s2.pg, () => window.__core.deck().standbyReady, null, 10000);
    const i1 = await s2.pg.evaluate(() => window.__core.idx());
    const len1 = await s2.pg.evaluate(() => window.__core.diag().length);
    await s2.pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const tNext = Date.now();
    await s2.pg.evaluate(() => window.__ms.nexttrack());
    c.lockHiddenAdvances = await waitFor(s2.pg, (i) => window.__core.idx() === i + 1 && window.__core.state() === 1, i1, 3000);
    r.notes.lockNextMs = Date.now() - tNext;
    const dn = await s2.pg.evaluate(() => window.__core.diag());
    const nextLines = dn.slice(len1).filter((x) => /^lock next: |^deck: (swap|prepare|standby)|^deck play#|^deck: src /.test(x));
    r.notes.lockNextLines = nextLines;
    c.lockHiddenUnder1s = c.lockHiddenAdvances && r.notes.lockNextMs < 1100;
    c.lockHiddenSwaps = nextLines.some((x) => /^deck: swap \S+ ready=true$/.test(x)) && nextLines.some((x) => /^deck play#\d+ ok$/.test(x));
    c.lockHiddenNoNewSource = !nextLines.some((x) => /^deck: src /.test(x));
    c.lockHiddenNoNetStart = dn.filter((x) => /^deck: src net /.test(x)).length === netBefore;
    await s2.pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    c.coldS2NoPageErrors = s2.errors.length === 0;
    await s2.pg.close();
    await cx.close();

    // Leerer Vorrat und langsames Netz: Pille "Loading, keep screen on" bis Daten da sind, danach weg, der Start wird als Netzstart gezählt
    net.delay = 2500;
    const cx2 = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await routes(cx2);
    const s3 = await open(cx2, 'now=2026-10-23&seed=5');
    await s3.pg.click('[data-testid=form-switch] button:has-text("Audio")');
    if (process.env.DEBUG_COLD) { await sleep(1200); r.notes.s3early = await s3.pg.evaluate(() => ({ diag: window.__core.diag().slice(0, 40), pill: !!document.querySelector('[data-testid=loading-pill]') })); }
    c.pillAppears = await waitFor(s3.pg, () => !!document.querySelector('[data-testid=loading-pill]'), null, 6000);
    c.pillText = (await s3.pg.locator('[data-testid=loading-pill]').first().textContent().catch(() => '')) === 'Loading, keep screen on';
    c.pillGoneWhenPlaying = await waitFor(s3.pg, () => window.__core.state() === 1 && !document.querySelector('[data-testid=loading-pill]'), null, 30000);
    c.pillCounted = (await s3.pg.evaluate(() => window.__core.lock().cold)) >= 1;
    // Der Zähler steht auch im Sync-Stand (signals.days[Tag].coldNetStarts)
    c.pillCountedInSignals = await waitFor(s3.pg, () => window.__core.lock().cloud >= 1, undefined, 3000);
    r.notes.coldNetLines = (await s3.pg.evaluate(() => window.__core.diag())).filter((x) => /^signals:/.test(x)).slice(0, 3);
    if (process.env.DEBUG_COLD) r.notes.s3diag = (await s3.pg.evaluate(() => window.__core.diag())).slice(0, 80);
    await cx2.close();
  } catch (e) {
    r.error = String(e);
  }
  await browser?.close();
  r.ok = !r.error && Object.values(c).every((v) => v === true);
  console.log(JSON.stringify(r));
}
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
if (results.runs.some((x) => !x.ok)) process.exit(1);
