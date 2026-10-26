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
for (let i = 12; i < 40; i++) moments.push(mk(i, 'brain', 'augen'));
for (let i = 40; i < 55; i++) moments.push(mk(i, 'body', 'kraft'));
for (const m of moments) m.excerpt = EX;
// Podcast-Momente (nur Ton) für den Audio-Filter
// Fallback ohne Feld form: audio true heißt audio. Die anderen fünf tragen das Feld.
for (const m of moments.slice(30, 35)) m.audio = true;
for (const m of moments.slice(35, 40)) Object.assign(m, { audio: true, form: 'audio' });
// Text-Momente: eigenes Feld form text, kein Player (die Video-ID dient nur dem Nachweis, dass nie geladen wird)
for (const m of moments.slice(40, 46)) Object.assign(m, { form: 'text', videoId: m.videoId.replace('test', 'texto') });
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
mkdirSync('dist/moments', { recursive: true });
writeFileSync('dist/moments/pool.enc', await encPool(moments));
const poolVideoOnly = await encPool(moments.filter((m) => !m.audio && m.form !== 'text'));
const k = Buffer.from(raw).toString('base64url');

const results = { at: new Date().toISOString(), runs: [] };
// Abrufkarte kommt nach jedem 4. Moment. Wo der Test etwas anderes prüft, wird sie ohne Wertung übersprungen.
const skipRecall = async (page) => {
  if (await page.$('[data-testid=recall-card]')) {
    await page.click('[data-testid=recall-card] >> text=Skip');
    await page.waitForFunction(() => !document.querySelector('[data-testid=recall-card]'));
  }
};
const waitFor = async (page, fn, arg, timeout = 8000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};

const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    // Service Worker aus: Anfragen über den SW kann Playwright nicht umleiten, dann käme das echte YouTube statt des Nachbaus (Fehler 150)
    const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Ohne Schlüssel gesperrt
    await page.goto(url + '?now=2026-10-23');
    c.lockedWithoutKey = await waitFor(page, () => document.body.innerText.includes('not unlocked'));

    // Freischalten über #k=, Fragment wird entfernt
    await page.goto('about:blank');
    await page.goto(`${url}?now=2026-10-23#k=${k}`);
    c.feedAfterDecrypt = await waitFor(page, () => !!window.__core?.moment());
    c.fragmentRemoved = !page.url().includes('#k=');
    // Schlüssel doppelt gesichert: Cache Storage hat ihn, und nach Löschen von IndexedDB schaltet die App sich selbst wieder frei
    c.keyInCache = await page.evaluate(async () => !!(await (await caches.open('core-key')).match(new URL('/core/__key', location.origin).href)));
    c.firstArea = await page.evaluate(() => window.__core.moment().area);
    c.firstPlaying = await waitFor(page, () => window.__core.state() === 1);
    const capState = () => page.evaluate(() => {
      const m = window.__core.moment();
      const el = document.querySelector('[data-testid=caption] span');
      return { ar: /[\u0600-\u06FF]/.test(JSON.stringify(m.cues ?? [])), shown: !!el?.textContent, rtl: el?.getAttribute('dir') === 'rtl', size: el ? parseFloat(getComputedStyle(el).fontSize) : 0, align: el ? getComputedStyle(el).textAlign : '' };
    });
    const capLog = [];
    await page.screenshot({ path: `${out}/${name}-1-start.png` });

    // Tipp: Ton an
    const vp = page.viewportSize();
    await page.mouse.click(vp.width / 2, vp.height / 2);
    c.soundOn = await waitFor(page, () => window.__ytlog.includes('unmute'));

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
    c.forYouExactlyWhenSet = seen.every((x) => x.has === x.fy);
    c.sawBothKinds = seen.some((x) => x.has) && seen.some((x) => !x.has);
    c.stoppedAtEnd = seen.every((x) => x.stoppedAtEnd);
    c.autoNext = seen.length === 4;
    // Punkt 5: nach dem 4. Moment kommt die Abrufkarte, Player steht, Hook erst nach dem Versuch
    c.recallAfter4 = await waitFor(page, () => !!document.querySelector('[data-testid=recall-card]'));
    c.recallPlayerStopped = await waitFor(page, () => window.__core.state() !== 1);
    c.recallHookHidden = c.recallAfter4 && !(await page.evaluate(() => !!document.querySelector('[data-testid=recall-answer]')));
    await page.screenshot({ path: `${out}/${name}-11-abruf-frage.png` });
    await page.fill('[data-testid=recall-input]', 'Test sentence from memory.');
    await page.click('[data-testid=recall-card] button >> text="Show answer"');
    c.recallShowsHook = await waitFor(page, () => /^The pointTestmoment/.test(document.querySelector('[data-testid=recall-answer]')?.textContent ?? ''));
    await page.screenshot({ path: `${out}/${name}-12-abruf-antwort.png` });
    await page.click('[data-testid=recall-card] button >> text="Got it"');
    c.recallClosed = await waitFor(page, () => !document.querySelector('[data-testid=recall-card]'));
    c.recallPlaysAgain = await waitFor(page, () => window.__core.state() === 1);
    const rs = await page.evaluate(() => Object.values(window.__core.recall().state));
    r.recall = rs;
    c.recallScheduled7d = rs.length === 1 && rs[0].results[0].got === true && Math.round((rs[0].due - rs[0].results[0].at) / 86400000) === 7;
    c.todayGotIt = await waitFor(page, () => /, 1 got it$/.test(document.querySelector('[data-testid=today]')?.textContent ?? ''));

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
    const before = await page.evaluate(() => window.__core.idx());
    await page.mouse.move(vp.width / 2, vp.height * 0.7);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(vp.width / 2, vp.height * (0.7 - 0.09 * i));
    await page.mouse.up();
    c.swipeNext = await waitFor(page, (b) => window.__core.idx() === b + 1, before);
    // Menü: Captions an, dann gilt immer an (auch Englisch)
    await skipRecall(page);
    await page.click('[aria-label=More]');
    await page.click('text=Captions');
    await page.click('text=Cancel');
    c.captionsMenuOn = await waitFor(page, () => !!document.querySelector('[data-testid=caption] span')?.textContent);
    await page.screenshot({ path: `${out}/${name}-7-untertitel-an.png` });
    // Gedrückt halten: 2x, Loslassen: normal
    await page.mouse.move(vp.width / 2, vp.height * 0.5);
    await page.mouse.down();
    c.holdFast = await waitFor(page, () => [...document.querySelectorAll("span")].some((s) => s.textContent === "2x"));
    await page.mouse.up();
    c.releaseNormal = await waitFor(page, () => ![...document.querySelectorAll("span")].some((s) => s.textContent === "2x"));
    // Punkt 8: YouTube-Iframe füllt genau das 16:9-Band, ohne Zoom und ohne Beschnitt
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
    await skipRecall(page);
    await page.click('[data-testid=form-switch] >> text=Text');
    c.textView = await waitFor(page, () => !!document.querySelector('[data-testid=text-view]')?.textContent?.includes('Sentence 14'));
    c.textPaused = await waitFor(page, () => window.__core.state() !== 1);
    await page.keyboard.press('j');
    await page.waitForTimeout(300);
    await skipRecall(page);
    const tid = await page.evaluate(() => window.__core.moment().id);
    c.textNotSeenBeforeEnd = !(await page.evaluate((id) => window.__core.seen(id), tid));
    await page.screenshot({ path: `${out}/${name}-9-text.png` });
    await page.evaluate(() => { const el = document.querySelector('[data-testid=text-view]'); el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    c.textSeenAtEnd = await waitFor(page, (id) => window.__core.seen(id), tid);
    c.textStillPaused = await page.evaluate(() => window.__core.state() !== 1);
    await skipRecall(page);
    // Filter nach Feld form: Text zeigt nur Text-Momente, ohne Player
    c.textOnlyTextMoments = await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) { if (window.__core.moment()?.form !== 'text') return false; window.__core.next(); await new Promise((r) => setTimeout(r, 40)); }
      return true;
    });
    c.textHookShown = await page.evaluate(() => { const m = window.__core.moment(); const t = document.querySelector('[data-testid=text-view]')?.textContent ?? ''; return t.includes(m.hook) && t.includes('Sentence 1 '); });
    c.textNeverLoadsPlayer = await page.evaluate(() => !window.__ytlog.some((x) => x.includes('texto')));
    await skipRecall(page);
    await page.click('[data-testid=form-switch] >> text=Audio');
    c.audioOnlyAudio = await waitFor(page, () => window.__core.moment()?.audio === true && !document.querySelector('[data-testid=text-view]'));
    c.audioPlays = await waitFor(page, () => window.__core.state() === 1);
    c.audioCoverShown = await waitFor(page, () => !!document.querySelector('.vslot[aria-hidden=false] .vaudio-art'));
    c.audioBigCaption = await waitFor(page, () => { const el = document.querySelector('[data-testid=caption] span'); return !!el?.textContent && parseFloat(getComputedStyle(el).fontSize) >= 22; });
    await page.screenshot({ path: `${out}/${name}-10-audio.png` });
    c.audioNeverVideo = await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) { if (window.__core.moment()?.audio !== true) return false; window.__core.next(); await new Promise((r) => setTimeout(r, 40)); }
      return true;
    });
    await skipRecall(page);
    await page.click('[data-testid=form-switch] >> text=Video');
    c.videoBack = await waitFor(page, () => window.__core.state() === 1 && !document.querySelector('[data-testid=text-view]') && !window.__core.moment()?.audio);
    c.videoNeverAudio = await page.evaluate(async () => {
      for (let i = 0; i < 12; i++) { const mm = window.__core.moment(); if (mm?.audio || mm?.form === 'text') return false; window.__core.next(); await new Promise((r) => setTimeout(r, 40)); }
      return true;
    });

    // Doppeltipp speichert (für den Wochenrückblick)
    await skipRecall(page);
    await page.mouse.dblclick(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(400);

    // Endscreen-Schutz: über jedem Player, der nicht gerade abspielt (also auch nach ENDED), liegt das Vorschaubild
    let checksDone = 0, violations = 0, endedSeen = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const res = await page.evaluate(() => {
        const st = window.__core.slots();
        const dom = [...document.querySelectorAll('.vslot')];
        return st.map((x, i) => ({ st: x.st, current: dom[i]?.getAttribute('aria-hidden') === 'false', poster: (() => { const p = dom[i]?.querySelector('.vposter'); return !!p && getComputedStyle(p).visibility !== 'hidden'; })() }));
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
    await page.screenshot({ path: `${out}/${name}-3-nach-ende.png` });

    // Punkt 1: Wisch bis erstes Bild wird gemessen, gepufferte Momente unter 300 ms (Nachbau-Player, echte Werte nur auf dem Gerät)
    const lat = await page.evaluate(() => window.__core.latency());
    const buf = lat.filter((x) => x.buffered).map((x) => x.ms).sort((a, b) => a - b);
    r.latency = { n: lat.length, buffered: buf.length, median: buf[Math.floor((buf.length - 1) / 2)] ?? null };
    c.latencyMeasured = lat.length >= 3 && buf.length >= 1;
    c.bufferedUnder300 = buf.length > 0 && r.latency.median < 300;
    c.latencyInDiag = (await page.evaluate(() => window.__core.diag())).some((x) => x.startsWith('first-frame'));
    // In den Einstellungen sichtbar
    await skipRecall(page);
    await page.keyboard.press(' ');
    await page.click('nav [aria-label=Settings]');
    await page.locator('[data-testid=unlock-device]').scrollIntoViewIfNeeded();
    await page.click('text=Show QR code');
    c.unlockQr = await waitFor(page, () => !!document.querySelector('[data-testid=unlock-qr] svg'));
    c.keyBackupsBoth = await waitFor(page, () => /IndexedDB yes .* offline cache yes/.test(document.querySelector('[data-testid=key-backups]')?.textContent ?? ''));
    await page.screenshot({ path: `${out}/${name}-8-geraet-freischalten.png` });
    c.speedOptions = await page.evaluate(() => [...document.querySelectorAll('[data-testid=speed] option')].map((o) => o.value).join(',') === '1,1.5');
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
    await p2.waitForTimeout(800); // Zustand wird verzögert gespeichert
    await p2.close();
    const p3 = await ctx.newPage();
    await p3.goto(url + '?now=2026-10-25');
    c.reviewOnlyOnce = await waitFor(p3, () => !!window.__core?.moment()) && !(await p3.$('[data-testid="weekly-review"]'));
    // Nächster Sonntag: Plan der Vorwoche mit "Did it happen?", dann Skip
    await p3.close();
    const p5 = await ctx.newPage();
    await p5.goto(url + '?now=2026-11-01');
    c.prevPlanShown = await waitFor(p5, () => document.querySelector('[data-testid=prev-plan]')?.textContent?.includes('When I finish the OCT clinic on Tuesday, I will explain one saved moment to a colleague.'));
    await p5.click('[data-testid=prev-plan] >> text=Yes');
    c.prevPlanAnswered = await waitFor(p5, () => document.querySelector('[data-testid=prev-plan] button[aria-pressed=true]')?.textContent === 'Yes');
    await p5.screenshot({ path: `${out}/${name}-13-vorwoche.png` });
    await p5.click('text=Skip this week');
    c.skipWorks = await waitFor(p5, () => !!window.__core?.moment());
    // Leerer Filter: eine Zeile statt leerem Feed, Schalter bleibt bedienbar
    await p5.close();
    const p6 = await ctx.newPage();
    await p6.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolVideoOnly }));
    await p6.goto(url + '?now=2026-10-23');
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
