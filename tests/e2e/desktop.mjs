// E2E des Desktop-Modus ab 900 px (Chromium, Viewport 1440x900) mit nachgebauter YouTube-API.
// Prüft jede Taste, das Panel, Trackpad, Medientasten, Fenstertitel, Übersicht, Seitenblatt, Schwelle 899/900 und PWA-Installierbarkeit.
// Aufruf: node tests/e2e/desktop.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-desktop'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');

// Testpool: Video (Beat, Brain, Body), Audio, Text. Jeder Moment mit Abrufkarte. Kein forYou, damit die Zwischenkarte nicht stört.
const EX = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the checked excerpt, long enough to wrap over several lines in the reading column.`).join('\n');
const mk = (i, area, extra = {}) => ({
  id: `test${String(i).padStart(7, '0')}:100`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20,
  channel: `Kanal ${area} (Dr. Test ${i % 4})`, videoTitle: `Testvideo ${i}`, area, topic: 'augen', hook: `Testmoment ${i} ${area}`, kind: 'regel',
  createdAt: '2026-10-20T00:00:00Z', cues: [[0, 'Untertitel eins, a marketing message'], [2, 'Untertitel zwei']], excerpt: EX,
  context: `Context sentence one for moment ${i}. Context sentence two names a term.`,
  recall: { question: `What follows from moment ${i}?`, options: [`Wrong A ${i}`, `Right ${i}`, `Wrong B ${i}`], correct: 1, why: `Because ${i} says so.` }, ...extra,
});
const moments = [];
for (let i = 0; i < 12; i++) moments.push(mk(i, 'beat'));
for (let i = 12; i < 30; i++) moments.push(mk(i, 'brain'));
for (let i = 30; i < 40; i++) moments.push(mk(i, 'body'));
for (let i = 40; i < 46; i++) moments.push(mk(i, 'brain', { form: 'audio', audio: true, hls: `https://stream.test/${i}.m3u8` }));
for (let i = 46; i < 56; i++) moments.push(mk(i, 'brain', { form: 'text', videoId: `texto${String(i).padStart(5, '0')}`, author: `Author ${i}`, ref: `Ref ${i}`, sourceUrl: `https://example.org/s/${i}`, license: 'CC BY 4.0' }));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
const POOL = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');

const results = { at: new Date().toISOString(), checks: {}, notes: {} };
const c = results.checks;
const waitFor = async (page, fn, arg, timeout = 6000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};

const freshPage = async (browser, size, opts = {}) => {
  const cx = await browser.newContext({ viewport: size, serviceWorkers: 'block', deviceScaleFactor: 1, ...opts });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const pg = await cx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  await pg.addInitScript(() => {
    window.__ytSlow = true;
    // Medientasten kommen im Browser als Media-Session-Handler an. Hier werden sie abgefangen und direkt aufgerufen.
    window.__msHandlers = {};
    const ms = navigator.mediaSession;
    if (ms) { const orig = ms.setActionHandler.bind(ms); ms.setActionHandler = (n, f) => { window.__msHandlers[n] = f; return orig(n, f); }; }
  });
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: POOL }));
  await pg.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
  await waitFor(pg, () => !!window.__core?.moment());
  return { cx, pg, errors };
};

const E = (pg, id) => pg.locator(`[data-testid="${id}"]`);
const has = async (pg, id) => (await E(pg, id).count()) > 0;
const idx = (pg) => pg.evaluate(() => window.__core.idx());
const st = (pg) => pg.evaluate(() => window.__core.state());
const press = async (pg, key, ms = 40) => { await pg.keyboard.press(key); await pg.waitForTimeout(ms); };
const goIdx = async (pg, n) => waitFor(pg, (j) => window.__core.idx() === j, n);
// Ein Trackpad-Wisch: viele kleine Wheel-Ereignisse mit Nachlauf
const swipe = async (pg, dx, dy) => {
  const ramp = [6, 18, 34, 42, 40, 36, 30, 25, 20, 16, 12, 9, 6, 4, 3, 2, 1];
  for (const v of ramp) { await pg.mouse.wheel(dx * v, dy * v); await pg.waitForTimeout(16); }
  await pg.waitForTimeout(260);
};
// Wiedergabe abwarten, sonst zählt Pause nicht
const settle = async (pg) => { await waitFor(pg, () => window.__core.state() === 1); };
// Abrufkarte schließen, falls offen (Esc)
const dismissRecall = async (pg) => {
  if (await has(pg, 'recall-card')) { await press(pg, 'Escape', 120); }
};

let browser;
try {
  browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});

  // ---------- Schwelle: 899 mobil, 900 Desktop ----------
  {
    const a = await freshPage(browser, { width: 899, height: 900 });
    c.below900Mobile = !(await has(a.pg, 'desk-bar')) && (await E(a.pg, 'form-switch').isVisible());
    await a.cx.close();
    const b = await freshPage(browser, { width: 900, height: 900 });
    c.at900Desktop = (await has(b.pg, 'desk-bar')) && !(await E(b.pg, 'form-switch').isVisible().catch(() => false));
    // Größe ändern ohne neu zu laden: Player bleibt im Dokument, Moment und Index bleiben
    await settle(b.pg);
    const before = await b.pg.evaluate(() => ({ id: window.__core.moment().id, n: document.querySelectorAll('iframe, [data-testid=player]').length }));
    await b.pg.setViewportSize({ width: 600, height: 900 });
    await b.pg.waitForTimeout(200);
    const mid = !(await has(b.pg, 'desk-bar')) && (await E(b.pg, 'form-switch').isVisible());
    await b.pg.setViewportSize({ width: 1440, height: 900 });
    await b.pg.waitForTimeout(200);
    const after = await b.pg.evaluate(() => ({ id: window.__core.moment().id }));
    c.resizeKeepsMoment = mid && (await has(b.pg, 'desk-bar')) && before.id === after.id;
    await b.cx.close();
  }

  // ---------- Hauptlauf 1440x900 ----------
  const { cx, pg, errors } = await freshPage(browser, { width: 1440, height: 900 });
  await settle(pg);
  const bodyNoHelp = () => pg.evaluate(() => !!document.querySelector('[data-testid=desk-help]'));

  // Ton aus: Symbol statt Text, unten rechts im 16:9-Band der Spalte (gemessen, wenn keine Transition mehr läuft)
  await waitFor(pg, () => document.getAnimations().filter((a) => a instanceof CSSTransition).length === 0);
  const dIcon = await pg.evaluate(() => {
    const el = document.querySelector('[data-testid=sound-off]');
    const band = document.querySelector('.vframe > div');
    if (!el || !band) return null;
    const a = el.getBoundingClientRect(), b = band.getBoundingClientRect();
    return { right: b.right - a.right, fromBandBottom: b.bottom - a.bottom, w: a.width, text: el.textContent.trim(), pill: /for sound/i.test(document.body.innerText) };
  });
  c.soundIconDesk = !!dIcon && dIcon.text === '' && !dIcon.pill && Math.abs(dIcon.right - 12) <= 3 && Math.abs(dIcon.fromBandBottom - 12) <= 3;
  if (!c.soundIconDesk) console.log('soundIconDesk', JSON.stringify(dIcon));

  // Übersicht einmalig beim ersten Desktop-Start
  c.helpShownFirst = await waitFor(pg, () => !!document.querySelector('[data-testid=desk-help]'));
  await pg.screenshot({ path: `${out}/01-uebersicht.png` });
  const helpText = await E(pg, 'desk-help').innerText();
  c.helpListsKeys = ['J', 'K', 'Space', 'Shift', 'Two fingers', 'Esc', '?'].every((x) => helpText.includes(x));
  c.helpNoDashes = !/[–—]/.test(helpText);
  c.helpFocusInside = await pg.evaluate(() => document.querySelector('[data-testid=desk-help]').contains(document.activeElement));
  // Taste im Hintergrund wirkt nicht, solange die Übersicht offen ist
  const i0 = await idx(pg);
  await press(pg, 'j');
  c.helpBlocksKeys = (await idx(pg)) === i0;
  await press(pg, 'Escape', 100);
  c.escClosesHelp = !(await bodyNoHelp());
  // Nach Neuladen nicht noch einmal
  await pg.reload();
  await waitFor(pg, () => !!window.__core?.moment());
  await pg.waitForTimeout(500);
  c.helpOnlyOnce = !(await bodyNoHelp());
  await settle(pg);

  // Layout 1440x900
  const geo = await pg.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const slot = document.querySelector('.vslot[aria-hidden="false"]') ?? document.querySelector('.vslot');
    const v = slot?.querySelector('.vframe > div')?.getBoundingClientRect();
    return { main: r('.dmain'), panel: r('[data-testid=desk-panel]'), aside: r('[data-testid=desk-aside]'), bar: r('[data-testid=desk-bar]'), video: v && { x: v.x, y: v.y, w: v.width, h: v.height }, scrollW: document.documentElement.scrollWidth };
  });
  results.notes.geo = geo;
  c.columnIs480 = !!geo.main && Math.abs(geo.main.w - 480) < 1;
  c.columnCentered = !!geo.main && Math.abs(geo.main.x + geo.main.w / 2 - 720) < 1;
  c.videoIs16by9 = !!geo.video && Math.abs(geo.video.w / geo.video.h - 16 / 9) < 0.02 && Math.abs(geo.video.w - 480) < 1;
  c.panelFixedRight = !!geo.aside && geo.aside.x + geo.aside.w > 1439 && geo.aside.w >= 340;
  c.barOnTop = !!geo.bar && geo.bar.y === 0 && geo.bar.h <= 60 && geo.bar.w >= 1439;
  c.noHorizontalScroll = geo.scrollW <= 1440;
  c.barOneRow = await pg.evaluate(() => { const ys = [...document.querySelectorAll('[data-testid=desk-bar] button')].map((b) => Math.round(b.getBoundingClientRect().y + b.getBoundingClientRect().height / 2)); return Math.max(...ys) - Math.min(...ys) <= 2; });
  c.barFitsWindow = await pg.evaluate(() => [...document.querySelectorAll('[data-testid=desk-bar] button')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  const topbar = await E(pg, 'desk-bar').innerText();
  c.barHasTabsAndDay = ['Video', 'Audio', 'Text'].every((x) => topbar.includes(x)) && (await E(pg, 'desk-today').innerText()).length > 0;
  c.panelHasHookAndSource = (await E(pg, 'desk-hook').innerText()) === (await pg.evaluate(() => window.__core.moment().hook)) && (await has(pg, 'desk-source')) && (await has(pg, 'desk-open-source'));
  c.noMobileOverlays = !(await has(pg, 'hook')) && !(await has(pg, 'info-tap'));
  c.compactButtons = await pg.evaluate(() => [...document.querySelectorAll('.vactions button')].every((b) => b.getBoundingClientRect().height <= 40 && b.getBoundingClientRect().height >= 32));
  await pg.screenshot({ path: `${out}/02-video.png` });

  // Fenstertitel zeigt den Hook
  const hook0 = await pg.evaluate(() => window.__core.moment().hook);
  c.titleShowsHook = (await pg.title()).includes(hook0);

  // Tasten: J K Pfeile
  await pg.mouse.move(720, 450);
  let i = await idx(pg);
  await press(pg, 'j', 300);
  c.keyJ = (await idx(pg)) === i + 1;
  await press(pg, 'k', 300);
  c.keyK = (await idx(pg)) === i;
  await press(pg, 'ArrowDown', 300);
  c.keyArrowDown = (await idx(pg)) === i + 1;
  await press(pg, 'ArrowUp', 300);
  c.keyArrowUp = (await idx(pg)) === i;
  await settle(pg);
  const hook1 = await pg.evaluate(() => window.__core.moment().hook);
  c.titleFollowsMoment = (await pg.title()).includes(hook1);

  // Leertaste: Pause und Weiter, auch wenn ein Knopf den Fokus hat
  await E(pg, 'desk-tab-video').focus();
  await press(pg, ' ', 150);
  c.spacePauses = (await st(pg)) === 2;
  c.spaceDidNotClickFocused = (await E(pg, 'desk-tab-video').getAttribute('aria-checked')) === 'true';
  await press(pg, ' ', 150);
  c.spaceResumes = (await st(pg)) === 1;
  await pg.evaluate(() => document.activeElement?.blur());

  // M stumm
  const sound0 = await pg.evaluate(() => window.__core.sound());
  await press(pg, 'm', 150);
  const sound1 = await pg.evaluate(() => window.__core.sound());
  await press(pg, 'M', 150);
  c.keyM = sound0 !== sound1 && (await pg.evaluate(() => window.__core.sound())) === sound0;

  // Shift+. schaltet das Tempo im Kreis: 1.5x, 2x, 1x. Anzeige in der Leiste, Wert im State, Player folgen.
  const pressTempo = async () => {
    await pg.keyboard.down('Shift');
    await pg.keyboard.down('Period');
    await pg.keyboard.up('Period');
    await pg.keyboard.up('Shift');
  };
  await pressTempo();
  c.tempo15 = await waitFor(pg, () => window.__core.rate() === 1.5 && document.querySelector('[data-testid=desk-rate]')?.textContent === '1.5x', undefined, 2000) && (await pg.evaluate(() => window.__ytlog.some((x) => x === 'rate 1.5')));
  await pressTempo();
  c.tempo2 = await waitFor(pg, () => window.__core.rate() === 2 && document.querySelector('[data-testid=desk-rate]')?.textContent === '2x', undefined, 2000) && (await pg.evaluate(() => window.__ytlog.some((x) => x === 'rate 2')));
  await pg.click('[data-testid=desk-rate]');
  c.tempoTapBackTo1 = await waitFor(pg, () => window.__core.rate() === 1 && !document.querySelector('[data-testid=desk-rate]'), undefined, 2000);
  await pressTempo();
  c.tempoKeyHeldDoesNotRepeat = await waitFor(pg, () => window.__core.rate() === 1.5, undefined, 2000);
  await pressTempo();
  await pressTempo();
  c.tempoCycleBackTo1 = await waitFor(pg, () => window.__core.rate() === 1, undefined, 2000);

  // L Herz, S Save
  const mid0 = await pg.evaluate(() => window.__core.moment().id);
  await press(pg, 'l', 150);
  c.keyL = await pg.evaluate((id) => window.__core.liked(id), mid0);
  await press(pg, 's', 150);
  c.keyS = await pg.evaluate((id) => window.__core.saved(id), mid0);
  await press(pg, 's', 150);
  c.keySToggles = !(await pg.evaluate((id) => window.__core.saved(id), mid0));

  // C Caption im Panel
  const capBefore = await has(pg, 'desk-caption');
  await press(pg, 'c', 150);
  const capOpen = await has(pg, 'desk-caption');
  c.keyC = !capBefore && capOpen && (await E(pg, 'desk-meta').innerText()).includes('Testvideo');
  // Kontext im Panel, unter dem Ausschnitt, mit der Überschrift "Context"
  const deskCtx = await pg.evaluate(() => {
    const e = document.querySelector('[data-testid=desk-context]');
    const m = window.__core.moment();
    const ex = document.querySelector('[data-testid=desk-excerpt]');
    return { text: e?.textContent ?? null, m: m.context, below: !!ex && !!e && !!(ex.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING), label: e?.querySelector('.vcap-ctx-label')?.textContent };
  });
  c.deskCaptionContext = deskCtx.label === 'Context' && deskCtx.text.includes(deskCtx.m) && deskCtx.below;
  await pg.screenshot({ path: `${out}/03-panel-caption.png` });
  await press(pg, 'j', 300);
  c.captionStaysOpenOnNext = await has(pg, 'desk-caption');
  await press(pg, 'Escape', 100);
  c.escClosesCaption = !(await has(pg, 'desk-caption'));
  await press(pg, 'k', 300);

  // O Quelle: neuer Tab mit youtube
  const popup = pg.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
  await press(pg, 'o', 100);
  const pop = await popup;
  c.keyO = !!pop;
  if (pop) await pop.close();

  // F Rückmeldung: 1 bis 6 für Chips, Enter für Text
  await press(pg, 'f', 200);
  c.keyF = await has(pg, 'note-sheet');
  c.noteShowsNumbers = (await E(pg, 'note-sheet').locator('.note-chip .note-key').count()) === 6;
  await pg.screenshot({ path: `${out}/04-feedback.png` });
  await press(pg, 'j', 150);
  c.noteBlocksNext = (await has(pg, 'note-sheet')) && true;
  const nBefore = await pg.evaluate(() => window.__core.notes().length);
  const nm = await pg.evaluate(() => window.__core.moment());
  await press(pg, '2', 200);
  // Bestätigungszeile am Blatt, dann schließt es von selbst
  c.noteConfirmLine = await pg.evaluate((t) => document.querySelector('[data-testid=note-confirm]')?.textContent === `Less ${t.charAt(0).toUpperCase()}${t.slice(1)}`, nm.topic);
  const w1 = await pg.evaluate((t) => window.__core.weights().topic[t] ?? 1, nm.topic);
  c.notForMeKeyTopic02 = Math.abs(w1 - 0.2) < 0.001;
  await pg.screenshot({ path: `${out}/04b-feedback-bestaetigung.png` });
  await pg.waitForFunction(() => !document.querySelector('[data-testid=note-sheet]'), null, { timeout: 4000 }).catch(() => {});
  const nl = await pg.evaluate(() => window.__core.notes());
  c.noteChipByNumber = !(await has(pg, 'note-sheet')) && nl.length === nBefore + 1 && nl.at(-1).chips.join() === 'Not for me' && nl.at(-1).id === nm.id;
  await press(pg, 'f', 200);
  await press(pg, 'Enter', 100);
  c.noteEnterFocusesText = await pg.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'note-text');
  await pg.keyboard.type('Dieser Test schreibt eine Notiz');
  await press(pg, 'j', 50);
  c.typingKeysStayText = (await E(pg, 'note-text').inputValue()).endsWith('j') && (await has(pg, 'note-sheet'));
  await pg.keyboard.press('Backspace');
  await press(pg, 'Enter', 200);
  const notes = await pg.evaluate(() => window.__core.notes());
  c.noteEnterSaves = !(await has(pg, 'note-sheet')) && notes.length === nBefore + 2 && JSON.stringify(notes).includes('Dieser Test');
  await press(pg, 'f', 200);
  await press(pg, 'Escape', 150);
  c.escClosesNote = !(await has(pg, 'note-sheet'));

  // A Ask: öffnet claude.ai/new mit Prompt zum laufenden Moment (auch ohne Blatt), Taste und Knopf im Blatt, Saved zeigt "asked"
  await pg.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push({ u, t, f }); return null; }; });
  const am = await pg.evaluate(() => window.__core.moment());
  await press(pg, 's', 150);
  await press(pg, 'a', 250);
  const askOpened = await pg.evaluate(() => window.__opened);
  c.keyA = askOpened.length === 1 && askOpened[0].u.startsWith('https://claude.ai/new?q=') && decodeURIComponent(askOpened[0].u.slice('https://claude.ai/new?q='.length)).includes(`Hook: ${am.hook}`) && (await pg.evaluate((id) => window.__core.asked(id), am.id)) > 0;
  c.keyAContext = decodeURIComponent(askOpened[0]?.u ?? '').includes(`Context: ${am.context}`);
  await E(pg, 'desk-saved').click();
  c.savedShowsAsked = await waitFor(pg, () => !!document.querySelector('[data-testid=saved-asked]'));
  await press(pg, 'Escape', 200);
  await press(pg, 's', 150);
  await press(pg, 'f', 200);
  c.noteSheetHasAsk = (await has(pg, 'note-ask')) && (await E(pg, 'note-ask').locator('.note-key').innerText()) === 'A' && (await E(pg, 'note-sheet').locator('.note-chip .note-key').count()) === 6;
  await press(pg, 'a', 250);
  c.keyAInSheet = (await pg.evaluate(() => window.__opened.length)) === 2 && !(await has(pg, 'note-sheet'));
  await press(pg, 'j', 300);

  // Reiter 1 2 3
  await press(pg, '2', 600);
  c.tab2Audio = (await E(pg, 'desk-tab-audio').getAttribute('aria-checked')) === 'true' && (await pg.evaluate(() => !!window.__core.moment()?.audio));
  await pg.screenshot({ path: `${out}/05-audio.png` });
  await press(pg, '3', 600);
  c.tab3Text = (await E(pg, 'desk-tab-text').getAttribute('aria-checked')) === 'true' && (await pg.evaluate(() => window.__core.moment()?.form === 'text'));
  // Text: 65 Zeichen Lesebreite, Quelle im Panel, Spalte breiter
  const tg = await pg.evaluate(() => {
    const body = document.querySelector('.vtext-body');
    const cs = getComputedStyle(body);
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;font:${cs.font};white-space:pre`;
    probe.textContent = '0'.repeat(65);
    document.body.appendChild(probe);
    const ch65 = probe.getBoundingClientRect().width;
    probe.remove();
    return { w: body.getBoundingClientRect().width, ch65, col: document.querySelector('.dmain').getBoundingClientRect().width };
  });
  results.notes.text = tg;
  c.textWidth65ch = tg.w <= tg.ch65 + 2 && tg.w >= tg.ch65 * 0.9;
  c.barFitsWindowText = await pg.evaluate(() => [...document.querySelectorAll('[data-testid=desk-bar] button')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  c.barTabsClickableText = await pg.evaluate(() => { const b = document.querySelector('[data-testid=desk-tab-audio]').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-testid=desk-tab-audio]') !== null; });
  c.textSourceInPanel = (await E(pg, 'text-source').count()) === 1 && (await E(pg, 'desk-panel').locator('[data-testid=text-source]').count()) === 1;
  await pg.screenshot({ path: `${out}/06-text.png` });
  await press(pg, '1', 600);
  c.tab1Video = (await E(pg, 'desk-tab-video').getAttribute('aria-checked')) === 'true';
  await settle(pg);

  // Abrufkarte: kommt nach dem 4. Moment, im Panel, 1 2 3 antworten, Enter Next
  // Die Karte zählt nur Momente, die zu mindestens 80 Prozent gesehen wurden. Darum Zeitraffer an und die Momente laufen lassen.
  await pg.evaluate(() => { window.__ytSlow = false; });
  const sawCard = await waitFor(pg, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 40000);
  c.recallAppears = sawCard;
  if (sawCard) {
    c.recallInPanel = (await E(pg, 'desk-panel').locator('[data-testid=recall-card]').count()) === 1;
    c.recallNoOverlay = await pg.evaluate(() => getComputedStyle(document.querySelector('[data-testid=recall-card]')).position !== 'absolute' && getComputedStyle(document.querySelector('[data-testid=recall-card]')).position !== 'fixed');
    c.recallShowsNumbers = (await E(pg, 'recall-card').locator('.recall-key').count()) >= 3;
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${out}/07-abrufkarte.png` });
    const ri = await idx(pg);
    await press(pg, 'j', 150);
    c.recallBlocksNext = (await idx(pg)) === ri && (await has(pg, 'recall-card'));
    // Die Antworten stehen gemischt. Die Nummer der richtigen steht im Knopf.
    const pos = await pg.evaluate(() => [...document.querySelectorAll('[data-testid=recall-option]')].findIndex((e) => e.dataset.correct === '1'));
    await press(pg, String(pos + 1), 250);
    const right = await E(pg, 'recall-option').nth(pos).getAttribute('data-state');
    c.recallPickByNumber = right === 'right';
    c.recallWhy = (await E(pg, 'recall-why').innerText()).startsWith('Because');
    await pg.screenshot({ path: `${out}/08-abrufkarte-antwort.png` });
    await press(pg, String(((pos + 1) % 3) + 1), 100);
    c.recallDigitsIgnoredAfterAnswer = (await E(pg, 'recall-option').nth(pos).getAttribute('data-state')) === 'right' && (await pg.evaluate(() => !document.querySelector('[data-state=wrong]')));
    await press(pg, 'Enter', 400);
    // Die Karte erscheint erst, nachdem der Feed schon beim nächsten Moment steht. Next schließt sie und startet ihn.
    c.recallEnterNext = !(await has(pg, 'recall-card')) && (await idx(pg)) === ri && (await waitFor(pg, () => window.__core.state() === 1));
  }
  // Esc schließt die Abrufkarte ohne Wertung
  await waitFor(pg, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 40000);
  await pg.evaluate(() => { window.__ytSlow = true; });
  if (await has(pg, 'recall-card')) {
    await press(pg, 'Escape', 250);
    c.escClosesRecall = !(await has(pg, 'recall-card'));
  }

  // Trackpad: zwei Finger vertikal blättert genau einen Moment, Nachlauf zählt nicht
  await dismissRecall(pg);
  await pg.mouse.move(720, 450);
  await settle(pg);
  i = await idx(pg);
  await swipe(pg, 0, 1);
  c.trackpadDown = (await idx(pg)) === i + 1;
  await dismissRecall(pg);
  i = await idx(pg);
  await swipe(pg, 0, -1);
  c.trackpadUp = (await idx(pg)) === i - 1;
  // Zwei Finger links (deltaX positiv) öffnet die Rückmeldung
  await swipe(pg, 1, 0);
  c.trackpadLeftOpensNote = await has(pg, 'note-sheet');
  await pg.screenshot({ path: `${out}/09-trackpad-links-rueckmeldung.png` });
  await press(pg, 'Escape', 200);
  // Zwei Finger rechts macht nichts
  i = await idx(pg);
  await swipe(pg, -1, 0);
  c.trackpadRightNothing = !(await has(pg, 'note-sheet')) && (await idx(pg)) === i;
  // Wisch über dem Panel blättert nicht
  await pg.mouse.move(1300, 400);
  i = await idx(pg);
  await swipe(pg, 0, 1);
  c.wheelOnPanelIgnored = (await idx(pg)) === i;
  await pg.mouse.move(720, 450);

  // Hover und Fokusrahmen
  await pg.mouse.move(10, 10);
  const hv = async (sel) => {
    const el = pg.locator(sel).first();
    const box = await el.boundingBox();
    const bs0 = await el.evaluate((e) => getComputedStyle(e).boxShadow);
    await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pg.waitForTimeout(80);
    const bs1 = await el.evaluate((e) => getComputedStyle(e).boxShadow);
    await pg.mouse.move(10, 10);
    return bs0 !== bs1;
  };
  c.hoverSettings = await hv('[data-testid=desk-settings]');
  c.hoverTab = await hv('[data-testid=desk-tab-audio]');
  c.hoverAction = await hv('.vactions button');
  c.hoverOpenSource = await hv('[data-testid=desk-open-source]');
  // Fokus per Tab: jeder Knopf bekommt einen sichtbaren Rahmen
  await pg.evaluate(() => document.activeElement?.blur());
  const ring = [];
  for (let n = 0; n < 12; n++) {
    await pg.keyboard.press('Tab');
    ring.push(await pg.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); return { tag: e.tagName, ok: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 }; }));
  }
  results.notes.ring = ring;
  c.focusRingOnAllButtons = ring.filter(Boolean).length >= 6 && ring.filter(Boolean).every((x) => x.ok);
  await pg.screenshot({ path: `${out}/10-fokus.png` });
  await pg.evaluate(() => document.activeElement?.blur());
  await pg.mouse.move(720, 450);

  // Settings als Seitenblatt: Feed bleibt links stehen, Esc schließt, Tasten wirken nicht dahinter
  await E(pg, 'desk-settings').click();
  c.sheetOpens = await waitFor(pg, () => !!document.querySelector('[data-testid=desk-sheet]'));
  const sg = await pg.evaluate(() => { const b = document.querySelector('[data-testid=desk-sheet]').getBoundingClientRect(); return { x: b.x, w: b.width, right: b.right }; });
  c.sheetIsSideSheet = sg.w <= 520 && sg.right >= 1439 && sg.x > 800;
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${out}/11-settings-seitenblatt.png` });
  i = await idx(pg);
  await pg.mouse.click(10, 500);
  await pg.waitForTimeout(150);
  c.sheetClosesOnOutsideClick = !(await has(pg, 'desk-sheet'));
  await E(pg, 'desk-settings').click();
  await pg.waitForTimeout(150);
  await pg.mouse.move(720, 450);
  await press(pg, 'j', 200);
  c.sheetBlocksKeys = (await idx(pg)) === i;
  await press(pg, 'Escape', 200);
  c.escClosesSheet = !(await has(pg, 'desk-sheet'));
  await E(pg, 'desk-saved').click();
  c.savedAsSheet = await waitFor(pg, () => !!document.querySelector('[data-testid=desk-sheet]'));
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${out}/12-saved-seitenblatt.png` });
  await E(pg, 'desk-sheet-close').click();
  c.sheetCloseButton = !(await has(pg, 'desk-sheet'));

  // ? öffnet die Übersicht, noch einmal ? oder Esc schließt
  await pg.keyboard.press('Shift+Slash');
  await pg.waitForTimeout(150);
  c.questionOpensHelp = await bodyNoHelp();
  await press(pg, 'Escape', 150);
  c.helpClosesAgain = !(await bodyNoHelp());
  await E(pg, 'desk-help-open').click();
  c.helpButtonOpens = await waitFor(pg, () => !!document.querySelector('[data-testid=desk-help]'));
  await E(pg, 'desk-help-close').click();

  // Medientasten über die Media Session
  const ms = await pg.evaluate(() => {
    const m = navigator.mediaSession;
    return { meta: !!m?.metadata, title: m?.metadata?.title ?? '', artist: m?.metadata?.artist ?? '', state: m?.playbackState };
  });
  c.mediaMetadata = ms.meta && ms.title === (await pg.evaluate(() => window.__core.moment().hook)) && ms.artist.length > 0;
  results.notes.media = ms;
  await settle(pg);
  const act = (name) => pg.evaluate((n) => { try { window.__msHandlers[n](); return true; } catch { return false; } }, name);
  c.mediaHandlersSet = await pg.evaluate(() => ['play', 'pause', 'nexttrack', 'previoustrack'].every((n) => typeof window.__msHandlers[n] === 'function'));
  await dismissRecall(pg);
  await settle(pg);
  await act('pause');
  await pg.waitForTimeout(150);
  c.mediaPause = (await st(pg)) === 2 && (await pg.evaluate(() => navigator.mediaSession.playbackState)) === 'paused';
  await act('play');
  await pg.waitForTimeout(150);
  c.mediaPlay = (await st(pg)) === 1 && (await pg.evaluate(() => navigator.mediaSession.playbackState)) === 'playing';
  i = await idx(pg);
  await act('nexttrack');
  await pg.waitForTimeout(300);
  c.mediaNext = (await idx(pg)) === i + 1;
  await dismissRecall(pg);
  i = await idx(pg);
  await act('previoustrack');
  await pg.waitForTimeout(300);
  c.mediaPrevious = (await idx(pg)) === i - 1;

  c.noPageErrors = errors.length === 0;
  if (errors.length) results.notes.errors = errors.slice(0, 5);
  await cx.close();

  // ---------- PWA: Installierbarkeit in Chromium (DevTools) ----------
  {
    const px = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pp = await px.newPage();
    await pp.goto(url);
    await pp.waitForTimeout(1500);
    const cdp = await px.newCDPSession(pp);
    await cdp.send('Page.enable');
    const inst = await cdp.send('Page.getInstallabilityErrors').catch((e) => ({ installabilityErrors: [{ errorId: 'cdp-' + e.message }] }));
    results.notes.installability = inst.installabilityErrors;
    c.pwaInstallable = inst.installabilityErrors.length === 0;
    const man = await pp.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); if (!l) return null; const r = await fetch(l.href); return r.json(); });
    results.notes.manifest = man && { name: man.name, display: man.display, start_url: man.start_url, icons: (man.icons ?? []).map((x) => x.sizes) };
    c.pwaManifest = !!man && ['standalone', 'fullscreen', 'minimal-ui'].includes(man.display) && (man.icons ?? []).some((x) => /512/.test(x.sizes));
    await px.close();
  }
} catch (e) {
  results.fatal = String(e && e.stack ? e.stack : e);
} finally {
  await browser?.close();
}
results.ok = !results.fatal && Object.values(c).length > 0 && Object.values(c).every(Boolean);
results.failed = Object.entries(c).filter(([, v]) => !v).map(([n]) => n);
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ ok: results.ok, failed: results.failed, fatal: results.fatal, checks: Object.keys(c).length }, null, 2));
process.exit(results.ok ? 0 : 1);
