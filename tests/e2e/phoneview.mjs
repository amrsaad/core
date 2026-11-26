// E2E iPhone-Ansicht, Schritt 1 (Runde 45): feste Abspielleiste unten, Aktionsreihe darüber, Reiterleiste oben, Inhalt dazwischen.
// Prüft bei 390x844, 375x667 und 430x932 in allen drei Reitern: Leiste ganz im Fenster und über der sicheren Unterkante, Aktionsreihe direkt darüber, keine Überschneidung von
// Kopf, Inhalt, Aktionsreihe und Leiste, alle Tasten mindestens 44 px, Hook nie abgeschnitten (auch ein sehr langer), Kontrast der Schrift, Video randlos 16:9.
// Verhalten bei 390x844: Zeitleiste läuft, Pause und Weiter per Taste, Voriger und Nächster, Wischen, Tippen auf den Inhalt, Tempo, CC, Like, Save, Share, More,
// Abrufkarte und Share-Blatt liegen über der Leiste, Settings über die Taste oben rechts, Saved über die Navigation dort, Text scrollt und wischt erst am Textende.
// Erste Geste nach dem App-Start ist die Play-Taste: Ton startet (iOS-Regel des Tests wie in audiotab.mjs, Zeile "deck: gesture unlock").
// Schalter aus (?phone=0): der alte Aufbau (kein data-phone, keine .ph-Klassen, .vactions, untere Navigation).
// Nur Kunst-IDs und Testtexte.
// Aufruf: node tests/e2e/phoneview.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview). E2E_BROWSERS=chromium,webkit
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';
import { onPageError } from './pageerrors.mjs';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-phoneview'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const EX = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the checked excerpt, long enough to wrap over several lines in the reading column.`).join('\n');
const EX_SHORT = 'Short passage that fits on one screen. Two sentences are enough.';
const LONG = ' und dazu ein langer zweiter Teil, der klar über drei Zeilen hinausgeht, damit die kleineren Stufen nötig werden und der Hook trotzdem nie abgeschnitten wird';
const CUES = [[0, 'Erste Zeile des Untertitels, etwas länger als eine Zeile auf dem Handy.'], [2, 'Zweite Zeile, kurz.'], [4, 'Dritte Zeile mit einem Satz, der ebenfalls umbricht.'], [7, 'Vierte.']];
const mk = (i, area, extra = {}) => ({
  id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20,
  channel: `Kanal ${area} (Dr. Test ${i % 4})`, videoTitle: `Testvideo ${i}`, area, topic: 'augen', hook: `Testmoment ${i} ${area}, ein Satz mit etwas mehr Text damit der Umbruch sichtbar wird`, kind: 'regel',
  createdAt: '2026-10-20T00:00:00Z', cues: CUES, excerpt: EX,
  recall: { question: `What follows from moment ${i}?`, options: [`Wrong A ${i}`, `Right ${i}`, `Wrong B ${i}`], correct: 1, why: `Because ${i} says so.` }, ...extra,
});
const moments = [];
for (let i = 0; i < 12; i++) moments.push(mk(i, 'beat', i === 5 ? { hook: `Testmoment ${i} beat, ein Satz${LONG}` } : {}));
for (let i = 12; i < 30; i++) moments.push(mk(i, 'brain'));
for (let i = 30; i < 40; i++) moments.push(mk(i, 'body'));
// Audio: ohne Untertitel (Auszug im Feld) bei 45, sehr langer Hook bei 42
for (let i = 40; i < 46; i++) moments.push(mk(i, 'brain', { form: 'audio', audio: true, hls: `https://stream.test/${i}.m3u8`, ...(i === 42 ? { hook: `Testmoment ${i} brain, ein Satz${LONG}` } : {}), ...(i === 45 ? { cues: undefined } : {}) }));
// Text: 46 mit Herkunft und Apply today, 47 sehr langer Hook, 48 kurzer Text (passt auf einen Bildschirm)
for (let i = 46; i < 56; i++) moments.push(mk(i, 'body', { form: 'text', videoId: `texto${String(i).padStart(5, '0')}`, author: `Author ${i}`, ref: `Ref ${i}`, sourceUrl: `https://example.org/s/${i}`, license: 'CC BY 4.0', ...(i === 46 ? { kind: 'takeaway', apply: 'Do the small thing today.', origin: 'Test entry 30' } : {}), ...(i === 47 ? { hook: `Testmoment ${i} body, ein Satz${LONG}` } : {}), ...(i === 48 ? { excerpt: EX_SHORT } : {}) }));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
const POOL = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');
const idOf = (i) => `test${String(i).padStart(7, '0')}:100`;

const waitFor = async (page, fn, arg, timeout = 6000) => { try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const E = (pg, id) => pg.locator(`[data-testid="${id}"]`);
const has = async (pg, id) => (await E(pg, id).count()) > 0;
const idx = (pg) => pg.evaluate(() => window.__core.idx());
const st = (pg) => pg.evaluate(() => window.__core.state());

/** Geräte: Breite, Höhe, Profil, Sicherheitsrand oben und unten (iPhone 14 und 15 Pro Max mit Dynamic Island und Home-Balken, iPhone SE ohne beides, nur die Statusleiste) */
const SIZES = [
  { name: '390x844', width: 390, height: 844, device: 'iPhone 14', safeT: 59, safeB: 34 },
  { name: '375x667', width: 375, height: 667, device: 'iPhone SE', safeT: 20, safeB: 0 },
  { name: '430x932', width: 430, height: 932, device: 'iPhone 15 Pro Max', safeT: 59, safeB: 34 },
];
const TABS = [['video', 'Video'], ['audio', 'Audio'], ['text', 'Text']];

async function open(type, size, { init, query = '', pool = POOL, tab = null } = {}) {
  const browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
  const prof = devices[size.device] ?? devices['iPhone 14'];
  const cx = await browser.newContext({ ...prof, viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await cx.addInitScript(({ t, b }) => {
    const put = () => { if (!document.documentElement) return false; const s = document.createElement('style'); s.textContent = `:root{--safe-top:${t}px;--safe-bottom:${b}px}`; document.documentElement.appendChild(s); return true; };
    if (!put()) document.addEventListener('readystatechange', put, { once: true });
  }, { t: size.safeT, b: size.safeB });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const pg = await cx.newPage();
  const errors = [];
  pg.on('pageerror', onPageError(errors));
  await pg.addInitScript(() => { window.__ytSlow = true; });
  if (init) await pg.addInitScript(init);
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: pool }));
  await pg.goto(`${url}?now=2026-10-23&seed=3${query}#k=${k}`);
  await waitFor(pg, () => !!window.__core?.moment(), undefined, 9000);
  await pg.waitForTimeout(500);
  if (tab) await gotoTab(pg, tab);
  return { browser, cx, pg, errors };
}
/** Reiter per Tipp wählen (die Taste ist selbst die Geste) und warten, bis ein Moment der Form steht */
async function gotoTab(pg, form) {
  const label = TABS.find(([f]) => f === form)[1];
  await pg.locator(`[data-testid=form-switch] button:has-text("${label}")`).click();
  await waitFor(pg, (f) => window.__core.moment() && (f === 'text' ? !!document.querySelector('[data-testid=text-view]') : window.__core.state() === 1), form, 8000);
  await pg.waitForTimeout(700);
}
/** Einen Moment der Reihe nach vorn holen und dorthin gehen */
async function showMoment(pg, id) {
  if ((await pg.evaluate(() => window.__core.moment()?.id)) === id) return;
  await pg.evaluate((i) => window.__core.arrange([i]), id);
  await pg.evaluate(() => window.__core.next());
  await waitFor(pg, (i) => window.__core.moment()?.id === i, id, 5000);
  await pg.waitForTimeout(700);
}

// ---------- Geometrie ----------
const GEOM = () => {
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const q = (s) => document.querySelector(s);
  const vis = (e) => { const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const form = q('.vfeed')?.dataset.form;
  const W = innerWidth, H = innerHeight;
  const safeB = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 0;
  const safeT = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0;
  const head = R(q('.ph-head')), actions = R(q('[data-testid=ph-actions]')), bar = R(q('[data-testid=ph-bar]'));
  const band = R(q('.vslot[aria-hidden=false] .vframe > div'));
  const content = form === 'text' ? R(q('[data-testid=text-view]')) : R(q('[data-testid=ph-audio]')) ?? R(q('[data-testid=ph-video]'));
  const hookEl = q('[data-testid=hook]');
  const hook = hookEl ? { ...R(hookEl), sh: hookEl.scrollHeight, ch: hookEl.clientHeight, size: parseFloat(getComputedStyle(hookEl).fontSize), step: hookEl.dataset.step ?? null } : null;
  const lyrics = R(q('[data-testid=ph-lyrics]'));
  // Alle Tasten (Kopf, Aktionsreihe, Leiste, Source) und ihre Größe
  const btns = [...document.querySelectorAll('.ph-head button, .ph-actions button, .ph-bar button, .ph-src, [data-testid=source]')].filter(vis).map((e) => { const r = R(e); return { id: e.dataset.testid ?? e.getAttribute('aria-label') ?? e.textContent.trim(), w: r.w, h: r.h, b: r.b, t: r.t, l: r.l, r: r.r }; });
  const hit = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  // Inhalt als Fläche zwischen Kopf und Aktionsreihe: alles Sichtbare des Inhalts liegt darin
  const inner = [R(q('[data-testid=ph-audio]')), R(q('[data-testid=ph-video]')), form === 'text' ? R(q('[data-testid=text-view]')) : null, form === 'video' ? band : null].filter(Boolean);
  const overlaps = [];
  const parts = { head, actions, bar };
  const names = Object.keys(parts);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (hit(parts[names[i]], parts[names[j]])) overlaps.push(`${names[i]} x ${names[j]}`);
  for (const [n, c] of [['content', content], ['band', form === 'video' ? band : null]]) for (const nm of names) if (c && hit(c, parts[nm])) overlaps.push(`${n} x ${nm}`);
  // Text im Inhalt (Kinder) liegt ganz zwischen Kopf und Aktionsreihe
  const lo = head ? head.b : 0, hi = actions ? actions.t : H;
  const outside = inner.some((r) => r.t < lo - 0.5 || r.b > hi + 0.5);
  // Der Hook liegt ganz im Inhaltsblock (nichts verdeckt, nichts darunter geschnitten)
  const hookInside = !hook || !content || (hook.t >= content.t - 0.5 && hook.b <= content.b + 0.5);
  // Chip-Zeile, Hook und Feld bzw. Untertitel überlagern sich nicht
  const chips = R(q('[data-testid=speaker-line]'));
  const stack = [chips, hook, lyrics].filter(Boolean);
  let stackOverlap = false;
  for (let i = 0; i < stack.length; i++) for (let j = i + 1; j < stack.length; j++) if (hit(stack[i], stack[j])) stackOverlap = true;
  return {
    W, H, safeB, safeT, form, head, actions, bar, band, content, hook, lyrics, btns, overlaps, outside, hookInside, stackOverlap,
    scrollX: document.documentElement.scrollWidth > W + 1, scrollY: document.scrollingElement.scrollHeight > H + 1,
    outsideWindow: [head, actions, bar].some((r) => !r || r.l < -0.5 || r.r > W + 0.5 || r.t < -0.5 || r.b > H + 0.5),
    // Unterkante der letzten Taste der Leiste über der sicheren Unterkante
    lowest: Math.max(...[...document.querySelectorAll('.ph-bar button')].filter(vis).map((e) => e.getBoundingClientRect().bottom)),
  };
};
/** Kontrast der sichtbaren Textknoten gegen den tatsächlichen Hintergrund (wie layout.mjs), nur im Bereich der neuen Ansicht */
const CONTRAST = () => {
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const blend = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1];
  const backdrop = (el) => { const stack = []; for (let n = el; n; n = n.parentElement) { let c = parse(getComputedStyle(n).backgroundColor); if ((!c || c[3] === 0) && n.tagName === 'BUTTON' && n.closest('.ph-tabs')) c = parse(getComputedStyle(n, '::before').backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let b = [0, 0, 0, 1]; for (const c of stack.reverse()) b = blend(c, b); return b; };
  const bad = [];
  for (const el of document.querySelectorAll('.ph-head *, .ph-actions *, .ph-bar *, .ph-audio *, .ph-video *, .vtext *, .status')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    if (r.bottom <= 0 || r.top >= innerHeight) continue;
    if (!([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = backdrop(el);
    const f = blend(fg, bg);
    const a = lum(f), b = lum(bg);
    const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize);
    const need = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700) ? 3 : 4.5;
    if (cr < need) bad.push(`${el.tagName}.${String(el.className).slice(0, 24)} "${el.textContent.trim().slice(0, 18)}" ${cr.toFixed(2)}<${need}`);
  }
  return bad;
};
const geomOk = (g, tag, c, notes) => {
  const must = (name, ok, detail) => { c[`${tag} ${name}`] = !!ok; if (!ok) notes[`${tag} ${name}`] = detail; };
  must('Leiste im Fenster', !g.outsideWindow && g.scrollX === false && g.scrollY === false, { head: g.head, actions: g.actions, bar: g.bar });
  must('Leiste über der sicheren Unterkante', g.bar && Math.abs(g.bar.b - g.H) <= 0.5 && g.lowest <= g.H - g.safeB + 1.5, { lowest: g.lowest, H: g.H, safeB: g.safeB, bar: g.bar });
  must('Aktionsreihe direkt über der Leiste', g.actions && g.bar && Math.abs(g.actions.b - g.bar.t) <= 1, { actions: g.actions, bar: g.bar });
  must('Kopf unter der Statusleiste', g.head && g.head.b - g.safeT >= 43.5 && g.head.b - g.safeT <= 44.5, { head: g.head, safeT: g.safeT });
  must('keine Überschneidung', g.overlaps.length === 0 && !g.outside && !g.stackOverlap, { overlaps: g.overlaps, outside: g.outside, stack: g.stackOverlap });
  must('alle Tasten mindestens 44 px', g.btns.length >= 7 && g.btns.every((b) => b.w >= 43.5 && b.h >= 43.5), g.btns.filter((b) => b.w < 43.5 || b.h < 43.5));
  must('Tasten im Fenster', g.btns.every((b) => b.l >= -0.5 && b.r <= g.W + 0.5 && b.t >= 0 && b.b <= g.H + 0.5), g.btns);
  if (g.hook) must('Hook nicht abgeschnitten', g.hook.sh <= g.hook.ch + 3 && g.hookInside, g.hook);
};
const mkRect = (r) => (r ? `${Math.round(r.l)},${Math.round(r.t)} ${Math.round(r.w)}x${Math.round(r.h)}` : null);

/** Wischen mit der Maus auf der Fläche (der Feed folgt dem Finger, Ereignisse wie bei Touch) */
async function swipe(pg, x, y0, y1) {
  await pg.mouse.move(x, y0);
  await pg.mouse.down();
  for (let i = 1; i <= 8; i++) { await pg.mouse.move(x, y0 + ((y1 - y0) * i) / 8); await pg.waitForTimeout(16); }
  await pg.mouse.up();
}
/** Wisch per Touch-Ereignissen auf einem Element (Text-Reiter: dort gelten onTouchStart und onTouchEnd) */
const touchSwipe = (pg, sel, x, y0, y1) => pg.evaluate(([q, px, a, b]) => {
  const el = document.querySelector(q); const mk = (y) => new Touch({ identifier: 1, target: el, clientX: px, clientY: y });
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [mk(a)], changedTouches: [mk(a)] }));
  el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [mk(b)], changedTouches: [mk(b)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [mk(b)] }));
}, [sel, x, y0, y1]);
const center = async (pg, sel) => { const b = await pg.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };

// iOS-Regel für play() wie in audiotab.mjs (Runde 7): angenommen nur in pointerup, touchend, click oder keydown ohne Bewegung des Fingers
const IOS_RULE = () => {
  const ALLOWED = ['pointerup', 'touchend', 'click', 'keydown'];
  window.__ev = 'none'; window.__moved = false; window.__refused = 0;
  const types = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown'];
  for (const t of types) {
    window.addEventListener(t, (e) => { if (e.type === 'pointerdown') window.__moved = false; window.__ev = e.type; setTimeout(() => { window.__ev = 'none'; }, 0); }, { capture: true, passive: true });
    window.addEventListener(t, () => { window.__ev = 'none'; }, { passive: true });
  }
  window.addEventListener('pointermove', (e) => { if (e.buttons) window.__moved = true; }, { capture: true, passive: true });
  const P = HTMLMediaElement.prototype;
  const orig = P.play;
  P.play = function () {
    const ok = this.__played || (ALLOWED.includes(window.__ev) && !window.__moved);
    if (!ok) { window.__refused++; return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError')); }
    const tok = (this.__ptok = (this.__ptok || 0) + 1);
    const slow = String(this.__src || '').startsWith('data:');
    return orig.call(this).then(() => {
      if (this.__p !== false || this.__ptok !== tok) throw new DOMException('aborted by pause', 'AbortError');
      this.__played = true;
    }).then(() => (slow ? new Promise((res) => setTimeout(res, 300)) : undefined));
  };
};

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {}, notes: {} };
  results.runs.push(r);
  const c = r.checks;
  try {
    // ---------- Aufbau: drei Größen, drei Reiter, sehr langer Hook ----------
    for (const size of SIZES) {
      const o = await open(type, size);
      const pg = o.pg;
      c[`${size.name} Ansicht aktiv`] = (await pg.locator('.vfeed[data-phone]').count()) === 1 && (await pg.locator('nav[class*="bottom-0"]').count()) === 0;
      for (const [form] of TABS) {
        const tag = `${size.name} ${form}`;
        if (form !== 'video') await gotoTab(pg, form);
        let g = await pg.evaluate(GEOM);
        geomOk(g, tag, c, r.notes);
        c[`${tag} Kontrast AA`] = (await pg.evaluate(CONTRAST)).length === 0;
        if (!c[`${tag} Kontrast AA`]) r.notes[`${tag} Kontrast`] = await pg.evaluate(CONTRAST);
        if (form === 'video') {
          // Player randlos über die volle Breite, 16:9, direkt unter der Reiterleiste
          c[`${tag} Player randlos 16:9`] = !!g.band && Math.abs(g.band.l) <= 0.5 && Math.abs(g.band.w - g.W) <= 0.5 && Math.abs(g.band.h - (g.W * 9) / 16) <= 1 && Math.abs(g.band.t - g.head.b) <= 0.5;
          if (!c[`${tag} Player randlos 16:9`]) r.notes[`${tag} Band`] = g.band;
        }
        if (form === 'audio') {
          c[`${tag} kein Cover`] = (await pg.evaluate(() => [...document.querySelectorAll('.vaudio-art')].every((e) => getComputedStyle(e).display === 'none')));
          c[`${tag} Feld unter dem Hook`] = !!g.lyrics && !!g.hook && g.lyrics.t >= g.hook.b - 0.5 && g.lyrics.b <= g.content.b + 0.5 && g.lyrics.h >= 90;
          if (!c[`${tag} Feld unter dem Hook`]) r.notes[`${tag} Feld`] = { lyrics: g.lyrics, hook: g.hook, content: g.content };
        }
        await pg.screenshot({ path: `${out}/${name}-${size.name}-${form}.png` });
        // Der sehr lange Hook: nie abgeschnitten, in höchstens zwei Stufen kleiner
        const long = form === 'video' ? idOf(5) : form === 'audio' ? idOf(42) : idOf(47);
        await showMoment(pg, long);
        g = await pg.evaluate(GEOM);
        geomOk(g, `${tag} langer Hook`, c, r.notes);
        c[`${tag} langer Hook kleinere Stufe`] = !!g.hook && (form === 'text' ? g.hook.size < 32 : g.hook.size <= 28);
        if (form === 'audio') c[`${tag} langer Hook Feld bleibt`] = !!g.lyrics && g.lyrics.h >= 60;
        await pg.screenshot({ path: `${out}/${name}-${size.name}-${form}-longhook.png` });
        // Zurück auf einen normalen Moment (der Reiter bleibt)
      }
      c[`${size.name} keine Seitenfehler`] = o.errors.length === 0;
      if (o.errors.length) r.notes[`${size.name} Fehler`] = o.errors.slice(0, 3);
      await o.browser.close();
    }

    // ---------- Verhalten bei 390x844: Video und Audio ----------
    {
      const size = SIZES[0];
      const o = await open(type, size);
      const pg = o.pg;
      // Der Start: erste Geste ist ein Tipp auf die Fläche der Reiter (wie bisher), hier gilt nur das Verhalten der neuen Tasten
      c.videoStartet = await waitFor(pg, () => window.__core.state() === 1, undefined, 8000);
      for (const [form] of TABS.slice(0, 2)) {
        const tag = `390 ${form}`;
        if (form !== 'video') { await gotoTab(pg, form); await showMoment(pg, idOf(40)); }
        // Zeitleiste: Position links wächst, Länge rechts steht, der Balken füllt sich
        await waitFor(pg, () => window.__core.state() === 1, undefined, 6000);
        await pg.waitForTimeout(800);
        const snap = () => pg.evaluate(() => ({ id: window.__core.moment().id, now: document.querySelector('[data-testid=ph-time-now]').textContent, len: document.querySelector('[data-testid=ph-time-len]').textContent, w: parseFloat(document.querySelector('[data-testid=ph-fill]').style.width) }));
        let t0, t1;
        for (let n = 0; n < 3; n++) { t0 = await snap(); await pg.waitForTimeout(2600); t1 = await snap(); if (t0.id === t1.id) break; }
        c[`${tag} Zeitleiste läuft`] = t1.w > t0.w && t1.now !== t0.now && t0.len === t1.len && /^\d+:\d\d$/.test(t1.len);
        if (!c[`${tag} Zeitleiste läuft`]) r.notes[`${tag} Zeitleiste`] = { t0, t1 };
        // Reine Anzeige: ein Tipp auf die Zeitleiste springt nicht
        const tl = await center(pg, '[data-testid=ph-timeline]');
        const idBefore = await pg.evaluate(() => window.__core.moment().id);
        const posBefore = await pg.evaluate(() => window.__core.time());
        await pg.mouse.click(tl.b.x + tl.b.width * 0.9, tl.y);
        await pg.waitForTimeout(400);
        c[`${tag} Zeitleiste springt nicht`] = (await pg.evaluate(() => window.__core.moment().id)) === idBefore && Math.abs((await pg.evaluate(() => window.__core.time())) - posBefore) < 3;
        // Pause-Taste pausiert und setzt fort
        const play = '[data-testid=ctl-play]';
        c[`${tag} Taste zeigt Pause beim Spielen`] = (await pg.locator(play).getAttribute('aria-label')) === 'Pause';
        await pg.locator(play).click();
        c[`${tag} Pause-Taste pausiert`] = await waitFor(pg, () => window.__core.state() !== 1 && window.__core.paused?.() !== false, undefined, 3000) && (await pg.locator(play).getAttribute('aria-label')) === 'Play';
        await pg.locator(play).click();
        c[`${tag} Play-Taste setzt fort`] = await waitFor(pg, () => window.__core.state() === 1, undefined, 4000) && (await pg.locator(play).getAttribute('aria-label')) === 'Pause';
        // Nächster und Voriger
        const i0 = await idx(pg);
        await pg.locator('[data-testid=ctl-next]').click();
        c[`${tag} Nächster wechselt`] = await waitFor(pg, (i) => window.__core.idx() === i + 1, i0, 4000) && (await waitFor(pg, () => window.__core.state() === 1, undefined, 5000));
        await pg.locator('[data-testid=ctl-prev]').click();
        c[`${tag} Voriger wechselt`] = await waitFor(pg, (i) => window.__core.idx() === i, i0, 4000) && (await waitFor(pg, () => window.__core.state() === 1, undefined, 5000));
        // Wischen hoch und runter auf der Fläche (Mitte des Inhalts, nicht auf Tasten)
        const area = form === 'audio' ? await center(pg, '[data-testid=ph-lyrics]') : await center(pg, '[data-testid=ph-video]');
        await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
        await pg.waitForTimeout(900);
        const dy = 120;
        await swipe(pg, area.x, area.y + dy, area.y - dy);
        c[`${tag} Wischen hoch wechselt`] = await waitFor(pg, (i) => window.__core.idx() === i + 1, i0, 5000);
        await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
        await pg.waitForTimeout(500);
        await swipe(pg, area.x, area.y - dy, area.y + dy);
        r.notes[`${tag} Wischen runter wechselt`] = { i0, now: await idx(pg), area: area.b }; c[`${tag} Wischen runter wechselt`] = await waitFor(pg, (i) => window.__core.idx() === i, i0, 5000);
        await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
        await pg.waitForTimeout(500);
        if (form === 'video') {
          const bd = await center(pg, '.vslot[aria-hidden=false] .vframe > div');
          const k0 = await idx(pg);
          await swipe(pg, bd.x, bd.b.y + bd.b.height - 8, bd.b.y + bd.b.height - 8 - 240);
          c['390 video Wischen im Player wechselt'] = await waitFor(pg, (i) => window.__core.idx() === i + 1, k0, 5000);
          await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
          await pg.waitForTimeout(700);
          await pg.locator('[data-testid=ctl-prev]').click();
          await waitFor(pg, (i) => window.__core.idx() === i, k0, 4000);
          await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
          await pg.waitForTimeout(500);
        }
        {
          // Wisch, der in der Aktionsreihe zwischen den Tasten beginnt (Daumen unten), wechselt den Moment wie auf dem Inhalt
          const ab = (await E(pg, 'ph-actions').boundingBox());
          const k1 = await idx(pg);
          await swipe(pg, ab.x + ab.width / 2, ab.y + 4, ab.y - 300);
          c[`${tag} Wisch aus der Aktionsreihe wechselt`] = await waitFor(pg, (i) => window.__core.idx() === i + 1, k1, 5000);
          await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
          await pg.waitForTimeout(700);
          await pg.locator('[data-testid=ctl-prev]').click();
          await waitFor(pg, (i) => window.__core.idx() === i, k1, 4000);
          await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
          await pg.waitForTimeout(500);
        }
        // Tippen auf den Inhalt pausiert und setzt fort (wie bisher: nach kurzer Wartezeit für den Doppeltipp)
        await pg.mouse.click(area.x, area.y);
        c[`${tag} Tippen auf Inhalt pausiert`] = await waitFor(pg, () => window.__core.state() !== 1, undefined, 3000) && (await pg.locator(play).getAttribute('aria-label')) === 'Play';
        await pg.waitForTimeout(500);
        await pg.mouse.click(area.x, area.y);
        c[`${tag} Tippen auf Inhalt setzt fort`] = await waitFor(pg, () => window.__core.state() === 1, undefined, 4000);
        // Tempo: 1x, 1.5x, 2x, 1x
        const rate = async () => ({ r: await pg.evaluate(() => window.__core.rate()), t: (await pg.locator('[data-testid=rate]').textContent()).trim() });
        const r0 = await rate();
        await pg.locator('[data-testid=rate]').click(); await pg.waitForTimeout(250);
        const r1 = await rate();
        await pg.locator('[data-testid=rate]').click(); await pg.waitForTimeout(250);
        const r2 = await rate();
        await pg.locator('[data-testid=rate]').click(); await pg.waitForTimeout(250);
        const r3 = await rate();
        c[`${tag} Tempo-Taste schaltet`] = r0.r === 1 && r0.t === '1x' && r1.r === 1.5 && r1.t === '1.5x' && r2.r === 2 && r2.t === '2x' && r3.r === 1 && r3.t === '1x';
        if (!c[`${tag} Tempo-Taste schaltet`]) r.notes[`${tag} Tempo`] = [r0, r1, r2, r3];
        // CC: der Zustand kehrt sich um, und die Anzeige folgt
        const cc = '[data-testid=cc]';
        const capShown = () => pg.evaluate((f) => (f === 'audio' ? !!document.querySelector('[data-testid=ph-lyric-prev], [data-testid=caption]') : !!document.querySelector('[data-testid=caption] span')), form);
        const cc0 = await pg.locator(cc).getAttribute('aria-pressed');
        await pg.locator(cc).click(); await pg.waitForTimeout(400);
        const cc1 = await pg.locator(cc).getAttribute('aria-pressed');
        const shown1 = await capShown();
        await pg.locator(cc).click(); await pg.waitForTimeout(400);
        const cc2 = await pg.locator(cc).getAttribute('aria-pressed');
        c[`${tag} CC schaltet Untertitel`] = cc0 !== cc1 && cc2 === cc0 && (form === 'audio' ? true : (cc1 === 'true') === shown1);
        if (!c[`${tag} CC schaltet Untertitel`]) r.notes[`${tag} CC`] = { cc0, cc1, cc2, shown1 };
        if (form === 'audio') {
          // Feld: vorige Zeile gedämpft, aktuelle groß, nächste gedämpft, feste Position der aktuellen Zeile
          await waitFor(pg, () => !!document.querySelector('[data-testid=ph-lyric-prev]'), undefined, 6000);
          const L = await pg.evaluate(() => { const f = (s) => document.querySelector(`[data-testid=${s}]`); const fs = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : 0); const cur = f('caption'); return { cur: cur?.textContent ?? '', curTop: cur ? cur.getBoundingClientRect().top : null, curFont: fs(cur), prevFont: fs(f('ph-lyric-prev')), nextFont: fs(f('ph-lyric-next')), curColor: cur ? getComputedStyle(cur).color : '', prevColor: f('ph-lyric-prev') ? getComputedStyle(f('ph-lyric-prev')).color : '' }; });
          r.notes.lyric = L;
          c[`${tag} Feld Größen`] = L.curFont === 24 && L.prevFont === 17 && L.nextFont === 15 && L.curColor !== L.prevColor;
          // Die aktuelle Zeile bleibt beim Wechsel an ihrem Platz: über vier Zeilen gleiche obere Kante bei gleich langer Zeile ist nicht verlangt, wohl aber dieselbe Mitte
          const mids = [];
          for (let n = 0; n < 4; n++) { mids.push(await pg.evaluate(() => { const e = document.querySelector('[data-testid=caption]'); if (!e) return null; const b = e.getBoundingClientRect(); return Math.round(b.top + b.height / 2); })); await pg.waitForTimeout(1800); }
          const ok = mids.filter((x) => x !== null);
          c[`${tag} Feld feste Position`] = ok.length >= 2 && Math.max(...ok) - Math.min(...ok) <= 20;
          if (!c[`${tag} Feld feste Position`]) r.notes[`${tag} Feld Mitten`] = mids;
          // Ohne Untertitel zeigt das Feld den Auszug
          await showMoment(pg, idOf(45));
          r.notes[`${tag} ohne Untertitel Auszug`] = { n: await pg.locator('[data-testid=ph-lyric-text]').count(), cc: await pg.locator('[data-testid=cc]').count(), id: await pg.evaluate(() => window.__core.moment().id) }; c[`${tag} ohne Untertitel Auszug`] = (await pg.locator('[data-testid=ph-lyric-text]').count()) === 1 && /Sentence 1 of/.test(await pg.locator('[data-testid=ph-lyric-text]').textContent()) && (await pg.locator('[data-testid=cc]').count()) === 0;
          await pg.screenshot({ path: `${out}/${name}-390-audio-excerpt.png` });
        } else {
          // CC nur mit Untertiteln: ein Moment ohne Cues zeigt die Taste nicht (Platz bleibt frei)
          c[`${tag} CC mit Untertiteln da`] = (await pg.locator(cc).count()) === 1;
        }
      }
      c['390 keine Seitenfehler Verhalten'] = o.errors.length === 0;
      if (o.errors.length) r.notes['390 Fehler Verhalten'] = o.errors.slice(0, 3);
      await o.browser.close();
    }

    // ---------- Aktionsreihe, Blätter über der Leiste, Settings und Saved ----------
    {
      const o = await open(type, SIZES[0]);
      const pg = o.pg;
      await waitFor(pg, () => window.__core.state() === 1, undefined, 8000);
      const id = await pg.evaluate(() => window.__core.moment().id);
      // Vier gleich breite Tasten, Beschriftung Like, Save, Share, More, keine Taste "Got it"
      const acts = await pg.evaluate(() => [...document.querySelectorAll('.ph-actions button')].map((b) => ({ id: b.dataset.testid, text: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width * 10) / 10 })));
      c.aktionen = acts.map((a) => a.text).join(',') === 'Like,Save,Share,More' && new Set(acts.map((a) => a.w)).size === 1 && !(await pg.evaluate(() => /got it/i.test(document.querySelector('.vfeed').textContent.replace(/today \d+ seen, \d+ got it/i, ''))));
      c.alteLeisteWeg = (await pg.locator('.vactions').count()) === 0 && (await pg.locator('.vtrack, .vprogress').count()) === 0;
      await E(pg, 'like').click();
      c.likeSchaltet = await waitFor(pg, (i) => window.__core.liked(i), id, 3000) && (await E(pg, 'like').getAttribute('aria-pressed')) === 'true';
      await E(pg, 'save').click();
      c.saveSchaltet = await waitFor(pg, (i) => window.__core.saved(i), id, 3000) && (await E(pg, 'save').getAttribute('aria-pressed')) === 'true';
      // More: das bestehende Blatt, über der Leiste
      await E(pg, 'more').click();
      c.moreOeffnet = await waitFor(pg, () => !!document.querySelector('[data-testid=note-sheet]'), undefined, 3000);
      await pg.waitForTimeout(500);
      const over = (sel, sheet) => pg.evaluate(([s, sh]) => { const b = document.querySelector(s).getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && !!e.closest(sh); }, [sel, sheet]);
      c.moreUeberLeiste = await over('[data-testid=ctl-play]', '[data-testid=note-sheet]');
      await pg.screenshot({ path: `${out}/${name}-390-more.png` });
      await pg.keyboard.press('Escape');
      await pg.evaluate(() => { document.querySelector('[data-testid=note-sheet-close]')?.click(); });
      await waitFor(pg, () => !document.querySelector('[data-testid=note-sheet]'), undefined, 3000);
      // Share-Blatt
      await E(pg, 'share').click();
      c.shareOeffnet = await waitFor(pg, () => !!document.querySelector('[data-testid=share-sheet]'), undefined, 3000);
      await pg.waitForTimeout(500);
      c.shareUeberLeiste = await over('[data-testid=ctl-play]', '[data-testid=share-sheet]') && await over('[data-testid=like]', '[data-testid=share-sheet]');
      await pg.screenshot({ path: `${out}/${name}-390-share.png` });
      await pg.evaluate(() => { document.querySelector('[data-testid=share-sheet-close]')?.click(); });
      await waitFor(pg, () => !document.querySelector('[data-testid=share-sheet]'), undefined, 3000);
      // Kontext: Tipp auf den Kopf öffnet das Blatt wie bisher
      await E(pg, 'info-tap').click();
      c.kontextOeffnet = await waitFor(pg, () => !!document.querySelector('[data-testid=caption-sheet]'), undefined, 3000);
      await pg.waitForTimeout(400);
      c.kontextUeberLeiste = await over('[data-testid=ctl-play]', '[data-testid=caption-sheet]');
      await pg.evaluate(() => { document.querySelector('[data-testid=caption-close]')?.click(); });
      await waitFor(pg, () => !document.querySelector('[data-testid=caption-sheet]'), undefined, 3000);
      // Fokus-Blatt per langem Druck auf einen Reiter, über der Leiste
      const tab = await center(pg, '[data-testid=form-switch] button:has-text("Video")');
      await pg.mouse.move(tab.x, tab.y); await pg.mouse.down(); await pg.waitForTimeout(700); await pg.mouse.up();
      c.fokusOeffnet = await waitFor(pg, () => !!document.querySelector('[data-testid=focus-sheet]'), undefined, 3000);
      await pg.waitForTimeout(400);
      c.fokusUeberLeiste = await over('[data-testid=ctl-play]', '[data-testid=focus-sheet]');
      await pg.evaluate(() => { document.querySelector('[data-testid=focus-sheet-close]')?.click(); });
      await waitFor(pg, () => !document.querySelector('[data-testid=focus-sheet]'), undefined, 3000);
      // Abrufkarte: liegt über Leiste und Aktionsreihe, nicht dahinter
      const other = await pg.evaluate(() => window.__core.queue()[window.__core.idx() + 1]);
      await pg.evaluate((i) => window.__core.showRecall(i), other);
      c.abrufOeffnet = await waitFor(pg, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 4000);
      await pg.waitForTimeout(500);
      c.abrufUeberLeiste = await over('[data-testid=ctl-play]', '[data-testid=recall-page]') && await over('[data-testid=like]', '[data-testid=recall-page]');
      await pg.screenshot({ path: `${out}/${name}-390-recall.png` });
      await pg.evaluate(() => window.__core.skipRecall());
      await waitFor(pg, () => !document.querySelector('[data-testid=recall-card]'), undefined, 3000);
      // Settings über die Taste oben rechts, Saved und Feed über die Navigation dort
      const today = await pg.locator('[data-testid=today]').textContent();
      c.heuteTaste = /^Today \d+$/.test(today.trim()) && /^today \d+ seen, \d+ got it$/.test(await E(pg, 'today').getAttribute('data-line'));
      await E(pg, 'today').click();
      c.settingsOeffnet = await waitFor(pg, () => !!document.querySelector('[data-testid=sync-card]'), undefined, 3000);
      c.navigationInSettings = (await pg.locator('nav [aria-label=Saved]').isVisible()) && (await pg.locator('nav [aria-label=Feed]').isVisible());
      await pg.locator('nav [aria-label=Saved]').click();
      r.notes.savedOeffnet = await pg.evaluate(() => ({ h1: [...document.querySelectorAll('h1,h2')].map((e) => e.textContent), tabs: document.querySelector('nav')?.textContent })); c.savedOeffnet = await waitFor(pg, () => [...document.querySelectorAll('h1,h2')].some((e) => e.textContent === 'Saved'), undefined, 3000);
      await pg.screenshot({ path: `${out}/${name}-390-saved.png` });
      await pg.locator('nav [aria-label=Feed]').click();
      c.zurueckImFeed = await waitFor(pg, () => !!document.querySelector('[data-testid=ph-bar]') && window.__core.state() === 1, undefined, 4000) && (await pg.locator('nav[class*="bottom-0"]').count()) === 0;
      c['Aktionen keine Seitenfehler'] = o.errors.length === 0;
      if (o.errors.length) r.notes['Aktionen Fehler'] = o.errors.slice(0, 3);
      await o.browser.close();
    }

    // ---------- Text: scrollt, Wisch erst am Textende, Previous und Next ----------
    {
      const o = await open(type, SIZES[0], { tab: 'text' });
      const pg = o.pg;
      await showMoment(pg, idOf(46));
      const g = await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); const cs = getComputedStyle(v); return { overflowY: cs.overflowY, scrollable: v.scrollHeight > v.clientHeight + 4, origin: document.querySelector('[data-testid=desk-origin]')?.textContent ?? null, apply: document.querySelector('[data-testid=desk-apply]')?.textContent ?? null, source: document.querySelector('[data-testid=text-source]')?.textContent ?? null, serif: getComputedStyle(document.querySelector('[data-testid=hook]')).fontFamily }; });
      c.textScrollt = g.overflowY === 'auto' && g.scrollable;
      c.textHatSerifenHook = /Source Serif|serif|Georgia/i.test(g.serif);
      c.textQuelleDa = /Author 46/.test(g.source ?? '') || !!g.source;
      // Ans Ende scrollen: Origin und Apply today stehen unten
      await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); v.scrollTop = v.scrollHeight; });
      await pg.waitForTimeout(400);
      const end = await pg.evaluate(() => ({ origin: document.querySelector('[data-testid=desk-origin]')?.textContent ?? null, apply: document.querySelector('[data-testid=desk-apply]')?.textContent ?? null, applyVisible: (() => { const e = document.querySelector('[data-testid=desk-apply]'); const v = document.querySelector('[data-testid=text-view]'); if (!e) return false; const a = e.getBoundingClientRect(), b = v.getBoundingClientRect(); return a.bottom <= b.bottom + 1 && a.top >= b.top; })() }));
      r.notes.textOriginApply = { ...end, id: await pg.evaluate(() => window.__core.moment().id), form: await pg.evaluate(() => window.__core.moment().form) }; c.textOriginApply = /Test entry 30/.test(end.origin ?? '') && /Apply today/.test(end.apply ?? '') && /Do the small thing today\./.test(end.apply ?? '') && end.applyVisible;
      await pg.screenshot({ path: `${out}/${name}-390-text-end.png` });
      // Wisch nach oben mitten im Text (nicht am Ende) wechselt nicht, am Textende wechselt er
      await pg.evaluate(() => { document.querySelector('[data-testid=text-view]').scrollTop = 0; });
      await pg.waitForTimeout(200);
      const i0 = await idx(pg);
      await touchSwipe(pg, '[data-testid=text-view]', 200, 600, 300);
      await pg.waitForTimeout(500);
      c.textWischMitteBleibt = (await idx(pg)) === i0;
      await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); v.scrollTop = v.scrollHeight; });
      await pg.waitForTimeout(200);
      await touchSwipe(pg, '[data-testid=text-view]', 200, 600, 300);
      c.textWischAmEndeWechselt = await waitFor(pg, (i) => window.__core.idx() === i + 1, i0, 3000);
      // Previous und Next
      await pg.locator('[data-testid=ctl-prev]').click();
      c.textPrevious = await waitFor(pg, (i) => window.__core.idx() === i, i0, 3000);
      await pg.locator('[data-testid=ctl-next]').click();
      c.textNext = await waitFor(pg, (i) => window.__core.idx() === i + 1, i0, 3000);
      c.textLeisteOhneGotIt = (await pg.evaluate(() => [...document.querySelectorAll('[data-testid=ph-bar] button')].map((b) => b.textContent.trim()).join('|'))) === 'Previous|Next';
      // Kurzer Text: der Wisch geht sofort
      await showMoment(pg, idOf(48));
      const j0 = await idx(pg);
      await touchSwipe(pg, '[data-testid=text-view]', 200, 600, 300);
      c.textKurzWischWechselt = await waitFor(pg, (i) => window.__core.idx() === i + 1, j0, 3000);
      c['Text keine Seitenfehler'] = o.errors.length === 0;
      await o.browser.close();
    }

    // ---------- Erste Geste nach dem App-Start ist die Play-Taste ----------
    {
      const o = await open(type, SIZES[0], { init: IOS_RULE });
      const pg = o.pg;
      await gotoTab(pg, 'audio');
      // Der Zustand (Reiter Audio) wird verzögert gespeichert, dann Neustart ohne Geste
      await pg.waitForTimeout(2000);
      await pg.reload();
      await waitFor(pg, () => !!window.__core?.moment()?.audio, undefined, 10000);
      c.startOhneGesteWartet = await waitFor(pg, () => !!document.querySelector('[data-testid=tap-to-play]'), undefined, 4000);
      c.startOhneGesteKeinTon = await pg.evaluate(() => [...document.querySelectorAll('audio')].every((e) => e.paused));
      c.startPlayTasteZeigtPlay = (await pg.locator('[data-testid=ctl-play]').getAttribute('aria-label')) === 'Play';
      c.startZeitleisteSteht = (await pg.locator('[data-testid=ph-time-now]').textContent()).trim() === '0:00';
      // Die allererste Geste dieser Seite ist der Tipp auf die Play-Taste (nichts davor berührt)
      await pg.locator('[data-testid=ctl-play]').click();
      c.ersteGesteStartetTon = await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
      c.ersteGesteKeinPause = await waitFor(pg, () => window.__core.state() === 1, undefined, 1500) && (await pg.locator('[data-testid=ctl-play]').getAttribute('aria-label')) === 'Pause';
      c.ersteGesteTippWeg = await waitFor(pg, () => !document.querySelector('[data-testid=tap-to-play]'), undefined, 3000);
      c.ersteGesteTonAn = await pg.evaluate(() => window.__core.sound() === true);
      const d = await pg.evaluate(() => window.__core.diag());
      c.ersteGesteDeckUnlock = d.some((x) => /^deck: gesture unlock \d+ elements ok=[1-9]\d* /.test(x));
      c.ersteGesteSpielZeile = d.some((x) => /^deck play#1 ok/.test(x));
      c.ersteGesteNichtAbgelehnt = !d.some((x) => /needs tap|deck play refused|muted play blocked/.test(x));
      r.notes.ersteGeste = d.filter((x) => !/probe done/.test(x)).slice(-14);
      // Danach spielen Voriger, Nächster und Pause wie sonst, ohne weiteren Tipp
      const i0 = await idx(pg);
      await pg.locator('[data-testid=ctl-next]').click();
      c.nachErsterGesteNaechster = await waitFor(pg, (i) => window.__core.idx() === i + 1 && window.__core.state() === 1, i0, 5000);
      c.nachErsterGesteKeinTippNoetig = !(await pg.evaluate(() => window.__core.diag())).slice(-30).some((x) => /needs tap|deck play refused/.test(x));
      c['Erste Geste keine Seitenfehler'] = o.errors.length === 0;
      if (o.errors.length) r.notes['Erste Geste Fehler'] = o.errors.slice(0, 3);
      await o.browser.close();
    }
    // Zweiter Fall: eine erste Geste auf Nächster (nicht auf Play) schaltet ebenfalls frei und der Ton läuft
    {
      const o = await open(type, SIZES[0], { init: IOS_RULE });
      const pg = o.pg;
      await gotoTab(pg, 'audio');
      await pg.waitForTimeout(2000);
      await pg.reload();
      await waitFor(pg, () => !!window.__core?.moment()?.audio, undefined, 10000);
      await waitFor(pg, () => !!document.querySelector('[data-testid=tap-to-play]'), undefined, 4000);
      await pg.locator('[data-testid=ctl-next]').click();
      c.ersteGesteNaechsterSpielt = await waitFor(pg, () => window.__core.idx() === 1 && window.__core.state() === 1, undefined, 6000);
      await o.browser.close();
    }

    // ---------- Schalter aus: der alte Aufbau ----------
    for (const [form] of TABS) {
      const o = await open(type, SIZES[0], { query: '&phone=0' });
      const pg = o.pg;
      if (form !== 'video') await gotoTab(pg, form);
      const old = await pg.evaluate(() => ({
        phoneAttr: !!document.querySelector('[data-phone]'), ph: document.querySelectorAll('[class*="ph-"], .ph-head, .ph-bar, .ph-actions').length,
        vactions: document.querySelectorAll('.vactions button').length, nav: !!document.querySelector('nav [aria-label=Settings]'), navHidden: document.querySelector('nav')?.className.includes('translate-y-full') ?? null,
        today: document.querySelector('.vtoday')?.textContent ?? null, head: document.querySelector('.head')?.className, tabs: document.querySelector('[data-testid=form-switch]')?.className,
        ctrl: !!document.querySelector('[data-testid=audio-controls]'), hook: !!document.querySelector('.vtitle, .vtext-hook'), mainCls: document.querySelector('.vfeed')?.getAttribute('data-surface'),
      }));
      c[`aus ${form} kein neuer Aufbau`] = !old.phoneAttr && old.ph === 0 && old.head === 'head' && old.tabs === 'head-tabs';
      c[`aus ${form} alte Aktionsleiste und Navigation`] = (old.vactions >= 4 || form === 'text') && old.nav;
      if (form === 'audio') c['aus audio alte Steuerzeile'] = old.ctrl;
      if (form === 'text') c['aus text Seite auf Papier'] = old.mainCls === 'page';
      r.notes[`aus ${form}`] = old;
      await pg.screenshot({ path: `${out}/${name}-390-${form}-aus.png` });
      await o.browser.close();
    }
  } catch (e) {
    r.error = String(e && e.stack ? e.stack : e);
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
let bad = 0;
for (const run of results.runs) {
  const fails = Object.entries(run.checks).filter(([, v]) => v !== true).map(([n]) => n);
  if (run.error || fails.length) bad++;
  console.log(JSON.stringify({ browser: run.browser, ok: !run.error && !fails.length, checks: Object.keys(run.checks).length, fails, error: run.error }));
  for (const f of fails) if (run.notes[f]) console.log('  ', f, JSON.stringify(run.notes[f]).slice(0, 400));
}
process.exit(bad ? 1 : 0);
