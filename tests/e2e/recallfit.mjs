// E2E Abrufkarte auf jede iPhone-Höhe. Runde 28: kein Kasten, ein Block auf der Seite unter der Reiterleiste (Kennzeile, Bereich, Quelle, Frage, Antworten, "Skip").
// Runde 35: nach der Antwort steht nur die Erklärung, der Hook erscheint auf dem Handy nie. Für alle Prüfhöhen (sichtbarer Bereich, innerHeight) und beide Breiten, in Text, Video und Audio:
//  - kein Kasten (kein Rahmen, kein eigener Hintergrund, kein Schatten, kein Innenabstand an der Karte), kein Platzhalter (.recall-ghost), Seitenrand 24 px,
//  - Hook weder vor noch nach der Antwort sichtbar, kein .recall-hook-after im DOM, nach der Antwort genau eine Erklärung,
//  - Abstand letzte Antwort bis "Skip" höchstens 20 px, Frage höchstens 4 Zeilen ohne "…", Maße und Abstände je Stufe (recallfit.ts),
//  - Position von Kennzeile, Frage und Antworten vor und nach der Antwort gleich (höchstens 1 px), sonst rückt der Block nur nach oben und nur, wenn er sonst überstünde,
//  - freier Platz 40 zu 60 über und unter dem Block (Toleranz 12 px), nichts scrollt, nichts überlappt, nichts abgeschnitten, Kontrast mindestens 4,5,
//  - bei 793 und normalem Inhalt Stufe 0,
//  - ein senkrechter Wisch auf der unbeantworteten Karte wechselt nicht (Diag "recall: swipe blocked", höchstens einmal je Karte), "Skip" schließt ohne Wertung,
//    nach der Antwort schließt ein Wisch nach oben,
//  - "Show text" (Text-Reiter) öffnet als Überlagerung, die Optionen bleiben an ihrem Platz.
// Fälle: normal, sehr lang (Frage und Optionen je 120 Zeichen), arabisch (rechtsläufig). Der Fall "long" hat bei kleinen Höhen (unter 800 px (außer 390x793)) mehr Inhalt, als in den Block passt:
// dort gilt die letzte Stufe, Überhang wird als Grenzfall gemeldet (Zeile "Grenzfall"), nicht als Fehler gewertet. Nie gescrollt, nie "…" in Frage oder Antworten.
// Aufruf: node tests/e2e/recallfit.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
// Browser: E2E_BROWSERS=chromium oder webkit wählt einen. ONLY=375x553,390x664 beschränkt auf diese Prüfhöhen und Breiten (zum Eintippen). SHOTS=<ordner> legt zusätzlich Screenshots für 390x664, 390x793 und 375x553 ab (SCALE=2 für deviceScaleFactor 2).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';
import { onPageError } from './pageerrors.mjs';

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

const results = { at: new Date().toISOString(), runs: [], failures: [], notes: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (page, fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);

/** Messung im Seitenkontext: sichtbare Elemente der Abrufkarte, Grenzen, Überlappung, Schrift, Hook */
const probe = ({ phase, hookTxt }) => {
  const rb0 = (el) => el.getBoundingClientRect();
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
  add('hook', q('[data-testid=recall-hook]'), false);
  add('source', q('.vtext-source'), false);
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
  for (const [nm, el] of [['hook', q('[data-testid=recall-hook]')], ['question', q('[data-testid=recall-question]')], ...[...document.querySelectorAll('[data-testid=recall-option]')].filter((o) => o.dataset.state !== 'rest').map((o, i) => [`option${i}`, o]), ['why', q('[data-testid=recall-why]')]]) if (el && vis(el) && contrast(el) < 4.5) lowContrast.push(`${nm} ${contrast(el).toFixed(1)}`);
  const rb = root.getBoundingClientRect();
  const act = [q('[data-testid=recall-skip]'), q('[data-testid=recall-next]')].find((e) => e && vis(e));
  const bottomGap = act ? rb.bottom - act.getBoundingClientRect().bottom : null;
  const cs = getComputedStyle(root);
  const inner = { top: rb.top + parseFloat(cs.paddingTop), bottom: rb.bottom - parseFloat(cs.paddingBottom) };
  const hook = q('[data-testid=recall-hook]');
  const hookInfo = hook ? { shown: hook.textContent, h: hook.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(hook).lineHeight), clipped: hook.scrollHeight > hook.clientHeight + 1, size: parseFloat(getComputedStyle(hook).fontSize), family: getComputedStyle(hook).fontFamily } : null;
  const clipped = [];
  for (const el of [q('[data-testid=recall-question]'), ...document.querySelectorAll('[data-testid=recall-option]'), q('[data-testid=recall-why]')]) if (el && el.scrollHeight > el.clientHeight + 1) clipped.push(el.dataset.testid);
  const overlaps = [];
  const shown = items.filter((x) => !x.missing);
  for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
    const A = shown[a], B = shown[b];
    const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (w > 0.5 && h > 0.5) overlaps.push(`${A.name}/${B.name}`);
  }
  // Runde 28: Kasten, Hook vor der Antwort, Abstände, Lage des Blocks
  const cc = getComputedStyle(card);
  const boxed = { border: ['Top', 'Right', 'Bottom', 'Left'].map((d) => parseFloat(cc[`border${d}Width`])).some((v) => v > 0), bg: (rgb(cc.backgroundColor)?.a ?? 0) > 0, shadow: cc.boxShadow !== 'none', pad: parseFloat(cc.paddingTop) + parseFloat(cc.paddingLeft) > 0 };
    const opts = [...document.querySelectorAll('[data-testid=recall-option]')];
  const lastOpt = opts[opts.length - 1];
  const skipEl = q('[data-testid=recall-skip]');
  const qEl = q('[data-testid=recall-question]');
  const pcs = getComputedStyle(root);
  const padB = parseFloat(pcs.paddingBottom);
  const headEl = q('.vrecall-head') ?? q('[data-testid=recall-tag]');
  const lastEl = [q('[data-testid=recall-skip]'), q('[data-testid=recall-next]')].find((e) => e && vis(e));
  const ext = {
    boxed, ghost: !!root.querySelector('.recall-ghost'),
    pageTop: rb0(root).top, areaBottom: rb0(root).bottom - padB, tagTop: headEl ? headEl.getBoundingClientRect().top : null, lastBottom: lastEl ? lastEl.getBoundingClientRect().bottom : null,
    skipGap: skipEl && lastOpt && vis(skipEl) ? skipEl.getBoundingClientRect().top - lastOpt.getBoundingClientRect().bottom : null,
    qLines: qEl ? qEl.getBoundingClientRect().height / parseFloat(getComputedStyle(qEl).lineHeight) : null, qText: qEl?.textContent ?? '', optTexts: opts.map((o) => o.textContent),
    qSize: qEl ? parseFloat(getComputedStyle(qEl).fontSize) : null, qLh: qEl ? parseFloat(getComputedStyle(qEl).lineHeight) : null, qW: qEl ? getComputedStyle(qEl).fontWeight : null,
    gaps: { qTop: qEl && q('.vrecall-origin') ? qEl.getBoundingClientRect().top - (q('.vtext-source') && vis(q('.vtext-source')) ? q('.vtext-source') : q('.vkicker')).getBoundingClientRect().bottom : null, qOpt: opts[0] && qEl ? opts[0].getBoundingClientRect().top - qEl.getBoundingClientRect().bottom : null, optGap: opts.length > 1 ? opts[1].getBoundingClientRect().top - opts[0].getBoundingClientRect().bottom : null, srcKick: q('.vtext-source') && vis(q('.vtext-source')) ? q('.vtext-source').getBoundingClientRect().top - q('.vkicker').getBoundingClientRect().bottom : null },
    opt0: opts[0] ? { size: parseFloat(getComputedStyle(opts[0]).fontSize), lh: parseFloat(getComputedStyle(opts[0]).lineHeight), pt: parseFloat(getComputedStyle(opts[0]).paddingTop) + parseFloat(getComputedStyle(opts[0]).borderTopWidth), px: parseFloat(getComputedStyle(opts[0]).paddingLeft) + parseFloat(getComputedStyle(opts[0]).borderLeftWidth), r: getComputedStyle(opts[0]).borderTopLeftRadius, w: opts[0].getBoundingClientRect().width } : null,
    colW: root.getBoundingClientRect().width - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight), sideL: opts[0] ? opts[0].getBoundingClientRect().left - rb0(root).left : null, sideR: opts[0] ? rb0(root).right - opts[0].getBoundingClientRect().right : null,
    whyEl: q('[data-testid=recall-why]') ? { size: parseFloat(getComputedStyle(q('[data-testid=recall-why]')).fontSize), lh: parseFloat(getComputedStyle(q('[data-testid=recall-why]')).lineHeight), top: q('[data-testid=recall-why]').getBoundingClientRect().top } : null,
    nextGap: q('[data-testid=recall-why]') && q('[data-testid=recall-next]') ? q('[data-testid=recall-next]').getBoundingClientRect().top - q('[data-testid=recall-why]').getBoundingClientRect().bottom : null,
    hookAfterInDom: !!root.querySelector('.recall-hook-after'),
    nextH: q('[data-testid=recall-next]') ? q('[data-testid=recall-next]').getBoundingClientRect().height : null,
    visibleHookText: hookTxt ? [...root.querySelectorAll('*')].some((e) => e.children.length === 0 && vis(e) && (e.textContent ?? '').includes(hookTxt)) : null,
    pageScroll: root.scrollHeight - root.clientHeight, anyScrollable: [...root.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1 && vis(e) && !e.closest('[data-testid=recall-peekov]'); }).length,
    srcVisible: !!(q('.vtext-source') && vis(q('.vtext-source'))),
    peekBtn: q('[data-testid=recall-showtext]') ? vis(q('[data-testid=recall-showtext]')) : null,
  };
  const need = items.filter((x) => x.need);
  const last = Math.max(...need.filter((x) => !x.missing).map((x) => x.bottom));
  const scrollers = [...document.querySelectorAll('[data-scroll]')].map((e) => e.dataset.testid ?? e.className);
  return {
    H, W, limit, fit: root.dataset.fit, root: page ? 'page' : 'card', dir: card.getAttribute('dir'),
    outside: need.filter((x) => x.missing || x.top < -0.5 || x.bottom > limit + 0.5 || x.left < -0.5 || x.right > W + 0.5 || x.bottom > inner.bottom + 1).map((x) => x.name + (x.missing ? ' fehlt' : ` ${Math.round(x.top)}-${Math.round(x.bottom)}`)),
    small: items.filter((x) => !x.missing && /^(option|next|skip|showtext)/.test(x.name) && x.h < 43.5).map((x) => `${x.name} ${Math.round(x.h)}`),
    fonts: items.filter((x) => /^(question|option)/.test(x.name) && x.size < 14).map((x) => `${x.name} ${x.size}`),
    overlaps, clipped, hookInfo, scrollers, free: Math.round((limit - last) * 10) / 10, last: Math.round(last),
    optTops: [...document.querySelectorAll('[data-testid=recall-option]')].map((o) => Math.round(o.getBoundingClientRect().top)),
    why: (() => { const w = q('.recall-why'); const a = act; return { whyH: w ? Math.round(w.getBoundingClientRect().height) : null, actH: a ? Math.round(a.getBoundingClientRect().height) : null, actTop: a ? Math.round(a.getBoundingClientRect().top) : null }; })(),
    kids: [...card.children].map((c) => `${c.className.split(' ')[0]}:${Math.round(c.getBoundingClientRect().top)}+${Math.round(c.getBoundingClientRect().height)}`).join(' '),
    ext, cardOpen: !!card, lowContrast, bottomGap, surfH: rb.height, hookTop: hook ? Math.round(hook.getBoundingClientRect().bottom) : null, qTop: Math.round(q('[data-testid=recall-question]').getBoundingClientRect().top),
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
    page.on('pageerror', onPageError(errors));
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
          const before = await page.evaluate(probe, { phase: 'ask', hookTxt: m.hook });
          r.cards.push({ form, case: c, phase: 'ask', fit: before.fit, free: before.free, scrollers: before.scrollers });
          const shot = async (ph) => { if (process.env.SHOTS && (w === 390 && (vh.h === 664 && !vh.tag || vh.h === 793) || w === 375 && vh.h === 553)) await page.screenshot({ path: `${process.env.SHOTS}/${name}-${w}x${vh.h}-${form}-${c}-${ph}.png` }); };
          await shot('ask');
          const H0 = await page.evaluate(() => window.innerHeight);
          const verify = (p, ph) => {
            const t = `${where} ${ph}`;
            if (p.missing) return fail(`${t} Karte da`, 'keine Karte');
            // Grenzfall: der Fall "long" (Frage und drei Antworten je 120 Zeichen, lange Erklärung und langer Hook) passt unter 800 px (außer 390x793) auch auf der letzten Stufe nicht ganz in den Block.
            // Dann gilt die letzte Stufe, es wird nicht gescrollt und nichts gekürzt, der Überhang wird gemeldet, aber nicht als Fehler gewertet.
            const hardCase = c === 'long' && Number(p.fit) === 3 && H0 < 800 && !(w === 390 && H0 === 793);
            const edge = (what, detail) => { if (hardCase) { results.notes.push(`${t}: ${what}: ${detail}`); r.checks[what] = r.checks[what] ?? true; } else fail(what, detail); };
            if (p.outside.length) edge(`${t} alles im sichtbaren Bereich`, `${p.outside.join(', ')} (Grenze ${Math.round(p.limit)}, Stufe ${p.fit})`); else ok(`${t} alles im sichtbaren Bereich`);
            if (p.overlaps.length) fail(`${t} nichts überlappt`, p.overlaps.join(', ')); else ok(`${t} nichts überlappt`);
            if (p.small.length) fail(`${t} Tippflächen 44 px`, p.small.join(', ')); else ok(`${t} Tippflächen 44 px`);
            if (p.fonts.length) fail(`${t} Schrift mindestens 14 px`, p.fonts.join(', ')); else ok(`${t} Schrift mindestens 14 px`);
            if (p.lowContrast.length) fail(`${t} Schrift lesbar (Kontrast 4,5)`, p.lowContrast.join(', ')); else ok(`${t} Schrift lesbar (Kontrast 4,5)`);
            if (p.clipped.length) fail(`${t} nichts abgeschnitten`, p.clipped.join(', ')); else ok(`${t} nichts abgeschnitten`);
            if (p.scrollers.length) fail(`${t} nichts scrollt`, `${p.scrollers.join(', ')} scrollt in sich (Stufe ${p.fit}, Platz ${p.free})`); else ok(`${t} nichts scrollt`);
            const e = p.ext;
            // Normale Fälle bei 793: Stufe 0 (Frage bis 110, Antworten bis 60, Erklärung bis 200 Zeichen)
            if (vh.h === 793 && c === 'normal') { if (Number(p.fit) !== 0) fail(`${t} Stufe 0 bei 793`, `Stufe ${p.fit}`); else ok(`${t} Stufe 0 bei 793`); }
            // kein Kasten, kein Platzhalter, kein Scrollen
            if (e.boxed.border || e.boxed.bg || e.boxed.shadow || e.boxed.pad) fail(`${t} kein Kasten`, JSON.stringify(e.boxed)); else ok(`${t} kein Kasten`);
            if (e.ghost) fail(`${t} kein Platzhalter`, '.recall-ghost da'); else ok(`${t} kein Platzhalter`);
            if (e.pageScroll > 1 || e.anyScrollable) edge(`${t} kein Scrollen`, `Seite ${e.pageScroll} px, scrollbare Elemente ${e.anyScrollable}`); else ok(`${t} kein Scrollen`);
            // Seitenrand 24 px
            if (Math.abs(e.sideL - 24) > 1 || Math.abs(e.sideR - 24) > 1) fail(`${t} Rand 24 px`, `${e.sideL} / ${e.sideR}`); else ok(`${t} Rand 24 px`);
            // Frage höchstens 4 Zeilen, nie gekürzt, Antworten nie gekürzt
            if (e.qLines > 4.05 || /…/.test(e.qText) || e.optTexts.some((x) => /…/.test(x))) fail(`${t} Frage höchstens 4 Zeilen ohne Auslassung`, `${e.qLines?.toFixed(2)} Zeilen`); else ok(`${t} Frage höchstens 4 Zeilen ohne Auslassung`);
            // Maße je Stufe
            const lv = Number(p.fit);
            const W = { q: [22, 20, 18, 18][lv], qlh: [28, 26, 23, 23][lv], o: [16, 15, 14, 14][lv], olh: [22, 20, 19, 19][lv], py: [14, 12, 10, 10][lv], og: [10, 10, 6, 8][lv], gq: [20, 20, 16, 16][lv], go: [16, 16, 12, 12][lv] };
            if (e.qSize !== W.q || e.qLh !== W.qlh || e.qW !== '600') fail(`${t} Frage Maße Stufe ${lv}`, `${e.qSize}/${e.qLh}/${e.qW}`); else ok(`${t} Frage Maße Stufe ${lv}`);
            if (e.opt0.size !== W.o || e.opt0.lh !== W.olh || e.opt0.pt !== W.py || e.opt0.px !== W.py * 0 + (16) || e.opt0.r !== '14px') fail(`${t} Antworten Maße Stufe ${lv}`, JSON.stringify(e.opt0)); else ok(`${t} Antworten Maße Stufe ${lv}`);
            if (Math.abs(e.opt0.w - e.colW) > 1) fail(`${t} Antworten volle Blockbreite`, `${e.opt0.w} von ${e.colW}`); else ok(`${t} Antworten volle Blockbreite`);
            if (e.gaps.optGap !== null && Math.abs(e.gaps.optGap - W.og) > 0.6) fail(`${t} Tastenabstand ${W.og}`, `${e.gaps.optGap}`); else ok(`${t} Tastenabstand ${W.og}`);
            if (Math.abs(e.gaps.qTop - W.gq) > 0.6 || Math.abs(e.gaps.qOpt - W.go) > 0.6) fail(`${t} Abstände Frage ${W.gq}/${W.go}`, `${e.gaps.qTop}/${e.gaps.qOpt}`); else ok(`${t} Abstände Frage ${W.gq}/${W.go}`);
            if (e.gaps.srcKick !== null && Math.abs(e.gaps.srcKick - 6) > 0.6) fail(`${t} Quelle 6 px unter Bereich`, `${e.gaps.srcKick}`); else ok(`${t} Quelle 6 px unter Bereich`);
            if (lv === 3 && e.srcVisible) fail(`${t} Stufe 3 ohne Quelle`, 'Quelle sichtbar'); else ok(`${t} Stufe 3 ohne Quelle`);
            if (ph === 'vor der Antwort') {
              // Hook vor der Antwort nicht sichtbar, Skip dicht unter den Antworten (höchstens 20 px), 40/60-Verteilung
              if (e.visibleHookText || p.hookInfo) fail(`${t} Hook nicht sichtbar`, 'Hook steht vor der Antwort'); else ok(`${t} Hook nicht sichtbar`);
              if (e.skipGap === null || e.skipGap > 20.5) fail(`${t} Skip höchstens 20 px unter den Antworten`, `${e.skipGap}`); else ok(`${t} Skip höchstens 20 px unter den Antworten`);
              const above = e.tagTop - e.pageTop;
              const below = e.areaBottom - e.lastBottom;
              const free = above + below;
              const want = Math.max(0, free < 16 ? free : Math.max(16, 0.4 * free));
              if (Math.abs(above - want) > 12) fail(`${t} Verteilung 40/60`, `oben ${above.toFixed(1)}, unten ${below.toFixed(1)}, erwartet oben ${want.toFixed(1)}`); else ok(`${t} Verteilung 40/60`);
            } else {
              // Nach der Antwort genau eine Erklärung (recall-why), kein Hook auf dem Handy, Abstände Erklärung zu Next, Next so hoch wie eine Antwort
              if (e.hookAfterInDom || p.hookInfo || e.visibleHookText) fail(`${t} kein Hook nach der Antwort`, 'recall-hook-after oder Hook-Text vorhanden'); else ok(`${t} kein Hook nach der Antwort`);
              if (!e.whyEl) fail(`${t} Erklärung da`, 'recall-why fehlt'); else ok(`${t} Erklärung da`);
              if (e.whyEl && (e.whyEl.size !== 15 || e.whyEl.lh !== 21)) fail(`${t} Erklärung 15/21`, JSON.stringify(e.whyEl)); else ok(`${t} Erklärung 15/21`);
              const gn = [16, 16, 12, 12][lv];
              if (e.nextGap === null || Math.abs(e.nextGap - gn) > 0.6) fail(`${t} Abstand Erklärung zu Next`, `${e.nextGap} erwartet ${gn}`); else ok(`${t} Abstand Erklärung zu Next`);
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
          const after = await page.evaluate(probe, { phase: 'done', hookTxt: m.hook });
          r.cards.push({ form, case: c, phase: 'done', fit: after.fit, free: after.free, scrollers: after.scrollers });
          await shot('done');
          verify(after, 'nach der Antwort');
          // Position von Kennzeile, Frage und Antworten vor und nach der Antwort gleich (höchstens 1 px), wenn der Block nicht nach oben rücken musste.
          // Rückte er, dann nur, weil er unverschoben unten über die Fläche hinausginge, und alles verschiebt sich um denselben Betrag.
          {
            const shift = after.ext.tagTop - before.ext.tagTop;
            const same = after.fit === before.fit;
            const unmovedBottom = after.ext.lastBottom - shift;
            const vOf = (x) => [x.ext.tagTop, x.qTop, ...x.optTops];
            if (!same) fail(`${where} Stufe bleibt nach der Antwort`, `${before.fit} -> ${after.fit}`); else ok(`${where} Stufe bleibt nach der Antwort`);
            if (Math.abs(shift) <= 1) {
              if (vOf(after).some((v, i) => Math.abs(v - vOf(before)[i]) > 1)) fail(`${where} Position vor und nach der Antwort gleich`, `${vOf(before)} -> ${vOf(after)}`); else ok(`${where} Position vor und nach der Antwort gleich`);
            } else {
              const uniform = vOf(after).every((v, i) => Math.abs(v - vOf(before)[i] - shift) <= 1.5);
              if (shift > 0 || !uniform || unmovedBottom <= after.ext.areaBottom + 1) fail(`${where} Block rückt nur nach oben, wenn nötig`, `Verschiebung ${shift}, unverschoben unten ${Math.round(unmovedBottom)} von ${Math.round(after.ext.areaBottom)}`); else ok(`${where} Block rückt nur nach oben, wenn nötig`);
            }
          }
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
        // Skip (Runde 34): schließt ohne Wertung, Ergebnisse unverändert, die Karte ist frühestens morgen wieder fällig (Wiedervorlage mit due, Diag "skipped <id>, back <Datum>")
        const sk = moments.find((x) => x.f === form && x.c === 'normal').m;
        await page.evaluate((i) => window.__core.showRecall(i), sk.id);
        if (await waitFor(page, () => !!document.querySelector('[data-testid=recall-skip]'), undefined, 4000)) {
          const rs0 = await page.evaluate((i) => (window.__core.recall().state[i]?.results ?? []).length, sk.id);
          const t0 = Date.parse('2026-10-22');
          await page.locator('[data-testid=recall-skip]').click();
          const gone = await waitFor(page, () => !document.querySelector('[data-testid=recall-card]'), undefined, 3000);
          const sk1 = await page.evaluate((i) => { const it = window.__core.recall().state[i]; return { n: (it?.results ?? []).length, due: it?.due ?? null, line: window.__core.diag().find((x) => x.startsWith(`recall: skipped ${i}, back `)) ?? null }; }, sk.id);
          const tomorrow = sk1.due !== null && sk1.due - t0 >= 20 * 3_600_000;
          if (!gone || sk1.n !== rs0 || !tomorrow || !/^recall: skipped \S+, back \d{4}-\d{2}-\d{2}$/.test(sk1.line ?? '')) fail(`${form} Skip schließt ohne Wertung, frühestens morgen`, JSON.stringify({ gone, rs0, ...sk1 })); else ok(`${form} Skip schließt ohne Wertung, frühestens morgen`);
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
console.log(`${results.notes.length} Grenzfälle (Fall long unter 800 px (außer 390x793), letzte Stufe, Überhang ohne Scrollen und ohne Kürzen)`);
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
if (results.failures.length) {
  console.log(`\n${results.failures.length} Prüfungen rot:`);
  for (const f of results.failures.slice(0, 60)) console.log(' - ' + f);
  process.exit(1);
}
console.log('\nAlle Prüfungen grün.');
