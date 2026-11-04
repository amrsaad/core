// Layout-Gate (Entscheidung 43, Brief 06): vier Breiten, drei Stimmungen, Überlauf, Stimmung am html-Element, Kontrast AA der sichtbaren Texte, Berührflächen 44 px.
// Schreibt Screenshots nach <ausgabeordner>/<block>/ und results.json. Bricht mit Exit-Code 1 ab, wenn eine Prüfung rot ist.
// Aufruf: node tests/e2e/layout.mjs <url> <ausgabeordner> [block]   (vorher npm run build, dann vite preview)
// Browser: E2E_CHROME=/pfad/zu/chrome nutzt ein vorhandenes Chrome statt Playwright-Chromium.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-layout', block = 'run'] = process.argv.slice(2);
const dir = `${out}/${block}`;
mkdirSync(dir, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '834', width: 834, height: 1194 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];
const MOODS = ['beat', 'body', 'brain'];
const SCHEMES = ['dark', 'light'];

const EX = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the checked excerpt, long enough to wrap over several lines in the reading column.`).join('\n');
const mk = (i, area, extra = {}) => ({
  id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20,
  channel: `Channel ${area} (Dr. Test ${i % 4})`, videoTitle: `Test video ${i}`, area, topic: 'augen', hook: `Test moment ${i} ${area}`, kind: 'regel',
  createdAt: '2026-10-20T00:00:00Z', cues: [[0, 'Caption one, a marketing message'], [2, 'Caption two']], excerpt: EX,
  context: `Context sentence one for moment ${i}. Context sentence two names a term.`,
  recall: { question: `What follows from moment ${i}?`, options: [`Wrong A ${i}`, `Right ${i}`, `Wrong B ${i}`], correct: 1, why: `Because ${i} says so.` }, ...extra,
});
async function pool(area) {
  const moments = Array.from({ length: 14 }, (_, i) => mk(i, area));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
  return { body: JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') }), k: Buffer.from(raw).toString('base64url') };
}

const results = { at: new Date().toISOString(), block, checks: {}, failures: [] };
const fail = (name, detail) => { results.checks[name] = false; results.failures.push(`${name}: ${detail}`); };
const ok = (name) => { if (!(name in results.checks)) results.checks[name] = true; };

const launch = { headless: true };
if (process.env.E2E_CHROME) launch.executablePath = process.env.E2E_CHROME;
const browser = await chromium.launch(launch);

/** Prüfungen im Seitenkontext: Überlauf, Berührflächen, Kontrast der Textknoten */
const probe = () => {
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const blend = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1];
  const backdrop = (el) => { const stack = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let b = [0, 0, 0, 1]; for (const c of stack.reverse()) b = blend(c, b); return b; };
  const W = innerWidth, H = innerHeight;
  const res = { overflowX: document.documentElement.scrollWidth > W + 1, outside: [], small: [], lowContrast: [], mood: document.documentElement.dataset.mood ?? null, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    if (r.right > W + 1 || r.left < -1) {
      // Karten außerhalb des Bildschirms (Wischfolge, Offscreen-Slots) zählen nicht
      let anc = el, off = false; for (; anc; anc = anc.parentElement) if (getComputedStyle(anc).transform !== 'none' && anc.className && /vslot/.test(String(anc.className))) { off = true; break; }
      if (!off && !el.closest('[aria-hidden="true"]') && !el.closest('.vslot')) res.outside.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
    }
    if (el.matches('button, a[href], [role="button"], input, [role="radio"]') && (r.width < 44 - 0.5 || r.height < 44 - 0.5) && r.top < H && r.bottom > 0 && r.left < W) res.small.push(`${el.tagName}.${String(el.className).slice(0, 30)}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 12)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    // Textknoten direkt unter dem Element
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && r.top < H && r.bottom > 0 && !el.closest('.vslot')) {
      const fg = parse(cs.color); if (!fg) continue;
      const bg = backdrop(el); const f = blend(fg, bg);
      const a = lum(f), b = lum(bg); const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(cs.fontSize); const bold = +cs.fontWeight >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (cr < need) res.lowContrast.push(`${el.tagName}.${String(el.className).slice(0, 30)} "${el.textContent.trim().slice(0, 20)}" ${cr.toFixed(2)}<${need}`);
    }
  }
  return res;
};

async function open(area, vp, scheme, p) {
  const cx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, serviceWorkers: 'block', deviceScaleFactor: 1, colorScheme: scheme });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const pg = await cx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  await pg.addInitScript(() => { window.__ytSlow = true; });
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: p.body }));
  await pg.goto(`${url}?now=2026-10-23&seed=3#k=${p.k}`);
  try { await pg.waitForFunction(() => !!window.__core?.moment(), null, { timeout: 8000 }); } catch { fail(`load ${area} ${vp.name}`, 'Feed lädt nicht'); }
  await pg.waitForTimeout(700);
  return { cx, pg, errors };
}

async function check(pg, label, { skipSmall = false } = {}) {
  const r = await pg.evaluate(probe);
  if (r.overflowX) fail(`${label} kein Seitwärtsscrollen`, 'scrollWidth größer als Fenster'); else ok(`${label} kein Seitwärtsscrollen`);
  if (r.outside.length) fail(`${label} nichts außerhalb`, r.outside.slice(0, 4).join(' | ')); else ok(`${label} nichts außerhalb`);
  if (r.lowContrast.length) fail(`${label} Kontrast AA`, r.lowContrast.slice(0, 4).join(' | ')); else ok(`${label} Kontrast AA`);
  if (!skipSmall) { if (r.small.length) fail(`${label} Berührfläche 44 px`, r.small.slice(0, 4).join(' | ')); else ok(`${label} Berührfläche 44 px`); }
  return r;
}

const only = process.env.LAYOUT_ONLY ? process.env.LAYOUT_ONLY.split(',') : null; // z. B. LAYOUT_ONLY=feed
const strict = process.env.LAYOUT_STRICT !== '0';
for (const area of MOODS) {
  const p = await pool(area);
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      if (area !== 'brain' && scheme === 'light') continue; // Beat und Body sind immer dunkel, Hell prüft nur Brain und neutral
      const { cx, pg, errors } = await open(area, vp, scheme, p);
      const tag = `${area} ${vp.name} ${scheme}`;
      const r = await check(pg, `feed ${tag}`, { skipSmall: !strict });
      if (r.mood !== area) fail(`stimmung ${tag}`, `data-mood ist ${r.mood}`); else ok(`stimmung ${tag}`);
      await pg.screenshot({ path: `${dir}/feed-${area}-${vp.name}${scheme === 'light' ? '-hell' : ''}.png` });
      if (area === 'body' || (area === 'brain' && scheme === 'light')) {
        // neutrale Screens: Saved und Settings
        for (const [id, name, desk] of [['saved', 'Saved', 'desk-saved'], ['settings', 'Settings', 'desk-settings']]) {
          const btn = vp.width >= 1181 ? pg.locator(`[data-testid="${desk}"]`) : pg.locator(`nav [aria-label="${name}"]`);
          if (vp.width < 1181 && id === 'saved') { await pg.mouse.click(vp.width / 2, vp.height / 2); await pg.waitForTimeout(400); }
          try { await btn.first().click({ timeout: 2500, force: true }); await pg.waitForTimeout(600); } catch { fail(`${id} öffnen ${tag}`, 'Schaltfläche nicht erreichbar'); continue; }
          if (scheme === 'dark' || area === 'body') {
            await check(pg, `${id} ${tag}`, { skipSmall: !strict });
            await pg.screenshot({ path: `${dir}/${id}-${vp.name}${scheme === 'light' ? '-hell' : ''}.png` });
          }
          try { await btn.first().click({ timeout: 1500, force: true }); } catch {}
        }
      }
      if (errors.length) fail(`js-fehler ${tag}`, errors[0]); else ok(`js-fehler ${tag}`);
      await cx.close();
    }
  }
}
await browser.close();
writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
const bad = Object.entries(results.checks).filter(([, v]) => !v).length;
console.log(`layout: ${Object.keys(results.checks).length - bad} grün, ${bad} rot`);
for (const f of results.failures) console.log(' ROT', f);
process.exit(bad ? 1 : 0);
