// E2E des Momente-Feeds mit nachgebauter YouTube-API (echte Wiedergabe ist im Runner nicht möglich, Fehler 150).
// Erzeugt einen eigenen Testschlüssel und einen verschlüsselten Testpool ohne persönliche Daten in dist/moments/pool.enc.
// Aufruf: node tests/e2e/moments.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-moments'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');

// Testpool: erster Block Beat (mit und ohne forYou), dann Brain und Body
const AR = [[0, 'وما من قلب إلا وهو بين إصبعين من أصابع الرحمن'], [2, 'إن شاء أقامه وإن شاء أزاغه']];
const mk = (i, area, topic, forYou) => ({ id: `test${String(i).padStart(7, '0')}:${100}`, videoId: `test${String(i).padStart(7, '0')}`, start: 100, end: 160 + (i % 3) * 20, channel: `Kanal ${area} ${i % 4}`, videoTitle: 'Testvideo', area, topic, hook: `Testmoment ${i} ${area}`, forYou, kind: 'regel', createdAt: '2026-10-20T00:00:00Z', cues: [[0, 'Untertitel eins, If Apple were like everyone else, a marketing message'] , [2, 'Untertitel zwei']] });
const EX = Array.from({ length: 14 }, (_, i) => `Sentence ${i + 1} of the checked excerpt, long enough to need scrolling on a phone screen.`).join('\n');
const moments = [];
// Beat: die Hälfte mit arabischen Untertiteln (Punkt 4: auto zeigt Arabisch, nicht Englisch)
for (let i = 0; i < 12; i++) moments.push({ ...mk(i, 'beat', 'islam', i % 2 === 0 ? 'Testzeile für dich' : undefined), ...(i % 2 === 1 ? { cues: AR } : {}) });
// Mehrere Themen: Not for me wirft ein ganzes Thema aus der Warteschlange, der Pool darf dadurch nicht vor der Endseite leerlaufen
for (let i = 12; i < 40; i++) moments.push(mk(i, 'brain', ['augen', 'retina', 'linse'][i % 3]));
for (let i = 40; i < 55; i++) moments.push(mk(i, 'body', ['kraft', 'schlaf'][i % 2]));
// Reserve: weitere Video-Momente, damit der Pool trotz Chips, Mute und Not for me nicht vor dem Ende der Prüfungen leerläuft
for (let i = 61; i < 91; i++) moments.push(mk(i, ['brain', 'body'][i % 2], ['augen', 'retina', 'kraft', 'schlaf'][i % 4]));
for (const m of moments) m.excerpt = EX;
// Kontext (Entscheidung 18): jeder fünfte Moment ohne Feld, damit auch "fehlt es, wird nichts angezeigt" geprüft wird
for (const [i, m] of moments.entries()) if (i % 5 !== 4) m.context = `Context sentence one for ${m.hook}. Context sentence two names a term.`;
// Abrufkarte: jeder Moment hat recall, die richtige Antwort wechselt (i % 3). Ungerade Nummern und Vielfache von 3 arabisch (rechtsläufig),
// damit in jeder Reihenfolge der Warteschlange beide Richtungen vorkommen (die Reihenfolge hängt von der Tiefe der Warteschlange ab).
for (const m of moments) {
  const i = Number(m.videoId.slice(4));
  const ar = i % 2 === 1 || i % 3 === 0;
  m.recall = ar
    ? { question: `ما الفكرة الأساسية في المقطع ${i}؟`, options: [`الجواب الصحيح ${i}`, `جواب خاطئ أ ${i}`, `جواب خاطئ ب ${i}`], correct: 0, why: `لأن هذا ما قيل في المقطع ${i}.` }
    : { question: `What follows from moment ${i}?`, options: [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`], correct: 0, why: `Because ${i} says so.` };
  // richtige Antwort an wechselnder Stelle der Liste
  const k = i % 3;
  const [right, ...wrong] = m.recall.options;
  const opts = [...wrong]; opts.splice(k, 0, right);
  m.recall.options = opts; m.recall.correct = k;
}
// Podcast-Momente (nur Ton) für den Audio-Filter
// Fallback ohne Feld form: audio true heißt audio. Die anderen fünf tragen das Feld.
for (const m of moments.slice(30, 35)) m.audio = true;
for (const m of moments.slice(35, 40)) Object.assign(m, { audio: true, form: 'audio' });
// Vertrag: Audio braucht einen eigenen Stream (hls). Das <video> wird in fakeyt.js nachgebaut.
for (const m of moments.slice(30, 40)) m.hls = `https://stream.test/${m.videoId}.m3u8`;
// Text-Momente: eigenes Feld form text, kein Player (die Video-ID dient nur dem Nachweis, dass nie geladen wird)
for (const m of moments.slice(40, 46)) Object.assign(m, { form: 'text', videoId: m.videoId.replace('test', 'texto') });
// Quellenzeile: gerade Nummern mit vorbehaltenen Rechten, ungerade CC BY (Aufgabe 6)
for (const [i, m] of moments.slice(40, 46).entries()) {
  Object.assign(m, {
    author: `Author ${i}`, ref: `Ref ${i}`, sourceUrl: `https://example.org/source/${i}`,
    license: i % 2 === 0 ? 'Alle Rechte vorbehalten, frei lesbar. Private Nutzung, Passagen mit Quellenangabe' : 'CC BY 4.0',
  });
}
// Gesehen bleibt gesehen: hinter dem letzten Moment steht die Endseite, es gibt kein Weiter. Darum genug Text-Momente für die Durchläufe unten.
for (let i = 55; i < 61; i++) {
  const m = mk(i, 'body', 'kraft');
  m.excerpt = EX;
  Object.assign(m, { form: 'text', videoId: m.videoId.replace('test', 'texto'), author: `Author ${i}`, ref: `Ref ${i}`, sourceUrl: `https://example.org/source/${i}`, license: i % 2 === 0 ? 'Alle Rechte vorbehalten, frei lesbar. Private Nutzung, Passagen mit Quellenangabe' : 'CC BY 4.0' });
  moments.push(m);
}
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
mkdirSync('dist/moments', { recursive: true });
writeFileSync('dist/moments/pool.enc', await encPool(moments));
// Pool für Hook und Caption: lange Hooks, ungerade Nummern mit arabischem excerpt, keine Abrufkarten
const LONG = ' and the hook keeps going, because a real hook is a full sentence that must never be cut off with three dots at the end of the second line, not even when it needs more than three lines on a phone screen.';
const AREX = Array.from({ length: 6 }, (_, i) => `الجملة ${i + 1} من المقطع المفحوص، طويلة بما يكفي ليحتاج الشاشة إلى التمرير.`).join('\n');
const poolNoRecall = await encPool(moments.map(({ recall, ...m }) => ({ ...m, hook: m.hook + LONG, ...(Number(m.videoId.slice(4)) % 2 === 1 ? { excerpt: AREX } : {}) })));
// Pool mit einem einzigen Kanal und Thema: zwei Skips in Folge treffen sicher denselben Kanal
const poolSolo = await encPool(Array.from({ length: 10 }, (_, i) => ({ ...mk(200 + i, 'brain', 'augen'), channel: 'Kanal solo', excerpt: EX })));
const poolVideoOnly = await encPool(moments.filter((m) => !m.audio && m.form !== 'text'));
// Pool mit fehlerhaften Momenten (Vertrag): Text ohne excerpt, Podcast ohne hls, Video mit pod-ID.
// Dazu vier Momente mit gültiger ID, die YouTube mit Fehler 150 ablehnt (Nachbau, IDs errorvid...). Der Feed muss trotzdem laufen.
const badBase = { start: 100, end: 160, channel: 'Kanal bad', videoTitle: 'Testvideo', topic: 'augen', kind: 'regel', createdAt: '2026-10-20T00:00:00Z' };
const badMoments = [
  { ...badBase, id: 'txt-0000001x:100', videoId: 'txt-0000001x', area: 'beat', hook: 'Text ohne excerpt', form: 'text' },
  { ...badBase, id: 'pod-0000001x:100', videoId: 'pod-0000001x', area: 'brain', hook: 'Podcast ohne hls', form: 'audio', audio: true },
  { ...badBase, id: 'pod-0000002x:100', videoId: 'pod-0000002x', area: 'body', hook: 'Video mit pod-ID', form: 'video' },
];
const errMoments = Array.from({ length: 4 }, (_, i) => ({ ...badBase, id: `errorvid00${i}:100`, videoId: `errorvid00${i}`, area: ['beat', 'brain', 'body', 'brain'][i], hook: `Fehler 150 Nr. ${i}`, form: 'video' }));
// Genug gültige Momente, damit 12 Wischer den Pool nie erschöpfen (am Poolende gibt es kein Weiter mehr)
const goodVideo = [...moments.slice(0, 4), ...moments.slice(12, 16), ...moments.slice(46, 50), ...moments.slice(4, 8), ...moments.slice(16, 28), ...moments.slice(50, 55)].map(({ recall, ...m }) => m);
const poolBad = await encPool([...badMoments.slice(0, 1), ...errMoments.slice(0, 2), badMoments[1], ...goodVideo.slice(0, 6), badMoments[2], ...errMoments.slice(2), ...goodVideo.slice(6)]);
// Alle Beat-Momente werfen beim Anlegen des Players (Konstruktor wirft). Der Tag beginnt mit Beat, also trifft es die ersten drei Slots.
const throwMoments = Array.from({ length: 3 }, (_, i) => ({ ...badBase, id: `throwvid00${i}:100`, videoId: `throwvid00${i}`, area: 'beat', hook: `Konstruktor wirft Nr. ${i}`, form: 'video' }));
const poolThrow = await encPool([...throwMoments, ...goodVideo.filter((m) => m.area !== 'beat')]);
const k = Buffer.from(raw).toString('base64url');

const results = { at: new Date().toISOString(), runs: [] };
// Abrufkarte kommt nach jedem 4. Moment. Wo der Test etwas anderes prüft, wird sie per Wisch nach oben ohne Wertung geschlossen.
// Beim ersten Mal dient eine spätere Karte dem Treffer-Test (richtig wählen, 7 Tage), siehe hitState.
const swipeUpCard = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid=recall-card]');
    try {
      const mk = (y) => new Touch({ identifier: 1, target: el, clientX: 100, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [mk(500)], changedTouches: [mk(500)] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [mk(300)] }));
      return 'touch';
    } catch {
      window.__core.skipRecall();
      return 'hook';
    }
  });
const hitState = { done: false, out: null, skipped: null, cards: [] };
const skipRecall = async (page, name = 'x', out = 'pipeline/out/e2e-moments') => {
  if (!(await page.$('[data-testid=recall-card]'))) return;
  const cd = await page.evaluate(() => ({ ar: /[\u0600-\u06FF]/.test(document.querySelector('[data-testid=recall-question]')?.textContent ?? ''), dir: document.querySelector('[data-testid=recall-card]')?.getAttribute('dir') }));
  if (cd.ar && !hitState.cards.some((x) => x.ar)) await page.screenshot({ path: `${out}/${name}-16-abruf-arabisch.png` });
  hitState.cards.push(cd);
  if (!hitState.done && globalThis.__firstCardDone) {
    hitState.done = true;
    const before = await page.evaluate(() => Object.keys(window.__core.recall().state).length);
    await page.click('[data-testid=recall-option][data-correct="1"]');
    const st = await page.evaluate(() => ({
      right: document.querySelector('[data-testid=recall-option][data-correct="1"]')?.dataset.state,
      others: [...document.querySelectorAll('[data-testid=recall-option][data-correct="0"]')].map((x) => x.dataset.state),
      why: document.querySelector('[data-testid=recall-why]')?.textContent ?? '',
      rs: Object.values(window.__core.recall().state),
      n: Object.keys(window.__core.recall().state).length,
    }));
    const last = st.rs.find((x) => x.results.length === 1 && x.results[0].got);
    hitState.out = {
      green: st.right === 'right' && st.others.every((x) => x === 'rest'),
      why: /^(Because \d+ says so\.|لأن هذا)/.test(st.why),
      due7: !!last && Math.round((last.due - last.results[0].at) / 86400000) === 7,
      grew: st.n === before + 1,
    };
    await page.screenshot({ path: `${out}/${name}-13-abruf-treffer.png` });
    await page.click('[data-testid=recall-next]');
  } else {
    const before = await page.evaluate(() => Object.keys(window.__core.recall().state).length);
    const how = await swipeUpCard(page);
    await page.waitForFunction(() => !document.querySelector('[data-testid=recall-card]'));
    const after = await page.evaluate(() => Object.keys(window.__core.recall().state).length);
    if (hitState.skipped === null) hitState.skipped = { how, noRating: before === after };
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid=recall-card]'));
};
// Der Feed läuft nach einem Wechsel noch kurz als Feder aus. Ein Finger, der dort aufsetzt, fängt die Seite (wie bei Instagram), darum warten die Gesten hier ab.
const settled = (page) => page.waitForFunction(() => !document.querySelector('.vfeed[data-moving]'), undefined, { timeout: 5000 }).catch(() => {});
// Wartet höchstens 20 s, kehrt aber sofort zurück, sobald die Bedingung gilt. Der lange Deckel fängt langsame CI-Läufe (WebKit unter Last) ab, ohne eine Prüfung zu lockern.
const waitFor = async (page, fn, arg, timeout = 20000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};

// Frischer Kontext (eigener Speicher, kein Gesehen, keine gemerkten Momente, keine Abrufstände aus den Abschnitten davor).
// Die Fehlerabschnitte nutzen dieselben Moment-IDs wie der Hauptpool. Im geteilten Kontext wären sie schon gesehen und der Feed am Poolende.
const freshPage = async (browser, url, k, poolBody, query) => {
  const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  const pg = await cx.newPage();
  await pg.addInitScript(() => { window.__ytSlow = true; });
  await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  await pg.goto(`${url}${query}#k=${k}`);
  return { cx, pg };
};

const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {} };
  results.runs.push(r);
  const c = r.checks;
  Object.assign(hitState, { done: false, out: null, skipped: null, cards: [] });
  globalThis.__firstCardDone = false;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    // Service Worker aus: Anfragen über den SW kann Playwright nicht umleiten, dann käme das echte YouTube statt des Nachbaus (Fehler 150)
    const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const page = await ctx.newPage();
    // Der Nachbau spielt 100-fach schnell: ein 60-s-Moment endet nach 0,6 s. Bis zum ersten Tipp läuft die Uhr in Echtzeit, sonst kippt der Tipp auf einem langsamen Runner in die Für-dich-Karte.
    await page.addInitScript(() => { window.__ytSlow = true; });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Ohne Schlüssel gesperrt
    await page.goto(url + '?now=2026-10-23');
    c.lockedWithoutKey = await waitFor(page, () => document.body.innerText.includes('not unlocked'));

    // Freischalten über #k=, Fragment wird entfernt
    await page.goto('about:blank');
    await page.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
    c.feedAfterDecrypt = await waitFor(page, () => !!window.__core?.moment());
    c.fragmentRemoved = !page.url().includes('#k=');
    // Schlüssel doppelt gesichert: Cache Storage hat ihn, und nach Löschen von IndexedDB schaltet die App sich selbst wieder frei
    c.keyInCache = await page.evaluate(async () => !!(await (await caches.open('core-key')).match(new URL('/core/__key', location.origin).href)));
    c.firstArea = await page.evaluate(() => window.__core.moment().area);
    c.firstPlaying = await waitFor(page, () => window.__core.state() === 1);
    // Kurzer Hook: Normalgröße, nicht gekürzt, keine drei Punkte
    const h0 = await page.evaluate(() => { const e = document.querySelector('[data-testid=hook]'); return { step: e.dataset.step, clipped: e.scrollHeight > e.clientHeight + 1, ellipsis: getComputedStyle(e).textOverflow === 'ellipsis', clamp: getComputedStyle(e).webkitLineClamp, size: parseFloat(getComputedStyle(e).fontSize), text: e.textContent }; });
    c.hookShortNormal = h0.step === '0' && !h0.clipped && h0.size === 17 && (h0.clamp === 'none' || h0.clamp === '' || h0.clamp === undefined);
    const capState = () => page.evaluate(() => {
      const m = window.__core.moment();
      const el = document.querySelector('[data-testid=caption] span');
      return { ar: /[\u0600-\u06FF]/.test(JSON.stringify(m.cues ?? [])), shown: !!el?.textContent, rtl: el?.getAttribute('dir') === 'rtl', size: el ? parseFloat(getComputedStyle(el).fontSize) : 0, align: el ? getComputedStyle(el).textAlign : '' };
    });
    const capLog = [];
    await page.screenshot({ path: `${out}/${name}-1-start.png` });

    // Ton aus: nur ein kleines durchgestrichenes Lautsprecher-Symbol unten rechts im Videoband, keine Pille und kein Text
    const vp = page.viewportSize();
    // Messen erst, wenn keine Transition mehr läuft (der Feed gleitet beim Start noch ein)
    await waitFor(page, () => document.getAnimations().filter((a) => a instanceof CSSTransition).length === 0);
    const icon = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=sound-off]');
      const band = document.querySelector('.vframe > div');
      if (!el || !band) return null;
      const a = el.getBoundingClientRect(), b = band.getBoundingClientRect();
      return { w: a.width, h: a.height, text: el.textContent.trim(), right: innerWidth - a.right, fromBandBottom: b.bottom - a.bottom, inBand: a.top >= b.top && a.bottom <= b.bottom + 12, centered: Math.abs(a.left + a.width / 2 - innerWidth / 2) < 40, pillText: document.body.innerText.includes('Tap for sound'), slashed: !!el.querySelector('path[d^="m16 9"]') };
    });
    r.soundIcon = icon;
    c.soundIconShownWhileMuted = !!icon && icon.w <= 40 && icon.h <= 40 && icon.text === '' && icon.slashed;
    c.soundIconBottomRightOfBand = !!icon && icon.right >= 8 && icon.right <= 24 && icon.inBand && Math.abs(icon.fromBandBottom - 12) <= 3 && !icon.centered;
    c.noSoundPill = !!icon && !icon.pillText && !(await page.$('.vhint'));
    await page.screenshot({ path: `${out}/${name}-1b-ton-aus-symbol.png` });
    // Tipp irgendwo: Ton an, Symbol verschwindet
    await page.mouse.click(vp.width / 2, vp.height / 2);
    c.soundOn = await waitFor(page, () => window.__ytlog.includes('unmute'));
    await page.evaluate(() => { window.__ytSlow = false; });
    c.soundIconGoneAfterTap = await waitFor(page, () => !document.querySelector('[data-testid=sound-off]'));

    // 4 Momente durchlaufen: Für dich genau dann, wenn forYou gesetzt ist; Ende genau bei end
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const m = await page.evaluate(() => ({ ...window.__core.moment(), idx: window.__core.idx() }));
      await page.waitForTimeout(250);
      const cs = await capState();
      capLog.push(cs);
      if (cs.ar && cs.shown && !capLog.slice(0, -1).some((x) => x.ar && x.shown)) await page.screenshot({ path: `${out}/${name}-6-arabisch.png` });
      await waitFor(page, (j) => window.__core.forYou() || window.__core.idx() !== j, m.idx, 15000);
      const fy = await page.evaluate(() => window.__core.forYou());
      const t = await page.evaluate(() => window.__core.time());
      if (fy) {
        if (!seen.some((x) => x.fy)) await page.screenshot({ path: `${out}/${name}-2-fuer-dich.png` });
        await page.click('[data-testid="foryou"]');
      }
      await waitFor(page, (j) => window.__core.idx() === j + 1, m.idx);
      seen.push({ id: m.id, has: !!m.forYou, fy, stoppedAtEnd: !fy || t <= m.end + 0.01 });
    }
    c.soundIconNeverBack = !(await page.$('[data-testid=sound-off]')) && (await page.evaluate(() => window.__core.sound()));
    c.forYouExactlyWhenSet = seen.every((x) => x.has === x.fy);
    c.sawBothKinds = seen.some((x) => x.has) && seen.some((x) => !x.has);
    c.stoppedAtEnd = seen.every((x) => x.stoppedAtEnd);
    c.autoNext = seen.length === 4;
    // Punkt 5: nach dem 4. Moment kommt die Abrufkarte, Player steht, Hook erst nach dem Versuch
    c.recallAfter4 = await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'));
    c.recallPlayerStopped = await waitFor(page, () => window.__core.state() !== 1);
    const card0 = await page.evaluate(() => {
      const card = document.querySelector('[data-testid=recall-card]');
      const opts = [...document.querySelectorAll('[data-testid=recall-option]')];
      const q = document.querySelector('[data-testid=recall-question]');
      const rect = (e) => e.getBoundingClientRect();
      return {
        n: opts.length,
        before: !!document.querySelector('[data-testid=recall-why]') || !!document.querySelector('[data-testid=recall-next]'),
        old: !!card?.querySelector('textarea') || /Got it|Missed|Skip|Show answer/.test(card?.textContent ?? ''),
        dir: card?.getAttribute('dir'),
        qar: /[\u0600-\u06FF]/.test(q?.textContent ?? ''),
        fullWidth: opts.every((o) => Math.abs(rect(o).width - (rect(card).width - 40)) < 2),
        order: opts.map((o) => o.dataset.correct),
        cover: !!card?.querySelector('.recall-source img'),
        area: !!card?.querySelector('.recall-area')?.textContent,
        speaker: !!card?.querySelector('.recall-speaker')?.textContent,
        coverFirst: card?.firstElementChild?.className === 'recall-source',
        qBeforeOptions: !!(q && opts[0] && q.compareDocumentPosition(opts[0]) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    r.card0 = card0;
    c.recallThreeFullWidthOptions = card0.n === 3 && card0.fullWidth;
    c.recallNothingBeforeChoice = !card0.before;
    c.recallOldControlsGone = !card0.old;
    c.recallLayout = card0.cover && card0.area && card0.speaker && card0.coverFirst && card0.qBeforeOptions;
    hitState.cards.push({ ar: card0.qar, dir: card0.dir });
    await page.screenshot({ path: `${out}/${name}-11-abruf-frage.png` });
    // Falsch wählen: gewählte rot, richtige grün, dritte neutral, dann Begründung und Next
    await page.click('[data-testid=recall-option][data-correct="0"]');
    const wr = await page.evaluate(() => ({
      states: [...document.querySelectorAll('[data-testid=recall-option]')].map((o) => ({ c: o.dataset.correct, s: o.dataset.state })),
      col: [...document.querySelectorAll('[data-testid=recall-option]')].map((o) => getComputedStyle(o).borderColor),
      why: document.querySelector('[data-testid=recall-why]')?.textContent ?? '',
      next: document.querySelector('[data-testid=recall-next]')?.textContent,
      whyBelow: (() => { const o = [...document.querySelectorAll('[data-testid=recall-option]')].pop(); const w = document.querySelector('[data-testid=recall-why]'); const n = document.querySelector('[data-testid=recall-next]'); return !!(o && w && n && o.compareDocumentPosition(w) & 4 && w.compareDocumentPosition(n) & 4); })(),
    }));
    r.wrongChoice = wr;
    c.recallColors = wr.states.filter((x) => x.s === 'right').length === 1 && wr.states.filter((x) => x.s === 'wrong').length === 1 && wr.states.filter((x) => x.s === 'rest').length === 1 && wr.states.find((x) => x.s === 'right').c === '1' && wr.states.find((x) => x.s === 'wrong').c === '0' && new Set(wr.col).size === 3;
    c.recallWhyAndNext = /^(لأن هذا|Because \d+ says so\.)/.test(wr.why) && wr.next === 'Next' && wr.whyBelow;
    // Zweiter Tipp ändert nichts
    await page.click('[data-testid=recall-option][data-state=rest]', { force: true, timeout: 1500 }).catch(() => {});
    await page.screenshot({ path: `${out}/${name}-12-abruf-antwort.png` });
    await page.click('[data-testid=recall-next]');
    globalThis.__firstCardDone = true;
    c.recallClosed = await waitFor(page, () => !document.querySelector('[data-testid=recall-card]'));
    c.recallPlaysAgain = await waitFor(page, () => window.__core.state() === 1);
    const rs = await page.evaluate(() => Object.values(window.__core.recall().state));
    r.recall = rs;
    c.recallMissed2d = rs.length === 1 && rs[0].results.length === 1 && rs[0].results[0].got === false && Math.round((rs[0].due - rs[0].results[0].at) / 86400000) === 2;
    c.todayNoGotItForMiss = await waitFor(page, () => /, 0 got it$/.test(document.querySelector('[data-testid=today]')?.textContent ?? ''));

    // Punkt 6: Tageszahl oben, zählt jeden neu gezeigten Moment, kein Stopp
    const todayTxt = await page.evaluate(() => document.querySelector('[data-testid=today]')?.textContent ?? '');
    r.today = todayTxt;
    c.todayCount = /^today ([5-9]|\d\d) seen, \d+ got it$/.test(todayTxt);
    // Punkt 4: auto heißt Englisch aus, Arabisch an, rechtsläufig, mindestens 20 px
    r.captions = capLog;
    c.captionsAutoRule = capLog.every((x) => x.shown === x.ar);
    c.captionsArabicRtl = capLog.filter((x) => x.ar).every((x) => x.rtl && x.align === 'right' && x.size >= 20);
    r.sequence = seen;

    // Wischen wechselt
    await settled(page);
    const before = await page.evaluate(() => window.__core.idx());
    await page.mouse.move(vp.width / 2, vp.height * 0.7);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(vp.width / 2, vp.height * (0.7 - 0.09 * i));
    await page.mouse.up();
    c.swipeNext = await waitFor(page, (b) => window.__core.idx() === b + 1, before);
    // Untertitel: das Menü gibt es nicht mehr, der Schalter steht in Settings. Immer an gilt auch für Englisch.
    await skipRecall(page, name, out);
    await page.keyboard.press(' ');
    await page.click('nav [aria-label=Settings]');
    await page.selectOption('[data-testid=captions]', 'on');
    await page.click('nav [aria-label=Feed]');
    await page.keyboard.press(' ');
    c.captionsSettingsOn = await waitFor(page, () => !!document.querySelector('[data-testid=caption] span')?.textContent);
    await page.screenshot({ path: `${out}/${name}-7-untertitel-an.png` });
    // Gedrückt halten: 2x, Loslassen: normal
    await page.mouse.move(vp.width / 2, vp.height * 0.5);
    await page.mouse.down();
    c.holdFast = await waitFor(page, () => [...document.querySelectorAll("span")].some((s) => s.textContent === "2x"));
    await page.mouse.up();
    c.releaseNormal = await waitFor(page, () => ![...document.querySelectorAll("span")].some((s) => s.textContent === "2x"));
    // Punkt 8: YouTube-Iframe füllt genau das 16:9-Band, ohne Zoom und ohne Beschnitt
    // Erst messen, wenn der Feed nicht mehr gleitet (sonst steht das erste Band noch versetzt)
    await waitFor(page, () => document.getAnimations().filter((a) => a instanceof CSSTransition).length === 0);
    r.band = await page.evaluate(() => {
      const band = document.querySelector('.vframe > div');
      const f = document.createElement('iframe');
      band.appendChild(f);
      const a = band.getBoundingClientRect(), b = f.getBoundingClientRect();
      f.remove();
      return { bw: a.width, bh: a.height, fw: b.width, fh: b.height, dx: b.left - a.left, dy: b.top - a.top, vw: innerWidth };
    });
    c.embedNoZoom = Math.abs(r.band.fw - r.band.bw) < 1 && Math.abs(r.band.fh - r.band.bh) < 1 && Math.abs(r.band.dx) < 1 && Math.abs(r.band.dy) < 1;
    c.embed16by9FullWidth = Math.abs(r.band.bw - r.band.vw) < 1 && Math.abs(r.band.bh - (r.band.vw * 9) / 16) < 1;

    // Punkt 2: Standard 1,5x, Halten 2x, nie über 2x
    const rates = await page.evaluate(() => window.__ytlog.filter((x) => x.startsWith('rate ')).map((x) => Number(x.slice(5))));
    r.rates = [...new Set(rates)];
    c.speedDefault15 = rates.includes(1.5);
    c.speedHold2 = rates.includes(2);
    c.speedNeverAbove2 = rates.length > 0 && rates.every((x) => x <= 2);
    c.speedBackAfterRelease = rates.lastIndexOf(1.5) > rates.indexOf(2);

    // Punkt 3: Formwahl. Text hält den Player an, "gesehen" erst am Textende, Wahl bleibt gespeichert
    await skipRecall(page, name, out);
    await page.click('[data-testid=form-switch] >> text=Text');
    c.textView = await waitFor(page, () => !!document.querySelector('[data-testid=text-view]')?.textContent?.includes('Sentence 14'));
    c.textPaused = await waitFor(page, () => window.__core.state() !== 1);
    await page.keyboard.press('j');
    await page.waitForTimeout(300);
    await skipRecall(page, name, out);
    const tid = await page.evaluate(() => window.__core.moment().id);
    c.textNotSeenBeforeEnd = !(await page.evaluate((id) => window.__core.seen(id), tid));
    await page.screenshot({ path: `${out}/${name}-9-text.png` });
    await page.evaluate(() => { const el = document.querySelector('[data-testid=text-view]'); el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    c.textSeenAtEnd = await waitFor(page, (id) => window.__core.seen(id), tid);
    c.textStillPaused = await page.evaluate(() => window.__core.state() !== 1);
    await skipRecall(page, name, out);
    // Filter nach Feld form: Text zeigt nur Text-Momente, ohne Player
    c.textOnlyTextMoments = await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) { if (window.__core.moment()?.form !== 'text') return false; window.__core.next(); await new Promise((r) => setTimeout(r, 40)); }
      return true;
    });
    c.textHookShown = await page.evaluate(() => { const m = window.__core.moment(); const t = document.querySelector('[data-testid=text-view]')?.textContent ?? ''; return t.includes(m.hook) && t.includes('Sentence 1 '); });
    // Aufgabe 6: Quellenzeile unter der Passage, antippbar, "Quoted from" nur bei vorbehaltenen Rechten
    const srcRows = await page.evaluate(async () => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const m = window.__core.moment();
        const a = document.querySelector('[data-testid=text-view] [data-testid=text-source]');
        const body = document.querySelector('[data-testid=text-view] .vtext-body');
        rows.push({ license: m.license, author: m.author, ref: m.ref, url: m.sourceUrl, t: a?.textContent ?? null, href: a?.getAttribute('href') ?? null, target: a?.getAttribute('target') ?? null, below: !!(a && body && (body.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)), h: a ? a.getBoundingClientRect().height : 0 });
        window.__core.next(); await new Promise((r) => setTimeout(r, 60));
      }
      return rows;
    });
    c.sourceLineAll = srcRows.length === 5 && srcRows.every((r) => r.t && r.below);
    c.sourceLineFields = srcRows.every((r) => r.t.includes(r.author) && r.t.includes(r.ref));
    c.sourceLineQuoted = srcRows.every((r) => (/Alle Rechte/.test(r.license) ? r.t.startsWith('Quoted from Author') && r.t.endsWith('All rights reserved') : r.t.startsWith('Author') && r.t.endsWith('CC BY 4.0')));
    c.sourceLineLink = srcRows.every((r) => r.href === r.url && r.target === '_blank' && r.h >= 20);
    for (let i = 0; i < 6 && (await page.$('[data-testid=recall-card]')); i++) { await page.evaluate(() => window.__core.skipRecall()); await page.waitForTimeout(250); }
    await page.context().route('https://example.org/**', (r) => r.abort());
    const popup = page.context().waitForEvent('page', { timeout: 4000 }).then(async (p) => { await p.waitForLoadState('commit').catch(() => {}); return p.url() || 'opened'; }, () => null);
    await page.click('[data-testid=text-view] [data-testid=text-source]');
    const popped = await popup;
    c.sourceLineOpens = popped !== null;
    await page.evaluate(() => { const el = document.querySelector('[data-testid=text-view]'); el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: `${out}/${name}-22-source-line.png` });
    c.textNeverLoadsPlayer = await page.evaluate(() => !window.__ytlog.some((x) => x.includes('texto')));
    await skipRecall(page, name, out);
    await page.click('[data-testid=form-switch] >> text=Audio');
    c.audioOnlyAudio = await waitFor(page, () => window.__core.moment()?.audio === true && !document.querySelector('[data-testid=text-view]'));
    c.audioPlays = await waitFor(page, () => window.__core.state() === 1);
    // Eigener Stream: jeder Startversuch steht mit Ergebnis im Protokoll (Metadaten, play, ok oder abgelehnt)
    await waitFor(page, () => window.__core.diag().some((l) => /deck loadedmetadata/.test(l)));
    const hlsDiag = await page.evaluate(() => window.__core.diag().filter((l) => /deck /.test(l)));
    r.hlsDiag = hlsDiag.slice(-6);
    c.hlsDiagPerAttempt = hlsDiag.some((l) => /deck loadedmetadata rs=\d muted=\w+/.test(l)) && hlsDiag.some((l) => /deck play#\d+ start rs=\d muted=\w+/.test(l)) && hlsDiag.some((l) => /deck play#\d+ ok/.test(l));
    c.audioCoverShown = await waitFor(page, () => !!document.querySelector('.vslot[aria-hidden=false] .vaudio-art'));
    c.audioBigCaption = await waitFor(page, () => { const el = document.querySelector('[data-testid=caption] span'); return !!el?.textContent && parseFloat(getComputedStyle(el).fontSize) >= 22; });
    await page.screenshot({ path: `${out}/${name}-10-audio.png` });
    c.audioNeverVideo = await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) { if (window.__core.moment()?.audio !== true) return false; window.__core.next(); await new Promise((r) => setTimeout(r, 40)); }
      return true;
    });
    await skipRecall(page, name, out);
    await page.click('[data-testid=form-switch] >> text=Video');
    c.videoBack = await waitFor(page, () => window.__core.state() === 1 && !document.querySelector('[data-testid=text-view]') && !window.__core.moment()?.audio);
    c.videoNeverAudio = await page.evaluate(async () => {
      for (let i = 0; i < 12; i++) { const mm = window.__core.moment(); if (mm?.audio || mm?.form === 'text') return false; window.__core.next(); await new Promise((r) => setTimeout(r, 40)); }
      return true;
    });

    // Aufgabe 3: Bedienung. Doppeltipp = More like this mit Herz an der Tippstelle, Save nur über die Spalte
    await skipRecall(page, name, out);
    // anhalten (der erste Leertaste-Druck schaltet nur den Ton ein), damit der Moment während der Prüfung nicht weiterläuft
    for (let i = 0; i < 3 && (await page.evaluate(() => window.__core.state())) === 1; i++) { await page.keyboard.press(' '); await page.waitForTimeout(300); }
    const op = await page.evaluate(() => ({ id: window.__core.moment().id }));
    c.pausedForCheck = (await page.evaluate(() => window.__core.state())) !== 1;
    const tapX = vp.width * 0.4, tapY = vp.height * 0.45;
    await page.mouse.dblclick(tapX, tapY);
    c.heartShown = await waitFor(page, () => !!document.querySelector('[data-testid=heart-burst]'));
    const hb = await page.evaluate(() => { const r = document.querySelector('[data-testid=heart-burst]')?.getBoundingClientRect(); return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null; });
    c.heartAtTap = !!hb && Math.abs(hb.cx - tapX) < 24 && Math.abs(hb.cy - tapY) < 24;
    c.heartGoneAfter400 = await waitFor(page, () => !document.querySelector('[data-testid=heart-burst]'), undefined, 1500);
    c.doubleTapLikes = await page.evaluate((id) => window.__core.liked(id) && document.querySelector('[data-testid=like]').getAttribute('aria-pressed') === 'true', op.id);
    c.doubleTapDoesNotSave = await page.evaluate((id) => !window.__core.saved(id), op.id);
    await page.mouse.dblclick(tapX, tapY);
    await page.waitForTimeout(150);
    c.doubleTapKeepsLike = await page.evaluate((id) => window.__core.liked(id), op.id);
    await page.click('[data-testid=like]');
    c.likeButtonUndoes = await page.evaluate((id) => !window.__core.liked(id) && document.querySelector('[data-testid=like]').getAttribute('aria-pressed') === 'false', op.id);
    await page.click('[data-testid=like]');
    c.likeButtonFills = await page.evaluate((id) => window.__core.liked(id), op.id);
    await page.click('[data-testid=save]');
    c.saveFills = await page.evaluate((id) => window.__core.saved(id) && document.querySelector('[data-testid=save]').getAttribute('aria-pressed') === 'true', op.id);
    // Spalte: vier Knöpfe, Ziele mindestens 48 pt, Abstände, Beschriftung
    const col = await page.evaluate(() => [...document.querySelectorAll('.vactions button')].map((b) => { const r = b.getBoundingClientRect(); return { id: b.dataset.testid, w: r.width, h: r.height, top: r.top, bottom: r.bottom, text: b.textContent }; }));
    c.columnOrder = col.map((x) => x.id).join() === 'like,save,source';
    c.columnTargets48 = col.every((x) => x.w >= 48 && x.h >= 48);
    c.columnSpacing = col.slice(1).every((x, i) => x.top - col[i].bottom >= 16);
    c.columnLabels = col.map((x) => x.text).join('|') === 'More|Save|Source';
    // Das "…"-Menü entfällt
    c.noOptionsButton = !(await page.$('[data-testid=options]')) && !(await page.$('[aria-label=Options]'));
    await page.screenshot({ path: `${out}/${name}-12-spalte.png` });

    // Tipp bis Füllung: im Test gemessen (App-Messung und unabhängige Messung), Ziel unter 100 ms
    const fills = [];
    for (let i = 0; i < 6; i++) {
      fills.push(await page.evaluate(() => new Promise((res) => {
        const b = document.querySelector('[data-testid=like]');
        const was = b.getAttribute('aria-pressed') === 'true';
        const t0 = performance.now();
        b.click();
        // React schreibt das Ergebnis eines Klicks spätestens am Ende des Ereignisses (Microtask) ins DOM
        queueMicrotask(() => {
          const changedNow = (b.getAttribute('aria-pressed') === 'true') !== was;
          requestAnimationFrame(() => requestAnimationFrame(() => res({ ms: performance.now() - t0, changedNow })));
        });
      })));
    }
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
    r.tapToFill = { measured: med(fills.map((x) => x.ms)), recorded: null };
    c.fillImmediate = fills.every((x) => x.changedNow);
    c.fillUnder100 = r.tapToFill.measured < 100;
    await page.waitForTimeout(300);
    const rec = await page.evaluate(() => window.__core.tapMs().map((x) => x.ms));
    r.tapToFill.recorded = med(rec);
    c.tapRecorded = rec.length >= 6 && r.tapToFill.recorded < 100;

    // Rückmeldung in einer Ebene (27.10.2026): Wisch nach links öffnet das Blatt, ein Tipp auf einen Chip speichert lokal und geht weiter, kein Netzwerkaufruf
    const gh = [];
    page.on('request', (q) => { if (/github\.com/.test(q.url())) gh.push(q.url()); });
    await page.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push({ u, t, f }); return null; }; });
    const swipeLeft = async (dxFrac = 0.5) => {
      const y = vp.height * 0.45;
      await page.mouse.move(vp.width * 0.8, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(vp.width * (0.8 - (dxFrac / 6) * i), y + i);
      await page.mouse.up();
    };
    const openSheet = async () => {
      // Im Zeitraffer kann der Moment unter dem Wisch enden (Abrufkarte, Wechsel): bis zu zwölfmal neu ansetzen
      let ok = false;
      for (let k = 0; k < 12 && !ok; k++) {
        await settled(page); await skipRecall(page, name, out);
        // Fing die Maus eine laufende Feder (im Zeitraffer wechselt der Feed ständig) und ging das Loslassen auf einer anderen Ebene verloren, bleibt der Griff offen: erst loslassen
        if (await page.evaluate(() => window.__core.motion().drag)) await page.mouse.up();
        await swipeLeft();
        ok = await waitFor(page, () => !!document.querySelector('[data-testid=note-sheet]'), undefined, 1500);
      }
      if (!ok) r.openDbg = await page.evaluate(() => ({ moving: !!document.querySelector('.vfeed[data-moving]'), card: !!document.querySelector('[data-testid=recall-card]'), motion: window.__core.motion(), vis: document.visibilityState, idx: window.__core.idx(), tr: document.querySelector('.vstage')?.style.transform, fy: window.__core.forYou(), recall: window.__core.recall().open }));
      return ok;
    };
    const notes = () => page.evaluate(() => window.__core.notes());
    const nm = await page.evaluate(() => window.__core.moment());
    const idxBefore = await page.evaluate(() => window.__core.idx());
    const likedBefore = await page.evaluate((id) => window.__core.liked(id), nm.id);
    c.swipeLeftOpensNote = await openSheet();
    c.swipeLeftStaysOnMoment = (await page.evaluate(() => window.__core.idx())) === idxBefore;
    const chipsSeen = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=note-chip-]')].map((x) => x.textContent));
    c.noteSixChips = chipsSeen.join() === 'Already known,Not for me,Weak,Wrong,Bad cut,Mute speaker' && !chipsSeen.includes('Great') && !chipsSeen.includes('Boring');
    c.noteTextAndDone = !!(await page.$('[data-testid=note-text]')) && (await page.textContent('[data-testid=note-done]')) === 'Done';
    c.noteNoSendButton = !(await page.$('[data-testid=note-send]')) && !(await page.$('text=Send'));
    const chipBox = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=note-chip-]')].map((e) => { const q = e.getBoundingClientRect(); return { w: q.width, h: q.height }; }));
    c.noteChipsLarge = chipBox.every((x) => x.h >= 56 && x.w >= 120);
    c.noteSheetOneLevel = (await page.evaluate(() => document.querySelectorAll('[data-testid=note-sheet]').length)) === 1;
    await page.screenshot({ path: `${out}/${name}-20-note-leer.png` });
    await page.fill('[data-testid=note-text]', 'typed only to test the keyboard keys: jjj kkk');
    c.noteTypingDoesNotNavigate = (await page.evaluate(() => window.__core.idx())) === idxBefore;
    await page.fill('[data-testid=note-text]', '');
    // Tipp auf Weak (früher Boring): speichert sofort, Bestätigungszeile am Blatt, nach etwa 0,9 s Blatt zu und nächster Moment, kein Toast, kein Browser, Herz unverändert
    const wWeak0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__core.weights())));
    await page.click('[data-testid="note-chip-Weak"]');
    c.noteConfirmLine = await waitFor(page, (t) => document.querySelector('[data-testid=note-confirm]')?.textContent === t && !!document.querySelector('[data-testid=note-sheet]'), `Less ${nm.channel}`);
    const wWeak = await page.evaluate(() => JSON.parse(JSON.stringify(window.__core.weights())));
    c.noteChipsLockedWhileConfirm = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=note-chip-]')].every((b) => b.disabled));
    await page.screenshot({ path: `${out}/${name}-23-note-bestaetigung.png` });
    c.noteSheetClosed = await waitFor(page, () => !document.querySelector('[data-testid=note-sheet]'));
    c.noteGoesToNext = await waitFor(page, (i) => window.__core.idx() === i + 1, idxBefore);
    const n1 = await notes();
    c.noteSavedLocally = n1.length === 1 && n1[0].id === nm.id && n1[0].chips.join() === 'Weak' && n1[0].hook === nm.hook && n1[0].tab === 'Video' && /^[0-9a-f]{7}$|^dev$/.test(n1[0].commit) && n1[0].sent === undefined;
    c.noteWeakWeakensChannel = (wWeak.channel[nm.channel] ?? 1) <= 0.7 + 0.001 && (wWeak.topic[nm.topic] ?? 1) === (wWeak0.topic[nm.topic] ?? 1);
    c.noteWeakNoToastNoHeart = !(await page.evaluate(() => !!document.querySelector('.flash'))) && (await page.evaluate((id) => window.__core.liked(id), nm.id)) === likedBefore;
    c.noteNothingOpened = (await page.evaluate(() => window.__opened)).length === 0 && gh.length === 0;
    // Nur Text, dann Done: speichert den Text ohne Chip, schließt, nächster Moment
    await openSheet();
    const nm2 = await page.evaluate(() => window.__core.moment());
    const idx2 = await page.evaluate(() => window.__core.idx());
    await page.fill('[data-testid=note-text]', 'The cut is two seconds late & the "hook" repeats.');
    await page.screenshot({ path: `${out}/${name}-21-note-text.png` });
    await page.click('[data-testid=note-done]');
    c.noteDoneClosesAndNext = await waitFor(page, (i) => !document.querySelector('[data-testid=note-sheet]') && window.__core.idx() >= i + 1, idx2);
    const n2 = await notes();
    c.noteTextSaved = n2.length === 2 && n2[1].id === nm2.id && n2[1].chips.length === 0 && n2[1].text === 'The cut is two seconds late & the "hook" repeats.';
    // Tipp neben das Blatt: schließt ohne Notiz, bleibt auf dem Moment. Done ohne Text: keine Notiz.
    await openSheet();
    const idx3 = await page.evaluate(() => window.__core.idx()); // Stand bei offenem Blatt: im Zeitraffer kann der Moment davor schon zu Ende gewesen sein
    await page.click('[data-testid=note-sheet]', { position: { x: 20, y: 20 } });
    c.noteOutsideCancels = await waitFor(page, () => !document.querySelector('[data-testid=note-sheet]')) && (await notes()).length === 2 && (await page.evaluate(() => window.__core.idx())) === idx3;
    await openSheet();
    await page.click('[data-testid=note-done]');
    await page.waitForTimeout(300);
    c.noteEmptyDoneNoNote = (await notes()).length === 2 && !(await page.$('[data-testid=note-sheet]'));
    // Wisch nach rechts und kurzer Zug nach links tun nichts
    await page.mouse.move(vp.width * 0.3, vp.height * 0.45);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(vp.width * (0.3 + 0.08 * i), vp.height * 0.45 + i);
    await page.mouse.up();
    await swipeLeft(0.08);
    await page.waitForTimeout(250);
    c.noteOnlyLongLeftSwipe = !(await page.$('[data-testid=note-sheet]'));
    c.noteNoNetwork = gh.length === 0;

    // Ask (Entscheidung 18): Knopf oberhalb der Chips, öffnet claude.ai/new mit Prompt, zählt wie More, setzt askedAt, schließt das Blatt, keine Notiz
    {
      await page.evaluate(() => { window.__opened = []; });
      const okAsk = await openSheet();
      const notesBefore = (await notes()).length;
      c.askButtonAboveChips = okAsk && (await page.evaluate(() => {
        const b = document.querySelector('[data-testid=note-ask]');
        const chips = document.querySelector('.note-chips');
        return !!b && !!chips && b.textContent.trim() === 'Ask' && !!(b.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING) && b.getBoundingClientRect().bottom <= chips.getBoundingClientRect().top + 1;
      }));
      const wBefore = await page.evaluate(() => JSON.stringify(window.__core.weights()));
      await page.click('[data-testid=note-ask]');
      c.askOpensClaude = await waitFor(page, () => window.__opened.length === 1);
      const op = await page.evaluate(() => window.__opened);
      const decoded = op.length ? decodeURIComponent(op[0].u.slice('https://claude.ai/new?q='.length)) : '';
      const num = /\nHook: Testmoment (\d+) /.exec(decoded)?.[1];
      const askId = num ? `test${num.padStart(7, '0')}:100` : '';
      r.askPrompt = decoded;
      c.askUrlHasHook = op.length === 1 && op[0].u.startsWith('https://claude.ai/new?q=') && !!num && decoded.startsWith('Core moment from Kanal ') && decoded.endsWith('\n\nMy question: ') && decoded.length < 1500 && op[0].t === '_blank';
      c.askUrlEncoded = op.length === 1 && !/[\s"<>]/.test(op[0].u) && op[0].u.includes('%0A');
      c.askClosesSheet = await waitFor(page, () => !document.querySelector('[data-testid=note-sheet]'));
      c.askSetsAskedAt = !!askId && (await page.evaluate((id) => window.__core.asked(id), askId)) > 0;
      c.askLearns = (await page.evaluate(() => JSON.stringify(window.__core.weights()))) !== wBefore;
      c.askNoHeartNoNote = !!askId && !(await page.evaluate((id) => window.__core.liked(id), askId)) && (await notes()).length === notesBefore;
      await page.waitForTimeout(300);
      c.askPausesMoment = (await page.evaluate(() => window.__core.state())) !== 1;
      // Die spätere Prüfung noteStillNoNetwork erwartet, dass bis dahin kein Fenster geöffnet wurde
      await page.evaluate(() => { window.__opened = []; });
    }

    // Alle Chips: Bestätigungszeile am Blatt (kein Toast), dann weiter, als Notiz gespeichert. Gewichte nach den Regeln (Deckel, nicht Faktoren).
    const shot = async (label, n) => { await page.screenshot({ path: `${out}/${name}-${n}-chip-${label.replace(/ /g, '-')}.png` }); };
    const wNow = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__core.weights())));
    const flow = async (label, line) => {
      const opened = await openSheet();
      // Moment erst lesen, wenn das Blatt offen ist (die Abrufkarte davor kann den Moment weiterschalten)
      // Solange das Blatt offen ist, läuft die Uhr in Echtzeit: im Zeitraffer endet der Moment zwischen Lesen und Tipp und sein Ende-Signal (1,1) verfälscht den Vorher-Nachher-Vergleich
      await page.evaluate(() => { window.__ytSlow = true; });
      const m = await page.evaluate(() => window.__core.moment());
      const idx = await page.evaluate(() => window.__core.idx());
      const n0 = (await notes()).length;
      const w0 = await wNow();
      await page.click(`[data-testid="note-chip-${label}"]`);
      const shown = await waitFor(page, (t) => document.querySelector('[data-testid=note-confirm]')?.textContent === t, typeof line === 'function' ? line(m) : line);
      // Gewichte, solange das Blatt mit der Bestätigung offen ist: nur die Wirkung des Chips, noch kein Signal des nächsten Moments
      const w = await wNow();
      const noToast = await page.evaluate(() => !document.querySelector('.flash'));
      await shot(label, 24);
      const advanced = await waitFor(page, (i) => !document.querySelector('[data-testid=note-sheet]') && window.__core.idx() > i, idx);
      await page.evaluate(() => { window.__ytSlow = false; });
      const saved = (await notes()).length === n0 + 1 && (await notes()).at(-1).chips.join() === label && (await notes()).at(-1).id === m.id;
      await page.waitForTimeout(1000);
      return { m, w0, ok: opened && shown && noToast && advanced && saved, w, until: w.until ?? {} };
    };
    // Known ("Already known"): nur das Thema auf höchstens 0,7. Der Kanal kommt nicht dazu.
    let f = await flow('Already known', (m) => `Less ${m.topic.charAt(0).toUpperCase()}${m.topic.slice(1)}`);
    c.knownViaChip = f.ok;
    c.knownTopicCap = Math.abs((f.w.topic[f.m.topic] ?? 1) - Math.min(0.7, f.w0.topic[f.m.topic] ?? 1)) < 0.001;
    c.knownChannelKept = Math.abs((f.w.channel[f.m.channel] ?? 1) - (f.w0.channel[f.m.channel] ?? 1)) < 0.001;
    // Wrong: nur der Kanal auf höchstens 0,5
    f = await flow('Wrong', (m) => `Less ${m.channel}`);
    c.wrongViaChip = f.ok;
    c.wrongChannelCap = Math.abs((f.w.channel[f.m.channel] ?? 1) - Math.min(0.5, f.w0.channel[f.m.channel] ?? 1)) < 0.001;
    c.wrongTopicKept = Math.abs((f.w.topic[f.m.topic] ?? 1) - (f.w0.topic[f.m.topic] ?? 1)) < 0.001;
    // Not for me: Thema 0,2 für 30 Tage (Ablauf als Zeitstempel), Kanal auf höchstens 0,5, Bereich bleibt
    f = await flow('Not for me', (m) => `Less ${m.topic.charAt(0).toUpperCase()}${m.topic.slice(1)}`);
    c.notForMeViaChip = f.ok;
    c.notForMeTopic02 = Math.abs((f.w.topic[f.m.topic] ?? 1) - 0.2) < 0.001;
    c.notForMeChannel05 = (f.w.channel[f.m.channel] ?? 1) <= 0.5 + 0.001;
    c.notForMeAreaKept = (f.w.area[f.m.area] ?? 1) >= (f.w0.area[f.m.area] ?? 1) - 0.001;
    const uT = f.until[`t:${f.m.topic}`];
    c.notForMeExpiry30Days = !!uT && Math.abs((uT.at - Date.parse('2026-10-23T12:00:00')) / 86400000 - 30) < 1.5 && uT.back <= 1;
    // Mute speaker: Zeile "<Sprecher> muted", Kanal verschwindet aus der Warteschlange, kein Toast
    c.muteViaChip = await openSheet();
    const idxM = await page.evaluate(() => window.__core.idx());
    const mutedMoment = await page.evaluate(() => window.__core.moment());
    await page.click('[data-testid="note-chip-Mute speaker"]');
    c.muteLine = await waitFor(page, (t) => document.querySelector('[data-testid=note-confirm]')?.textContent === t, `${mutedMoment.channel} muted`);
    c.muteNoToast = await page.evaluate(() => !document.querySelector('.flash'));
    c.muteAdvanced = await waitFor(page, (i) => !document.querySelector('[data-testid=note-sheet]') && window.__core.idx() > i, idxM);
    c.muteSaved = (await notes()).at(-1).chips.join() === 'Mute speaker' && (await notes()).at(-1).id === mutedMoment.id;
    c.noteStillNoNetwork = gh.length === 0 && (await page.evaluate(() => window.__opened)).length === 0;
    r.notesCount = (await notes()).length;
    await page.waitForTimeout(1000);
    await skipRecall(page, name, out);

    // Endscreen-Schutz: über jedem Player, der nicht gerade abspielt (also auch nach ENDED), liegt das Vorschaubild
    let checksDone = 0, violations = 0, endedSeen = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) {
      await skipRecall(page, name, out);
      const res = await page.evaluate(() => {
        const st = window.__core.slots();
        const dom = [...document.querySelectorAll('.vslot')];
        const qlen = window.__core.queue().length;
        // Ein Slot hinter dem Ende der Warteschlange (Pool aufgebraucht) hat keinen Moment und ist leer und verborgen
        return st.map((x, i) => ({ index: x.index, st: x.st, current: dom[i]?.getAttribute('aria-hidden') === 'false', poster: (() => { const p = dom[i]?.querySelector('.vposter'); return !!p && getComputedStyle(p).visibility !== 'hidden'; })() })).filter((x) => x.index < qlen);
      });
      for (const x of res) {
        checksDone++;
        if (x.st === 0) endedSeen++;
        if ((x.st !== 1 || !x.current) && !x.poster) violations++;
      }
      await page.waitForTimeout(40);
    }
    c.posterWheneverNotPlaying = violations === 0 && checksDone > 0;
    r.posterCheck = { checksDone, violations, endedSeen };
    // Alle Zustände (Auftrag Max 29.10.2026): ENDED, PAUSED, BUFFERING, CUED und UNSTARTED werden an jedem Slot erzwungen, auch an den
    // vorgeladenen Nachbarn. Das Vorschaubild muss sichtbar sein, ohne Zoom (16:9 in Bildschirmbreite) und über dem ganzen Bildbereich des IFrames.
    // Nur bei PLAYING des aktuellen Moments ist der IFrame sichtbar.
    await skipRecall(page, name, out);
    // Nur YouTube-Momente haben einen IFrame unter dem Vorschaubild: zu einer Stelle blättern, an der der aktuelle Moment und beide Nachbarn YouTube sind
    for (let k = 0; k < 40; k++) {
      const ok = await page.evaluate(() => { const sl = [...document.querySelectorAll('.vslot')].filter((x) => x.querySelector('.vframe')); return !window.__core.forYou() && sl.length >= 3 && sl.every((x) => !!x.querySelector('.vposter') && !x.querySelector('.vaudio')); });
      if (ok) break;
      await page.evaluate(() => window.__core.next());
      await page.waitForTimeout(250);
      await skipRecall(page, name, out);
    }
    await page.waitForTimeout(400);
    const poster = (st) => page.evaluate(() => [...document.querySelectorAll('.vslot')].map((sl) => {
      const p = sl.querySelector('.vposter'); const host = sl.querySelector('.vframe > div'); const pr = p?.getBoundingClientRect(); const hr = host?.getBoundingClientRect();
      const vis = !!p && getComputedStyle(p).visibility !== 'hidden' && getComputedStyle(p).display !== 'none' && +getComputedStyle(p).opacity > 0;
      return { rects: { p: pr && [pr.left, pr.top, pr.width, pr.height].map(Math.round), h: hr && [hr.left, hr.top, hr.width, hr.height].map(Math.round), iw: innerWidth }, current: sl.getAttribute('aria-hidden') === 'false', vis, live: sl.hasAttribute('data-live'), covers: !!pr && (!hr || (pr.left <= hr.left + 0.5 && pr.right >= hr.right - 0.5 && pr.top <= hr.top + 0.5 && pr.bottom >= hr.bottom - 0.5)), noZoom: !!pr && Math.abs(pr.width - innerWidth) < 1.5 && Math.abs(pr.height - (innerWidth * 9) / 16) < 1.5 };
    }));
    // ENDED am aktuellen Slot blättert weiter (finish), also wird er dort von der Schleife oben abgedeckt (endedSeen) und hier nur an den Nachbarn erzwungen
    const force = (st) => page.evaluate((s) => { for (const sl of document.querySelectorAll('.vslot')) if (s !== 0 || sl.getAttribute('aria-hidden') !== 'false') sl.querySelector('.vframe > div')?.firstChild?.__player?.__force(s); }, st);
    const posterRuns = {};
    r.posterState = await page.evaluate(() => ({ idx: window.__core.idx(), qlen: window.__core.queue().length, end: !!document.querySelector('.vend'), recall: !!document.querySelector('[data-testid=recall-card]'), forYou: !!window.__core.forYou(), text: !!document.querySelector('[data-testid=text-view]'), url: location.href, cls: document.querySelector('.vfeed')?.className }));
    r.posterDom = await page.evaluate(() => [...document.querySelectorAll('.vslot')].map((sl) => sl.outerHTML.slice(0, 700)));
    let posterBad = 0;
    for (const [label, st] of [['unstarted', -1], ['ended', 0], ['paused', 2], ['buffering', 3], ['cued', 5]]) {
      // Der soundGuard der App startet einen stehenden aktuellen Moment von selbst neu: trifft das genau in die 60 ms, noch einmal erzwingen
      let res = [];
      for (let k = 0; k < 8; k++) {
        await force(st);
        await page.waitForTimeout(k === 0 ? 60 : 150);
        res = await poster(st);
        if (res.every((x) => x.vis && x.covers && x.noZoom && !(x.live && st !== 1))) break;
      }
      if (st === 3) r.posterRects = res.map((x) => x.rects);
      posterRuns[label] = res.map((x) => `${x.current ? 'cur' : 'nb'}:${x.vis ? 'poster' : 'KEIN-POSTER'}${x.covers && x.noZoom ? '' : ':GEOMETRIE'}`);
      for (const x of res) if (!x.vis || !x.covers || !x.noZoom || (x.live && st !== 1)) posterBad++;
    }
    // PLAYING am aktuellen Slot: Poster weg, IFrame sichtbar. Nachbarn bleiben unter dem Poster.
    let playingRes = [];
    for (let k = 0; k < 8; k++) {
      await page.evaluate(() => { const sl = [...document.querySelectorAll('.vslot')].find((x) => x.getAttribute('aria-hidden') === 'false'); sl?.querySelector('.vframe > div')?.firstChild?.__player?.__force(1); });
      await page.waitForTimeout(k === 0 ? 60 : 150);
      playingRes = await poster(1);
      const cp = playingRes.find((x) => x.current);
      if (cp && !cp.vis && playingRes.filter((x) => !x.current).every((x) => x.vis)) break;
    }
    const curP = playingRes.find((x) => x.current);
    posterRuns.playing = playingRes.map((x) => `${x.current ? 'cur' : 'nb'}:${x.vis ? 'poster' : 'ohne-Poster'}`);
    c.posterAllStates = posterBad === 0 && !!curP && !curP.vis && playingRes.filter((x) => !x.current).every((x) => x.vis);
    r.posterAllStates = posterRuns;
    // Befehle, die das Spielen beenden, nehmen das Poster-Freigabe-Attribut sofort weg (kein Warten auf den Zustandswechsel des IFrames)
    const sync = await page.evaluate(() => {
      const sl = [...document.querySelectorAll('.vslot')].find((x) => x.getAttribute('aria-hidden') === 'false');
      const pl = sl?.querySelector('.vframe > div')?.firstChild?.__player;
      if (!sl || !pl) return null;
      const out = {};
      for (const k of ['pauseVideo', 'cueVideoById']) { // loadVideoById spielt im Nachbau sofort (PLAYING), also ist das Poster dort zu Recht weg
        pl.__force(1);
        out[k] = sl.hasAttribute('data-live');
        const had = out[k];
        if (k === 'pauseVideo') pl.pauseVideo(); else pl[k]({ videoId: 'syncvid0001', startSeconds: 0 });
        out[k] = { vorher: had, nachherSofort: sl.hasAttribute('data-live') };
      }
      return out;
    });
    c.posterDropsSynchronously = !!sync && Object.values(sync).every((x) => x.vorher === true && x.nachherSofort === false);
    r.posterSync = sync;
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-3-nach-ende.png` });

    // Punkt 1: Wisch bis erstes Bild wird gemessen, gepufferte Momente unter 300 ms (Nachbau-Player, echte Werte nur auf dem Gerät)
    const lat = await page.evaluate(() => window.__core.latency());
    const buf = lat.filter((x) => x.buffered).map((x) => x.ms).sort((a, b) => a - b);
    r.latency = { n: lat.length, buffered: buf.length, median: buf[Math.floor((buf.length - 1) / 2)] ?? null };
    c.latencyMeasured = lat.length >= 3 && buf.length >= 1;
    c.bufferedUnder300 = buf.length > 0 && r.latency.median < 300;
    c.latencyInDiag = (await page.evaluate(() => window.__core.diag())).some((x) => x.startsWith('first-frame'));
    // In den Einstellungen sichtbar
    await skipRecall(page, name, out);
    await page.keyboard.press(' ');
    await page.click('nav [aria-label=Settings]');
    await page.locator('[data-testid=unlock-device]').scrollIntoViewIfNeeded();
    await page.click('text=Show QR code');
    c.unlockQr = await waitFor(page, () => !!document.querySelector('[data-testid=unlock-qr] svg'));
    c.keyBackupsBoth = await waitFor(page, () => /IndexedDB yes .* offline cache yes/.test(document.querySelector('[data-testid=key-backups]')?.textContent ?? ''));
    await page.screenshot({ path: `${out}/${name}-8-geraet-freischalten.png` });
    c.speedOptions = await page.evaluate(() => [...document.querySelectorAll('[data-testid=speed] option')].map((o) => o.value).join(',') === '1,1.5');
    c.tapInSettings = await waitFor(page, () => /Median \d+ ms/.test(document.querySelector('[data-testid=tap-reaction]')?.textContent ?? ''));
    c.latencyInSettings = await waitFor(page, () => /Preloaded: median \d+ ms/.test(document.querySelector('[data-testid=latency]')?.textContent ?? ''));
    await page.locator('[data-testid=latency]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${name}-5-einstellungen.png` });
    await page.click('nav [aria-label=Feed]');

    // Simulierter Sonntag: Wochenrückblick mit dem gespeicherten Moment.
    // Erste Seite schließen: zwei offene Tabs würden sich gegenseitig den gespeicherten Zustand überschreiben.
    await page.waitForTimeout(500);
    await page.close();
    const p2 = await ctx.newPage();
    await p2.goto(url + '?now=2026-10-25');
    c.weeklyReviewOnSunday = await waitFor(p2, () => !!document.querySelector('[data-testid="weekly-review"]'));
    c.reviewListsSaved = await p2.evaluate(() => document.querySelectorAll('[data-testid="weekly-review"] li').length >= 1);
    // Punkt 7: Zahlen nur zur Aufgabe, keine Prozentkacheln, Plan Pflicht oder Skip
    c.reviewWeekLine = await p2.evaluate(() => /^This week: \d+ seen, \d+ got it, \d+ applied$/.test(document.querySelector('[data-testid=week-line]')?.textContent ?? ''));
    c.reviewNoPercent = await p2.evaluate(() => !document.querySelector('[data-testid="weekly-review"]').textContent.includes('%'));
    c.reviewSaveNeedsPlan = await p2.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save plan and continue')?.disabled === true);
    await p2.fill('[data-testid=plan-when]', 'I finish the OCT clinic on Tuesday');
    await p2.fill('[data-testid=plan-will]', 'explain one saved moment to a colleague');
    await p2.locator('[data-testid=new-plan]').scrollIntoViewIfNeeded();
    await p2.screenshot({ path: `${out}/${name}-4-wochenrueckblick.png` });
    await p2.click('text=Save plan and continue');
    c.feedAfterReview = await waitFor(p2, () => !!window.__core?.moment());
    // Erstes Öffnen an einem neuen Tag mit ungesendeten Notizen (23.10.): Zeile "N notes, send?", ein Tipp öffnet ein einziges Issue mit allen Notizen
    const allNotes = await p2.evaluate(() => window.__core.notes());
    c.notesUnsentBefore = allNotes.length === r.notesCount && allNotes.every((x) => x.sent === undefined);
    c.promptLine = await waitFor(p2, (t) => document.querySelector('[data-testid=notes-prompt]')?.textContent === t, `${allNotes.length} notes, send?`);
    await p2.screenshot({ path: `${out}/${name}-22-notes-send.png` });
    await p2.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push({ u, t, f }); return null; }; });
    await p2.click('[data-testid=notes-prompt]');
    const opN = await p2.evaluate(() => window.__opened);
    const uN = opN[0] ? new URL(opN[0].u) : null;
    c.promptOneIssue = opN.length === 1 && !!uN && uN.origin + uN.pathname === 'https://github.com/amrsaad/core-content/issues/new' && opN[0].t === '_blank' && uN.searchParams.get('labels') === 'feedback';
    const bodyN = uN?.searchParams.get('body') ?? '';
    r.notesIssueBody = bodyN;
    const lines = bodyN.split('\n');
    const momentsN = new Set(allNotes.map((x) => x.id));
    c.issueTable = lines[0] === '| Moment | Hook | Chips | Text | Tab | App |' && lines.length === 2 + momentsN.size;
    // Landet der Feed bei einem späteren Chip noch einmal auf demselben Moment (gesehen zählt erst am Ende), führt die App dessen Notiz zu einer Zeile zusammen: dann prüft die Zeile Chip und Text einzeln
    const distinctN = new Set([nm.id, nm2.id, mutedMoment.id]).size === 3;
    c.issueRowsHaveAllFields = [[nm, 'Weak', '-'], [nm2, '-', 'The cut is two seconds late & the "hook" repeats.'], [mutedMoment, 'Mute speaker', '-']].every(([m, chipsCell, textCell]) =>
      lines.some((l) => /\| ([0-9a-f]{7}|dev) \|$/.test(l) && (distinctN ? l.startsWith(`| ${m.id} | ${m.hook} | ${chipsCell} | ${textCell} | Video | `) : l.startsWith(`| ${m.id} | ${m.hook} | `) && (chipsCell === '-' || l.includes(chipsCell)) && (textCell === '-' || l.includes(textCell)) && l.includes('| Video | '))));
    c.issueTitleCount = (uN?.searchParams.get('title') ?? '') === `Core feedback 2026-10-25, ${momentsN.size} moments`;
    c.promptMarksSent = await waitFor(p2, () => window.__core.notes().every((x) => typeof x.sent === 'number') && !document.querySelector('[data-testid=notes-prompt]'));
    // Nach dem Senden: neue Notiz bleibt ungesendet, und am selben Tag kommt die Zeile nicht noch einmal
    await p2.evaluate(() => window.__core.openNote());
    const wG0 = await p2.evaluate(() => JSON.stringify(window.__core.weights()));
    await p2.click('[data-testid="note-chip-Bad cut"]');
    // Bad cut lernt nichts: Zeile "Noted", Gewichte unverändert
    c.badCutNoted = await waitFor(p2, () => document.querySelector('[data-testid=note-confirm]')?.textContent === 'Noted');
    c.badCutLearnsNothing = (await p2.evaluate(() => JSON.stringify(window.__core.weights()))) === wG0;
    await p2.waitForTimeout(800); // Zustand wird verzögert gespeichert
    c.newNoteUnsent = await p2.evaluate(() => window.__core.notes().filter((x) => x.sent === undefined).length === 1);
    await p2.close();
    const p3 = await ctx.newPage();
    await p3.goto(url + '?now=2026-10-25');
    c.reviewOnlyOnce = await waitFor(p3, () => !!window.__core?.moment()) && !(await p3.$('[data-testid="weekly-review"]'));
    await p3.waitForTimeout(500);
    c.promptOncePerDay = !(await p3.$('[data-testid=notes-prompt]')) && (await p3.evaluate(() => window.__core.notes().filter((x) => x.sent === undefined).length)) === 1;
    // Nächster Sonntag: Plan der Vorwoche mit "Did it happen?", dann Skip
    await p3.close();
    const p5 = await ctx.newPage();
    // Echtzeit-Uhr: im Zeitraffer enden die Momente hinter den Einstellungen und ihre Signale verändern die Gewichte, die die Karte zeigt
    await p5.addInitScript(() => { window.__ytSlow = true; });
    await p5.goto(url + '?now=2026-11-01');
    c.prevPlanShown = await waitFor(p5, () => document.querySelector('[data-testid=prev-plan]')?.textContent?.includes('When I finish the OCT clinic on Tuesday, I will explain one saved moment to a colleague.'));
    await p5.click('[data-testid=prev-plan] >> text=Yes');
    c.prevPlanAnswered = await waitFor(p5, () => document.querySelector('[data-testid=prev-plan] button[aria-pressed=true]')?.textContent === 'Yes');
    await p5.screenshot({ path: `${out}/${name}-13-vorwoche.png` });
    await p5.click('text=Skip this week');
    c.skipWorks = await waitFor(p5, () => !!window.__core?.moment());
    // Karte "What Core learned" (App-Zeit 1.11.): Zeilen mit Gewicht und Pfeil, laufende Fristen, Reset mit Rückfrage
    await p5.click('nav [aria-label=Settings]');
    await p5.locator('[data-testid=learned-card]').scrollIntoViewIfNeeded();
    const cardRows = async (pg) => pg.evaluate(() => ({
      empty: !!document.querySelector('[data-testid=learned-empty]'),
      lists: Object.fromEntries(['channel-up', 'channel-down', 'topic-up', 'topic-down'].map((id) => [id, [...document.querySelectorAll(`[data-testid=learned-${id}] [data-testid=learned-row]`)].map((r) => ({ text: r.textContent, w: Number(r.querySelector('[data-weight]').dataset.weight) }))])),
    }));
    const k1 = await cardRows(p5);
    c.cardShown = !!(await p5.$('[data-testid=learned-card]')) && /What Core learned/.test(await p5.textContent('[data-testid=learned-card]'));
    c.cardMax5 = Object.values(k1.lists).every((l) => l.length <= 5);
    c.cardArrows = Object.entries(k1.lists).every(([id, l]) => l.every((x) => (id.endsWith('up') ? x.w > 1 && x.text.includes('↑') : x.w < 1 && x.text.includes('↓') && /\d\.\d\d ↓/.test(x.text))));
    c.cardSortedDown = Object.entries(k1.lists).every(([id, l]) => l.every((x, i) => i === 0 || (id.endsWith('up') ? l[i - 1].w >= x.w : l[i - 1].w <= x.w)));
    c.cardHasLessRows = k1.lists['channel-down'].length > 0 && k1.lists['topic-down'].length > 0;
    c.cardTopicBlocked = k1.lists['topic-down'].some((x) => x.w < 0.5 && /until Nov 2\d/.test(x.text));
    await p5.screenshot({ path: `${out}/${name}-25-learned-card.png` });
    // Reset learning fragt nach. Abbrechen ändert nichts.
    await p5.click('[data-testid=reset-learning]');
    c.resetAsks = await waitFor(p5, () => !!document.querySelector('[data-testid=reset-ask]'));
    await p5.screenshot({ path: `${out}/${name}-26-reset-ask.png` });
    await p5.click('[data-testid=reset-cancel]');
    await waitFor(p5, () => !document.querySelector('[data-testid=reset-ask]'));
    c.resetCancelKeeps = !(await p5.$('[data-testid=reset-ask]')) && JSON.stringify(await cardRows(p5)) === JSON.stringify(k1);
    // Frist abgelaufen (App-Zeit 30 Tage später): das Thema ist wieder auf dem Gewicht davor, ohne dass etwas läuft.
    // Erste Seite zuerst schließen: zwei offene Tabs würden sich gegenseitig den gespeicherten Zustand überschreiben.
    await p5.waitForTimeout(500);
    await p5.close();
    const pCard = await ctx.newPage();
    await pCard.goto(url + '?now=2026-12-05');
    await waitFor(pCard, () => !!window.__core?.moment());
    await skipRecall(pCard, name, out);
    await pCard.click('nav [aria-label=Settings]');
    await pCard.locator('[data-testid=learned-card]').scrollIntoViewIfNeeded();
    const k7 = await cardRows(pCard);
    c.cardExpiryLifted = !k7.lists['topic-down'].some((x) => x.w === 0.2) && !k7.lists['channel-down'].some((x) => x.w === 0.2) && !/until/.test(await pCard.textContent('[data-testid=learned-card]'));
    await pCard.screenshot({ path: `${out}/${name}-27-learned-nach-ablauf.png` });
    await pCard.click('[data-testid=reset-learning]');
    await pCard.click('[data-testid=reset-confirm]');
    c.resetEmpties = await waitFor(pCard, () => !!document.querySelector('[data-testid=learned-empty]'));
    c.resetClearsWeights = await pCard.evaluate(() => { const w = window.__core?.weights?.(); return !w || (Object.keys(w.area).length + Object.keys(w.channel).length + Object.keys(w.topic).length === 0 && !w.until); });
    await pCard.screenshot({ path: `${out}/${name}-28-learned-reset.png` });
    await pCard.waitForTimeout(800);
    await pCard.close();
    // Leerer Filter: eine Zeile statt leerem Feed, Schalter bleibt bedienbar
    // Eigener Kontext: im geteilten wären je nach Verlauf der Abschnitte davor schon fast alle Momente gesehen
    // Zweiter Skip desselben Kanals in Folge: Kanal 0,2 für 14 Tage, danach zurück auf 0,6 (eigener Pool mit einem Kanal)
    const fs = await freshPage(browser, url, k, poolSolo, '?now=2026-10-23');
    const ps = fs.pg;
    c.soloFeed = await waitFor(ps, () => !!window.__core?.moment());
    const skipNow = async () => {
      await skipRecall(ps, name, out);
      await ps.waitForTimeout(150);
      const i0 = await ps.evaluate(() => window.__core.idx());
      await ps.evaluate(() => { window.__core.markStart(); window.__core.next(); });
      await waitFor(ps, (i) => window.__core.idx() > i, i0);
      return ps.evaluate(() => ({ w: JSON.parse(JSON.stringify(window.__core.weights())), run: window.__core.skipRun() }));
    };
    const s1 = await skipNow();
    c.soloFirstSkip = Math.abs((s1.w.channel['Kanal solo'] ?? 1) - 0.6) < 0.001 && Math.abs((s1.w.topic.augen ?? 1) - 0.6) < 0.001 && s1.run?.channel === 'Kanal solo' && s1.run?.n === 1 && !s1.w.until && Object.keys(s1.w.area).length === 0;
    const s2 = await skipNow();
    const u2 = s2.w.until?.['c:Kanal solo'];
    c.soloSecondSkip02 = Math.abs((s2.w.channel['Kanal solo'] ?? 1) - 0.2) < 0.001 && s2.run?.n === 2 && Math.abs((s2.w.topic.augen ?? 1) - 0.6) < 0.001;
    c.soloSecondSkip14Days = !!u2 && Math.abs((u2.at - Date.parse('2026-10-23T12:00:00')) / 86400000 - 14) < 1.5 && Math.abs(u2.back - 0.6) < 0.001;
    await ps.screenshot({ path: `${out}/${name}-29-zweiter-skip.png` });
    await ps.waitForTimeout(800);
    await ps.close();
    await fs.cx.close();
    const f6 = await freshPage(browser, url, k, poolVideoOnly, '?now=2026-10-23');
    const p6 = f6.pg;
    c.p6Feed = await waitFor(p6, () => !!window.__core?.moment());
    await p6.click('[data-testid=form-switch] >> text=Audio');
    c.emptyAudioLine = await waitFor(p6, () => document.body.innerText.includes('No audio moments yet'));
    c.emptyKeepsSwitch = !!(await p6.$('[data-testid=form-switch]'));
    await p6.screenshot({ path: `${out}/${name}-14-filter-leer.png` });
    await p6.click('[data-testid=form-switch] >> text=Video');
    await p6.click('[data-testid=form-switch] >> text=Text');
    c.emptyTextLine = await waitFor(p6, () => document.body.innerText.includes('Text sources coming'));
    await p6.screenshot({ path: `${out}/${name}-15-text-leer.png` });
    await p6.click('[data-testid=form-switch] >> text=Video');
    c.emptyBackToVideo = await waitFor(p6, () => !!window.__core?.moment() && !document.body.innerText.includes('No audio moments yet'));
    if (!c.emptyBackToVideo) r.p6Text = (await p6.evaluate(() => document.body.innerText)).slice(0, 300);
    // Momente ohne recall bekommen keine Karte: fünf Wischer, nie eine Karte
    await p6.close();
    // Fehlerhafte Momente im Pool: der Feed läuft weiter, keine Fehlerseite, nur Überspringen
    const errors8 = [];
    const f8 = await freshPage(browser, url, k, poolBad, '?now=2026-10-23&seed=3');
    const p8 = f8.pg;
    p8.on('pageerror', (e) => errors8.push(String(e)));
    c.badFeedStarts = await waitFor(p8, () => !!window.__core?.moment());
    c.badFirstPlays = await waitFor(p8, () => window.__core.state() === 1 && !/^errorvid/.test(window.__core.moment().videoId));
    const badWalk = [];
    for (let n = 0; n < 12; n++) {
      await p8.evaluate(() => window.__core.next());
      await p8.waitForTimeout(250);
      badWalk.push(await p8.evaluate(() => ({ idx: window.__core.idx(), id: window.__core.moment()?.videoId, card: !!document.querySelector('[data-testid=recall-card]'), end: /seen every moment/.test(document.body.innerText), err: /Moments need internet|Invalid video id/.test(document.body.innerText) })));
    }
    r.badWalk = badWalk;
    c.badNoErrorPage = badWalk.every((x) => x.id && !x.err);
    // Fehler 150 wurde ausgelöst und der Moment übersprungen: nach Ruhephase steht der Feed nie auf einem errorvid
    await p8.waitForTimeout(400);
    c.badErrorsHappened = (await p8.evaluate(() => window.__core.diag().some((x) => / error 150$/.test(x)) || window.__ytlog.some((x) => x.startsWith('load errorvid')))) === true;
    // Jeder Wischer rückt wirklich vor (Index steigt), und der Feed steht nie auf einem errorvid
    c.badNotStuckOnError = badWalk.every((x) => !/^errorvid/.test(x.id)) && badWalk.every((x, i) => i === 0 || x.idx > badWalk[i - 1].idx);
    // Nie ein Player für Text- oder Podcast-IDs ohne Stream
    c.badNeverLoaded = await p8.evaluate(() => !window.__ytlog.some((x) => /^(load|cue) (txt-|pod-)/.test(x)));
    c.badNeverShown = (await p8.evaluate(() => window.__core.diag().length)) >= 0 && badWalk.every((x) => !/^(txt|pod)-/.test(x.id));
    // Diagnose: drei aussortiert
    await p8.click('[aria-label=Settings]');
    c.badSkippedLine = await waitFor(p8, () => document.querySelector('[data-testid=moments-skipped]')?.textContent === 'Moments skipped: 3');
    await p8.screenshot({ path: `${out}/${name}-20-moments-skipped.png` });
    c.badPageErrors = errors8.length === 0;
    await f8.cx.close();
    // Der Player-Konstruktor wirft für einen Moment: früher Fehlerseite, jetzt nur Überspringen
    const errors9 = [];
    const f9 = await freshPage(browser, url, k, poolThrow, '?now=2026-10-23&seed=3');
    const p9 = f9.pg;
    p9.on('pageerror', (e) => errors9.push(String(e)));
    c.throwFeedStarts = await waitFor(p9, () => !!window.__core?.moment());
    c.throwNoErrorPage = await p9.evaluate(() => !/Moments need internet|Invalid video id/.test(document.body.innerText));
    c.throwLogged = await waitFor(p9, () => window.__core.diag().some((x) => / player failed /.test(x)), undefined, 3000);
    c.throwPlaysAfterSkip = await waitFor(p9, () => window.__core.state() === 1 && !!document.querySelector('.vfeed'), undefined, 8000);
    for (let n = 0; n < 6; n++) { await p9.evaluate(() => window.__core.next()); await p9.waitForTimeout(250); }
    c.throwStillNoErrorPage = await p9.evaluate(() => !/Moments need internet|Invalid video id/.test(document.body.innerText) && !!window.__core.moment());
    c.throwPageErrors = errors9.length === 0;
    await f9.cx.close();
    const f7 = await freshPage(browser, url, k, poolNoRecall, '?now=2026-10-23&seed=3');
    const p7 = f7.pg;
    c.p7Feed = await waitFor(p7, () => !!window.__core?.moment());
    if (!c.p7Feed) r.p7Text = (await p7.evaluate(() => document.body.innerText)).slice(0, 300);
    let cardSeen = false;
    const capLogs = [];
    for (let n = 0; n < 5; n++) {
      const b = await p7.evaluate(() => window.__core.idx());
      // Hook lang: eine Stufe kleiner, nie gekürzt. Caption auf, Ton läuft weiter, zu.
      const hk = await p7.evaluate(() => { const e = document.querySelector('[data-testid=hook]'); const m = window.__core.moment(); return { step: e.dataset.step, clipped: e.scrollHeight > e.clientHeight + 1, full: e.textContent === m.hook, size: parseFloat(getComputedStyle(e).fontSize), lines: Math.round(e.scrollHeight / parseFloat(getComputedStyle(e).lineHeight)), id: m.id }; });
      capLogs.push({ hk });
      if (n === 0) await p7.screenshot({ path: `${out}/${name}-17-hook-lang.png` });
      if (await p7.$('[data-testid=sound-off]') || (await p7.evaluate(() => window.__core.state())) !== 1) await p7.mouse.click(vp.width / 2, vp.height / 2);
      await waitFor(p7, () => window.__core.state() === 1);
      await p7.click(n % 2 === 0 ? '[data-testid=hook]' : '[data-testid=speaker-line]');
      const open = await waitFor(p7, () => !!document.querySelector('[data-testid=caption-sheet]'));
      const cs = await p7.evaluate(() => {
        const q = (t) => document.querySelector(`[data-testid=${t}]`);
        const m = window.__core.moment();
        const ex = q('caption-excerpt');
        const meta = q('caption-meta')?.textContent ?? '';
        const kids = [...q('caption-sheet').children].map((e) => e.dataset.testid ?? e.tagName);
        const cx = q('caption-context');
        const cxText = cx?.querySelector('.vcap-ctx-text');
        const cxLabel = cx?.querySelector('.vcap-ctx-label');
        const css = (e, p) => (e ? getComputedStyle(e)[p] : null);
        return { ctx: cx?.textContent ?? null, mctx: m.context ?? null, ctxPx: parseFloat(css(cxText, 'fontSize')) || 0, exPx: parseFloat(css(ex, 'fontSize')) || 0, ctxColor: css(cxText, 'color'), exColor: css(ex, 'color'), ctxCaps: css(cxLabel, 'textTransform'), ctxLabel: cxLabel?.textContent ?? null, hook: q('caption-hook')?.textContent === m.hook, exLen: ex?.textContent.length, exDir: ex?.getAttribute('dir'), exAr: /[\u0600-\u06FF]/.test(ex?.textContent ?? ''), meta, speaker: meta.includes(m.channel.replace(/^(.*?)\s*\((.+)\)$/, '$1 · $2')), ep: meta.includes('Testvideo'), at: meta.includes('1:40'), order: kids, playing: window.__core.state() === 1 };
      });
      await p7.waitForTimeout(400);
      const stillPlaying = await p7.evaluate(() => window.__core.state() === 1);
      if (n === 0) await p7.screenshot({ path: `${out}/${name}-18-caption-auf.png` });
      // Kontext sichtbar machen: das Blatt bis zum Kontext scrollen (die Test-Ausschnitte sind lang), einmal je Lauf
      if (cs.ctx && !capLogs.some((x) => x.ctxShot)) {
        await p7.evaluate(() => document.querySelector('[data-testid=caption-sheet]')?.scrollTo(0, 1e5));
        await p7.waitForTimeout(150);
        await p7.screenshot({ path: `${out}/${name}-18b-caption-context.png` });
        await p7.evaluate(() => document.querySelector('[data-testid=caption-sheet]')?.scrollTo(0, 0));
        capLogs[n].ctxShot = true;
      }
      if (cs.exAr && !capLogs.some((x) => x.ar)) await p7.screenshot({ path: `${out}/${name}-19-caption-arabisch.png` });
      Object.assign(capLogs[n], { open, ...cs, stillPlaying, ar: cs.exAr });
      if (n % 2 === 0) {
        await p7.mouse.click(vp.width / 2, vp.height * 0.12);
      } else {
        await p7.evaluate(() => {
          const el = document.querySelector('[data-testid=caption-sheet]');
          const mk = (y) => new Touch({ identifier: 1, target: el, clientX: 100, clientY: y });
          el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [mk(300)], changedTouches: [mk(300)] }));
          el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [mk(420)] }));
        }).catch(() => p7.evaluate(() => window.__core.closeCaption()));
      }
      capLogs[n].stClose0 = await p7.evaluate(() => window.__core.state());
      capLogs[n].closed = await waitFor(p7, () => !document.querySelector('[data-testid=caption-sheet]'), undefined, 3000);

      capLogs[n].stClose = await p7.evaluate(() => window.__core.state());
      await p7.mouse.move(vp.width / 2, vp.height * 0.7);
      await p7.mouse.down();
      for (let i = 1; i <= 5; i++) await p7.mouse.move(vp.width / 2, vp.height * (0.7 - 0.09 * i));
      await p7.mouse.up();
      await waitFor(p7, (x) => window.__core.idx() === x + 1, b);
      await p7.waitForTimeout(150);
      capLogs[n].after = await p7.evaluate(() => ({ st: window.__core.state(), idx: window.__core.idx(), log: window.__ytlog.slice(-6) }));
      if (await p7.$('[data-testid=recall-card]')) cardSeen = true;
    }
    // Falls ein Wischer nicht griff: weiter wischen, bis fünf Momente durch sind
    for (let extra = 0; extra < 6 && (await p7.evaluate(() => window.__core.idx())) < 5; extra++) {
      const b = await p7.evaluate(() => window.__core.idx());
      if (await p7.$('[data-testid=sound-off]')) await p7.mouse.click(vp.width / 2, vp.height / 2);
      await p7.mouse.move(vp.width / 2, vp.height * 0.7);
      await p7.mouse.down();
      for (let i = 1; i <= 5; i++) await p7.mouse.move(vp.width / 2, vp.height * (0.7 - 0.09 * i));
      await p7.mouse.up();
      await waitFor(p7, (x) => window.__core.idx() === x + 1, b, 3000);
      await p7.waitForTimeout(150);
      if (await p7.$('[data-testid=recall-card]')) cardSeen = true;
    }
    r.capLogs = capLogs;
    c.hookLongSmallerNeverCut = capLogs.every((x) => x.hk.step === '1' && !x.hk.clipped && x.hk.full && x.hk.size === 15);
    c.captionOpensWithContent = capLogs.every((x) => x.open && x.hook && x.exLen > 50 && x.speaker && x.ep && x.at);
    c.captionOrder = capLogs.every((x) => x.order.filter((t) => t !== 'caption-context').join() === 'DIV,caption-hook,caption-excerpt,caption-meta');
    // Kontext (Entscheidung 18): unter dem Ausschnitt, kleiner und gedämpft, Überschrift wie die anderen Meta-Zeilen (Großbuchstaben, gesperrt), kein eigenes Blatt, fehlt das Feld, fehlt die Zeile
    c.captionShowsContext = capLogs.some((x) => x.mctx) && capLogs.every((x) => (x.mctx ? !!x.ctx && x.ctx.startsWith('Context') && x.ctx.includes(x.mctx) : x.ctx === null));
    c.captionContextBelowExcerpt = capLogs.filter((x) => x.mctx).every((x) => x.order.indexOf('caption-context') === x.order.indexOf('caption-excerpt') + 1 && x.order.indexOf('caption-context') < x.order.indexOf('caption-meta'));
    c.captionContextMutedSmall = capLogs.filter((x) => x.mctx).every((x) => x.ctxPx > 0 && x.ctxPx < x.exPx && x.ctxColor !== x.exColor && x.ctxCaps === 'uppercase' && x.ctxLabel === 'Context');
    c.captionKeepsPlaying = capLogs.every((x) => x.playing && x.stillPlaying);
    c.captionCloses = capLogs.every((x) => x.closed);
    c.captionArabicRtl = capLogs.some((x) => x.exAr) && capLogs.filter((x) => x.exAr).every((x) => x.exDir === 'rtl') && capLogs.filter((x) => !x.exAr).every((x) => x.exDir === 'ltr');
    r.noRecallDbg = { cardSeen, idx: await p7.evaluate(() => window.__core.idx()) };
    c.noRecallNoCard = !cardSeen && (await p7.evaluate(() => window.__core.idx())) >= 5;
    c.recallHit = !!hitState.out && Object.values(hitState.out).every(Boolean);
    c.recallSwipeSkipsWithoutRating = !!hitState.skipped?.noRating;
    r.cards = hitState.cards;
    // Welche Sprache die Karten zeigen, hängt vom Ablauf ab (gesehene Momente, Zufall mit festem Startwert): jede gezeigte Karte muss stimmen, und es muss Karten geben
    c.recallArabicRtl = hitState.cards.length > 0 && hitState.cards.filter((x) => x.ar).every((x) => x.dir === 'rtl');
    c.recallEnglishLtr = hitState.cards.length > 0 && hitState.cards.filter((x) => !x.ar).every((x) => x.dir === 'ltr');
    r.hit = hitState.out;
    r.skip = hitState.skipped;
    c.pageErrors = errors.length;
    r.errors = errors.slice(0, 3);
  } catch (e) {
    r.error = String(e);
  }
  await browser?.close();
  r.ok = !r.error && Object.entries(c).every(([key, v]) => (key === 'firstArea' ? v === 'beat' : key === 'pageErrors' ? v === 0 : v === true));
  console.log(JSON.stringify(r));
}
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
if (results.runs.some((x) => !x.ok)) process.exit(1);
