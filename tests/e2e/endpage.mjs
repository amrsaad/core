// E2E Endseite (Auftrag Max 29.10.2026): Gesehen bleibt gesehen, nie Wiederholung. Ist ein Reiter durch, steht
// "You've seen every video moment. New ones arrive daily." mit zwei Knöpfen zu den anderen Reitern und der Zahl ihrer ungesehenen Momente.
// Abrufkarten laufen weiter (die Karte nach dem letzten Moment kommt vor der Endseite).
// Aufruf: node tests/e2e/endpage.mjs <url> <ausgabeordner>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-endpage'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const NV = 4, NA = 5, NT = 2;
const base = (i, extra) => ({
  id: `endp${String(i).padStart(7, '0')}:100`, videoId: `endp${String(i).padStart(7, '0')}`, start: 100, end: 150, channel: `Kanal ${i % 4}`, videoTitle: 'Testvideo',
  area: ['beat', 'brain', 'body'][i % 3], topic: ['islam', 'augen', 'kraft'][i % 3], hook: `Endtest ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z',
  cues: [[0, 'Untertitel eins'], [2, 'Untertitel zwei']], excerpt: 'Ein geprüfter Ausschnitt.',
  recall: { question: `What follows from ${i}?`, options: [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`], correct: 0, why: `Because ${i}.` }, ...extra,
});
const moments = [];
for (let i = 0; i < NV; i++) moments.push(base(i, {}));
for (let i = NV; i < NV + NA; i++) moments.push(base(i, { audio: true, form: 'audio', hls: `https://stream.test/endp${String(i).padStart(7, '0')}.m3u8` }));
for (let i = NV + NA; i < NV + NA + NT; i++) moments.push(base(i, { form: 'text' }));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
const poolBody = await encPool(moments);
const k = Buffer.from(raw).toString('base64url');
// Brief 24: eigener Pool mit mehr Audio-Momenten. Ein weggewischter Moment kommt erst wieder, wenn er nicht mehr unter den letzten 10 des Protokolls ist (mix.ts),
// darum braucht die zweite Sitzung mindestens 10 andere Audio-Momente.
const NA2 = 16;
const moments2 = [];
for (let i = 0; i < NV; i++) moments2.push(base(i, {}));
for (let i = NV; i < NV + NA2; i++) moments2.push(base(i, { audio: true, form: 'audio', hls: `https://stream.test/endp${String(i).padStart(7, '0')}.m3u8` }));
for (let i = NV + NA2; i < NV + NA2 + NT; i++) moments2.push(base(i, { form: 'text' }));
const poolBody2 = await encPool(moments2);

const waitFor = async (page, fn, arg, timeout = 15000) => { try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; } };
const results = { at: new Date().toISOString(), runs: [] };
let failed = false;
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]]) {
  const r = { variant: name, checks: {} };
  const c = r.checks;
  results.runs.push(r);
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
    await page.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
    c.feedLoaded = await waitFor(page, () => !!window.__core?.moment());
    const vp = page.viewportSize();
    const shown = [];
    // Alle vier Videos laufen bis zum Ende und blättern selbst weiter. Die Abrufkarte (alle 4 Momente) kommt vor der Endseite.
    for (let guard = 0; guard < 200; guard++) {
      const s = await page.evaluate(() => ({ i: window.__core.idx(), id: window.__core.moment()?.id, card: !!document.querySelector('[data-testid=recall-card]'), end: !!document.querySelector('[data-testid=end-page]') }));
      if (s.id && !shown.includes(s.id)) shown.push(s.id);
      if (s.card || s.end) break;
      await page.waitForTimeout(100);
    }
    r.shown = shown;
    c.fourVideosShownOnce = shown.length === NV;
    c.recallCardBeforeEnd = await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 5000);
    c.cardOverEndPage = (await page.evaluate(() => window.__core.idx())) === NV;
    await page.screenshot({ path: `${out}/${name}-1-abrufkarte.png` });
    // Karte beantworten und schließen: dahinter steht die Endseite
    await page.click('[data-testid=recall-option][data-correct="1"]');
    await page.click('[data-testid=recall-next]');
    c.endPageAfterCard = await waitFor(page, () => !!document.querySelector('[data-testid=end-page]') && !document.querySelector('[data-testid=recall-card]'));
    const end = await page.evaluate(() => {
      const e = document.querySelector('[data-testid=end-page]');
      const b = [...document.querySelectorAll('[data-testid^=end-]')].filter((x) => x.tagName === 'BUTTON').map((x) => ({ t: x.textContent, id: x.dataset.testid, h: x.getBoundingClientRect().height, w: x.getBoundingClientRect().width, dis: x.disabled }));
      return { line: document.querySelector('[data-testid=end-line]')?.textContent, text: e?.innerText.replace(/\s+/g, ' ').trim(), b, full: e ? (() => { const q = e.getBoundingClientRect(); return q.width >= innerWidth - 1 && q.height >= innerHeight - 1; })() : false };
    });
    r.end = end;
    c.endLine = end.line === "You've seen every video moment.";
    c.endText = end.text === "You've seen every video moment. New ones arrive daily. Audio, 5 new Text, 2 new";
    c.endTwoButtons = end.b.length === 2 && end.b[0].t === 'Audio, 5 new' && end.b[1].t === 'Text, 2 new';
    c.endButtonsLarge = end.b.every((x) => x.h >= 48 && x.w >= 200);
    c.endCoversFeed = end.full;
    c.noMomentOnEnd = await page.evaluate(() => window.__core.moment() === undefined);
    await page.screenshot({ path: `${out}/${name}-2-endseite.png` });
    // Wisch nach oben auf der Endseite geht nicht weiter
    const swipe = async (dir) => {
      const y0 = vp.height * (dir === 'up' ? 0.75 : 0.25), y1 = vp.height * (dir === 'up' ? 0.25 : 0.75);
      await page.mouse.move(vp.width / 2, y0); await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(vp.width / 2, y0 + ((y1 - y0) * i) / 8); await page.waitForTimeout(16); }
      await page.mouse.up(); await page.waitForTimeout(500);
    };
    await swipe('up');
    c.upStaysOnEnd = (await page.evaluate(() => window.__core.idx())) === NV && !!(await page.$('[data-testid=end-page]'));
    // Gesehen bleibt gesehen: nach dem Neuladen steht sofort die Endseite, kein Video wird wiederholt
    await page.waitForTimeout(1500); // Zustand wird verzögert gespeichert
    await page.reload();
    c.reloadEndPageAtOnce = await waitFor(page, () => !!document.querySelector('[data-testid=end-page]'));
    c.reloadNoMoment = await page.evaluate(() => !window.__core?.moment?.());
    c.reloadNoRepeat = await page.evaluate((ids) => !ids.some((id) => window.__core?.moment?.()?.id === id), shown);
    await page.screenshot({ path: `${out}/${name}-3-nach-neuladen.png` });
    // Knopf Audio: wechselt den Reiter, der erste Audio-Moment erscheint. Beim Zurück sinkt die Zahl.
    await page.click('[data-testid=end-audio]');
    c.audioOpens = await waitFor(page, () => !!window.__core?.moment()?.audio);
    const firstAudio = await page.evaluate(() => window.__core.moment()?.id);
    c.audioMarkedSeen = await waitFor(page, (id) => window.__core.seen(id), firstAudio, 3000);
    await page.waitForTimeout(1300); // Zustand wird verzögert gespeichert (der Moment läuft im Zeitraffer erst danach zu Ende)
    await page.screenshot({ path: `${out}/${name}-3b-audio.png` });
    await page.click('.head-tabs button:has-text("Video")', { timeout: 4000 });
    c.backToVideoEnd = await waitFor(page, () => !!document.querySelector('[data-testid=end-page]') && !document.querySelector('[data-testid=end-page]').innerText.includes('Video'));
    const b2 = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=end-]')].filter((x) => x.tagName === 'BUTTON').map((x) => x.textContent));
    r.afterAudio = b2;
    // Im Zeitraffer laufen mehrere Audio-Momente durch: die Zahl ist genau die der noch ungesehenen
    const audioIds = moments.filter((m) => m.form === 'audio').map((m) => m.id);
    const seenAudio = await page.evaluate((ids) => ids.filter((id) => window.__core.seen(id)).length, audioIds);
    r.seenAudio = seenAudio;
    c.countDropsAfterSeen = seenAudio >= 1 && b2.join() === `Audio, ${NA - seenAudio} new,Text, 2 new`;
    // Text-Reiter: Knopf, erster Text-Moment (gesehen zählt erst am Textende, hier nur Anzeige)
    await page.click('[data-testid=end-text]');
    c.textOpens = await waitFor(page, () => document.querySelector('[data-testid=text-view]') !== null);
    // Ist auch Text leer: Endseite nennt text und bietet Video (0 new, gesperrt) und Audio
    c.noPageErrors = errors.length === 0;
    if (errors.length) r.errors = errors.slice(0, 5);
    await page.screenshot({ path: `${out}/${name}-4-text.png` });
    await ctx.close();

    // Brief 24 (Ergänzung 45): zweimal weggewischt ohne Wiedergabe sperrt 30 Tage. Der Moment kommt nach dem ersten Mal einmal wieder,
    // nach dem zweiten Mal nicht mehr, und die Endseite zählt ihn nicht ("Audio, 0 new"). Nach 30 Tagen kommt er wieder. Frischer Zustand.
    const ctx2 = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx2.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx2.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const p2 = await ctx2.newPage();
    const errors2 = [];
    p2.on('pageerror', (e) => errors2.push(String(e)));
    await p2.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody2 }));
    const endPage = () => !!document.querySelector('[data-testid=end-page]') && !document.querySelector('[data-testid=recall-card]');
    /** Alle Momente des Reiters laufen im Zeitraffer durch, Abrufkarten werden beantwortet, bis die Endseite steht. Liefert die gezeigten IDs. */
    const playThrough = async (pg) => {
      const ids = [];
      for (let guard = 0; guard < 300; guard++) {
        const st = await pg.evaluate(() => ({ id: window.__core?.moment()?.id, card: !!document.querySelector('[data-testid=recall-card]'), end: !!document.querySelector('[data-testid=end-page]') }));
        if (st.id && !ids.includes(st.id)) ids.push(st.id);
        if (st.card) {
          await pg.click('[data-testid=recall-option][data-correct="1"]');
          await pg.click('[data-testid=recall-next]');
          continue;
        }
        if (st.end && !st.card) return ids;
        await pg.waitForTimeout(100);
      }
      return ids;
    };
    /** Text des Knopfs "Audio, N new" auf der Video-Endseite */
    const audioButton = (pg) => pg.evaluate(() => document.querySelector('[data-testid=end-audio]')?.textContent ?? null);
    /** Sobald der nächste Audio-Moment da ist, sofort weiter. ready true: erst wenn er spielbereit ist (PLAYING erreicht, noch unter einer Sekunde Spielzeit), sonst ohne jede Wiedergabe. Liefert die ID. */
    const swipeAtOnce = async (pg, ready = true) => {
      await pg.waitForFunction((rd) => {
        const m = window.__core?.moment();
        if (!m?.audio) return false;
        // Erstes Bild gemeldet, noch ohne Spielzeit: so bleibt der Wisch kein schneller Skip nach Spielzeit (Entscheidung 36, abgelehnt und gesehen), sondern zählt für die Sperre (Entscheidung 45)
        if (rd) window.__core.markReady(m.id);
        window.__swiped = m.id;
        window.__core.next();
        return true;
      }, ready, { timeout: 15000 });
      return pg.evaluate(() => window.__swiped);
    };
    /** Dump bei Fehlern (Befund 24.11.): letzte Diag-Zeilen und Zustand des Moments */
    const dump = async (pg, label, id) => {
      const d = await pg.evaluate((i) => ({ diag: window.__core.diag().slice(-60), probe: window.__core.probe(i) }), id);
      console.log(`DUMP ${name} ${label} ${JSON.stringify(d.probe)}\n${d.diag.join('\n')}`.split('\n').slice(0, 80).join('\n'));
    };
    const diagHas = (pg, line) => pg.evaluate((l) => window.__core.diag().some((x) => x === l), line);
    await p2.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
    c.b24FeedLoaded = await waitFor(p2, () => !!window.__core?.moment());
    await playThrough(p2);
    c.b24VideoEndFirst = (await audioButton(p2)) === `Audio, ${NA2} new`;
    // Erstes Wegwischen: zählt, keine Sperre, der Moment bleibt ungesehen
    // Der Moment startet nicht (wie p3): sonst läuft das Deck je nach Lastlage vor dem Wisch an, der Wisch wäre ein schneller Skip nach Spielzeit (Entscheidung 36) statt Sperrzähler, und der Test wäre unzuverlässig
    await p2.evaluate(() => { window.__mediaNoStart = true; });
    await p2.click('[data-testid=end-audio]');
    const a1 = await swipeAtOnce(p2);
    await p2.evaluate(() => { window.__mediaNoStart = false; });
    r.b24Blocked = a1;
    await p2.waitForTimeout(300);
    c.b24FirstSkipLogged = await diagHas(p2, `skipped (not seen) ${a1}`);
    c.b24FirstSkipNoBlock = !(await p2.evaluate(() => window.__core.diag().some((x) => /^skip: \S+ blocked 30 d/.test(x))));
    const shown1 = await playThrough(p2);
    c.b24OthersPlayed = shown1.filter((x) => x !== a1).length === NA2 - 1;
    await p2.click('.head-tabs button:has-text("Video")', { timeout: 4000 });
    c.b24UnseenAfterFirst = await waitFor(p2, () => document.querySelector('[data-testid=end-audio]')?.textContent === 'Audio, 1 new', undefined, 5000);
    c.b24NotSeenAfterFirst = await p2.evaluate((id) => !window.__core.seen(id), a1);
    await p2.waitForTimeout(1500); // Zustand wird verzögert gespeichert
    // Zweite Sitzung: der Moment kommt einmal wieder, zweites Wegwischen sperrt 30 Tage
    await p2.reload();
    c.b24ReloadEnd = await waitFor(p2, endPage);
    c.b24StartNoneBlocked = await diagHas(p2, 'skip: 0 blocked');
    await p2.evaluate(() => { window.__mediaNoStart = true; });
    await p2.click('[data-testid=end-audio]');
    const a1again = await swipeAtOnce(p2);
    await p2.evaluate(() => { window.__mediaNoStart = false; });
    c.b24ComesBackOnce = a1again === a1;
    c.b24BlockedLine = await waitFor(p2, (l) => window.__core.diag().some((x) => x === l), `skip: ${a1} blocked 30 d (2 skips)`, 3000);
    await dump(p2, 'nach BlockedLine', a1);
    r.b24Rejected = await p2.evaluate((id) => window.__core.rejected(id), a1);
    await playThrough(p2);
    await p2.click('.head-tabs button:has-text("Video")', { timeout: 4000 });
    c.b24EndCountsNotBlocked = await waitFor(p2, () => document.querySelector('[data-testid=end-audio]')?.textContent === 'Audio, 0 new', undefined, 5000);
    c.b24NotSeenAfterBlock = await p2.evaluate((id) => !window.__core.seen(id), a1);
    if (!c.b24NotSeenAfterBlock) await dump(p2, 'nach NotSeenAfterBlock', a1);
    await p2.screenshot({ path: `${out}/${name}-5-gesperrt.png` });
    await p2.waitForTimeout(1500);
    // Dritte Sitzung: der gesperrte Moment erscheint nicht mehr, Start meldet die Sperre
    await p2.reload();
    c.b24Reload2End = await waitFor(p2, endPage);
    c.b24StartOneBlocked = await diagHas(p2, 'skip: 1 blocked');
    c.b24Reload2Count = (await audioButton(p2)) === 'Audio, 0 new';
    c.b24Reload2ButtonOff = await p2.evaluate(() => document.querySelector('[data-testid=end-audio]')?.disabled === true);
    await p2.click('.head-tabs button:has-text("Audio")', { timeout: 4000 });
    c.b24AudioEndAtOnce = await waitFor(p2, endPage, undefined, 5000);
    c.b24BlockedNeverShown = await p2.evaluate((id) => window.__core.moment()?.id !== id && !window.__core.queue().includes(id), a1);
    await p2.waitForTimeout(1500);
    // 31 Tage später: die Sperre ist abgelaufen, der Moment kommt wieder und zählt wieder
    await p2.goto(`${url}?now=2026-11-23&seed=3#k=${k}`);
    c.b24ExpiredShown = await waitFor(p2, (id) => window.__core?.moment()?.id === id, a1);
    c.b24ExpiredStartLine = await diagHas(p2, 'skip: 0 blocked');
    c.b24NoPageErrors = errors2.length === 0;
    if (errors2.length) r.errors2 = errors2.slice(0, 5);
    await p2.screenshot({ path: `${out}/${name}-6-nach-30-tagen.png` });
    await ctx2.close();

    // Issue 57: ein Wegwischen ohne je spielbereit zu sein zählt nicht, Diag nennt es, es gibt keine Sperre (frischer Zustand)
    const ctx3 = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx3.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx3.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const p3 = await ctx3.newPage();
    await p3.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody2 }));
    await p3.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
    c.b57FeedLoaded = await waitFor(p3, () => !!window.__core?.moment());
    await playThrough(p3);
    // Seit Runde 9 ist ein Audio-Slot sofort startbereit und das nachgebaute Element spielt ohne Netz sofort (PLAYING), der Wisch käme dann nicht mehr
    // vor dem Start. Darum startet das Element hier nie, so wie ein Stream, der keine Daten liefert.
    await p3.evaluate(() => { window.__mediaNoStart = true; });
    await p3.click('[data-testid=end-audio]');
    const n1 = await swipeAtOnce(p3, false);
    await p3.waitForTimeout(300);
    c.b57NotCountedLine = await diagHas(p3, `skip: ${n1} not counted (never ready)`);
    if (!c.b57NotCountedLine) await dump(p3, 'nach NotCountedLine', n1);
    c.b57NoBlockLine = !(await p3.evaluate(() => window.__core.diag().some((x) => /^skip: \S+ blocked 30 d/.test(x))));
    await ctx3.close();
  } catch (e) {
    r.fatal = String(e);
    c.noFatal = false;
  } finally {
    await browser?.close();
  }
  const bad = Object.entries(r.checks).filter(([, x]) => x === false).map(([n]) => n);
  console.log(`${name}: ${Object.keys(r.checks).length} Prüfpunkte${bad.length ? ' FEHLER: ' + bad.join(', ') : ''}${r.fatal ? ' FATAL: ' + r.fatal.slice(0, 300) : ''}`);
  if (bad.length) failed = true;
}
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 2));
if (failed) process.exit(1);
