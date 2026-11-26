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
for (let i = 40; i < 46; i++) moments.push(mk(i, 'brain', { form: 'audio', audio: true, hls: `https://stream.test/${i}.m3u8` }));
for (let i = 46; i < 56; i++) moments.push(mk(i, 'body', { form: 'text', videoId: `texto${String(i).padStart(5, '0')}`, author: `Author ${i}`, ref: `Ref ${i}`, sourceUrl: `https://example.org/s/${i}`, license: 'CC BY 4.0', ...(i === 46 ? { kind: 'takeaway', apply: 'Do the small thing today.', origin: 'Test entry 30' } : {}) }));
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
        if (form === 'audio') {
          const a = await pg.evaluate(() => { const cv = document.querySelector('[data-testid=desk-cover]').getBoundingClientRect(); return { w: cv.width, h: cv.height }; });
          c.audioCover176 = Math.round(a.w) === 176 && Math.round(a.h) === 176;
          c.audioLyricsField = await waitFor(pg, () => !!document.querySelector('[data-testid=desk-lyric-cur]')?.textContent);
          // Die Zeitleiste ist im Audio-Reiter nur Anzeige (das Audio-Deck springt nicht)
          c.audioTimelineReadOnly = (await E(pg, 'desk-timeline').getAttribute('role')) === 'progressbar';
          await press(pg, 'c', 200);
          c.audioCaptionsOff = (await E(pg, 'desk-lyrics').innerText()).includes('Captions are off');
          await press(pg, 'c', 200);
        }
        if (form === 'text') {
          c.textNoPlayerControls = !(await has(pg, 'desk-transport')) && (await has(pg, 'desk-textbar'));
          c.textSerifHook = (await E(pg, 'desk-hook').evaluate((e) => getComputedStyle(e).fontFamily)).includes('Source Serif');
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
