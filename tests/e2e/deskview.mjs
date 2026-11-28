// E2E der Mac-Ansicht (Runde 44, Desktop ab 1181 px): drei Spalten in allen Reitern, keine Überschneidung, Abspielleiste im Fenster, Warteschlange, Tasten, Zeitleiste.
// Ein Fall bei 390x844: die Desk-Elemente fehlen im DOM. Nur Kunst-IDs und Testtexte.
// Aufruf: node tests/e2e/deskview.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview). E2E_BROWSERS=chromium,webkit
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, webkit } from 'playwright';
import { onPageError } from './pageerrors.mjs';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-deskview'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const EX = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the checked excerpt, long enough to wrap over several lines in the reading column.`).join('\n');
const mk = (i, area, extra = {}) => ({
  id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20,
  channel: `Kanal ${area} (Dr. Test ${i % 4})`, videoTitle: `Testvideo ${i}`, area, topic: 'augen', hook: `Testmoment ${i} ${area}, ein Satz mit etwas mehr Text damit der Umbruch sichtbar wird`, kind: 'regel',
  createdAt: '2026-10-20T00:00:00Z', cues: [[0, 'Untertitel eins, a marketing message'], [2, 'Untertitel zwei, noch eine Zeile.'], [5, 'Untertitel drei.']], excerpt: EX,
  recall: { question: `What follows from moment ${i}?`, options: [`Wrong A ${i}`, `Right ${i}`, `Wrong B ${i}`], correct: 1, why: `Because ${i} says so.` }, ...extra,
});
const moments = [];
for (let i = 0; i < 12; i++) moments.push(mk(i, 'beat'));
for (let i = 12; i < 30; i++) moments.push(mk(i, 'brain'));
for (let i = 30; i < 40; i++) moments.push(mk(i, 'body'));
const LONG = ' und dazu ein langer zweiter Teil, der klar über drei Zeilen der schmalen Warteschlange hinausgeht, damit die Auslassungspunkte nötig werden';
for (let i = 40; i < 46; i++) moments.push(mk(i, 'brain', { form: 'audio', audio: true, hls: `https://stream.test/${i}.m3u8`, ...(i === 42 || i === 44 ? { hook: `Testmoment ${i} brain, ein Satz${LONG}` } : {}) }));
for (let i = 46; i < 56; i++) moments.push(mk(i, 'body', { form: 'text', videoId: `texto${String(i).padStart(5, '0')}`, author: `Author ${i}`, ref: `Ref ${i}`, sourceUrl: `https://example.org/s/${i}`, license: 'CC BY 4.0', ...(i === 46 ? { kind: 'takeaway', apply: 'Do the small thing today.', origin: 'Test entry 30' } : {}) }));
// Runde 53: arabischer Textmoment (eigener Testtext), Doppelpunkt ohne Leerzeichen wie in der Quelle
const AR_TXT = 'الخسار مراتب متعددة متفاوتة:قد يكون خسارًا مطلقًا، كحال من خسر الدنيا والآخرة. ونمجِّدك بكل صفات:الإيمان والعمل الصالح؛فهذا هو المطلوب في سورة العصر 103:2 عند الساعة 10:30.';
moments.push(mk(56, 'body', { form: 'text', videoId: 'texto00056', author: 'Author 56', ref: 'Ref 56', sourceUrl: 'https://example.org/s/56', license: 'CC BY 4.0', hook: 'هذا عنوان تجريبي لنص عربي', excerpt: AR_TXT }));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
const POOL = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');

const waitFor = async (page, fn, arg, timeout = 6000) => { try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; } };
const E = (pg, id) => pg.locator(`[data-testid="${id}"]`);
const has = async (pg, id) => (await E(pg, id).count()) > 0;
const idx = (pg) => pg.evaluate(() => window.__core.idx());
// WebKit setzt :focus-visible bei focus() aus dem Skript nicht verlässlich (Safari wandert per Tab auch nicht über Tasten).
// Dort gilt ersatzweise: Es gibt eine :focus-visible-Regel für genau dieses Element mit einem Rahmen ab 2 px.
const focusRule = (pg, sel, on) => pg.evaluate(([sel, on]) => {
  const el = document.querySelector(sel); const tgt = on ? document.querySelector(on) : el;
  if (!el || !tgt) return false;
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) {
      if (!r.selectorText || !r.selectorText.includes(':focus-visible')) continue;
      const w = parseFloat(r.style.outlineWidth || (r.cssText.match(/outline(?:-width)?:\s*([\d.]+)px/) || [])[1] || '0');
      if (w < 2) continue;
      try { if (tgt.matches(r.selectorText.replaceAll(':focus-visible', ''))) return true; } catch { /* Selektor nicht prüfbar */ }
    }
  }
  return false;
}, [sel, on ?? null]);
const press = async (pg, key, ms = 60) => { await pg.keyboard.press(key); await pg.waitForTimeout(ms); };

const open = async (type, size) => {
  const browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
  const cx = await browser.newContext({ viewport: size, serviceWorkers: 'block', deviceScaleFactor: 1 });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const pg = await cx.newPage();
  const errors = [];
  pg.on('pageerror', onPageError(errors));
  await pg.addInitScript(() => { window.__ytSlow = true; });
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: POOL }));
  await pg.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
  await waitFor(pg, () => !!window.__core?.moment());
  await pg.waitForTimeout(600);
  if (await has(pg, 'desk-help')) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); }
  return { browser, pg, errors };
};

// Rechtecke der Hauptbausteine, ihre Überschneidung und ob etwas ins Fenster ragt
const GEOM = () => {
  const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const q = (s) => document.querySelector(s);
  const bar = box(q('[data-testid=desk-bar]'));
  const cols = { queue: box(q('[data-testid=desk-queue-aside]')), main: box(q('.dmain')), side: box(q('[data-testid=desk-aside]')) };
  const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  const overlapCols = hit(cols.queue, cols.main) || hit(cols.main, cols.side) || hit(cols.queue, cols.side);
  // Elemente der Mitte: nichts ragt über die Kopfleiste, aus der Mitte oder aus dem Fenster
  const mid = [...document.querySelectorAll('.dc > *, .dc-textbar, .vtext > *, .vframe > div, .vposter')].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map(box).filter((b) => b.w > 0 && b.h > 0);
  const aboveBar = mid.some((b) => b.t < bar.b - 0.5);
  const outOfMain = mid.some((b) => b.l < cols.main.l - 0.5 || b.r > cols.main.r + 0.5);
  const tr = q('[data-testid=desk-transport]') ?? q('[data-testid=desk-textbar]');
  const trb = tr ? box(tr) : null;
  const inWindow = !!trb && trb.l >= 0 && trb.r <= innerWidth && trb.t >= 0 && trb.b <= innerHeight;
  // Kinder der Mitte überlappen sich nicht (Platzhalter, Meta, Feld, Leiste)
  const kids = [...document.querySelectorAll('.dc > *')].map(box);
  let kidsOverlap = false;
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (hit({ l: kids[i].l, t: kids[i].t, r: kids[i].r, b: kids[i].b }, kids[j])) kidsOverlap = true;
  const noHScroll = document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight;
  // Nichts in den Spalten ist abgeschnitten: Spalten selbst scrollen nicht horizontal, die Warteschlange zeigt nur ganze Einträge
  const qItems = [...document.querySelectorAll('[data-testid=desk-queue-item]')].filter((e) => !e.parentElement.hidden).map(box);
  const queueWhole = qItems.every((b) => b.b <= cols.queue.b - 0.5 && b.t >= cols.queue.t);
  const sideFits = document.querySelector('[data-testid=desk-aside]').scrollWidth <= cols.side.w + 1;
  return { overlapCols, aboveBar, outOfMain, inWindow, kidsOverlap, noHScroll, queueWhole, sideFits, queueShown: qItems.length, barB: bar.b, cols };
};

// Runde 44b: Zeilen des Audio-Felds, Raster der Gruppe, Warteschlange, Leiste
const LYR = () => {
  const q = (s) => document.querySelector(`[data-testid=${s}]`);
  const f = q('desk-lyrics');
  if (!f) return null;
  const r = (e) => e.getBoundingClientRect();
  const cur = q('desk-lyric-cur'), prev = q('desk-lyric-prev'), next = q('desk-lyric-next');
  const fr = r(f);
  const fs = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : 0);
  const els = [prev, cur, next].filter(Boolean);
  return {
    cur: cur?.textContent ?? '', prev: prev?.textContent ?? '', next: next?.textContent ?? '', hasPrev: !!prev, hasNext: !!next,
    curTop: cur ? r(cur).top : null, curFont: fs(cur), prevFont: fs(prev), nextFont: fs(next),
    prevColor: prev ? getComputedStyle(prev).color : '', nextColor: next ? getComputedStyle(next).color : '', curColor: cur ? getComputedStyle(cur).color : '',
    fieldH: fr.height, hscroll: f.scrollWidth > f.clientWidth + 1,
    inside: els.every((e) => { const b = r(e); return b.left >= fr.left - 0.5 && b.right <= fr.right + 0.5 && b.top >= fr.top - 0.5 && b.bottom <= fr.bottom + 0.5; }),
    ordered: (!prev || !cur || r(prev).bottom <= r(cur).top + 0.5) && (!next || !cur || r(cur).bottom <= r(next).top + 0.5),
  };
};
const RASTER = () => {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  const head = r('.dc-head'), lyr = r('[data-testid=desk-lyrics]'), tr = r('[data-testid=desk-transport]'), main = r('.dmain');
  const rate = r('[data-testid=desk-rate]'), play = r('[data-testid=desk-play]'), prev = r('[data-testid=desk-prev]'), next = r('[data-testid=desk-next]');
  return { gap1: lyr.top - head.bottom, gap2: tr.top - lyr.bottom, top: head.top - main.top, bottom: main.bottom - tr.bottom, rateLeft: rate.left - tr.left, playCx: play.left + play.width / 2 - (tr.left + tr.width / 2), rateRightOfTrack: rate.right <= prev.left, ccAbsent: !document.querySelector('[data-testid=desk-cc]'),
    order: rate.right <= prev.left && prev.right <= play.left && play.right <= next.left };
};
const QUEUE = async (pg) => {
  const items = E(pg, 'desk-queue-item');
  const n = await items.count();
  const info = await pg.evaluate(() => {
    const out = [...document.querySelectorAll('[data-testid=desk-queue-item]')].filter((e) => !e.parentElement.hidden).map((e) => {
      const h = e.querySelector('.dq-hook'), cs = getComputedStyle(h), li = getComputedStyle(e.parentElement);
      return { cur: e.hasAttribute('data-current'), clamp: cs.webkitLineClamp, h: h.clientHeight, sh: h.scrollHeight, len: h.textContent.length, sep: li.borderTopWidth, bg: getComputedStyle(e).backgroundColor, bd: getComputedStyle(e).borderTopColor };
    });
    return out;
  });
  return { n, info };
};

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {}, notes: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    // ---------- 1440x900: alle drei Reiter ----------
    {
      const o = await open(type, { width: 1440, height: 900 });
      browser = o.browser;
      const pg = o.pg;
      for (const [form, tab] of [['video', '1'], ['audio', '2'], ['text', '3']]) {
        await press(pg, tab, 1500);
        await waitFor(pg, () => window.__core.state() === 1 || document.querySelector('[data-testid=text-view]'), undefined, 4000);
        const g = await pg.evaluate(GEOM);
        r.notes[`geo-${form}`] = g;
        c[`${form}ThreeColumns`] = g.cols.queue.w >= 272 && g.cols.queue.w <= 296 && g.cols.side.w >= 320 && g.cols.side.w <= 344 && g.cols.main.w > 600 && (await has(pg, 'desk-queue')) && (await has(pg, 'desk-panel'));
        c[`${form}NoColumnOverlap`] = !g.overlapCols;
        c[`${form}NothingAboveBar`] = !g.aboveBar && !g.outOfMain;
        c[`${form}TransportInWindow`] = g.inWindow;
        c[`${form}NoKidOverlap`] = !g.kidsOverlap && g.noHScroll;
        c[`${form}QueueAtLeast3`] = g.queueShown >= 3 && g.queueWhole && g.sideFits;
        c[`${form}HookInCenter`] = (await E(pg, 'desk-hook').innerText()) === (await pg.evaluate(() => window.__core.moment().hook));
        // Klick auf Eintrag 2 wechselt den Moment
        const before = await idx(pg);
        const id0 = await pg.evaluate(() => window.__core.moment().id);
        const second = E(pg, 'desk-queue-item').nth(1);
        const target = Number(await second.getAttribute('data-index'));
        await second.click();
        await waitFor(pg, (j) => window.__core.idx() === j, target);
        c[`${form}QueueClickSwitches`] = (await idx(pg)) === target && target === before + 1 && (await pg.evaluate(() => window.__core.moment().id)) !== id0;
        {
          // Runde 44b: Liste lesbar, laufender Eintrag klar, Hover und Fokus der übrigen, lange Hooks mit Auslassung
          const qi = await QUEUE(pg);
          const rows = qi.info;
          r.notes[`queue-${form}`] = rows;
          c[`${form}QueueCurrentMarked`] = rows.filter((x) => x.cur).length === 1 && rows[0].cur && rows[0].bd !== 'rgba(0, 0, 0, 0)' && rows[0].bg !== rows[1].bg;
          c[`${form}QueueSeparators`] = rows.slice(1).every((x, k) => k === 0 || x.sep === '1px');
          c[`${form}QueueLongHookClamped`] = rows.filter((x) => x.len > 150).every((x) => x.clamp === '3' && x.h <= 61 && x.sh > x.h) && (form !== 'audio' || rows.some((x) => x.len > 150));
          const it = E(pg, 'desk-queue-item').nth(2);
          const bg0 = await it.evaluate((e) => getComputedStyle(e).backgroundColor);
          await it.hover();
          await pg.waitForTimeout(250);
          const hov = await it.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, cur: getComputedStyle(e).cursor }));
          c[`${form}QueueHoverState`] = hov.bg !== bg0 && hov.cur === 'pointer';
          await pg.mouse.move(700, 450);
          await pg.keyboard.press('Shift');
          await it.focus();
          const ring = await it.evaluate((e) => ({ st: getComputedStyle(e).outlineStyle, w: parseFloat(getComputedStyle(e).outlineWidth), m: e.matches(':focus-visible') }));
          c[`${form}QueueFocusState`] = (ring.m && ring.st !== 'none' && ring.w >= 2) || (name === 'webkit' && await focusRule(pg, '.dq-list .dq-item:not([aria-current])'));
          await it.evaluate((e) => e.blur());
        }
        // Pfeil runter wechselt, Pfeil hoch zurück
        const i1 = await idx(pg);
        await press(pg, 'ArrowDown', 300);
        c[`${form}ArrowDownSwitches`] = (await idx(pg)) === i1 + 1;
        await press(pg, 'ArrowUp', 300);
        c[`${form}ArrowUpSwitches`] = (await idx(pg)) === i1;
        if (form !== 'text') {
          await waitFor(pg, () => window.__core.state() === 1);
          // Leertaste pausiert und setzt fort, der Knopf zeigt es
          await press(pg, ' ', 200);
          const paused = (await pg.evaluate(() => window.__core.state())) === 2 && (await E(pg, 'desk-play').getAttribute('aria-label')) === 'Play';
          await press(pg, ' ', 200);
          c[`${form}SpacePausesAndResumes`] = paused && (await pg.evaluate(() => window.__core.state())) === 1 && (await E(pg, 'desk-play').getAttribute('aria-label')) === 'Pause';
          // Die Zeitleiste bewegt sich beim Abspielen
          const t0 = await E(pg, 'desk-timeline').getAttribute('aria-valuenow');
          const w0 = await pg.evaluate(() => document.querySelector('.dt-fill').getBoundingClientRect().width);
          await pg.waitForTimeout(2200);
          const w1 = await pg.evaluate(() => document.querySelector('.dt-fill').getBoundingClientRect().width);
          const t1 = await E(pg, 'desk-timeline').getAttribute('aria-valuenow');
          c[`${form}TimelineMoves`] = w1 > w0 && Number(t1) > Number(t0);
          c[`${form}TimesShown`] = /^\d+:\d\d$/.test(await E(pg, 'desk-time-now').innerText()) && /^\d+:\d\d$/.test(await E(pg, 'desk-time-len').innerText());
          // Tempo-Taste ruft nextRate
          await E(pg, 'desk-rate').click();
          c[`${form}RateButton`] = await waitFor(pg, () => window.__core.rate() === 1.5);
          await E(pg, 'desk-rate').click();
          await E(pg, 'desk-rate').click();
          await waitFor(pg, () => window.__core.rate() === 1);
          // Weiter-Knopf und Voriger-Knopf
          const i2 = await idx(pg);
          await E(pg, 'desk-next').click();
          await waitFor(pg, (j) => window.__core.idx() === j, i2 + 1);
          c[`${form}NextButton`] = (await idx(pg)) === i2 + 1;
          await E(pg, 'desk-prev').click();
          await waitFor(pg, (j) => window.__core.idx() === j, i2);
          c[`${form}PrevButton`] = (await idx(pg)) === i2;
        }
        if (form === 'video') {
          // Springen im Ausschnitt: Pfeil rechts und links, Klick auf die Zeitleiste, nie außerhalb des Ausschnitts
          await waitFor(pg, () => window.__core.state() === 1);
          const pos = () => pg.evaluate(() => { for (const d of document.querySelectorAll('.vslot[aria-hidden="false"] div')) if (d.__player) return d.__player.getCurrentTime(); return -1; });
          const m = await pg.evaluate(() => window.__core.moment());
          const a = await pos();
          await press(pg, 'ArrowRight', 300);
          const b = await pos();
          c.videoArrowRightSeeks = b >= a + 9 && b <= m.end;
          await press(pg, 'ArrowLeft', 300);
          const d = await pos();
          c.videoArrowLeftSeeks = d <= b - 9 && d >= m.start;
          for (let n = 0; n < 12; n++) await pg.keyboard.press('ArrowLeft');
          await pg.waitForTimeout(300);
          c.videoSeekClampedAtStart = (await pos()) >= m.start - 0.01;
          for (let n = 0; n < 12; n++) await pg.keyboard.press('ArrowRight');
          await pg.waitForTimeout(300);
          c.videoSeekClampedAtEnd = (await pos()) <= m.end;
          await pg.waitForFunction(() => window.__core.state() !== 0);
          const bb = await E(pg, 'desk-timeline').boundingBox();
          await pg.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height / 2);
          await pg.waitForTimeout(300);
          const mid = await pos();
          c.videoTimelineClickSeeks = Math.abs(mid - (m.start + (m.end - m.start) * 0.5)) < 4;
          // C: Untertitel im Bild unten, innerhalb des Bildes
          await press(pg, 'c', 300);
          const sub = await pg.evaluate(() => { const s = document.querySelector('[data-testid=desk-subtitle]'); const v = document.querySelector('[data-testid=desk-media]'); if (!s || !v) return null; const a = s.getBoundingClientRect(), b = v.getBoundingClientRect(); return { inside: a.left >= b.left && a.right <= b.right && a.bottom <= b.bottom && a.top >= b.top, low: a.top > b.top + b.height / 2 }; });
          c.videoSubtitleInFrameBottom = !!sub && sub.inside && sub.low;
          // V: Vollbild über die Fullscreen API (in Headless nicht überall erlaubt: dann prüft der Test nur den Knopf)
          c.videoFullscreenButton = (await E(pg, 'fullscreen').innerText()).includes('Full screen');
          await press(pg, 'v', 500);
          const fs = await pg.evaluate(() => !!document.fullscreenElement);
          r.notes.fullscreen = fs;
          if (fs) { await press(pg, 'v', 500); c.videoFullscreenToggles = !(await pg.evaluate(() => !!document.fullscreenElement)); }
        }
        if (form === 'video') {
          // Runde 44b: Gruppe ohne Lücke, mittig, Player 16:9 und höchstens 760 px, Griff und CC
          const g = await pg.evaluate(() => {
            const r = (s) => document.querySelector(s).getBoundingClientRect();
            const media = r('[data-testid=desk-media]'), hook = r('[data-testid=desk-hook]'), meta = r('.dc-meta'), tr = r('[data-testid=desk-transport]'), main = r('.dmain');
            const players = [...document.querySelectorAll('.vframe > div, .vposter')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
            return { gap: tr.top - hook.bottom, gapTop: meta.top - media.bottom, top: media.top - main.top, bottom: main.bottom - tr.bottom, w: media.width, h: media.height, minTop: 40,
              aligned: players.some((b) => Math.abs(b.left - media.left) < 1.5 && Math.abs(b.top - media.top) < 1.5 && Math.abs(b.width - media.width) < 1.5) };
          });
          r.notes.videoGroup = g;
          c.videoHookToBarGap = g.gap >= 0 && g.gap <= 64 && Math.abs(g.gap - g.gapTop) <= 12;
          c.videoGroupCentered = Math.abs(g.top - g.bottom) <= 3 || g.top <= g.minTop + 1;
          c.videoPlayer169Max760 = Math.abs(g.w / g.h - 16 / 9) < 0.02 && g.w <= 760.5;
          c.videoPlayerAlignsWithGroup = g.aligned;
          const th = await pg.evaluate(() => { const t = document.querySelector('.dt-thumb'); const b = document.querySelector('[data-testid=desk-timeline]'); return t ? { w: t.getBoundingClientRect().width, cur: getComputedStyle(b).cursor, role: b.getAttribute('role') } : null; });
          c.videoTimelineHandleDraggable = !!th && th.w >= 14 && th.cur === 'pointer' && th.role === 'slider';
          await pg.keyboard.press('Shift');
          await E(pg, 'desk-timeline').focus();
          const thumbRing = await pg.evaluate(() => { const t = document.querySelector('.dt-thumb'); const cs = getComputedStyle(t); return document.activeElement?.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });
          c.videoTimelineHandleFocusRing = !!thumbRing || (name === 'webkit' && await focusRule(pg, '[data-testid=desk-timeline]', '.dt-thumb'));
          await E(pg, 'desk-timeline').evaluate((e) => e.blur());
          // CC rechts in der Leiste, schaltet wie C
          const cc = E(pg, 'desk-cc');
          c.videoCcShown = (await cc.count()) === 1 && (await pg.evaluate(() => { const b = document.querySelector('[data-testid=desk-cc]').getBoundingClientRect(), t = document.querySelector('[data-testid=desk-transport]').getBoundingClientRect(), n = document.querySelector('[data-testid=desk-next]').getBoundingClientRect(); return b.left > n.right && b.right <= t.right; }));
          const on0 = (await cc.getAttribute('aria-pressed')) === 'true' && (await has(pg, 'desk-subtitle'));
          await cc.click();
          await pg.waitForTimeout(200);
          const off = (await cc.getAttribute('aria-pressed')) === 'false' && !(await has(pg, 'desk-subtitle'));
          await press(pg, 'c', 200);
          const on1 = (await cc.getAttribute('aria-pressed')) === 'true' && (await has(pg, 'desk-subtitle'));
          c.videoCcTogglesLikeC = on0 && off && on1;
        }
        if (form === 'audio') {
          const a = await pg.evaluate(() => { const cv = document.querySelector('[data-testid=desk-cover]').getBoundingClientRect(); return { w: cv.width, h: cv.height }; });
          c.audioCover176 = Math.round(a.w) === 176 && Math.round(a.h) === 176;
          c.audioLyricsField = await waitFor(pg, () => !!document.querySelector('[data-testid=desk-lyric-cur]')?.textContent);
          // Die Zeitleiste ist im Audio-Reiter nur Anzeige (das Audio-Deck springt nicht)
          c.audioTimelineReadOnly = (await E(pg, 'desk-timeline').getAttribute('role')) === 'progressbar';
          await press(pg, 'c', 200);
          c.audioCaptionsOff = (await E(pg, 'desk-lyrics').innerText()).includes('Captions are off');
          await press(pg, 'c', 200);
          // Runde 44b: kein Griff, kein Zeiger, Leiste links Tempo, mittig drei Tasten, rechts frei, Cover-Platzhalter bei abgebrochenem Bild
          const tl = await pg.evaluate(() => { const b = document.querySelector('[data-testid=desk-timeline]'); return { thumb: !!document.querySelector('.dt-thumb'), cur: getComputedStyle(b).cursor, tab: b.hasAttribute('tabindex'), seekable: b.hasAttribute('data-seekable') }; });
          c.audioTimelineNoHandle = !tl.thumb && tl.cur !== 'pointer' && !tl.tab && !tl.seekable;
          const ra = await pg.evaluate(RASTER);
          r.notes.audioRaster = ra;
          c.audioTransportLayout = ra.order && ra.ccAbsent && Math.abs(ra.playCx) <= 2 && ra.rateLeft <= 32;
          c.audioGridEven = Math.abs(ra.gap1 - ra.gap2) <= 1.5 && ra.gap1 > 0 && ra.gap1 <= 32 && Math.abs(ra.top - ra.bottom) <= 2;
          const ph = await pg.evaluate(() => { const p = document.querySelector('[data-testid=desk-cover-ph]'); const cv = document.querySelector('[data-testid=desk-cover]'); return p ? { t: p.textContent, w: p.getBoundingClientRect().width, h: p.getBoundingClientRect().height, img: !!cv.querySelector('img'), bg: getComputedStyle(p).backgroundColor, ch: document.querySelector('.dc').textContent.length > 0 } : null; });
          const chan = await pg.evaluate(() => window.__core.moment().channel);
          r.notes.coverPh = { ph, chan };
          c.audioCoverPlaceholder = !!ph && ph.t === chan.trim()[0].toUpperCase() && !ph.img && ph.w >= 174 && ph.w <= 176 && ph.h >= 174 && ph.h <= 176 && ph.bg !== 'rgba(0, 0, 0, 0)';
          // Drei Zeilen: neues Moment von vorn, Zeilenwechsel eins, zwei, drei beobachten
          await press(pg, 'ArrowDown', 100);
          await waitFor(pg, () => window.__core.state() === 1);
          const samples = [];
          for (let n = 0; n < 60; n++) { const x = await pg.evaluate(LYR); if (x && x.cur) samples.push(x); await pg.waitForTimeout(150); if (samples.some((y) => y.cur.startsWith('Untertitel drei')) && n > 40) break; }
          const texts = [...new Set(samples.map((x) => x.cur))];
          r.notes.lyricTexts = texts;
          const mid = samples.find((x) => x.cur.startsWith('Untertitel zwei'));
          const first = samples.find((x) => x.cur.startsWith('Untertitel eins'));
          const last = samples.find((x) => x.cur.startsWith('Untertitel drei'));
          c.audioThreeLines = !!mid && mid.prev.startsWith('Untertitel eins') && mid.next.startsWith('Untertitel drei') && mid.hasPrev && mid.hasNext;
          c.audioLineHierarchy = !!mid && mid.prevFont < mid.curFont && mid.nextFont < mid.prevFont && mid.prevColor !== mid.nextColor && mid.curColor !== mid.prevColor;
          c.audioCurrentLineFixed = texts.length >= 3 && samples.every((x) => Math.abs(x.curTop - samples[0].curTop) <= 0.5);
          c.audioNoInventedLines = !!first && !!last && !first.hasPrev && first.prev === '' && !last.hasNext && last.next === '';
          c.audioLinesInsideField = samples.every((x) => x.inside && x.ordered && !x.hscroll);
          c.audioFieldHeight = samples.length > 0 && samples.every((x) => x.fieldH <= 340 && x.fieldH >= 160);
          // Überblendung höchstens 150 ms, bei reduzierter Bewegung keine
          const an = await pg.evaluate(() => { const e = document.querySelector('[data-testid=desk-lyric-cur]'); const cs = getComputedStyle(e); return { name: cs.animationName, d: parseFloat(cs.animationDuration) * (cs.animationDuration.endsWith('ms') ? 0.001 : 1) }; });
          c.audioFadeAtMost150ms = an.name !== 'none' && an.d > 0 && an.d <= 0.15;
          await pg.emulateMedia({ reducedMotion: 'reduce' });
          const an2 = await pg.evaluate(() => getComputedStyle(document.querySelector('[data-testid=desk-lyric-cur]')).animationName);
          await pg.emulateMedia({ reducedMotion: 'no-preference' });
          c.audioNoFadeWhenReducedMotion = an2 === 'none';
        }
        if (form === 'text') {
          c.textNoPlayerControls = !(await has(pg, 'desk-transport')) && (await has(pg, 'desk-textbar'));
          c.textSerifHook = (await E(pg, 'desk-hook').evaluate((e) => getComputedStyle(e).fontFamily)).includes('Source Serif');
          // Runde 44b: Lesebereich scrollt, weicher Auslauf, Leiste bleibt, Rad und Seitentasten blättern nicht
          const tv = E(pg, 'text-view');
          const geo = () => pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'), b = document.querySelector('[data-testid=desk-textbar]').getBoundingClientRect(), r = v.getBoundingClientRect(), cs = getComputedStyle(v); return { st: v.scrollTop, sh: v.scrollHeight, ch: v.clientHeight, end: v.hasAttribute('data-end'), mask: cs.maskImage !== 'none' && cs.maskImage !== '' ? cs.maskImage : cs.webkitMaskImage, vb: r.bottom, bt: b.top, bb: b.bottom, win: b.bottom <= innerHeight && b.top >= 0 }; });
          await tv.evaluate((e) => { e.scrollTop = 0; });
          await pg.waitForTimeout(150);
          const g0 = await geo();
          r.notes.textGeo = g0;
          c.textScrollable = g0.sh > g0.ch + 100 && g0.vb <= g0.bt + 0.5 && g0.win;
          c.textFadeAtBottom = !g0.end && !!g0.mask && g0.mask !== 'none' && g0.mask.includes('48px');
          const iw = await idx(pg);
          await pg.mouse.move(720, 450);
          for (let n = 0; n < 3; n++) { await pg.mouse.wheel(0, 120); await pg.waitForTimeout(60); }
          await pg.waitForTimeout(300);
          const g1 = await geo();
          c.textWheelScrollsNotNavigates = g1.st > 100 && (await idx(pg)) === iw && g1.win;
          await tv.focus();
          const st1 = g1.st;
          await press(pg, 'PageDown', 400);
          const g2 = await geo();
          c.textPageDownDoesNotNavigate = (await idx(pg)) === iw && g2.st >= st1 && g2.win;
          await press(pg, ' ', 200);
          c.textSpaceDoesNotNavigate = (await idx(pg)) === iw;
          await tv.evaluate((e) => { e.scrollTop = e.scrollHeight; });
          await pg.waitForTimeout(250);
          const g3 = await geo();
          c.textFadeGoneAtEnd = g3.end && (g3.mask === 'none' || g3.mask === '' || g3.mask === undefined) && g3.win && g3.bb <= 900;
          await pg.screenshot({ path: `${out}/${name}-text-scrolled.png` });
          await press(pg, 'ArrowDown', 400);
          const iNext = await idx(pg);
          await press(pg, 'ArrowUp', 400);
          c.textArrowKeysStillNavigate = iNext === iw + 1 && (await idx(pg)) === iw;
          await tv.evaluate((e) => { e.scrollTop = 0; });
        }
        await pg.screenshot({ path: `${out}/${name}-${form}.png` });
      }
      // Tasten L, S, T und ?
      await press(pg, '1', 1200);
      const mid = await pg.evaluate(() => window.__core.moment().id);
      await press(pg, 'l', 150);
      await press(pg, 's', 150);
      c.keysLikeSave = (await pg.evaluate((id) => window.__core.liked(id) && window.__core.saved(id), mid)) && (await E(pg, 'like').getAttribute('aria-pressed')) === 'true';
      await pg.keyboard.press('Shift+Slash');
      await pg.waitForTimeout(150);
      const help = await has(pg, 'desk-help');
      // Keine Kürzel, während ein Eingabefeld den Fokus hat (Notizfeld der Rückmeldung)
      await press(pg, 'Escape', 150);
      await press(pg, 'f', 250);
      await press(pg, 'Enter', 150);
      const i3 = await idx(pg);
      await pg.keyboard.type('c v t l ');
      await pg.keyboard.press('ArrowRight');
      c.noKeysWhileTyping = (await idx(pg)) === i3 && (await E(pg, 'note-text').inputValue()).startsWith('c v t l');
      c.helpKey = help;
      await press(pg, 'Escape', 150);
      await press(pg, 'Escape', 150);
      c.noErrors1440 = o.errors.length === 0;
      if (o.errors.length) r.notes.errors = o.errors.slice(0, 3);
      await browser.close();
    }
    // ---------- Runde 53: Mac 1440, Zitatlinie am Zeilenanfang (arabisch rechts), Leerzeichen nach Doppelpunkt ----------
    {
      const o = await open(type, { width: 1440, height: 900 });
      browser = o.browser;
      const pg = o.pg;
      await press(pg, '3', 1500);
      await waitFor(pg, () => !!document.querySelector('[data-testid=text-view]'), undefined, 4000);
      const QM = () => {
        const q = document.querySelector('.dtx-quote'); const p = document.querySelector('[data-testid=text-body]');
        if (!q || !p) return null;
        const qb = q.getBoundingClientRect(); const qs = getComputedStyle(q); const pb = p.getBoundingClientRect();
        return { dir: q.getAttribute('dir'), ql: qb.left, qr: qb.right, bl: parseFloat(qs.borderLeftWidth), br: parseFloat(qs.borderRightWidth), pl: parseFloat(qs.paddingLeft), pr: parseFloat(qs.paddingRight), pL: pb.left, pR: pb.right, text: p.textContent };
      };
      const toMoment = async (n) => { const id = `test${String(n).padStart(7, '0')}:100`; for (let t = 0; t < 6; t++) { await pg.evaluate((i) => { window.__core.arrange([i]); window.__core.next(); }, id); if (await waitFor(pg, (i) => window.__core.moment()?.id === i, id, 2500)) break; } await pg.waitForTimeout(500); };
      await toMoment(46);
      const L = await pg.evaluate(QM);
      await pg.screenshot({ path: `${out}/${name}-1440-text-latein.png` });
      await toMoment(56);
      const A = await pg.evaluate(QM);
      await pg.screenshot({ path: `${out}/${name}-1440-text-arabisch.png` });
      const gapL = L ? L.pL - (L.ql + L.bl) : NaN; const gapA = A ? (A.qr - A.br) - A.pR : NaN;
      console.error(`53 Mac 1440 Latein: dir ${L?.dir}, Linie links ${L?.bl} rechts ${L?.br}, Einzug ${L?.pl}, Zitat ${L?.ql}..${L?.qr}, Text ${L?.pL}..${L?.pR}, Abstand ${gapL}`);
      console.error(`53 Mac 1440 Arabisch: dir ${A?.dir}, Linie links ${A?.bl} rechts ${A?.br}, Einzug ${A?.pr}, Zitat ${A?.ql}..${A?.qr}, Text ${A?.pL}..${A?.pR}, Abstand ${gapA}`);
      c.quoteLatinLeft = !!L && L.dir === 'ltr' && L.bl === 2 && L.br === 0 && L.pl > 0 && L.pr === 0;
      c.quoteArabicRight = !!A && A.dir === 'rtl' && A.br === 2 && A.bl === 0 && A.pr > 0 && A.pl === 0 && Math.abs(A.pR - (A.qr - A.br - A.pr)) <= 0.5;
      c.quoteGapSame = !!L && !!A && Math.abs(gapL - gapA) <= 0.5 && Math.abs(L.ql - A.ql) <= 0.5 && Math.abs(L.qr - A.qr) <= 0.5;
      c.arabicColonSpaced = !!A && A.text.includes('متفاوتة: قد') && A.text.includes('صفات: الإيمان') && A.text.includes('103:2') && A.text.includes('10:30') && !/[:؛][ء-ي]/.test(A.text);
      c.quoteNoErrors = o.errors.length === 0;
      await browser.close();
    }
    // ---------- 1280x800 und 1920x1080: keine Überschneidung ----------
    for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
      const o = await open(type, size);
      browser = o.browser;
      for (const [form, tab] of [['video', '1'], ['audio', '2'], ['text', '3']]) {
        await press(o.pg, tab, 1400);
        const g = await o.pg.evaluate(GEOM);
        r.notes[`geo-${size.width}-${form}`] = g;
        c[`${size.width}${form}Clean`] = !g.overlapCols && !g.aboveBar && !g.outOfMain && g.inWindow && !g.kidsOverlap && g.noHScroll && g.queueWhole && g.queueShown >= 3 && g.sideFits;
        await o.pg.screenshot({ path: `${out}/${name}-${size.width}-${form}.png` });
      }
      c[`noErrors${size.width}`] = o.errors.length === 0;
      await browser.close();
    }
    // ---------- 390x844: nichts davon im DOM ----------
    {
      const o = await open(type, { width: 390, height: 844 });
      browser = o.browser;
      const n = await o.pg.evaluate(() => document.querySelectorAll('[data-testid^=desk-], .desk, .dq, .dpanel, .dc, .dt').length);
      c.mobileNoDeskElements = n === 0 && (await o.pg.locator('[data-testid=form-switch]').count()) === 1;
      c.mobileNoErrors = o.errors.length === 0;
      await browser.close();
    }
  } catch (e) {
    r.error = String(e && e.stack ? e.stack : e);
    await browser?.close().catch(() => {});
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
let bad = 0;
for (const run of results.runs) {
  const fails = Object.entries(run.checks).filter(([, v]) => v !== true).map(([n]) => n);
  if (run.error || fails.length) bad++;
  console.log(JSON.stringify({ browser: run.browser, ok: !run.error && !fails.length, checks: Object.keys(run.checks).length, fails, error: run.error }));
}
process.exit(bad ? 1 : 0);
