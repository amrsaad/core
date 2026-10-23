// E2E-Test des Video-Feeds gegen echtes YouTube. Läuft in GitHub Actions (Netzwerk), nicht in der Cloud-Session.
// Aufruf: node tests/e2e/video.mjs http://localhost:4173/core/ pipeline/out/e2e
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://localhost:4173/core/', out = 'pipeline/out/e2e'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const results = { url, at: new Date().toISOString(), runs: [] };

async function waitFor(page, fn, timeout = 20000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await page.evaluate(fn, arg)) return Date.now() - t0;
    } catch {}
    await page.waitForTimeout(50);
  }
  return -1;
}

async function swipeUp(page) {
  const vp = page.viewportSize();
  const x = vp.width / 2, y0 = vp.height * 0.7, y1 = vp.height * 0.25;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y0 + ((y1 - y0) * i) / 6);
  await page.mouse.up();
}

// Einbettbarkeit laut oEmbed (401 = Einbettung gesperrt), getrennt vom Player-Verhalten im Runner
const pool = await (await fetch(new URL('videos/pool.json', url))).json();
results.oembed = {};
for (const v of pool.videos.slice(0, 8)) {
  const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/shorts/' + v.id)}&format=json`);
  results.oembed[v.id] = r.status;
}
console.log('oEmbed', JSON.stringify(results.oembed));

const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const run = { browser: name, ok: false, steps: {} };
  results.runs.push(run);
  const browser = await type.launch(name === 'chromium' ? { args: ['--autoplay-policy=no-user-gesture-required'] } : {});
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 15'], hasTouch: false });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    run.steps.feedReady = await waitFor(page, () => !!window.__core?.video());
    run.steps.firstVideo = await page.evaluate(() => window.__core?.video());
    run.steps.firstPlayingMs = await waitFor(page, () => window.__core?.state() === 1, 25000);
    run.steps.loadToPlayingMs = run.steps.firstPlayingMs >= 0 ? Date.now() - t0 : -1;
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${name}-1-erstes-video.png` });
    // Ohne Vorschaubild: zeigt, was der YouTube-Player selbst gerade anzeigt
    await page.addStyleTag({ content: '.vposter{display:none!important}' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-1b-player-ohne-poster.png` });
    await page.addStyleTag({ content: '.vposter{display:block!important}' });
    run.steps.diagStart = await page.evaluate(() => window.__core?.diag?.());

    // Wischen: Wechsel bis PLAYING des nächsten Videos
    const before = await page.evaluate(() => window.__core.idx());
    const s0 = Date.now();
    await swipeUp(page);
    const changed = await waitFor(page, (b) => window.__core.idx() === b + 1, 3000, before);
    const playing = await waitFor(page, () => window.__core.state() === 1, 5000);
    run.steps.swipeIdxMs = changed;
    run.steps.swipeToPlayingMs = playing >= 0 ? Date.now() - s0 : -1;
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${name}-2-nach-wischen.png` });

    // Endscreen-Schutz: kurz vor Ende springen, Screenshots vor und nach dem Ende
    const [, dur] = await page.evaluate(() => window.__core.time());
    run.steps.duration = dur;
    const idxEnd = await page.evaluate(() => window.__core.idx());
    await page.evaluate((d) => window.__core.seek(Math.max(0, d - 2.2)), dur);
    await waitFor(page, () => window.__core.state() === 1, 5000);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${name}-3-kurz-vor-ende.png` });
    const advanced = await waitFor(page, (b) => window.__core.idx() === b + 1, 6000, idxEnd);
    run.steps.autoNextAfterEndMs = advanced;
    // Direkt nach dem Wechsel und noch einmal etwas später fotografieren
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${name}-4-direkt-nach-ende.png` });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${name}-5-nach-ende.png` });
    run.steps.nextPlaying = (await page.evaluate(() => window.__core.state())) === 1;

    // ENDED-Pfad: genau ans Ende springen
    const idxEnded = await page.evaluate(() => window.__core.idx());
    const [, d2] = await page.evaluate(() => window.__core.time());
    await page.evaluate((d) => window.__core.seek(d), d2);
    run.steps.endedJumpMs = await waitFor(page, (b) => window.__core.idx() === b + 1, 6000, idxEnded);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-6-nach-ended.png` });

    run.steps.pageErrors = errors;
    run.steps.diagEnd = await page.evaluate(() => window.__core?.diag?.());
    run.ok = run.steps.firstPlayingMs >= 0 && run.steps.swipeToPlayingMs >= 0 && run.steps.swipeToPlayingMs < 1000 && run.steps.autoNextAfterEndMs >= 0 && run.steps.endedJumpMs >= 0;
  } catch (e) {
    run.error = String(e);
    try { run.steps.diagEnd = await (await browser.contexts()[0].pages()[0]).evaluate(() => window.__core?.diag?.()); } catch {}
  }
  await browser.close();
  console.log(JSON.stringify(run));
}

writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
