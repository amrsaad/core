// Schlüsselsicherung (Max, 26.10.2026): Schlüssel liegt in IndexedDB und Cache Storage, jeder Speicher stellt den anderen wieder her.
// Eigener Lauf, RUNS-mal hintereinander je Browser. Stabil heißt: alle Läufe grün. Ein roter Lauf ist ein Fehler der App.
// Aufruf: node tests/e2e/keyrestore.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-keyrestore'] = process.argv.slice(2);
const RUNS = Number(process.env.RUNS ?? 3);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const m = (i) => ({ id: `kr${i}:1`, videoId: `krtest${String(i).padStart(5, "0")}`, start: 1, end: 60, channel: 'Test', videoTitle: 'Test', area: 'brain', topic: 'augen', hook: `Test ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z' });
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: null, moments: Array.from({ length: 6 }, (_, i) => m(i)) })));
mkdirSync('dist/moments', { recursive: true });
writeFileSync('dist/moments/pool.enc', JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') }));
const k = Buffer.from(raw).toString('base64url');

// Donnerstag, damit kein Wochenrückblick dazwischenkommt
const APP = url + '?now=2026-10-22';
const unlocked = (page) =>
  page
    .waitForFunction(() => !!window.__core?.moment(), null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
const inCache = (page) => page.evaluate(async () => !!(await (await caches.open('core-key')).match(new URL('/core/__key', location.origin).href)));
const inIdb = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('core-key', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('k');
        r.onsuccess = () => {
          const g = r.result.transaction('k').objectStore('k').get('raw');
          g.onsuccess = () => { r.result.close(); res(!!g.result); };
          g.onerror = () => { r.result.close(); res(false); };
        };
        r.onerror = () => res(false);
      }),
  );

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  for (let run = 1; run <= RUNS; run++) {
    const r = { browser: name, run, checks: {} };
    results.runs.push(r);
    const c = r.checks;
    let browser;
    try {
      browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
      // Service Worker aus (wie in moments.mjs): Er holt die per Route abgebrochenen Vorschaubilder selbst und meldet das als unbehandelte NetworkError. Geprüft wird hier nur die Schlüsselsicherung, sie braucht den Worker nicht.
      const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
      await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
      await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
      const errors = [];
      ctx.on('weberror', (e) => errors.push(String(e.error())));

      // 1. Freischalten, beide Kopien angelegt
      let p = await ctx.newPage();
      await p.goto(`${APP}#k=${k}`);
      c.unlocked = await unlocked(p);
      c.savedInCache = await inCache(p);
      c.savedInIdb = await inIdb(p);
      await p.close();

      // 2. IndexedDB weg, Cache bleibt: App schaltet sich selbst frei und trägt IndexedDB nach
      p = await ctx.newPage();
      await p.goto(url + 'icon.svg');
      r.deleteIdb = await p.evaluate(() => new Promise((res) => { const q = indexedDB.deleteDatabase('core-key'); q.onsuccess = () => res('ok'); q.onerror = () => res('error'); q.onblocked = () => res('blocked'); }));
      c.idbDeleted = r.deleteIdb === 'ok';
      await p.goto(APP);
      c.restoredFromCache = await unlocked(p);
      c.idbRewritten = await inIdb(p);
      await p.screenshot({ path: `${out}/${name}-${run}-nach-wiederherstellung.png` });
      await p.close();

      // 3. Cache weg, IndexedDB bleibt: App läuft und trägt die Cache-Kopie nach
      p = await ctx.newPage();
      await p.goto(url + 'icon.svg');
      await p.evaluate(() => caches.delete('core-key'));
      await p.goto(APP);
      c.runsWithoutCache = await unlocked(p);
      c.cacheRewritten = await p.waitForFunction(async () => !!(await (await caches.open('core-key')).match(new URL('/core/__key', location.origin).href)), null, { timeout: 5000 }).then(() => true).catch(() => false);
      await p.close();
      c.noPageErrors = errors.length === 0;
      r.errors = errors.slice(0, 3);
    } catch (e) {
      r.error = String(e);
    }
    await browser?.close();
    r.ok = !r.error && Object.values(c).every((v) => v === true);
    console.log(JSON.stringify(r));
  }
}
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
const bad = results.runs.filter((x) => !x.ok);
console.log(bad.length ? `NICHT STABIL: ${bad.length} von ${results.runs.length} Läufen rot` : `STABIL: ${results.runs.length} von ${results.runs.length} Läufen grün`);
if (bad.length) process.exit(1);
