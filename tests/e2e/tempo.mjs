// E2E Tempo als gespeicherte Einstellung (Pfeiler 17, Max 30.10.2026). Langes Drücken (500 ms) schaltet 1x, 1.5x, 2x, 1x. Der Wert bleibt über
// Reiterwechsel, Settings, Feedback-Blatt und Neustart, die Anzeige "1.5x" oder "2x" steht oben neben den Reitern, Tipp darauf schaltet weiter.
// Zwei Pools: Streams (eigenes Media-Element) und YouTube (nachgebaute API, setPlaybackRate steht im __ytlog).
// Aufruf: node tests/e2e/tempo.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-tempo'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const k = b64u(raw);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: b64u(iv), ct: b64u(ct) });
};
const mk = (i, hls) => ({
  id: `tp${String(i).padStart(9, '0')}:100`, videoId: `tp${String(i).padStart(9, '0')}`, thumb: `${url}apple-touch-icon.png?m=${i}`, start: 100, end: 1000,
  channel: `Kanal ${i % 4}`, videoTitle: 'Testvideo', area: 'brain', topic: ['augen', 'retina', 'linse'][i % 3], hook: `Tempo ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z',
  cues: [[0, `Erste Zeile ${i}`]], ...(hls ? { hls: `https://stream.test/tp${String(i).padStart(9, '0')}.m3u8` } : {}),
});
const POOLS = { stream: await encPool(Array.from({ length: 12 }, (_, i) => mk(i, true))), youtube: await encPool(Array.from({ length: 12 }, (_, i) => mk(100 + i, false))) };

const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rate = (page) => page.evaluate(() => window.__core?.rate?.() ?? null);
/** Gespeicherter Stand (IndexedDB core/kv/state), nicht der Speicher der Seite */
const stored = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const rq = indexedDB.open('core');
        rq.onerror = () => res(null);
        rq.onsuccess = () => {
          try {
            const g = rq.result.transaction('kv').objectStore('kv').get('state');
            g.onsuccess = () => res(g.result?.settings?.playbackRate ?? null);
            g.onerror = () => res(null);
          } catch { res(null); }
        };
      }),
  );
const chip = (page) => page.evaluate(() => { const b = document.querySelector('[data-testid=rate]'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, w: r.width, h: r.height, onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 }; });
/** Alle laufenden Player stehen auf dem Tempo: YouTube über __ytlog, Streams über das Media-Element */
const playersAt = (page, kind, want) =>
  waitFor(page, ([kd, w]) => {
    if (kd === 'youtube') {
      const r = window.__ytlog.filter((x) => x.startsWith('rate ')).map((x) => Number(x.slice(5)));
      return r.length > 0 && r[r.length - 1] === w;
    }
    const playing = [...document.querySelectorAll('video,audio')].filter((e) => !e.paused);
    return playing.length > 0 && playing.every((e) => e.playbackRate === w);
  }, [kind, want], 6000);
/** Tipp auf die Anzeige: sie nimmt keine Zeiger an, der Tipp geht an die Gesten-Ebene und wird dort erkannt. Darum Mausklick auf ihre Mitte. */
const tapChip = async (page) => {
  const b = await page.evaluate(() => { const r = document.querySelector('[data-testid=rate]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(b.x, b.y);
};
const longPress = async (page, ms = 700) => {
  await page.mouse.move(190, 420);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
};

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  for (const [kind, poolBody] of Object.entries(POOLS)) {
    const r = { browser: name, pool: kind, checks: {}, notes: {} };
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
      await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
      await page.goto(`${url}?now=2026-10-22&seed=3#k=${k}`);
      c.feedUp = await waitFor(page, () => !!window.__core?.moment());
      c.playing = await waitFor(page, () => window.__core.state() === 1);
      c.noHoldHint = !(await page.evaluate(() => document.body.innerText.includes('Hold the video')));
      c.defaultRate1 = (await rate(page)) === 1 && (await chip(page)) === null;
      const id0 = await page.evaluate(() => window.__core.moment().id);

      // Langes Drücken: 1.5x, Anzeige binnen 150 ms nach dem Erkennen (500 ms), Ziel 48 pt
      await page.evaluate(() => {
        window.__t = { down: 0, seen: 0 };
        addEventListener('pointerdown', () => { window.__t.down = performance.now(); }, true);
        new MutationObserver(() => { if (!window.__t.seen && document.querySelector('[data-testid=rate]')) window.__t.seen = performance.now(); }).observe(document.body, { childList: true, subtree: true });
      });
      await longPress(page);
      c.longPress15 = await waitFor(page, () => window.__core.rate() === 1.5, null, 3000);
      const ch = await chip(page);
      r.notes.chip = ch;
      c.chipShows15 = ch?.text === '1.5x' && ch.onScreen;
      c.chipTarget48 = !!ch && ch.w >= 48 && ch.h >= 48;
      const t = await page.evaluate(() => window.__t);
      r.notes.feedbackMs = Math.round(t.seen - t.down - 500);
      c.feedbackWithin150 = t.seen > 0 && t.seen - t.down - 500 <= 150;
      c.playersAt15 = await playersAt(page, kind, 1.5);
      c.sameMomentStillPlaying = (await page.evaluate(() => window.__core.moment().id)) === id0 && (await page.evaluate(() => window.__core.state())) === 1;
      c.storedLocally = false;
      for (let i = 0; i < 20 && !c.storedLocally; i++) { c.storedLocally = (await stored(page)) === 1.5; if (!c.storedLocally) await sleep(200); }
      await page.screenshot({ path: `${out}/${name}-${kind}-1-tempo-15.png` });

      // Zweites langes Drücken: 2x, drittes: wieder 1x ohne Anzeige
      await longPress(page);
      c.longPress2 = await waitFor(page, () => window.__core.rate() === 2, null, 3000) && (await chip(page))?.text === '2x';
      c.playersAt2 = await playersAt(page, kind, 2);
      await longPress(page);
      c.longPress1 = await waitFor(page, () => window.__core.rate() === 1, null, 3000) && (await chip(page)) === null;
      c.playersAt1 = await playersAt(page, kind, 1);

      // Tipp auf die Anzeige schaltet weiter: 1.5x per Druck, dann Tipp auf 2x, Tipp auf 1x? Nein: der Tipp schaltet im Kreis, bei 1x gibt es keine Anzeige
      await longPress(page);
      c.backTo15 = await waitFor(page, () => window.__core.rate() === 1.5, null, 3000);
      await tapChip(page);
      c.tapAdvancesTo2 = await waitFor(page, () => window.__core.rate() === 2, null, 3000) && (await chip(page))?.text === '2x';
      await tapChip(page);
      c.tapAdvancesTo1 = await waitFor(page, () => window.__core.rate() === 1, null, 3000) && (await chip(page)) === null;
      c.tapDidNotChangeMoment = (await page.evaluate(() => window.__core.moment().id)) === id0;
      await longPress(page);
      c.rate15Again = await waitFor(page, () => window.__core.rate() === 1.5, null, 3000);

      // Ein Wisch, der auf der Anzeige beginnt, geht durch (die Anzeige schluckt keine Gesten) und ändert das Tempo nicht
      {
        await page.evaluate(() => window.__core.next());
        await waitFor(page, () => window.__core.idx() === 1 && window.__core.state() === 1, null, 8000);
        await sleep(500);
        const idx0 = await page.evaluate(() => window.__core.idx());
        const b = await page.evaluate(() => { const r = document.querySelector('[data-testid=rate]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        await page.mouse.move(b.x, b.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y + 260, { steps: 8 });
        await page.mouse.up();
        c.swipeFromChipMoves = await waitFor(page, (i) => window.__core.idx() === i - 1, idx0, 5000);
        c.swipeFromChipKeepsRate = (await rate(page)) === 1.5;
        await waitFor(page, () => window.__core.state() === 1, null, 5000);
      }
      // Reiterwechsel (Audio hat in diesem Pool keine Momente, der Wert bleibt trotzdem), zurück auf Video
      await page.click('[data-testid=form-switch] >> text=Audio');
      await sleep(400);
      c.afterTabSwitchStored = (await stored(page)) === 1.5;
      await page.click('[data-testid=form-switch] >> text=Video');
      c.backOnVideo = await waitFor(page, () => !!window.__core?.moment() && window.__core.state() === 1);
      c.tabKeeps15 = (await rate(page)) === 1.5 && (await chip(page))?.text === '1.5x';
      c.playersAfterTab = await playersAt(page, kind, 1.5);

      // Settings: Wert steht dort, nach dem Zurückgehen unverändert, kein Hinweistext zum Halten
      await page.click('nav [aria-label=Settings]');
      await page.waitForSelector('[data-testid=speed]');
      c.settingsShows15 = (await page.inputValue('[data-testid=speed]')) === '1.5';
      c.settingsOptions = await page.evaluate(() => [...document.querySelectorAll('[data-testid=speed] option')].map((o) => o.value).join(',') === '1,1.5,2');
      c.settingsNoHoldText = !(await page.evaluate(() => document.body.innerText.includes('Hold the video')));
      await page.click('nav [aria-label=Feed]');
      c.backFromSettings = await waitFor(page, () => window.__core.state() === 1);
      c.settingsKeeps15 = (await rate(page)) === 1.5;
      c.playersAfterSettings = await playersAt(page, kind, 1.5);

      // Feedback-Blatt
      await page.evaluate(() => window.__core.openNote());
      c.noteOpen = await waitFor(page, () => !!document.querySelector('[data-testid=note-sheet]'), null, 4000);
      await sleep(300);
      c.noteKeeps15 = (await rate(page)) === 1.5 && (await stored(page)) === 1.5;
      await page.keyboard.press('Escape');
      await page.mouse.click(190, 60).catch(() => {});
      await sleep(300);

      // Neustart
      await page.screenshot({ path: `${out}/${name}-${kind}-2-vor-neustart.png` });
      await page.reload();
      c.reloaded = await waitFor(page, () => !!window.__core?.moment());
      c.restartKeeps15 = await waitFor(page, () => window.__core.rate() === 1.5, null, 5000) && (await chip(page))?.text === '1.5x';
      c.restartPlaying = await waitFor(page, () => window.__core.state() === 1);
      c.restartPlayersAt15 = await playersAt(page, kind, 1.5);
      await page.screenshot({ path: `${out}/${name}-${kind}-3-nach-neustart.png` });
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
  console.log(JSON.stringify({ browser: run.browser, pool: run.pool, ok: !run.error && !fails.length, fails, error: run.error, feedbackMs: run.notes.feedbackMs }));
}
process.exit(bad ? 1 : 0);
