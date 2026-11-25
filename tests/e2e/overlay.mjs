// E2E keine Abdeckung nach Abrufkarte und Reiterwechsel (Runde 40, Gerätefall 25.11. 07:37: grauer Schleier über dem Video-Reiter).
// Ablauf: Audio-Reiter, Abrufkarte offen, dann (a) direkt auf Video wechseln, (b) falsch beantworten und wechseln, (c) beantworten, wischen und wechseln,
// (d) beantworten, Next, wechseln. Danach darf keine Abrufkarte im DOM stehen, keine Vollbild-Ebene mit Deckkraft unter 1 oder halbtransparentem Hintergrund,
// an fünf Punkten kein halbtransparentes Element, und das Protokoll trägt die Zeile "ui: overlay <klasse> opacity=<x> ... after tab <reiter>".
// Aufruf: node tests/e2e/overlay.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';
import { onPageError } from './pageerrors.mjs';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-overlay'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const k = b64u(raw);
const mk = (i, f) => {
  const n = `${f}${String(i).padStart(9, '0')}`;
  return {
    id: `${n}:100`, videoId: n, start: 100, end: 160, channel: `Kanal ${i}`, videoTitle: 'Testvideo', area: ['brain', 'body', 'beat'][i % 3], topic: ['augen', 'retina', 'linse'][i % 3],
    hook: `Hook ${f} ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z',
    recall: { question: `Question for ${i}?`, options: [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`], correct: 0, why: `Because ${i}.` },
    ...(f === 'au' ? { form: 'audio', audio: true, hls: `https://stream.test/${i}.mp3` } : {}),
  };
};
const iv = crypto.getRandomValues(new Uint8Array(12));
const list = [...Array.from({ length: 20 }, (_, i) => mk(i, 'vd')), ...Array.from({ length: 20 }, (_, i) => mk(i, 'au'))];
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
const POOL = JSON.stringify({ v: 1, iv: b64u(iv), ct: b64u(ct) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VARIANTS = {
  open: async () => {},
  answered: async (p) => { await p.click('[data-testid=recall-option][data-correct="0"] >> nth=0'); await sleep(400); },
  swipe: async (p) => { await p.click('[data-testid=recall-option][data-correct="0"] >> nth=0'); await sleep(400); await p.evaluate(() => window.__core.next()); await sleep(700); },
  next: async (p) => { await p.click('[data-testid=recall-option][data-correct="0"] >> nth=0'); await sleep(400); await p.click('[data-testid=recall-next]'); await sleep(500); },
};

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  for (const [scn, run] of Object.entries(VARIANTS)) {
    const r = { browser: name, scenario: scn, checks: {}, notes: {} };
    results.runs.push(r);
    const c = r.checks;
    let browser;
    try {
      browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
      const ctx = await browser.newContext({ ...devices['iPhone 15'], viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
      await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
      await ctx.route('https://stream.test/**', (x) => x.abort());
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', onPageError(errors));
      await page.addInitScript(() => { window.__ytSlow = true; });
      await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: POOL }));
      await page.goto(`${url}?now=2026-10-22&seed=3#k=${k}`);
      await page.waitForSelector('[data-testid=form-switch]');
      await page.click('[data-testid=form-switch] >> text=Audio');
      await sleep(1500);
      c.cardShown = await page.evaluate(() => window.__core.showRecall(window.__core.moment().id));
      await sleep(600);
      c.cardUp = await page.evaluate(() => !!document.querySelector('[data-testid=recall-card]'));
      await page.screenshot({ path: `${out}/${name}-${scn}-1-karte.png` });
      await run(page);
      await page.click('[data-testid=form-switch] >> text=Video');
      await sleep(1500);
      await page.screenshot({ path: `${out}/${name}-${scn}-2-video.png` });
      c.noCardInDom = await page.evaluate(() => !document.querySelector('[data-testid=recall-card], [data-testid=recall-page], .vrecall-page, .sheet-backdrop'));
      // Keine Vollbild-Ebene mit Deckkraft unter 1 oder halbtransparentem Hintergrund
      const covers = await page.evaluate(() => window.__core.overlays());
      r.notes.covers = covers.map((l) => `${l.cls} op=${l.opacity.toFixed(2)} bg=${l.bgAlpha}`);
      // Erlaubt sind genau zwei Ebenen: .vfeed (Bühne, deckend) und .vambient (Absicht, Brief 06: weiches Vorschaubild mit Deckkraft 0.32 hinter der Karte). Alles andere ist eine stehengebliebene Abdeckung.
      c.noTranslucentCover = covers.every((l) => (l.cls === 'vfeed' && l.opacity >= 0.995 && l.bgAlpha === 1) || (l.cls === 'vambient' && Math.abs(l.opacity - 0.32) < 0.01));
      // An fünf Punkten: kein halbtransparenter Hintergrund und keine Deckkraft unter 1 in der ganzen Kette über dem Bild
      const pts = await page.evaluate(() => [[196, 80], [196, 300], [196, 520], [196, 700], [20, 840]].map(([x, y]) => document.elementsFromPoint(x, y).map((e) => {
        const cs = getComputedStyle(e);
        const m = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(cs.backgroundColor);
        return { cls: String(e.className).slice(0, 30), alpha: m ? Number(m[1]) : 1, bg: cs.backgroundColor, op: Number(cs.opacity) };
      })));
      const bad = pts.flat().filter((e) => (e.alpha > 0 && e.alpha < 1) || e.op < 0.995 && !/vposter|vambient|vtrack|vplay|vtap/.test(e.cls));
      r.notes.bad = bad.slice(0, 5);
      c.noTranslucentAtPoints = bad.length === 0;
      // Die Mitte zeigt den Feed-Hintergrund (fast schwarz), nicht einen grauen Schleier
      const mid = await page.evaluate(() => { const e = document.querySelector('.vfeed'); return e ? getComputedStyle(e).backgroundColor : ''; });
      c.feedStageDark = /^rgb\((\d+), (\d+), (\d+)\)$/.test(mid) && mid.match(/\d+/g).every((v) => Number(v) < 40);
      // Protokoll: Zeile je Vollbild-Ebene nach dem Reiterwechsel, Format fest, keine mit Deckkraft unter 1
      await sleep(700);
      const lines = (await page.evaluate(() => window.__core.diag())).filter((x) => x.startsWith('ui: overlay '));
      r.notes.lines = lines.slice(-4);
      c.diagLineAfterTab = lines.some((x) => /^ui: overlay \S+ opacity=\d\.\d\d bg=\d\.\d\d after tab feed\/video( px=\S+)?$/.test(x));
      c.diagNoTranslucent = lines.filter((x) => /after tab feed\/video/.test(x)).every((x) => /^ui: overlay (vfeed opacity=1\.00|vambient opacity=0\.32)/.test(x));
      // Gegenprobe: eine künstlich eingesetzte Schleier-Ebene (weiß, 35 %) muss die Prüfung erkennen, sonst wäre sie blind
      await page.evaluate(() => { const d = document.createElement('div'); d.className = 'stuck-test'; d.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(255,255,255,.35)'; document.body.appendChild(d); });
      c.controlDetected = (await page.evaluate(() => window.__core.overlays())).some((l) => l.cls === 'stuck-test');
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
