// E2E Abrufkarten-Warteschlange (Pfeiler 19, Max 30.10.2026). Eine fällige Karte erscheint nie, solange der Feed nicht im Vordergrund und
// sichtbar ist (Settings, Saved, Feedback-Blatt, Hintergrund). Sie wartet in recallQueue, Rückkehr: eine Karte sofort, vor dem nächsten Wisch.
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
  await page.evaluate(() => { for (const d of document.querySelectorAll('div')) if (d.__player) d.__player.seekTo(159); });
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
      // Drei Momente zu über 80 % geschaut, noch keine Karte (kommt nach jedem 4.)
      for (let i = 0; i < 3; i++) await watchAndNext(page);
      c.threeSeenNoCard = !(await cardUp(page)) && (await page.evaluate(() => window.__core.recall().sessionSeen)) === 3;
      // Feed verlassen oder verdecken, dann der vierte Wisch: die Karte wäre fällig
      await sc.open(page);
      await sleep(300);
      const idxBefore = await page.evaluate(() => window.__core.idx());
      await page.evaluate(() => window.__core.next());
      await sleep(800);
      c.noCardWhileAway = !(await cardUp(page)) && !(await page.evaluate(() => window.__core.recall().open));
      const queued = await page.evaluate(() => window.__core.recallQueue());
      r.notes.queued = queued;
      c.queuedOne = queued.length === 1;
      const id = queued[0]?.id;
      c.diagQueued = (await page.evaluate(() => window.__core.diag())).some((x) => x === `recall: queued ${id}` || x === `recall: queued ${id} (bg)`);
      c.soundAndFeedContinue = (await page.evaluate(() => window.__core.idx())) === idxBefore + 1;
      // Zurück: die Karte erscheint sofort, ohne dass gewischt wird
      await sc.close(page);
      c.cardOnReturn = await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'), null, 4000);
      c.cardBeforeNextSwipe = (await page.evaluate(() => window.__core.idx())) === idxBefore + 1;
      c.cardIsTheQueuedMoment = !!id && (await page.evaluate((i) => document.querySelector('[data-testid=recall-card]')?.textContent?.includes(`Question for ${Number(i.slice(2, 11))}?`) ?? false, id));
      c.queueEmptyAfterShow = (await page.evaluate(() => window.__core.recallQueue())).length === 0;
      c.diagShown = (await page.evaluate(() => window.__core.diag())).some((x) => x === `recall: shown ${id} from queue`);
      await page.screenshot({ path: `${out}/${name}-${scn}-karte.png` });
      // Karte schließen, nächster Wisch: keine weitere Karte (Warteschlange leer, nächste Karte erst nach 4 Momenten)
      await page.evaluate(() => window.__core.skipRecall());
      await sleep(200);
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
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
let bad = 0;
for (const run of results.runs) {
  const fails = Object.entries(run.checks).filter(([, v]) => v !== true).map(([n]) => n);
  if (run.error || fails.length) bad++;
  console.log(JSON.stringify({ browser: run.browser, scenario: run.scenario, ok: !run.error && !fails.length, fails, error: run.error }));
}
process.exit(bad ? 1 : 0);
