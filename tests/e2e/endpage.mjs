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
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
const poolBody = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');

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
    await page.click('.vform button:has-text("Video")', { timeout: 4000 });
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
