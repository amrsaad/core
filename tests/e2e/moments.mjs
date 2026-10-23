// E2E des Momente-Feeds mit nachgebauter YouTube-API (echte Wiedergabe ist im Runner nicht möglich, Fehler 150).
// Erzeugt einen eigenen Testschlüssel und einen verschlüsselten Testpool ohne persönliche Daten in dist/moments/pool.enc.
// Aufruf: node tests/e2e/moments.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-moments'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');

// Testpool: erster Block Beat (mit und ohne forYou), dann Brain und Body
const mk = (i, area, topic, forYou) => ({ id: `test${String(i).padStart(7, '0')}:${100}`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20, channel: `Kanal ${area} ${i % 4}`, videoTitle: 'Testvideo', area, topic, hook: `Testmoment ${i} ${area}`, forYou, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', cues: [[0, 'Untertitel eins, If Apple were like everyone else, a marketing message'] , [2, 'Untertitel zwei']] });
const moments = [];
for (let i = 0; i < 12; i++) moments.push(mk(i, 'beat', 'islam', i % 2 === 0 ? 'Testzeile für dich' : undefined));
for (let i = 12; i < 40; i++) moments.push(mk(i, 'brain', 'augen'));
for (let i = 40; i < 55; i++) moments.push(mk(i, 'body', 'kraft'));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
mkdirSync('dist/moments', { recursive: true });
writeFileSync('dist/moments/pool.enc', JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') }));
const k = Buffer.from(raw).toString('base64url');

const results = { at: new Date().toISOString(), runs: [] };
const waitFor = async (page, fn, arg, timeout = 8000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};

const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    const ctx = await browser.newContext({ ...devices['iPhone 15'] });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Ohne Schlüssel gesperrt
    await page.goto(url + '?now=2026-10-23');
    c.lockedWithoutKey = await waitFor(page, () => document.body.innerText.includes('not unlocked'));

    // Freischalten über #k=, Fragment wird entfernt
    await page.goto('about:blank');
    await page.goto(`${url}?now=2026-10-23#k=${k}`);
    c.feedAfterDecrypt = await waitFor(page, () => !!window.__core?.moment());
    c.fragmentRemoved = !page.url().includes('#k=');
    c.firstArea = await page.evaluate(() => window.__core.moment().area);
    c.firstPlaying = await waitFor(page, () => window.__core.state() === 1);
    c.captionShown = await waitFor(page, () => !!document.querySelector('[data-testid=caption]')?.textContent?.startsWith('Untertitel'));
    await page.screenshot({ path: `${out}/${name}-1-start.png` });

    // Tipp: Ton an
    const vp = page.viewportSize();
    await page.mouse.click(vp.width / 2, vp.height / 2);
    c.soundOn = await waitFor(page, () => window.__ytlog.includes('unmute'));

    // 4 Momente durchlaufen: Für dich genau dann, wenn forYou gesetzt ist; Ende genau bei end
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const m = await page.evaluate(() => ({ ...window.__core.moment(), idx: window.__core.idx() }));
      await waitFor(page, (j) => window.__core.forYou() || window.__core.idx() !== j, m.idx, 15000);
      const fy = await page.evaluate(() => window.__core.forYou());
      const t = await page.evaluate(() => window.__core.time());
      if (fy) {
        if (!seen.some((x) => x.fy)) await page.screenshot({ path: `${out}/${name}-2-fuer-dich.png` });
        await page.click('[data-testid="foryou"]');
      }
      await waitFor(page, (j) => window.__core.idx() === j + 1, m.idx);
      seen.push({ id: m.id, has: !!m.forYou, fy, stoppedAtEnd: !fy || t <= m.end + 0.01 });
    }
    c.forYouExactlyWhenSet = seen.every((x) => x.has === x.fy);
    c.sawBothKinds = seen.some((x) => x.has) && seen.some((x) => !x.has);
    c.stoppedAtEnd = seen.every((x) => x.stoppedAtEnd);
    c.autoNext = seen.length === 4;
    r.sequence = seen;

    // Wischen wechselt
    const before = await page.evaluate(() => window.__core.idx());
    await page.mouse.move(vp.width / 2, vp.height * 0.7);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(vp.width / 2, vp.height * (0.7 - 0.09 * i));
    await page.mouse.up();
    c.swipeNext = await waitFor(page, (b) => window.__core.idx() === b + 1, before);
    // Gedrückt halten: 2x, Loslassen: normal
    await page.mouse.move(vp.width / 2, vp.height * 0.5);
    await page.mouse.down();
    c.holdFast = await waitFor(page, () => [...document.querySelectorAll("span")].some((s) => s.textContent === "2x"));
    await page.mouse.up();
    c.releaseNormal = await waitFor(page, () => ![...document.querySelectorAll("span")].some((s) => s.textContent === "2x"));

    // Doppeltipp speichert (für den Wochenrückblick)
    await page.mouse.dblclick(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(400);

    // Endscreen-Schutz: über jedem Player, der nicht gerade abspielt (also auch nach ENDED), liegt das Vorschaubild
    let checksDone = 0, violations = 0, endedSeen = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const res = await page.evaluate(() => {
        const st = window.__core.slots();
        const dom = [...document.querySelectorAll('.vslot')];
        return st.map((x, i) => ({ st: x.st, current: dom[i]?.getAttribute('aria-hidden') === 'false', poster: !!dom[i]?.querySelector('.vposter') }));
      });
      for (const x of res) {
        checksDone++;
        if (x.st === 0) endedSeen++;
        if ((x.st !== 1 || !x.current) && !x.poster) violations++;
      }
      await page.waitForTimeout(40);
    }
    c.posterWheneverNotPlaying = violations === 0 && checksDone > 0;
    r.posterCheck = { checksDone, violations, endedSeen };
    await page.screenshot({ path: `${out}/${name}-3-nach-ende.png` });

    // Simulierter Sonntag: Wochenrückblick mit dem gespeicherten Moment.
    // Erste Seite schließen: zwei offene Tabs würden sich gegenseitig den gespeicherten Zustand überschreiben.
    await page.waitForTimeout(500);
    await page.close();
    const p2 = await ctx.newPage();
    await p2.goto(url + '?now=2026-10-25');
    c.weeklyReviewOnSunday = await waitFor(p2, () => !!document.querySelector('[data-testid="weekly-review"]'));
    c.reviewListsSaved = await p2.evaluate(() => document.querySelectorAll('[data-testid="weekly-review"] li').length >= 1);
    await p2.screenshot({ path: `${out}/${name}-4-wochenrueckblick.png` });
    await p2.click('text=Continue to feed');
    c.feedAfterReview = await waitFor(p2, () => !!window.__core?.moment());
    await p2.waitForTimeout(800); // Zustand wird verzögert gespeichert
    await p2.close();
    const p3 = await ctx.newPage();
    await p3.goto(url + '?now=2026-10-25');
    c.reviewOnlyOnce = await waitFor(p3, () => !!window.__core?.moment()) && !(await p3.$('[data-testid="weekly-review"]'));
    c.pageErrors = errors.length;
  } catch (e) {
    r.error = String(e);
  }
  await browser?.close();
  r.ok = !r.error && Object.entries(c).every(([key, v]) => (key === 'firstArea' ? v === 'beat' : key === 'pageErrors' ? v === 0 : v === true));
  console.log(JSON.stringify(r));
}
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
if (results.runs.some((x) => !x.ok)) process.exit(1);
