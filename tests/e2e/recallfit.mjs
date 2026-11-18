// E2E Abrufkarte auf jede iPhone-Höhe (Runde 23). Auf dem Gerät war die Karte unbrauchbar: die Optionen lagen unter dem sichtbaren Rand, und ein Wisch nach oben
// zu ihnen wechselte die unbeantwortete Karte weg. Hier wird für alle Prüfhöhen (sichtbarer Bereich, innerHeight) und beide Breiten gemessen:
//  - vor der Antwort liegen Kennzeichnung, Frage und alle drei Optionen (und "Skip") ganz im sichtbaren Bereich, nach der Antwort Erklärung und "Next",
//  - nichts überlappt, Optionen und Tippflächen mindestens 44 px hoch, Schrift von Frage und Optionen mindestens 15 px,
//  - der Hook endet mit "…" an einer Wortgrenze, nie mit einem halben Wort,
//  - ein senkrechter Wisch auf der unbeantworteten Karte wechselt nicht (Diag "recall: swipe blocked", höchstens einmal je Karte), "Skip" schließt ohne Wertung,
//    nach der Antwort schließt ein Wisch nach oben,
//  - "Show text" öffnet als Überlagerung, die Optionen bleiben an ihrem Platz.
// Runde 24: in allen drei Reitern ist die Karte dieselbe volle Seite unter der Reiterleiste (Bezug oben, Block aus Frage und Antworten unten). Zusätzlich je Reiter:
//  - ab innerHeight 700 und normalem Inhalt ist die Stufe höchstens 1,
//  - die Unterkante von "Skip" beziehungsweise "Next" liegt höchstens 25 Prozent der Flächenhöhe über dem unteren Rand der Fläche (kein Loch unten),
//  - nach der Antwort bleiben die Antworten an ihrem Platz (gleiche Stufe, bis Stufe 4).
// Reiter Text, Video und Audio. Fälle: normal, sehr lang (Frage und Optionen je 120 Zeichen), arabisch (rechtsläufig).
// Aufruf: node tests/e2e/recallfit.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
// Browser: E2E_BROWSERS=chromium oder webkit wählt einen. ONLY=375x553,390x664 beschränkt auf diese Prüfhöhen und Breiten (zum Eintippen). SHOTS=<ordner> legt zusätzlich Screenshots für 390x664, 390x793 und 375x553 ab (SCALE=2 für deviceScaleFactor 2).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-recallfit'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
if (process.env.SHOTS) mkdirSync(process.env.SHOTS, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const k = b64u(raw);

// Sichtbarer Bereich (innerHeight) und Sicherheitsränder: 844 und 750 wie eine Web-App mit Dynamic Island und Home-Balken, die kleineren wie Safari mit Leisten
// (dort melden die Ränder 0). 664 steht zusätzlich mit den Rändern der Web-App, als härtere Probe.
const HEIGHTS = [
  { h: 844, top: 47, bottom: 34 },
  { h: 750, top: 47, bottom: 34 },
  { h: 664, top: 0, bottom: 0 },
  { h: 635, top: 0, bottom: 0 },
  { h: 553, top: 0, bottom: 0 },
  { h: 664, top: 47, bottom: 34, tag: 'safe' },
  // Runde 24: Max' iPhone (Audio-Reiter, Diag "recall: shown ... h=793"), Web-App mit Dynamic Island und Home-Balken
  { h: 793, top: 47, bottom: 34 },
];
const WIDTHS = [390, 375];
const FORMS = ['text', 'video', 'audio'];
const CASES = ['normal', 'long', 'arabic'];

const L120 = (s) => `${s} ${'with a long continuation that keeps going '.repeat(4)}`.slice(0, 120).trim();
const EX = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the checked excerpt, long enough to wrap over several lines in the reading column.`).join('\n');
const AR_Q = 'ما الذي يترتب على قول الله تعالى في هذه الآية الكريمة عن العسر واليسر؟';
const AR_O = ['أن العسر لا يخلو من يسر يصاحبه ويأتي بعده', 'أن اليسر لا يأتي إلا بعد انقضاء العسر كله', 'أن العسر دائم لا ينقطع عن صاحبه أبدا'];
const recallOf = (kind, i) =>
  kind === 'long'
    ? { question: L120(`What is the most accurate way to describe what follows from moment ${i}, including the exceptions`), options: [L120(`Right ${i}`), L120(`Wrong A ${i}`), L120(`Wrong B ${i}`)], correct: 0, why: `${L120(`Because ${i} says so`)} The reason in one more clause.`.slice(0, 135) }
    : kind === 'arabic'
      ? { question: AR_Q, options: AR_O, correct: 0, why: 'لأن الله تعالى كرر الوعد باليسر مع العسر، فاليسر قريب من العسر ولا يفارقه.' }
      : { question: `What follows from moment ${i}?`, options: [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`], correct: 0, why: `Because ${i} says so, and here is one more sentence of the reason.` };
const hookOf = (kind, i) =>
  kind === 'long' ? `A very long hook that keeps going over several lines to test wrapping in the page, with many words and a clause or two ${i}`
    : kind === 'arabic' ? 'تفسير السعدي: إن مع العسر يسرا، وما يتصل به من الفوائد في هذه الآية الكريمة'
      : `Check lens status before the next injection ${i} and note it in the chart`;
let n = 0;
const mk = (form, kind) => {
  const i = ++n;
  const base = {
    channel: `Channel (Dr. Test ${i})`, videoTitle: `Test video ${i}`, area: kind === 'arabic' ? 'brain' : 'body', topic: kind === 'arabic' ? 'islam' : 'augen', hook: hookOf(kind, i), kind: 'regel', createdAt: '2026-10-20T00:00:00Z', start: 100, end: 160,
    context: `Context sentence one for moment ${i}.`, recall: recallOf(kind, i), author: `Author ${i}`, ref: `Ref ${i}`, sourceUrl: `https://example.org/s/${i}`, license: 'CC BY 4.0',
  };
  if (form === 'text') return { ...base, id: `texto${String(i).padStart(5, '0')}:100`, videoId: `texto${String(i).padStart(5, '0')}`, form: 'text', excerpt: EX };
  if (form === 'audio') return { ...base, id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, form: 'audio', audio: true, hls: `https://stream.test/${i}.m3u8`, cues: [[0, 'Audio caption one'], [2, 'two']] };
  return { ...base, id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, cues: [[0, 'Caption one'], [2, 'Caption two']], excerpt: EX };
};
const moments = FORMS.flatMap((f) => CASES.map((c) => ({ f, c, m: mk(f, c) })));
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: moments.map((x) => x.m) })));
const POOL = JSON.stringify({ v: 1, iv: b64u(iv), ct: b64u(ct) });

const results = { at: new Date().toISOString(), runs: [], failures: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (page, fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);

/** Messung im Seitenkontext: sichtbare Elemente der Abrufkarte, Grenzen, Überlappung, Schrift, Hook */
const probe = (phase) => {
  const H = innerHeight;
  const W = innerWidth;
  const nav = document.querySelector('nav');
  let limit = H;
  if (nav && !nav.className.includes('translate-y-full')) { const r = nav.getBoundingClientRect(); if (r.top < H) limit = r.top; }
  const page = document.querySelector('[data-testid=recall-page]');
  const card = document.querySelector('[data-testid=recall-card]');
  const root = page ?? card;
  if (!card || !root) return { missing: true, H, W };
  // Nur die Abrufkarte: darunter liegt der Lesetext mit eigenem Kicker, Hook und Quelle
  const q = (s) => root.querySelector(s);
  const vis = (el) => { if (!el) return false; const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; };
  const items = [];
  const add = (name, el, need) => { if (el && vis(el)) items.push({ name, ...box(el), need, size: parseFloat(getComputedStyle(el).fontSize) }); else if (need) items.push({ name, missing: true, need }); };
  add('tag', q('[data-testid=recall-tag]'), phase === 'ask');
  add('skip', q('[data-testid=recall-skip]'), phase === 'ask');
  add('kicker', q('.vkicker'), false);
  add('hook', q('[data-recall-hook]'), false);
  add('source', q('.recall-hooksrc, .vtext-source'), false);
  add('showtext', q('[data-testid=recall-showtext]'), false);
  add('question', q('[data-testid=recall-question]'), true);
  [...document.querySelectorAll('[data-testid=recall-option]')].forEach((o, i) => add(`option${i}`, o, true));
  add('why', q('[data-testid=recall-why]'), phase === 'done');
  add('next', q('[data-testid=recall-next]'), phase === 'done');
  // Lesbarkeit: Kontrast von Schrift zu ihrem tatsächlichen Hintergrund (nächster Vorfahr mit deckender Farbe), mindestens 4,5
  const rgb = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.95) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const contrast = (el) => { const fg = rgb(getComputedStyle(el).color); const bg = bgOf(el); if (!fg) return 21; const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const lowContrast = [];
  for (const [nm, el] of [['hook', q('[data-recall-hook]')], ['question', q('[data-testid=recall-question]')], ...[...document.querySelectorAll('[data-testid=recall-option]')].filter((o) => o.dataset.state !== 'rest').map((o, i) => [`option${i}`, o]), ['why', q('[data-testid=recall-why]')]]) if (el && vis(el) && contrast(el) < 4.5) lowContrast.push(`${nm} ${contrast(el).toFixed(1)}`);
  const rb = root.getBoundingClientRect();
  const act = [q('[data-testid=recall-skip]'), q('[data-testid=recall-next]')].find((e) => e && vis(e));
  const bottomGap = act ? rb.bottom - act.getBoundingClientRect().bottom : null;
  const cs = getComputedStyle(root);
  const inner = { top: rb.top + parseFloat(cs.paddingTop), bottom: rb.bottom - parseFloat(cs.paddingBottom) };
  const hook = q('[data-recall-hook]');
  const hookInfo = hook ? { shown: hook.textContent, full: hook.dataset.full, h: hook.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(hook).lineHeight) } : null;
  const clipped = [];
  for (const el of [q('[data-testid=recall-question]'), ...document.querySelectorAll('[data-testid=recall-option]'), q('[data-testid=recall-why]')]) if (el && !el.hasAttribute('data-scroll') && el.scrollHeight > el.clientHeight + 1) clipped.push(el.dataset.testid);
  const overlaps = [];
  const shown = items.filter((x) => !x.missing);
  for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
    const A = shown[a], B = shown[b];
    const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (w > 0.5 && h > 0.5) overlaps.push(`${A.name}/${B.name}`);
  }
  const need = items.filter((x) => x.need);
  const last = Math.max(...need.filter((x) => !x.missing).map((x) => x.bottom));
  const scrollers = [...document.querySelectorAll('[data-scroll]')].map((e) => e.dataset.testid ?? e.className);
  return {
    H, W, limit, fit: root.dataset.fit, root: page ? 'page' : 'card', dir: card.getAttribute('dir'),
    outside: need.filter((x) => x.missing || x.top < -0.5 || x.bottom > limit + 0.5 || x.left < -0.5 || x.right > W + 0.5 || x.bottom > inner.bottom + 1).map((x) => x.name + (x.missing ? ' fehlt' : ` ${Math.round(x.top)}-${Math.round(x.bottom)}`)),
    small: items.filter((x) => !x.missing && /^(option|next|skip|showtext)/.test(x.name) && x.h < 43.5).map((x) => `${x.name} ${Math.round(x.h)}`),
    fonts: items.filter((x) => /^(question|option)/.test(x.name) && x.size < 15).map((x) => `${x.name} ${x.size}`),
    overlaps, clipped, hookInfo, scrollers, free: Math.round((limit - last) * 10) / 10, last: Math.round(last),
    optTops: [...document.querySelectorAll('[data-testid=recall-option]')].map((o) => Math.round(o.getBoundingClientRect().top)),
    why: (() => { const w = q('.recall-why'); const a = act; return { whyH: w ? Math.round(w.getBoundingClientRect().height) : null, actH: a ? Math.round(a.getBoundingClientRect().height) : null, actTop: a ? Math.round(a.getBoundingClientRect().top) : null }; })(),
    kids: [...card.children].map((c) => `${c.className.split(' ')[0]}:${Math.round(c.getBoundingClientRect().top)}+${Math.round(c.getBoundingClientRect().height)}`).join(' '),
    cardOpen: !!card, lowContrast, bottomGap, surfH: rb.height, hookTop: hook ? Math.round(hook.getBoundingClientRect().bottom) : null, qTop: Math.round(q('[data-testid=recall-question]').getBoundingClientRect().top),
  };
};

const touchSwipe = (page, sel, y0, y1) =>
  page.evaluate(({ sel, y0, y1 }) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    // Ohne new Touch und new TouchEvent: WebKit auf dem Desktop wirft dort "Illegal constructor". Ein gewöhnliches Ereignis mit den Feldern touches und changedTouches
    // trägt dieselben Daten, die Handler lesen nur clientX und clientY.
    const mk = (y) => ({ identifier: 7, target: el, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
    const fire = (type, touches, changed) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'touches', { value: touches });
      Object.defineProperty(ev, 'targetTouches', { value: touches });
      Object.defineProperty(ev, 'changedTouches', { value: changed });
      el.dispatchEvent(ev);
    };
    fire('touchstart', [mk(y0)], [mk(y0)]);
    fire('touchmove', [mk((y0 + y1) / 2)], [mk((y0 + y1) / 2)]);
    fire('touchend', [], [mk(y1)]);
  }, { sel, y0, y1 });

/** Echte Berührung per DevTools-Protokoll (nur Chromium): Finger setzt auf dem Element auf und zieht 250 px nach oben */
async function cdpSwipe(page, sel) {
  const cdp = await page.context().newCDPSession(page);
  const b = await page.locator(sel).first().boundingBox();
  const x = b.x + b.width / 2;
  const y = Math.min(b.y + b.height / 2, page.viewportSize().height - 40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.max(5, y - i * 32) }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([nm]) => targets.includes(nm))) {
  const browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
  for (const vh of HEIGHTS) for (const w of WIDTHS) {
    const tag = `${name} ${w}x${vh.h}${vh.tag ? ' ' + vh.tag : ''}`;
    if (process.env.ONLY && !process.env.ONLY.split(',').some((o) => tag.includes(o))) continue;
    const r = { tag, browser: name, w, h: vh.h, safe: [vh.top, vh.bottom], cards: [], checks: {} };
    results.runs.push(r);
    const fail = (what, detail) => { r.checks[what] = false; results.failures.push(`${tag}: ${what}: ${detail}`); };
    const ok = (what) => { if (!(what in r.checks)) r.checks[what] = true; };
    const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: w, height: vh.h }, colorScheme: process.env.SCHEME ?? 'light', deviceScaleFactor: Number(process.env.SCALE ?? 1), serviceWorkers: 'block' });
    await ctx.addInitScript(({ t, b }) => {
      window.__ytSlow = true;
      const put = () => { if (!document.documentElement) return false; const st = document.createElement('style'); st.textContent = `:root{--safe-top:${t}px;--safe-bottom:${b}px}`; document.documentElement.appendChild(st); return true; };
      if (!put()) document.addEventListener('readystatechange', put, { once: true });
    }, { t: vh.top, b: vh.bottom });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: POOL }));
    try {
      await page.goto(`${url}?now=2026-10-22&seed=3#k=${k}`);
      if (!(await waitFor(page, () => !!window.__core?.moment(), undefined, 20000))) throw new Error('Feed startet nicht');
      for (const form of FORMS) {
        const label = form[0].toUpperCase() + form.slice(1);
        if ((await page.evaluate(() => document.querySelector('.vfeed')?.dataset.form)) !== form) {
          await page.locator(`[data-testid=form-switch] button:has-text("${label}")`).first().click();
          await sleep(900);
        }
        if (!(await waitFor(page, (f) => document.querySelector('.vfeed')?.dataset.form === f && !!window.__core?.moment(), form, 15000))) { fail(`Reiter ${form} offen`, 'Reiter nicht erreicht'); continue; }
        for (const { f, c, m } of moments.filter((x) => x.f === form)) {
          const id = m.id;
          const where = `${form} ${c}`;
          const opened = await page.evaluate((i) => window.__core.showRecall(i), id);
          if (!opened || !(await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 5000))) { fail(`${where} Karte öffnet`, 'keine Karte'); continue; }
          await sleep(500);
          const before = await page.evaluate(probe, 'ask');
          r.cards.push({ form, case: c, phase: 'ask', fit: before.fit, free: before.free, scrollers: before.scrollers });
          const shot = async (ph) => { if (process.env.SHOTS && (w === 390 && (vh.h === 664 && !vh.tag || vh.h === 793) || w === 375 && vh.h === 553)) await page.screenshot({ path: `${process.env.SHOTS}/${name}-${w}x${vh.h}-${form}-${c}-${ph}.png` }); };
          await shot('ask');
          const H0 = await page.evaluate(() => window.innerHeight);
          const verify = (p, ph) => {
            const t = `${where} ${ph}`;
            if (p.missing) return fail(`${t} Karte da`, 'keine Karte');
            if (p.outside.length) fail(`${t} alles im sichtbaren Bereich`, `${p.outside.join(', ')} (Grenze ${Math.round(p.limit)}, Stufe ${p.fit})`); else ok(`${t} alles im sichtbaren Bereich`);
            if (p.overlaps.length) fail(`${t} nichts überlappt`, p.overlaps.join(', ')); else ok(`${t} nichts überlappt`);
            if (p.small.length) fail(`${t} Tippflächen 44 px`, p.small.join(', ')); else ok(`${t} Tippflächen 44 px`);
            if (p.fonts.length) fail(`${t} Schrift mindestens 15 px`, p.fonts.join(', ')); else ok(`${t} Schrift mindestens 15 px`);
            if (p.lowContrast.length) fail(`${t} Schrift lesbar (Kontrast 4,5)`, p.lowContrast.join(', ')); else ok(`${t} Schrift lesbar (Kontrast 4,5)`);
            if (p.clipped.length) fail(`${t} nichts abgeschnitten`, p.clipped.join(', ')); else ok(`${t} nichts abgeschnitten`);
            if (p.scrollers.length) fail(`${t} nichts scrollt`, `${p.scrollers.join(', ')} scrollt in sich (Stufe ${p.fit}, Platz ${p.free})`); else ok(`${t} nichts scrollt`);
            if (H0 >= 700 && c === 'normal') { if (Number(p.fit) > 1) fail(`${t} Stufe höchstens 1 ab 700 px`, `Stufe ${p.fit} bei ${H0}`); else ok(`${t} Stufe höchstens 1 ab 700 px`); }
            if (p.bottomGap !== null) { if (p.bottomGap > 0.25 * p.surfH + 0.5) fail(`${t} Abstand unten höchstens 25 Prozent`, `${Math.round(p.bottomGap)} von ${Math.round(p.surfH)} px`); else ok(`${t} Abstand unten höchstens 25 Prozent`); }
            if (c === 'arabic' && p.dir !== 'rtl') fail(`${t} arabisch rechtsläufig`, `dir=${p.dir}`); else ok(`${t} arabisch rechtsläufig`);
            const hk = p.hookInfo;
            if (hk) {
              const lines = hk.h / hk.lh;
              const cut = hk.shown !== hk.full;
              const prefix = hk.shown.replace(/…$/, '');
              const wordEnd = !cut || (hk.full.startsWith(prefix.trimEnd()) && /^\s/.test(hk.full.slice(prefix.trimEnd().length)) && hk.shown.endsWith('…'));
              if (!wordEnd) fail(`${t} Hook endet mit … an der Wortgrenze`, JSON.stringify(hk.shown)); else ok(`${t} Hook endet mit … an der Wortgrenze`);
              const maxL = Number(p.fit) >= 3 ? 1 : Number(p.fit) === 2 ? 2 : 3;
              if (lines > maxL + 0.05) fail(`${t} Hook höchstens ${maxL} Zeilen`, `${lines.toFixed(2)} Zeilen`); else ok(`${t} Hook Zeilenzahl`);
            }
          };
          verify(before, 'vor der Antwort');
          // Wisch auf der unbeantworteten Karte: Frage, dann eine Option, dann (Chromium) echte Berührung. Die Karte bleibt, die Diag-Zeile steht genau einmal.
          const rs0 = Object.keys(await page.evaluate(() => window.__core.recall().state)).length;
          const L = (await page.evaluate(() => window.innerHeight)) - 60;
          await touchSwipe(page, '[data-testid=recall-question]', L, 60);
          await touchSwipe(page, '[data-testid=recall-option]', L, 40);
          if (name === 'chromium') await cdpSwipe(page, '[data-testid=recall-question]');
          await sleep(250);
          const still = await page.evaluate((i) => ({ card: !!document.querySelector('[data-testid=recall-card]'), cur: window.__core.recall().open, blocked: window.__core.diag().filter((x) => x === `recall: swipe blocked ${i}`).length, state: Object.keys(window.__core.recall().state).length }), id);
          if (!still.card || !still.cur) fail(`${where} Wisch wechselt nie`, 'Karte nach dem Wisch weg'); else ok(`${where} Wisch wechselt nie`);
          if (still.blocked !== 1) fail(`${where} Diag swipe blocked einmal`, `${still.blocked} Zeilen`); else ok(`${where} Diag swipe blocked einmal`);
          if (still.state !== rs0) fail(`${where} Wisch wertet nicht`, `${rs0} -> ${still.state} Einträge`);
          // Show text (Text-Reiter): Überlagerung, die Optionen bleiben an ihrem Platz
          if (form === 'text' && c === 'normal' && before.fit !== undefined && (await page.locator('[data-testid=recall-showtext]').isVisible())) {
            await page.locator('[data-testid=recall-showtext]').click();
            await sleep(250);
            const pk = await page.evaluate(() => {
              const ov = document.querySelector('[data-testid=recall-peekov]');
              const tx = document.querySelector('[data-testid=recall-peektext]');
              const cl = document.querySelector('[data-testid=recall-peekclose]');
              if (!ov || !tx || !cl) return { missing: true };
              const o = ov.getBoundingClientRect();
              const nav = document.querySelector('nav');
              const limit = nav && !nav.className.includes('translate-y-full') ? nav.getBoundingClientRect().top : innerHeight;
              const o0 = document.querySelector('[data-testid=recall-option]').getBoundingClientRect();
              const hit = document.elementFromPoint(o0.left + o0.width / 2, o0.top + o0.height / 2);
              return { covers: !!hit?.closest('[data-testid=recall-peekov]'), top: o.top, bottom: o.bottom, limit, scroll: tx.scrollHeight > tx.clientHeight + 1, closeH: cl.getBoundingClientRect().height, closeW: cl.getBoundingClientRect().width, optTops: [...document.querySelectorAll('[data-testid=recall-option]')].map((x) => Math.round(x.getBoundingClientRect().top)), pos: getComputedStyle(ov).position };
            });
            if (pk.missing || !pk.covers || pk.pos !== 'absolute' || pk.top < 0 || pk.bottom > pk.limit + 0.5 || !pk.scroll || pk.closeH < 43.5 || pk.closeW < 43.5) fail(`${where} Show text als Überlagerung`, JSON.stringify(pk)); else ok(`${where} Show text als Überlagerung`);
            if (!pk.missing && JSON.stringify(pk.optTops) !== JSON.stringify(before.optTops)) fail(`${where} Show text verschiebt Optionen nicht`, `${before.optTops} -> ${pk.optTops}`); else ok(`${where} Show text verschiebt Optionen nicht`);
            await shot('peek');
            await page.locator('[data-testid=recall-peekclose]').click();
            await sleep(150);
            if (await page.locator('[data-testid=recall-peekov]').count()) fail(`${where} Close schließt die Überlagerung`, 'bleibt offen'); else ok(`${where} Close schließt die Überlagerung`);
          }
          // Antwort (die erste ist die richtige, die Reihenfolge ist gemischt)
          await page.locator('[data-testid=recall-option][data-correct="1"]').click();
          await sleep(450);
          const after = await page.evaluate(probe, 'done');
          r.cards.push({ form, case: c, phase: 'done', fit: after.fit, free: after.free, scrollers: after.scrollers });
          await shot('done');
          verify(after, 'nach der Antwort');
          // Bis Stufe 4 bleiben die Antworten an ihrem Platz. Ab Stufe 5 (sehr wenig Höhe, sehr lange Texte) darf der Block nach der Antwort nach oben wachsen.
          if (after.fit === before.fit && Number(before.fit) <= 4) { if (JSON.stringify(after.optTops) !== JSON.stringify(before.optTops)) fail(`${where} Antworten springen nicht`, `${before.optTops} -> ${after.optTops} (Stufe ${before.fit}, vorher ${before.kids}, nachher ${after.kids})`); else ok(`${where} Antworten springen nicht`); }
          if (await page.locator('[data-testid=recall-skip]').isVisible().catch(() => false)) fail(`${where} Skip nach der Antwort weg`, 'sichtbar'); else ok(`${where} Skip nach der Antwort weg`);
          // Nach der Antwort schließt ein Wisch nach oben (einmal je Reiter, Fall normal), sonst "Next"
          if (c === 'normal') {
            await touchSwipe(page, '[data-testid=recall-question]', L, 60);
            if (!(await waitFor(page, () => !document.querySelector('[data-testid=recall-card]'), undefined, 3000))) fail(`${where} Wisch nach der Antwort schließt`, 'Karte bleibt'); else ok(`${where} Wisch nach der Antwort schließt`);
          } else {
            await page.locator('[data-testid=recall-next]').click();
            if (!(await waitFor(page, () => !document.querySelector('[data-testid=recall-card]'), undefined, 3000))) fail(`${where} Next schließt`, 'Karte bleibt'); else ok(`${where} Next schließt`);
          }
          const dg = await page.evaluate((i) => window.__core.diag().filter((x) => x.startsWith('recall:') && x.includes(i)), id);
          if (!dg.some((x) => new RegExp(`^recall: shown ${id} fit=\\d h=${vh.h}$`).test(x))) fail(`${where} Diag shown`, JSON.stringify(dg)); else ok(`${where} Diag shown`);
          if (!dg.some((x) => x === `recall: answered ${id} ok=true`)) fail(`${where} Diag answered`, JSON.stringify(dg)); else ok(`${where} Diag answered`);
          await sleep(200);
        }
        // Skip: schließt ohne Wertung, die Karte kommt nach der bestehenden Regel wieder (kein Eintrag im Wiedervorlage-Stand)
        const sk = moments.find((x) => x.f === form && x.c === 'normal').m;
        await page.evaluate((i) => window.__core.showRecall(i), sk.id);
        if (await waitFor(page, () => !!document.querySelector('[data-testid=recall-skip]'), undefined, 4000)) {
          const rs0 = await page.evaluate(() => Object.keys(window.__core.recall().state).length);
          await page.locator('[data-testid=recall-skip]').click();
          const gone = await waitFor(page, () => !document.querySelector('[data-testid=recall-card]'), undefined, 3000);
          const sk1 = await page.evaluate((i) => ({ n: Object.keys(window.__core.recall().state).length, line: window.__core.diag().includes(`recall: skipped ${i}`), q: window.__core.recallQueue().length }), sk.id);
          if (!gone || sk1.n !== rs0 || !sk1.line) fail(`${form} Skip schließt ohne Wertung`, JSON.stringify({ gone, rs0, ...sk1 })); else ok(`${form} Skip schließt ohne Wertung`);
        } else fail(`${form} Skip sichtbar`, 'kein Knopf');
      }
    } catch (e) {
      fail('Lauf', String(e).slice(0, 200));
    }
    if (errors.length) fail('keine Seitenfehler', errors[0].slice(0, 120));
    await ctx.close();
    const bad = Object.values(r.checks).filter((v) => !v).length;
    console.log(`${tag}: ${Object.keys(r.checks).length} Prüfungen, ${bad} rot; Stufen ${r.cards.map((x) => `${x.form[0]}${x.case[0]}${x.phase === 'ask' ? 'a' : 'd'}${x.fit}/${x.free}`).join(' ')}`);
  }
  await browser.close();
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
if (results.failures.length) {
  console.log(`\n${results.failures.length} Prüfungen rot:`);
  for (const f of results.failures.slice(0, 60)) console.log(' - ' + f);
  process.exit(1);
}
console.log('\nAlle Prüfungen grün.');
