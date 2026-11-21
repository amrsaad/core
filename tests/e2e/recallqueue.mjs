// E2E Abrufkarten-Abstand (Pfeiler 19, Runde 34). Eine Karte kommt nach je 10 im Vordergrund gespielten Momenten. Eine fällige Karte erscheint nie,
// solange der Feed nicht im Vordergrund und sichtbar ist (Settings, Saved, Feedback-Blatt, Hintergrund) und wird nicht vorgemerkt.
// Hintergrund-Momente zählen nicht, bei der Rückkehr aus dem Hintergrund kommt keine Karte. Weggewischt: erst am nächsten Tag wieder.
// Aufruf: node tests/e2e/recallqueue.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-recallqueue'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const k = b64u(raw);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: b64u(iv), ct: b64u(ct) });
};
const mk = (i) => ({
  id: `rq${String(i).padStart(9, '0')}:100`, videoId: `rq${String(i).padStart(9, '0')}`, start: 100, end: 160, channel: `Kanal ${i}`, videoTitle: 'Testvideo',
  area: 'brain', topic: ['augen', 'retina', 'linse', 'lid', 'glaukom', 'kornea'][i % 6], hook: `Warteschlange ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z',
  recall: { question: `Question for ${i}?`, options: [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`], correct: 0, why: `Because ${i}.` },
});
const POOL = await encPool(Array.from({ length: 30 }, (_, i) => mk(i)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (page, fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
const setVisibility = (page, v) => page.evaluate((state) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state }); document.dispatchEvent(new Event('visibilitychange')); }, v);
const cardUp = (page) => page.evaluate(() => !!document.querySelector('[data-testid=recall-card]'));
/** Die Zeit des aktuellen Moments ans Ende setzen (80 % geschaut), dann wischen */
const watchAndNext = async (page) => {
  await sleep(1150); // mindestens eine Sekunde echte Spielzeit (played.ts), sonst zählt der Moment nicht
  await page.evaluate(() => { for (const d of document.querySelectorAll('div')) if (d.__player) d.__player.seekTo(150); });
  await sleep(150);
  await page.evaluate(() => window.__core.next());
  await sleep(450);
};

const SCENARIOS = {
  settings: { open: (p) => p.click('nav [aria-label=Settings]'), close: (p) => p.click('nav [aria-label=Feed]') },
  saved: { open: (p) => p.click('nav [aria-label=Saved]'), close: (p) => p.click('nav [aria-label=Feed]') },
  note: { open: (p) => p.evaluate(() => window.__core.openNote()), close: (p) => p.mouse.click(190, 40) },
  background: { open: (p) => setVisibility(p, 'hidden'), close: (p) => setVisibility(p, 'visible') },
};

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  for (const [scn, sc] of Object.entries(SCENARIOS)) {
    const r = { browser: name, scenario: scn, checks: {}, notes: {} };
    results.runs.push(r);
    const c = r.checks;
    let browser;
    try {
      browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
      const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
      await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
      await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript(() => { window.__ytSlow = true; });
      await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: POOL }));
      await page.goto(`${url}?now=2026-10-22&seed=3#k=${k}`);
      c.feedUp = await waitFor(page, () => !!window.__core?.moment() && window.__core.state() === 1);
      // Neun Momente im Vordergrund gespielt, keine Karte, der Zähler steht auf 9
      for (let i = 0; i < 9; i++) await watchAndNext(page);
      c.nineNoCard = !(await cardUp(page)) && (await page.evaluate(() => window.__core.recall().played)) === 9;
      // Der 10. Moment wird gehört, dann Feed verlassen oder verdecken und weiter: die Karte wäre fällig
      await sleep(1150);
      await sc.open(page);
      await sleep(300);
      const idxBefore = await page.evaluate(() => window.__core.idx());
      await page.evaluate(() => window.__core.next());
      await sleep(800);
      c.noCardWhileAway = !(await cardUp(page)) && !(await page.evaluate(() => window.__core.recall().open));
      c.nothingQueued = (await page.evaluate(() => window.__core.recallQueue())).length === 0 && !(await page.evaluate(() => window.__core.diag())).some((x) => x.startsWith('recall: queued'));
      c.soundAndFeedContinue = (await page.evaluate(() => window.__core.idx())) === idxBefore + 1;
      const playedAway = await page.evaluate(() => window.__core.recall().played);
      r.notes.playedAway = playedAway;
      // Hintergrund: der Moment lief verdeckt, zählt nicht (9). Settings, Saved, Blatt: er lief im Vordergrund (10), die Karte war nur nicht zeigbar.
      c.countAway = scn === 'background' ? playedAway === 9 : playedAway === 10;
      await sc.close(page);
      // Rückkehr: keine Karte
      c.noCardOnReturn = !(await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'), null, 1800));
      c.noShownOnReturn = !(await page.evaluate(() => window.__core.diag())).some((x) => x.startsWith('recall: shown'));
      // Nach der Rückkehr einen Moment im Vordergrund hören und weiter
      await sleep(1150);
      await page.evaluate(() => { for (const d of document.querySelectorAll('div')) if (d.__player) d.__player.seekTo(150); });
      await sleep(150);
      await page.evaluate(() => window.__core.next());
      await sleep(700);
      if (scn === 'background') {
        // Der Moment, bei dem die Seite zurückkam, zählt nicht: noch 9, keine Karte. Ein weiterer im Vordergrund gehörter Moment macht 10.
        c.bgMomentsNotCounted = !(await cardUp(page)) && (await page.evaluate(() => window.__core.recall().played)) === 9;
        await watchAndNext(page);
        c.cardAfterTenForeground = await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'), null, 4000);
      } else {
        c.cardAfterTenForeground = await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'), null, 4000);
      }
      const shown = (await page.evaluate(() => window.__core.diag())).filter((x) => /^recall: shown \S+ after \d+ played$/.test(x));
      r.notes.shown = shown;
      c.diagShown = shown.length === 1 && Number(/after (\d+) played/.exec(shown[0])[1]) >= 10;
      c.counterReset = (await page.evaluate(() => window.__core.recall().played)) === 0;
      await page.screenshot({ path: `${out}/${name}-${scn}-karte.png` });
      // Wegwischen (Skip): keine Wertung, morgen wieder
      const cid = /^recall: shown (\S+) after/.exec(shown[0] ?? '')?.[1];
      await page.evaluate(() => window.__core.skipRecall());
      await sleep(200);
      const it = await page.evaluate((i) => window.__core.recall().state[i] ?? null, cid);
      const skipLine = (await page.evaluate(() => window.__core.diag())).find((x) => x.startsWith(`recall: skipped ${cid},`));
      c.skipWritesTomorrow = !!it && it.results.length === 0 && it.due - Date.parse('2026-10-22') >= 20 * 3_600_000 && /^recall: skipped \S+, back 2026-10-2[34]$/.test(skipLine ?? '');
      // Nächste Wische: keine zweite Karte
      await page.evaluate(() => window.__core.next());
      await sleep(700);
      c.noSecondCard = !(await cardUp(page));
      c.noErrors = errors.length === 0;
      if (errors.length) r.notes.errors = errors.slice(0, 3);
    } catch (e) {
      r.error = String(e);
    } finally {
      await browser?.close();
    }
  }
}
// Abstand schon erreicht, dann Hintergrund und Rückkehr: keine Karte bei der Rückkehr (Diag "held"), erst nach einem im Vordergrund gehörten Moment
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, scenario: 'held', checks: {}, notes: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { window.__ytSlow = true; });
    await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: POOL }));
    await page.goto(`${url}?now=2026-10-22&seed=3#k=${k}`);
    c.feedUp = await waitFor(page, () => !!window.__core?.moment() && window.__core.state() === 1);
    for (let i = 0; i < 3; i++) await watchAndNext(page);
    // Zähler auf Abstand erreicht setzen (Hook), Hintergrund und Rückkehr
    await page.evaluate(() => window.__core.setRecallPlayed(10));
    await setVisibility(page, 'hidden');
    await sleep(300);
    await setVisibility(page, 'visible');
    await sleep(400);
    c.noCardOnReturn = !(await cardUp(page));
    c.holdSet = (await page.evaluate(() => window.__core.recall().hold)) === true;
    // Sofort weiter, ohne im Vordergrund gehört zu haben: gehalten, einmal in der Diag
    await page.evaluate(() => window.__core.next());
    await sleep(700);
    c.stillNoCard = !(await cardUp(page));
    const held = (await page.evaluate(() => window.__core.diag())).filter((x) => x === 'recall: held (just back from bg)');
    c.diagHeldOnce = held.length === 1;
    // Ein Moment im Vordergrund gehört: beim Weiter kommt die Karte
    await watchAndNext(page);
    c.cardAfterHeard = await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'), null, 4000);
    c.noErrors = errors.length === 0;
  } catch (e) {
    r.error = String(e);
  } finally {
    await browser?.close();
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
let bad = 0;
for (const run of results.runs) {
  const fails = Object.entries(run.checks).filter(([, v]) => v !== true).map(([n]) => n);
  if (run.error || fails.length) bad++;
  console.log(JSON.stringify({ browser: run.browser, scenario: run.scenario, ok: !run.error && !fails.length, fails, error: run.error }));
}
process.exit(bad ? 1 : 0);
