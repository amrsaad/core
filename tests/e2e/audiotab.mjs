// E2E Audio-Reiter (Issue 11, 13 Punkt 1, 14, 15) mit nachgebautem Medien-Element, dessen Zeit stetig mit playbackRate läuft (window.__cont)
// und timeupdate nur alle 250 ms meldet, wie ein echter Browser.
// Prüft: erste Geste auf dem Reiter, kein Symbol "Ton aus"; fünf Momente in Folge im Hintergrund am selben Element;
// Tempo 2x über zehn Momente ohne Warten und Pause; höchstens drei Medien-Elemente mit Quelle; Untertitel folgen der Elementzeit (10 s bei 2x).
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
    c.rowSameNode = row.same && row.count === 1;
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

    // 5. Fällige Abrufkarte im Auto-Weiter des Audio-Reiters (Pfeiler 19, Issue 11): im Hintergrund nur in recallQueue, Ton läuft durch, Karte erst bei Rückkehr
    if (want('recall')) {
      const f5 = await freshPage(browser, poolRecall);
      const p5 = f5.pg;
      await startAudio(p5);
      await p5.evaluate(() => { window.__node = document.querySelector('audio'); });
      for (let i = 0; i < 3; i++) { await p5.evaluate(() => window.__core.next()); await sleep(350); }
      c.recallThreeSwiped = (await p5.evaluate(() => window.__core.recall().sessionSeen)) === 3;
      c.recallNoCardYet = (await p5.locator('[data-testid=recall-card]').count()) === 0;
      await waitFor(p5, () => window.__core.state() === 1, undefined, 4000);
      await setVisibility(p5, 'hidden');
      c.recallBgThree = await waitFor(p5, () => window.__core.diag().filter((x) => x.startsWith('bg: next ')).length >= 3 && window.__core.state() === 1, undefined, 40000);
      const st = await p5.evaluate(() => ({ q: window.__core.recallQueue(), open: window.__core.recall().open, card: !!document.querySelector('[data-testid=recall-card]'), state: window.__core.state(), idx: window.__core.idx(), same: window.__node === document.querySelector('audio'), paused: document.querySelector('audio')?.paused, diag: window.__core.diag() }));
      r.notes.recall = { q: st.q, idx: st.idx, lines: st.diag.filter((x) => x.startsWith('recall:') || x.startsWith('bg: ')).slice(-40) };
      c.recallQueuedOne = st.q.length === 1;
      c.recallNotOpenInBg = !st.open && !st.card;
      c.recallAudioKeepsPlaying = st.state === 1 && st.paused === false && st.same;
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
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
if (results.runs.some((x) => !x.ok)) process.exit(1);
