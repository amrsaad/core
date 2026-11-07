// Layout-Gate (Entscheidung 43, Brief 06): vier Breiten, drei Stimmungen, Überlauf, Stimmung am html-Element, Kontrast AA der sichtbaren Texte, Berührflächen 44 px.
// Schreibt Screenshots nach <ausgabeordner>/<block>/ und results.json. Bricht mit Exit-Code 1 ab, wenn eine Prüfung rot ist.
// Aufruf: node tests/e2e/layout.mjs <url> <ausgabeordner> [block]   (vorher npm run build, dann vite preview)
// Browser: E2E_CHROME=/pfad/zu/chrome nutzt ein vorhandenes Chrome statt Playwright-Chromium.
// Zwei Läufe (Brief 17): Chromium mit den vier Breiten wie bisher, danach WebKit mit den iPhone-Profilen 390x844 und 430x932
// (Skalierung 3, isMobile, hasTouch, Sicherheitsrand 59/34 über --safe-top und --safe-bottom). LAYOUT_ENGINES=chromium oder webkit wählt einen davon.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, webkit, devices } from 'playwright';

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
/** iPhone-Profile für WebKit: echte Maße des Geräts (Playwright liefert 664 hoch für Safari mit Leiste, der Feed braucht den ganzen Schirm), Sicherheitsrand wie bei Dynamic Island und Home-Balken */
const IPHONES = [
  { name: 'iphone390', width: 390, height: 844, device: 'iPhone 14' },
  { name: 'iphone430', width: 430, height: 932, device: 'iPhone 15 Pro Max' },
];
const SAFE_TOP = 59;
const SAFE_BOTTOM = 34;
const ENGINES = (process.env.LAYOUT_ENGINES ?? 'chromium,webkit').split(',');
const RUNS = [
  { engine: 'chromium', type: chromium, viewports: VIEWPORTS, launch: process.env.E2E_CHROME ? { headless: true, executablePath: process.env.E2E_CHROME } : { headless: true } },
  { engine: 'webkit', type: webkit, viewports: IPHONES, launch: process.env.E2E_WEBKIT ? { headless: true, executablePath: process.env.E2E_WEBKIT } : { headless: true } },
].filter((r) => ENGINES.includes(r.engine));
let browser;
let cur = RUNS[0];
const newCtx = async (vp, scheme) => {
  if (!vp.device) return browser.newContext({ viewport: { width: vp.width, height: vp.height }, serviceWorkers: 'block', deviceScaleFactor: 1, colorScheme: scheme });
  const cx = await browser.newContext({ ...devices[vp.device], viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: scheme });
  await cx.addInitScript(({ t, b }) => {
    const put = () => { if (!document.documentElement) return false; const st = document.createElement('style'); st.textContent = `:root{--safe-top:${t}px;--safe-bottom:${b}px}`; document.documentElement.appendChild(st); return true; };
    if (!put()) document.addEventListener('readystatechange', put, { once: true });
  }, { t: SAFE_TOP, b: SAFE_BOTTOM });
  return cx;
};
const MOODS = ['beat', 'body', 'brain'];
const SCHEMES = ['dark', 'light'];

const EX_SHORT = 'Short passage that fits the first step. Two sentences are enough.';
const AREX = 'قال الشيخ السعدي في تفسير قوله تعالى {فَإِنَّ مَعَ الْعُسْرِ يُسْرًا * إِنَّ مَعَ الْعُسْرِ يُسْرًا}: أي إن العسر لا يخلو من يسر يصاحبه، ولهذا قال النبي صلى الله عليه وسلم \\" لن يغلب عسر يسرين \\" وهذه قاعدة عظيمة. ومن قواعد الفقه \\" المشقة تجلب التيسير \\" فكلما ضاق الأمر اتسع. ثم قال تعالى {فَإِذَا فَرَغْتَ فَانصَبْ} أي إذا فرغت من أشغالك فاجتهد في العبادة والدعاء. وهذا يدل على أن المؤمن لا يكون فارغا أبدا، بل ينتقل من طاعة إلى طاعة.';
const EX = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the checked excerpt, long enough to wrap over several lines in the reading column.`).join('\n');
const mk = (i, area, extra = {}) => ({
  id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20,
  channel: `Channel ${area} (Dr. Test ${i % 4})`, videoTitle: `Test video ${i}`, area, topic: 'augen', hook: `Test moment ${i} ${area}`, kind: 'regel',
  createdAt: '2026-10-20T00:00:00Z', cues: [[0, 'Caption one, a marketing message'], [2, 'Caption two']], excerpt: EX,
  context: `Context sentence one for moment ${i}. Context sentence two names a term.`,
  recall: { question: `What follows from moment ${i}?`, options: [`Wrong A ${i}`, `Right ${i}`, `Wrong B ${i}`], correct: 1, why: `Because ${i} says so.` }, ...extra,
});
async function pool(area) {
  const moments = [
    ...Array.from({ length: 14 }, (_, i) => mk(i, area)),
    ...Array.from({ length: 6 }, (_, i) => mk(40 + i, area, { form: 'audio', audio: true, hls: `https://stream.test/${40 + i}.m3u8`, cues: [[0, area === 'beat' ? 'لَا تَقْصُصْ رُؤْيَاكَ عَلَىٰ إِخْوَتِكَ فَيَكِيدُوا لَكَ كَيْدًا' : area === 'brain' ? 'Audio caption one, a marketing message that is quite a bit longer than one line to test wrapping' : 'Audio caption one, a marketing message that is quite a bit longer than one line, so that the subtitle line wraps over a second and a third line on a phone'], [2, 'two']] })),
    // Text (Brief 18): 0 und 1 lang (Schnitt am Satzende), 2 arabisch mit Vers in { } und Backslash-Anführungszeichen aus der Pipeline (Issue 43), 3 bis 5 kurz (passen in Stufe 0, gelten als gesehen, bringen die Abrufkarte)
    ...Array.from({ length: 6 }, (_, i) => mk(60 + i, area, { form: 'text', videoId: `texto${String(60 + i).padStart(5, '0')}`, author: `Author ${i}`, ref: `Ref ${i}`, sourceUrl: `https://example.org/s/${i}`, license: 'CC BY 4.0', hook: i === 1 ? 'A very long hook that keeps going over several lines to test wrapping in the page, with many words and a clause or two' : i === 2 ? 'تفسير السعدي: مع العسر يسرا' : `Check lens status before the next injection ${i}`, ...(i === 2 ? { topic: 'islam', excerpt: AREX } : i >= 3 ? { excerpt: EX_SHORT } : {}) })),
  ];
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
  return { body: JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') }), k: Buffer.from(raw).toString('base64url') };
}

const results = { at: new Date().toISOString(), block, checks: {}, failures: [] };
const fail = (name, detail) => { results.checks[name] = false; results.failures.push(`${name}: ${detail}`); };
const ok = (name) => { if (!(name in results.checks)) results.checks[name] = true; };


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
    if (own && r.top < H && r.bottom > 0 && !el.closest('.vslot') && !el.closest('.head[data-focus="on"] button:not(.on)')) {
      const fg = parse(cs.color); if (!fg) continue;
      const bg = backdrop(el); const f = blend(fg, bg);
      const a = lum(f), b = lum(bg); const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(cs.fontSize); const bold = +cs.fontWeight >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (cr < need) res.lowContrast.push(`${el.tagName}.${String(el.className).slice(0, 30)} "${el.textContent.trim().slice(0, 20)}" ${cr.toFixed(2)}<${need}`);
    }
  }
  // Fluss (Brief 17): Textblöcke überlagern sich nicht, die Seite scrollt nicht, die Leiste liegt ganz im Fenster
  res.innerW = W;
  res.scrollH = document.scrollingElement.scrollHeight;
  res.innerH = H;
  const bar = document.querySelector('.vactions');
  if (bar) { const r = bar.getBoundingClientRect(); res.bar = { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) }; }
  const blocks = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.vslot') || el.closest('[aria-hidden="true"]') || el.closest('nav')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length) continue;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of texts) { const g = document.createRange(); g.selectNodeContents(n); for (const q of g.getClientRects()) { if (q.width < 1 || q.height < 1) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); } }
    if (!isFinite(l) || r <= 0 || l >= W || b <= 0 || t >= H) continue;
    // Kürzung per Zeilenzahl (Hook, Untertitel, Text): sichtbar ist nur der Kasten des Elements
    const box = el.getBoundingClientRect();
    if (cs.overflow !== 'visible' || cs.webkitLineClamp !== 'none') { t = Math.max(t, box.top); b = Math.min(b, box.bottom); l = Math.max(l, box.left); r = Math.min(r, box.right); }
    if (r - l < 1 || b - t < 1) continue;
    blocks.push({ el, l, t, r, b, name: `${el.tagName}.${String(el.className).slice(0, 24)}` });
  }
  // Das Cover im Audio-Reiter zählt als Block (ein Bild, kein Text): Zähler, Untertitel und Bedienung dürfen es nicht berühren
  for (const el of document.querySelectorAll('.vaudio-art')) {
    const r = el.getBoundingClientRect();
    if (r.width > 40 && r.left >= 0 && r.right <= W && r.bottom > 0 && r.top < H) blocks.push({ el, l: r.left, t: r.top, r: r.right, b: r.bottom, name: 'cover.vaudio-art' });
  }
  res.overlaps = [];
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], c = blocks[j];
    if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
    const w = Math.min(a.r, c.r) - Math.max(a.l, c.l), h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
    if (w > 1 && h > 1) res.overlaps.push(`${a.name} x ${c.name} ${Math.round(w)}x${Math.round(h)}`);
  }
  // Daumenzone (Entscheidung 54, Brief 16): jedes Pflicht-Tippziel liegt mit seiner Oberkante unter 35 Prozent der Höhe, also in den unteren 65 Prozent.
  // Pflicht sind alle Elemente mit data-primary="true" (Leiste) und alle Knöpfe in Blättern, Abrufkarte, Kontext, Endseite und auf dem Unlock-Screen.
  // Oben liegt nur Anzeige (Reiter, Pille, Status), die trägt kein data-primary und steht nicht in dieser Liste.
  const PRIMARY = '[data-primary="true"], .sheet-body button, .vcap-sheet button, .recall button, .vend-btn, [data-testid=unlock-screen] button';
  res.thumb = [];
  res.thumbCount = 0;
  for (const el of document.querySelectorAll(PRIMARY)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    if (el.closest('[aria-hidden="true"]') || el.closest('.vslot')) continue;
    if (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
    res.thumbCount++;
    if (r.top < H * 0.35) res.thumb.push(`${el.tagName}.${String(el.className).slice(0, 24)}[${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 12)}] top ${Math.round(r.top)} = ${Math.round((r.top / H) * 100)} %`);
  }
  return res;
};

/** Bild mit markierter 65-Prozent-Linie (Brief 16, Abschlussblock): rote Linie bei 35 Prozent der Höhe, darunter die Daumenzone */
async function thumbShot(pg, path) {
  await pg.evaluate(() => {
    const d = document.createElement('div');
    d.id = '__thumbline';
    d.style.cssText = 'position:fixed;left:0;right:0;top:35%;height:0;border-top:2px dashed #ff3b30;z-index:99999;pointer-events:none';
    const t = document.createElement('span');
    t.textContent = 'thumb zone, lower 65 %';
    t.style.cssText = 'position:absolute;right:8px;top:2px;font:12px sans-serif;color:#ff3b30;background:rgba(0,0,0,.6);padding:2px 6px;border-radius:4px';
    d.appendChild(t);
    document.body.appendChild(d);
  });
  await pg.screenshot({ path });
  await pg.evaluate(() => document.getElementById('__thumbline')?.remove());
}

async function open(area, vp, scheme, p) {
  const cx = await newCtx(vp, scheme);
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
  // Erststart-Übersicht der Tasten (Desktop) zu, sie deckt sonst den Feed
  if (await pg.locator('[data-testid=desk-help]').count()) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
  return { cx, pg, errors };
}

async function check(pg, label, { skipSmall = false, flow = false } = {}) {
  const r = await pg.evaluate(probe);
  if (flow) {
    // Am Schreibtisch (ab 1181 px) scrollt der Text unter der Leiste durch, das ist dort gewollt: überlagerte Textblöcke zählen nur auf dem Handy und Tablet
    if (r.overlaps.length && r.innerW < 1181) fail(`${label} keine überlagerten Textblöcke`, r.overlaps.slice(0, 4).join(' | ')); else ok(`${label} keine überlagerten Textblöcke`);
    if (r.scrollH > r.innerH + 1) fail(`${label} Seite scrollt nicht`, `scrollHeight ${r.scrollH} > innerHeight ${r.innerH}`); else ok(`${label} Seite scrollt nicht`);
    if (r.bar && (r.bar.top < 0 || r.bar.bottom > r.innerH + 0.5)) fail(`${label} Leiste im Fenster`, JSON.stringify(r.bar)); else ok(`${label} Leiste im Fenster`);
  }
  // Daumenzone nur auf dem Handy (390x844 und 430x932, Entscheidung 54); Tablet und Desktop werden mit zwei Händen bedient
  if (r.innerW <= 430) { if (r.thumb.length) fail(`${label} Daumenzone`, r.thumb.slice(0, 4).join(' | ')); else ok(`${label} Daumenzone`); }
  if (r.overflowX) fail(`${label} kein Seitwärtsscrollen`, 'scrollWidth größer als Fenster'); else ok(`${label} kein Seitwärtsscrollen`);
  if (r.outside.length) fail(`${label} nichts außerhalb`, r.outside.slice(0, 4).join(' | ')); else ok(`${label} nichts außerhalb`);
  if (r.lowContrast.length) fail(`${label} Kontrast AA`, r.lowContrast.slice(0, 4).join(' | ')); else ok(`${label} Kontrast AA`);
  if (!skipSmall) { if (r.small.length) fail(`${label} Berührfläche 44 px`, r.small.slice(0, 4).join(' | ')); else ok(`${label} Berührfläche 44 px`); }
  return r;
}

/** Blätter (Brief 17, Issue 39): Schließen-Knopf oben rechts, mindestens 44 px, ganz im Fenster; über dem Blatt bleibt unter der Statusleiste ein Streifen des Hintergrunds */
async function sheetCheck(pg, label, sheetSel, closeSel) {
  const g = await pg.evaluate(([ss, cs]) => {
    const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    return { sheet: R(document.querySelector(ss)), x: R(document.querySelector(cs)), W: innerWidth, H: innerHeight, safeT: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0 };
  }, [sheetSel, closeSel]);
  if (!g.sheet) { fail(`${label} Blatt da`, 'Blatt nicht gefunden'); return; }
  if (!g.x) { fail(`${label} Schließen-Knopf da`, 'kein Schließen-Knopf'); return; }
  ok(`${label} Schließen-Knopf da`);
  if (g.x.w < 43.5 || g.x.h < 43.5) fail(`${label} Schließen-Knopf 44 px`, `${Math.round(g.x.w)}x${Math.round(g.x.h)}`); else ok(`${label} Schließen-Knopf 44 px`);
  if (g.x.l < 0 || g.x.t < 0 || g.x.r > g.W + 0.5 || g.x.b > g.H + 0.5) fail(`${label} Schließen-Knopf im Fenster`, JSON.stringify(g.x)); else ok(`${label} Schließen-Knopf im Fenster`);
  if (g.x.r < g.sheet.r - 40 || g.x.t > g.sheet.t + 24) fail(`${label} Schließen-Knopf oben rechts`, `x ${Math.round(g.x.r)}/${g.W}, y ${Math.round(g.x.t - g.sheet.t)} unter der Kante`); else ok(`${label} Schließen-Knopf oben rechts`);
  if (g.sheet.t - g.safeT < 44) fail(`${label} Hintergrundstreifen oben`, `${Math.round(g.sheet.t - g.safeT)} px unter der Statusleiste`); else ok(`${label} Hintergrundstreifen oben`);
}
const gone = (pg, sel) => pg.waitForSelector(sel, { state: 'detached', timeout: 1500 }).then(() => true, () => false);

/**
 * Text-Reiter (Brief 18, Issues 41, 42, 43), Handy und Tablet. Geht die Text-Momente der Reihe nach durch und sammelt:
 * kein Überlauf im sichtbaren Text, kein "Read more", Schnitt endet am Satzende, Leiste ganz im Fenster, arabischer Moment mit Vers in Amiri
 * und Erklärtext in Noto Sans Arabic ohne Backslash, Abrufkarte als eigene Seite über dem Lesetext (kein Overlay).
 */
async function textChecks(pg, tag, vp, dir, { area, scheme }) {
  const suffix = scheme === 'light' ? '-hell' : '';
  const seen = { cut: null, ar: null, recall: null, readMore: false, overflow: [], bar: [] };
  for (let i = 0; i < 9; i++) {
    const r = await pg.evaluate(() => {
      const b = document.querySelector('[data-testid=text-body]');
      const col = document.querySelector('.vtext-col');
      const page = document.querySelector('[data-testid=recall-page]');
      const bar = document.querySelector('.vactions');
      const br = bar?.getBoundingClientRect();
      const out = { id: window.__core.moment()?.id, readMore: !!document.querySelector('[data-testid=text-more]') || /Read more/.test(document.querySelector('[data-testid=text-view]')?.textContent ?? ''), bar: br ? { top: Math.round(br.top), bottom: Math.round(br.bottom), H: innerHeight, btns: bar.querySelectorAll('button').length } : null };
      if (page) {
        const card = document.querySelector('[data-testid=recall-card]');
        const text = document.querySelector('[data-testid=text-view]');
        const tr = text?.getBoundingClientRect();
        // Steht an einer Stelle mitten im Lesetext die Abrufseite oben, ist der Text verdeckt, nicht teilweise lesbar
        const hit = tr ? document.elementFromPoint(tr.left + tr.width / 2, Math.min(innerHeight - 1, tr.top + 140)) : null;
        const pr = page.getBoundingClientRect();
        out.recall = { card: !!card, covers: !!hit && !!hit.closest('[data-testid=recall-page]'), origin: document.querySelector('[data-testid=recall-origin]')?.textContent ?? '', pageTop: Math.round(pr.top), pageBottom: Math.round(pr.bottom), H: innerHeight, opts: [...document.querySelectorAll('[data-testid=recall-option]')].map((o) => Math.round(o.getBoundingClientRect().top)) };
        return out;
      }
      if (!b) return out;
      const t = (b.textContent ?? '').trimEnd();
      const cs = getComputedStyle(b);
      const v = document.querySelector('[data-testid=verse]');
      out.text = { cut: b.hasAttribute('data-cut'), clamp: b.hasAttribute('data-clamp'), step: col?.dataset.step, overflow: b.scrollHeight > b.clientHeight + 1, sentenceEnd: /[.!?؟…]["'”’»)\]}]*$/.test(t), ar: b.getAttribute('dir') === 'rtl', font: cs.fontFamily, size: cs.fontSize, lh: cs.lineHeight, backslash: t.includes('\\'), verse: v ? { font: getComputedStyle(v).fontFamily, size: getComputedStyle(v).fontSize } : null, hookSize: getComputedStyle(document.querySelector('.vtext-hook')).fontSize, colBottom: Math.round(col.getBoundingClientRect().bottom) };
      return out;
    });
    if (r.readMore) seen.readMore = true;
    if (r.bar) seen.bar.push(r.bar);
    if (r.recall) {
      if (!seen.recall) { seen.recall = r.recall; await pg.screenshot({ path: `${dir}/text-abruf-${area}-${vp.name}${suffix}.png` }); }
      await pg.evaluate(() => window.__core.skipRecall()); await pg.waitForTimeout(400);
      continue;
    }
    if (r.text) {
      if (r.text.overflow) seen.overflow.push(r.id);
      if (r.text.cut && !seen.cut) { seen.cut = r.text; await pg.screenshot({ path: `${dir}/text-schnitt-${area}-${vp.name}${suffix}.png` }); }
      if (r.text.ar && !seen.ar) { seen.ar = r.text; await pg.screenshot({ path: `${dir}/text-arabisch-${area}-${vp.name}${suffix}.png` }); }
    }
    await pg.evaluate(() => window.__core.next()); await pg.waitForTimeout(500);
  }
  if (seen.readMore) fail(`text kein Read more ${tag}`, 'Read more im Text-Reiter'); else ok(`text kein Read more ${tag}`);
  if (seen.overflow.length) fail(`text ohne Überlauf ${tag}`, seen.overflow.join(', ')); else ok(`text ohne Überlauf ${tag}`);
  if (!seen.bar.length || seen.bar.some((b) => b.top < b.H * 0.35 || b.bottom > b.H + 0.5 || b.btns < 3)) fail(`text Leiste sichtbar ${tag}`, JSON.stringify(seen.bar[0])); else ok(`text Leiste sichtbar ${tag}`);
  if (!seen.cut) fail(`text Schnitt am Satzende ${tag}`, 'kein gekürzter Moment gesehen');
  else if (!seen.cut.sentenceEnd || seen.cut.step !== '2' || seen.cut.clamp) fail(`text Schnitt am Satzende ${tag}`, JSON.stringify(seen.cut)); else ok(`text Schnitt am Satzende ${tag}`);
  if (seen.cut && area === 'brain' && parseFloat(seen.cut.hookSize) > 24.5) fail(`text Hook klein ${tag}`, seen.cut.hookSize); else ok(`text Hook klein ${tag}`);
  if (!seen.ar) fail(`text arabisch ${tag}`, 'kein arabischer Moment gesehen');
  else {
    const a = seen.ar;
    if (!/^"?Noto Sans Arabic/.test(a.font) || a.size !== '15px' && a.size !== '14px' && a.size !== '13px') fail(`text arabisch Noto Sans Arabic ${tag}`, `${a.font} ${a.size}/${a.lh}`); else ok(`text arabisch Noto Sans Arabic ${tag}`);
    if (!a.verse || !/^"?Amiri/.test(a.verse.font) || parseFloat(a.verse.size) <= parseFloat(a.size)) fail(`text arabisch Vers in Amiri ${tag}`, JSON.stringify(a.verse)); else ok(`text arabisch Vers in Amiri ${tag}`);
    if (a.backslash) fail(`text arabisch ohne Backslash ${tag}`, 'Backslash im Text'); else ok(`text arabisch ohne Backslash ${tag}`);
    if (a.overflow) fail(`text arabisch ohne Überlauf ${tag}`, `Stufe ${a.step}`); else ok(`text arabisch ohne Überlauf ${tag}`);
  }
  if (!seen.recall) fail(`text Abrufseite ${tag}`, 'keine Abrufkarte im Text-Reiter nach 9 Momenten');
  else {
    const q = seen.recall;
    if (!q.card || !q.covers) fail(`text Abrufseite kein Overlay ${tag}`, JSON.stringify(q)); else ok(`text Abrufseite kein Overlay ${tag}`);
    if (!/Check lens status|A very long hook|تفسير السعدي/.test(q.origin) || !/Author \d/.test(q.origin)) fail(`text Abrufseite Hook und Quelle ${tag}`, q.origin.slice(0, 80)); else ok(`text Abrufseite Hook und Quelle ${tag}`);
    if (q.pageBottom < q.H - 0.5 || q.opts.length < 3 || (vp.width < 768 && q.opts.some((y) => y < q.H * 0.35))) fail(`text Abrufseite Vollbild und Daumenzone ${tag}`, JSON.stringify(q)); else ok(`text Abrufseite Vollbild und Daumenzone ${tag}`);
  }
}
/** Schließen per Knopf und per Tipp auf den Hintergrund; danach wieder öffnen (reopen) */
async function closeTests(pg, label, { sheet, sheetSel, closeSel, reopen, x }) {
  await pg.locator(closeSel).first().click({ timeout: 2000 }).catch(() => {});
  if (await gone(pg, sheet)) ok(`${label} schließt per Knopf`); else fail(`${label} schließt per Knopf`, 'Blatt bleibt offen');
  await reopen(); await pg.waitForSelector(sheet, { timeout: 2500 }); await pg.waitForTimeout(400);
  const top = await pg.evaluate((ss) => document.querySelector(ss).getBoundingClientRect().top, sheetSel);
  await pg.mouse.click(x, Math.max(2, top - 20));
  if (await gone(pg, sheet)) ok(`${label} schließt per Hintergrund`); else fail(`${label} schließt per Hintergrund`, `Tipp bei y ${Math.round(top - 20)} schließt nicht`);
  await reopen(); await pg.waitForSelector(sheet, { timeout: 2500 }); await pg.waitForTimeout(400);
}

for (const R of RUNS) {
cur = R;
browser = await R.type.launch(R.launch);
const only = process.env.LAYOUT_ONLY ? process.env.LAYOUT_ONLY.split(',') : null; // z. B. LAYOUT_ONLY=feed
const strict = process.env.LAYOUT_STRICT !== '0';
for (const area of MOODS) {
  const p = await pool(area);
  for (const vp of cur.viewports) {
    for (const scheme of SCHEMES) {
      if (area !== 'brain' && scheme === 'light') continue; // Beat und Body sind immer dunkel, Hell prüft nur Brain und neutral
      const { cx, pg, errors } = await open(area, vp, scheme, p);
      const tag = `${area} ${vp.name} ${scheme}`;
      const r = await check(pg, `feed ${tag}`, { skipSmall: !strict, flow: true });
      if (r.mood !== area) fail(`stimmung ${tag}`, `data-mood ist ${r.mood}`); else ok(`stimmung ${tag}`);
      await pg.screenshot({ path: `${dir}/feed-${area}-${vp.name}${scheme === 'light' ? '-hell' : ''}.png` });
      if (area === 'body' && vp.width <= 430) await thumbShot(pg, `${dir}/thumb-feed-${vp.name}.png`);
      if (area === 'body') {
        // Zustände der Leiste und der Status-Zeile (Entscheidung 50 und 22E): Stumm kommt vom Start, Offline per Netz aus
        const st = await pg.evaluate(() => { const e = document.querySelector('[data-status]'); return e ? { kind: e.getAttribute('data-status'), text: e.textContent.trim() } : null; });
        if (vp.width < 1181 && st?.kind !== 'muted') fail(`status stumm ${tag}`, JSON.stringify(st)); else ok(`status stumm ${tag}`);
        await check(pg, `status stumm ${tag}`, { skipSmall: true });
        if (vp.width < 1181) await pg.screenshot({ path: `${dir}/status-stumm-${vp.name}.png` });
        await cx.setOffline(true);
        await pg.evaluate(() => window.dispatchEvent(new Event('offline')));
        await pg.waitForTimeout(500);
        const off = await pg.evaluate(() => { const e = document.querySelector('[data-status]'); const t = document.querySelector('[data-testid=form-switch]'); const r = e?.getBoundingClientRect(); return { kind: e?.getAttribute('data-status') ?? null, under: r && t ? r.top >= t.getBoundingClientRect().bottom - 1 || document.querySelector('.desk') !== null : false, count: document.querySelectorAll('[data-status]').length }; });
        if (off.kind !== 'offline' || off.count !== 1) fail(`status offline ${tag}`, JSON.stringify(off)); else ok(`status offline ${tag}`);
        await check(pg, `status offline ${tag}`, { skipSmall: true });
        await pg.screenshot({ path: `${dir}/status-offline-${vp.name}.png` });
        await cx.setOffline(false);
        await pg.evaluate(() => window.dispatchEvent(new Event('online')));
        await pg.waitForTimeout(300);
      }
      if (area === 'body') {
        // Zustände (Entscheidung 43): Kontext, Fokus-Blatt, Fokus aktiv, More, Toast, Abruf
        const isDesk = vp.width >= 1181;
        const snap = async (name) => { await check(pg, `${name} ${tag}`, { skipSmall: !strict }); await pg.screenshot({ path: `${dir}/state-${name.replace(/\s+/g, '-')}-${vp.name}.png` }); };
        if (!isDesk) {
          try { await pg.locator('[data-testid=info-tap]').first().click({ timeout: 2500, force: true }); await pg.waitForSelector('[data-testid=caption-sheet]', { timeout: 2500 }); await pg.waitForTimeout(500); await snap('kontext');
            await sheetCheck(pg, `kontext ${tag}`, '[data-testid=caption-sheet]', '[data-testid=caption-close]');
            await pg.locator('[data-testid=caption-close]').first().click({ timeout: 2000 }).catch(() => {});
            if (await gone(pg, '[data-testid=caption-sheet]')) ok(`kontext schließt per Knopf ${tag}`); else fail(`kontext schließt per Knopf ${tag}`, 'Blatt bleibt offen');
            await pg.locator('[data-testid=info-tap]').first().click({ timeout: 2500, force: true }); await pg.waitForSelector('[data-testid=caption-sheet]', { timeout: 2500 }); await pg.waitForTimeout(400);
            await pg.locator('[data-testid=caption-backdrop]').first().click({ force: true, position: { x: 5, y: 5 } }); await pg.waitForTimeout(300);
            if (await gone(pg, '[data-testid=caption-sheet]')) ok(`kontext schließt per Hintergrund ${tag}`); else fail(`kontext schließt per Hintergrund ${tag}`, 'Blatt bleibt offen');
          } catch (e) { fail(`kontext ${tag}`, String(e).slice(0, 80)); }
          try {
            const tab = pg.locator('[data-testid=form-switch] button:has-text("Video")').first(); const bb = await tab.boundingBox();
            await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.down(); await pg.waitForTimeout(700); await pg.mouse.up();
            await pg.waitForSelector('[data-testid=focus-sheet]', { timeout: 2500 }); await pg.waitForTimeout(500); await snap('fokus-blatt');
            await sheetCheck(pg, `fokus-blatt ${tag}`, '[data-testid=focus-sheet] .sheet', '[data-testid=focus-sheet-close]');
            await closeTests(pg, `fokus-blatt ${tag}`, { sheet: '[data-testid=focus-sheet]', sheetSel: '[data-testid=focus-sheet] .sheet', closeSel: '[data-testid=focus-sheet-close]', x: vp.width / 2, reopen: async () => { const b2 = await tab.boundingBox(); await pg.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await pg.mouse.down(); await pg.waitForTimeout(700); await pg.mouse.up(); } });
            await pg.locator('[data-testid=focus-sheet] .chip:has-text("English")').first().click(); await pg.locator('[data-testid=focus-start]').click(); await pg.waitForTimeout(700);
            const f = await pg.evaluate(() => !!document.querySelector('[data-testid=focus-in-tab]'));
            if (!f) fail(`fokus aktiv ${tag}`, 'kein Zusatz am Reiter'); else ok(`fokus aktiv ${tag}`);
            await snap('fokus-aktiv');
            await pg.evaluate(() => localStorage.removeItem('core-focus')); await pg.reload(); await pg.waitForFunction(() => !!window.__core?.moment(), null, { timeout: 8000 }); await pg.waitForTimeout(500);
          } catch (e) { fail(`fokus ${tag}`, String(e).slice(0, 80)); }
          try { await pg.locator('[data-testid=more]').first().click({ timeout: 2500, force: true }); await pg.waitForSelector('[data-testid=note-sheet]', { timeout: 2500 }); await pg.waitForTimeout(500); await snap('more');
            if (vp.width <= 430) await thumbShot(pg, `${dir}/thumb-more-${vp.name}.png`);
            await sheetCheck(pg, `more ${tag}`, '[data-testid=note-sheet] .sheet', '[data-testid=note-sheet-close]');
            await closeTests(pg, `more ${tag}`, { sheet: '[data-testid=note-sheet]', sheetSel: '[data-testid=note-sheet] .sheet', closeSel: '[data-testid=note-sheet-close]', x: vp.width / 2, reopen: () => pg.evaluate(() => window.__core.openNote()) });
            await pg.locator('[data-testid=note-chip-Wrong]').click(); await pg.waitForTimeout(300); if (await pg.locator('[data-testid=toast]').count()) await snap('toast'); await pg.waitForTimeout(1500); } catch (e) { fail(`more ${tag}`, String(e).slice(0, 80)); }
        }
        try {
          // Abruf: nach dem ersten Tipp läuft die Nachbildung schnell, nach vier gesehenen Momenten kommt die Karte
          await pg.reload(); await pg.waitForFunction(() => !!window.__core?.moment(), null, { timeout: 8000 }); await pg.waitForTimeout(500);
          if (isDesk && (await pg.locator('[data-testid=desk-help]').count())) await pg.keyboard.press('Escape');
          // drei Momente zu über 80 % geschaut, der vierte Wisch bringt die Karte (wie recallqueue.mjs)
          for (let i = 0; i < 4; i++) {
            await pg.evaluate(() => { for (const d of document.querySelectorAll('div')) if (d.__player) d.__player.seekTo(Math.max(0, (window.__core.moment()?.end ?? 60) - 1)); });
            await pg.waitForTimeout(200);
            await pg.evaluate(() => window.__core.next());
            await pg.waitForTimeout(500);
          }
          const got = await pg.waitForSelector('[data-testid=recall-card]', { timeout: 6000 }).then(() => true, () => false);
          if (got) { await pg.waitForTimeout(600); await snap('abruf'); } else fail(`abruf ${tag}`, 'keine Karte nach vier Wischen');
        } catch (e) { fail(`abruf ${tag}`, String(e).slice(0, 80)); }
        if (!isDesk) {
          // Issue 49 (Brief 18): neuer Tag mit der ungesendeten Notiz aus dem More-Test, Zeile "1 note, send?" im Video-Reiter nie über dem Bild, als Tippziel in den unteren 65 Prozent (54)
          try {
            await pg.goto(`${url}?now=2026-10-24&seed=3#k=${p.k}`); await pg.waitForFunction(() => !!window.__core?.moment(), null, { timeout: 8000 }); await pg.waitForTimeout(700);
            const np = await pg.evaluate(() => {
              const n = document.querySelector('[data-testid=notes-prompt]');
              const card = document.querySelector('.vslot[aria-hidden=false] .vframe > div');
              if (!n) return null;
              const a = n.getBoundingClientRect(); const b = card?.getBoundingClientRect();
              const overlap = !!b && Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
              return { form: document.querySelector('.vfeed')?.dataset.form, top: Math.round(a.top), bottom: Math.round(a.bottom), H: innerHeight, card: !!b, cardBottom: b ? Math.round(b.bottom) : null, overlap };
            });
            if (!np) fail(`notiz-zeile ${tag}`, 'keine Zeile "1 note, send?" am neuen Tag');
            else {
              ok(`notiz-zeile ${tag}`);
              if (np.form !== 'video' || !np.card || np.overlap) fail(`notiz-zeile nicht über dem Bild ${tag}`, JSON.stringify(np)); else ok(`notiz-zeile nicht über dem Bild ${tag}`);
              if (np.top < np.H * 0.35) fail(`notiz-zeile Daumenzone ${tag}`, `oben bei ${np.top} von ${np.H}`); else ok(`notiz-zeile Daumenzone ${tag}`);
              await check(pg, `notiz-zeile ${tag}`, { skipSmall: !strict, flow: true });
              await pg.screenshot({ path: `${dir}/state-notiz-zeile-${vp.name}.png` });
            }
            await pg.goto(`${url}?now=2026-10-23&seed=3#k=${p.k}`); await pg.waitForFunction(() => !!window.__core?.moment(), null, { timeout: 8000 }); await pg.waitForTimeout(500);
          } catch (e) { fail(`notiz-zeile ${tag}`, String(e).slice(0, 80)); }
        }
      }
      for (const [form, label] of [['audio', 'Audio'], ['text', 'Text']]) {
        const tab = vp.width >= 1181 ? pg.locator(`[data-testid="desk-tab-${form}"]`) : pg.locator(`[data-testid=form-switch] button:has-text("${label}")`);
        try { await tab.first().click({ timeout: 2500 }); await pg.waitForTimeout(900); } catch { fail(`${form} öffnen ${tag}`, 'Reiter nicht erreichbar'); continue; }
        await check(pg, `${form} ${tag}`, { skipSmall: !strict, flow: true });
        await pg.screenshot({ path: `${dir}/${form}-${area}-${vp.name}${scheme === 'light' ? '-hell' : ''}.png` });
        if (form === 'text' && vp.width < 1181) await textChecks(pg, tag, vp, dir, { area, scheme });
      }
      try { const tab = vp.width >= 1181 ? pg.locator('[data-testid="desk-tab-video"]') : pg.locator('[data-testid=form-switch] button:has-text("Video")'); await tab.first().click({ timeout: 1500 }); await pg.waitForTimeout(500); } catch {}
      if (area === 'body' || (area === 'brain' && scheme === 'light')) {
        // neutrale Screens: Saved und Settings
        for (const [id, name, desk] of [['saved', 'Saved', 'desk-saved'], ['settings', 'Settings', 'desk-settings']]) {
          const btn = vp.width >= 1181 ? pg.locator(`[data-testid="${desk}"]`) : pg.locator(`nav [aria-label="${name}"]`);
          if (vp.width < 1181 && id === 'saved') { await pg.mouse.click(vp.width / 2, vp.height / 2); await pg.waitForTimeout(400); }
          if (id === 'saved' && vp.width < 1181) {
            // ein gespeicherter Moment, damit Raster und Liste etwas zeigen
            try {
              for (let i = 0; i < 3; i++) {
                await pg.locator('[data-testid=save]').first().click({ timeout: 2000, force: true }); await pg.waitForTimeout(300);
                await pg.evaluate(() => window.__core.next()); await pg.waitForTimeout(700);
              }
            } catch {}
          }
          try { await btn.first().click({ timeout: 2500, force: true }); await pg.waitForTimeout(600); } catch { fail(`${id} öffnen ${tag}`, 'Schaltfläche nicht erreichbar'); continue; }
          if (scheme === 'dark' || area === 'body') {
            await check(pg, `${id} ${tag}`, { skipSmall: !strict });
            await pg.screenshot({ path: `${dir}/${id}-${vp.name}${scheme === 'light' ? '-hell' : ''}.png` });
            if (id === 'saved' && (await pg.locator('[data-testid=saved-view-list]').count())) {
              await pg.locator('[data-testid=saved-view-list]').click({ force: true }); await pg.waitForTimeout(300);
              await check(pg, `saved-liste ${tag}`, { skipSmall: !strict });
              await pg.screenshot({ path: `${dir}/saved-liste-${vp.name}${scheme === 'light' ? '-hell' : ''}.png` });
              await pg.locator('[data-testid=saved-view-grid]').click({ force: true }); await pg.waitForTimeout(200);
            }
          }
          try { await btn.first().click({ timeout: 1500, force: true }); } catch {}
        }
      }
      if (errors.length) fail(`js-fehler ${tag}`, errors[0]); else ok(`js-fehler ${tag}`);
      await cx.close();
    }
  }
}
// Unlock-Seite: ohne Schlüssel im Fragment
for (const scheme of SCHEMES) {
  for (const vp of cur.viewports) {
    const cx = await newCtx(vp, scheme);
    const pg = await cx.newPage();
    try {
      await pg.goto(`${url}?now=2026-10-23`);
      await pg.waitForSelector('[data-testid=unlock-screen]', { timeout: 8000 });
      await pg.waitForTimeout(400);
      await check(pg, `unlock ${vp.name} ${scheme}`, { skipSmall: !strict });
      await pg.screenshot({ path: `${dir}/unlock-${vp.name}${scheme === 'light' ? '-hell' : ''}.png` });
    } catch (e) { fail(`unlock ${vp.name} ${scheme}`, String(e).slice(0, 80)); }
    await cx.close();
  }
}
// Share-Blatt und Clip-Seite (Vorschau ?design=, Verdrahtung kommt mit Brief 05)
for (const which of ['share', 'clip', 'clip-text', 'clip-rtl']) {
  for (const scheme of SCHEMES) {
    for (const vp of cur.viewports) {
      const cx = await newCtx(vp, scheme);
      const pg = await cx.newPage();
      try {
        await pg.goto(`${url}?design=${which}`);
        await pg.waitForSelector(which === 'share' ? '[data-testid=share-sheet]' : '[data-testid=clip-view]', { timeout: 8000 });
        await pg.waitForTimeout(700);
        await check(pg, `${which} ${vp.name} ${scheme}`, { skipSmall: !strict });
        if (which === 'share' && vp.width < 1181) await sheetCheck(pg, `share ${vp.name} ${scheme}`, '[data-testid=share-sheet] .sheet', '[data-testid=share-sheet-close]');
        await pg.screenshot({ path: `${dir}/${which}-${vp.name}${scheme === 'light' ? '-hell' : ''}.png` });
      } catch (e) { fail(`${which} ${vp.name} ${scheme}`, String(e).slice(0, 80)); }
      await cx.close();
    }
  }
}
// Wisch nach unten schließt ab 80 px (nur Chromium: WebKit auf Linux kann keine Touch-Ereignisse erzeugen, die Regel prüft tests/sheet-close.test.ts)
if (R.engine === 'chromium') {
  const p = await pool('brain');
  const vp = IPHONES[0];
  const cx = await browser.newContext({ ...devices[vp.device], viewport: { width: vp.width, height: vp.height }, serviceWorkers: 'block', colorScheme: 'dark' });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const pg = await cx.newPage();
  await pg.addInitScript(() => { window.__ytSlow = true; });
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: p.body }));
  const swipe = (sel, y0, dy) => pg.evaluate(([q, a, d]) => {
    const el = document.querySelector(q); const mk = (y) => new Touch({ identifier: 1, target: el, clientX: 200, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [mk(a)], changedTouches: [mk(a)] }));
    el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [mk(a + d)], changedTouches: [mk(a + d)] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [mk(a + d)] }));
  }, [sel, y0, dy]);
  const open = () => pg.evaluate(() => window.__core.openNote());
  try {
    await pg.goto(`${url}?now=2026-10-23&seed=3#k=${p.k}`);
    await pg.waitForFunction(() => !!window.__core?.moment(), null, { timeout: 8000 });
    await pg.waitForTimeout(600);
    await open(); await pg.waitForSelector('[data-testid=note-sheet]'); await pg.waitForTimeout(400);
    await swipe('[data-testid=note-sheet] .sheet-bar', 300, 79); await pg.waitForTimeout(300);
    if (await pg.locator('[data-testid=note-sheet]').count()) ok('more Wisch 79 px bleibt offen'); else fail('more Wisch 79 px bleibt offen', 'Blatt ist zu');
    await swipe('[data-testid=note-sheet] .sheet-bar', 300, 80);
    if (await gone(pg, '[data-testid=note-sheet]')) ok('more Wisch 80 px an der Griffleiste schließt'); else fail('more Wisch 80 px an der Griffleiste schließt', 'Blatt bleibt offen');
    await open(); await pg.waitForSelector('[data-testid=note-sheet]'); await pg.waitForTimeout(400);
    const scrollable = await pg.evaluate(() => { const b = document.querySelector('[data-testid=note-sheet] .sheet-body'); return b.scrollHeight > b.clientHeight + 1; });
    if (scrollable) {
      await pg.evaluate(() => { document.querySelector('[data-testid=note-sheet] .sheet-body').scrollTop = 40; });
      await swipe('[data-testid=note-sheet] .sheet-body', 300, 140); await pg.waitForTimeout(300);
      if (await pg.locator('[data-testid=note-sheet]').count()) ok('more Wisch bei gescrolltem Inhalt schließt nicht'); else fail('more Wisch bei gescrolltem Inhalt schließt nicht', 'Blatt ist zu');
      await pg.evaluate(() => { document.querySelector('[data-testid=note-sheet] .sheet-body').scrollTop = 0; });
    } else ok('more Wisch bei gescrolltem Inhalt schließt nicht');
    await swipe('[data-testid=note-sheet] .sheet-body', 300, 140);
    if (await gone(pg, '[data-testid=note-sheet]')) ok('more Wisch 140 px im Inhalt schließt'); else fail('more Wisch 140 px im Inhalt schließt', 'Blatt bleibt offen');
    await pg.locator('[data-testid=info-tap]').first().click({ timeout: 2500, force: true }); await pg.waitForSelector('[data-testid=caption-sheet]', { timeout: 2500 }); await pg.waitForTimeout(400);
    await swipe('[data-testid=caption-sheet]', 300, 79); await pg.waitForTimeout(300);
    if (await pg.locator('[data-testid=caption-sheet]').count()) ok('kontext Wisch 79 px bleibt offen'); else fail('kontext Wisch 79 px bleibt offen', 'Blatt ist zu');
    await swipe('[data-testid=caption-sheet]', 300, 120);
    if (await gone(pg, '[data-testid=caption-sheet]')) ok('kontext Wisch 120 px schließt'); else fail('kontext Wisch 120 px schließt', 'Blatt bleibt offen');
  } catch (e) { fail('blatt wischen', String(e).slice(0, 120)); }
  await cx.close();
}
await browser.close();
}
writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
const bad = Object.entries(results.checks).filter(([, v]) => !v).length;
console.log(`layout: ${Object.keys(results.checks).length - bad} grün, ${bad} rot`);
for (const f of results.failures) console.log(' ROT', f);
process.exit(bad ? 1 : 0);
