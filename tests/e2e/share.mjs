// E2E Share (Brief 05, Entscheidung 27, Issue 21): der Share-Knopf öffnet das Blatt mit Link zur Clip-Seite, Text in der Sprache des Tracks,
// Kopieren zeigt "Copied". Die Clip-Seite (clip/) rendert Hook, Kanal, Folge und Caption aus dem Hash, das Audio springt auf start und hält bei end,
// YouTube bekommt start und end im IFrame, Text ist eine Passage, Arabisch ist rechtsläufig, ein kaputter Hash zeigt die Hinweiszeile.
// Aufruf: node tests/e2e/share.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-share'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');

// Testpool: Video (YouTube-ID), Audio mit Folgenseite, arabisches Audio, Text. Nichts davon ist echt.
const base = (i, extra) => ({
  id: `shar${String(i).padStart(7, '0')}:100`, videoId: `shar${String(i).padStart(7, '0')}`, start: 100, end: 160, channel: `Kanal ${i}`, videoTitle: `Folge ${i}`,
  area: ['beat', 'brain', 'body'][i % 3], topic: ['islam', 'augen', 'kraft'][i % 3], hook: `Share hook ${i}`, context: `Context one ${i}.\nContext two ${i}.`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z',
  cues: [[0, 'Untertitel eins'], [2, 'Untertitel zwei']], excerpt: 'Ein geprüfter Ausschnitt.', lang: 'en', ...extra,
});
const moments = [];
for (let i = 0; i < 6; i++) moments.push(base(i, {}));
for (let i = 6; i < 12; i++) moments.push(base(i, { audio: true, form: 'audio', hls: `https://stream.test/ep${i}.mp3`, url: `https://podcast.test/ep${i}` }));
// Arabische Audio-Momente: Hook und Kontext arabisch, Sprache ar
for (let i = 12; i < 18; i++) moments.push(base(i, { audio: true, form: 'audio', hls: `https://stream.test/ep${i}.mp3`, url: `https://podcast.test/ep${i}`, lang: 'ar', hook: `العين لا تنام ${i}`, context: `الجملة الأولى ${i}.\nالجملة الثانية ${i}.`, channel: `قناة ${i}`, videoTitle: `الحلقة ${i}` }));
for (let i = 18; i < 22; i++) moments.push(base(i, { form: 'text', videoId: `txt-${String(i).padStart(7, '0')}`, sourceUrl: `https://example.org/source/${i}`, excerpt: `Satz eins ${i}.\nSatz zwei ${i}.` }));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
const poolBody = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');

// Stille WAV-Datei, 10 s, 8 kHz, 8 Bit mono, als "Original beim Host" über den Vorschau-Server (dist/e2e). Über route() ausgelieferte Medien
// kann kein Browser spulen (keine Range-Antworten), WebKit lädt sie gar nicht, darum eine echte Datei.
const WAV_S = 10;
const wav = (() => {
  const n = 8000 * WAV_S;
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
})();

mkdirSync('dist/e2e', { recursive: true });
writeFileSync('dist/e2e/clip.wav', wav);

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const decode = (hash) => JSON.parse(Buffer.from(hash.replace(/^#/, ''), 'base64url').toString('utf8'));
const clipAudio = { v: 1, form: 'audio', src: `${url}e2e/clip.wav`, start: 3, end: 5, hook: 'Clip hook from the hash', context: 'Caption line one.\nCaption line two.', channel: 'Clip channel', episode: 'Episode 7', lang: 'en', dir: 'ltr', url: 'https://podcast.test/ep7' };
const clipAr = { ...clipAudio, hook: 'العين لا تنام', context: 'الجملة الأولى.\nالجملة الثانية.', channel: 'قناة الطب', episode: 'الحلقة ٣', lang: 'ar', dir: 'rtl' };
const clipYt = { v: 1, form: 'video', src: 'dQw4w9WgXcQ', start: 61, end: 95, hook: 'Video hook', channel: 'Video channel', episode: 'Talk 3', lang: 'en', dir: 'ltr' };
const clipText = { v: 1, form: 'text', src: 'https://example.org/article', start: 0, end: 0, hook: 'Text hook', context: 'Passage one.\nPassage two.\nPassage three.', channel: 'Author', episode: 'Book', lang: 'de', dir: 'ltr' };
const clipFail = { ...clipAudio, src: 'https://nohost.test/ep.m3u8', url: undefined };

const waitFor = async (page, fn, arg, timeout = 15000) => { try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; } };
const results = { at: new Date().toISOString(), runs: [] };
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]]) {
  const r = { variant: name, checks: {} };
  const c = r.checks;
  results.runs.push(r);
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
    await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
    await ctx.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
    await ctx.route('https://nohost.test/**', (x) => x.abort());
    await ctx.route('https://www.youtube-nocookie.com/**', (x) => x.fulfill({ contentType: 'text/html', body: '<!doctype html><title>yt</title>' }));
    const page = await ctx.newPage();
    // Zwischenablage nachgebaut: der Runner hat keine, der Text landet in window.__copied
    await page.addInitScript(() => {
      window.__copied = null;
      const clip = { writeText: (t) => { window.__copied = t; return Promise.resolve(); } };
      Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // ---- App: Share-Knopf, Blatt, Link, Kopieren ----
    // Wie moments.mjs: erst ohne Schlüssel laden, dann mit #k=, sonst kommt WebKit beim Kaltstart nicht bis zum Feed
    await page.goto(url + '?now=2026-10-23');
    await page.goto('about:blank');
    await page.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
    c.feedLoaded = await waitFor(page, () => !!window.__core?.moment(), undefined, 30000);
    const col = await page.evaluate(() => [...document.querySelectorAll('.vactions button')].map((b) => ({ id: b.dataset.testid, dis: b.disabled, primary: b.dataset.primary, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })));
    c.columnUnchanged = col.map((x) => x.id).join() === 'like,save,share,source,more' && col.every((x) => x.primary === 'true' && x.w >= 48 && x.h >= 48);
    c.shareEnabled = col.find((x) => x.id === 'share')?.dis === false;
    const m0 = await page.evaluate(() => window.__core.moment());
    await page.click('[data-testid=share]');
    c.sheetOpens = await waitFor(page, () => !!document.querySelector('[data-testid=share-sheet]'), undefined, 5000);
    await page.screenshot({ path: `${out}/${name}-1-share-sheet.png` });
    const sheet = await page.evaluate(() => ({ url: document.querySelector('[data-testid=share-url]')?.dataset.url ?? '', shown: document.querySelector('[data-testid=share-url]')?.textContent ?? '', hook: document.querySelector('.share-hook')?.textContent ?? '', rows: [...document.querySelectorAll('[data-testid=share-system],[data-testid=share-copy]')].map((b) => b.disabled) }));
    r.sheet = { url: sheet.url.slice(0, 80), hook: sheet.hook };
    c.linkUnderBase = sheet.url.startsWith(`${url}clip/#`);
    // Im Blatt steht nur der Anfang des Links (Host, Pfad, Hash-Anfang), damit die Zeilen Share und Copy im Blatt bleiben
    c.linkShownShort = sheet.shown.length < 60 && sheet.shown.startsWith(`${url.replace(/^https?:\/\//, '')}clip/#`) && sheet.shown.endsWith('…');
    let payload = null;
    try { payload = decode(sheet.url.split('#')[1]); } catch {}
    r.payload = payload;
    c.linkHasPayload = !!payload && payload.v === 1 && payload.form === 'video' && payload.src === m0.videoId && payload.start === m0.start && payload.end === m0.end && payload.hook === m0.hook && payload.channel === m0.channel && payload.episode === m0.videoTitle && payload.context === m0.context;
    // Nichts aus dem Pool, kein Schlüssel: keine Moment-ID, kein k=, keine Felder außer den vereinbarten
    const allowed = ['v', 'form', 'src', 'start', 'end', 'hook', 'context', 'channel', 'episode', 'lang', 'dir', 'url'];
    c.linkNoSecrets = !!payload && !JSON.stringify(payload).includes(m0.id) && !sheet.url.includes(k) && !sheet.url.includes('k=') && Object.keys(payload).every((x) => allowed.includes(x));
    c.sheetRowsActive = sheet.rows.length === 2 && sheet.rows.every((d) => d === false) && sheet.hook === m0.hook;
    await page.click('[data-testid=share-copy]');
    c.copiedToast = await waitFor(page, () => document.querySelector('[data-testid=toast]')?.textContent === 'Copied', undefined, 3000);
    c.sheetClosesAfterCopy = await waitFor(page, () => !document.querySelector('[data-testid=share-sheet]'), undefined, 3000);
    const copied = await page.evaluate(() => window.__copied);
    r.copied = copied;
    // Text: Hook, Kontext in einer Zeile, Kanal · Folge · m:ss, dann der Link. Kein englisches Etikett.
    c.copiedText = typeof copied === 'string' && copied.startsWith(`${m0.hook}\n\nContext one 0. Context two 0.\n\n${m0.channel} · ${m0.videoTitle} · 1:40\n\n${url}clip/#`) && !/Channel:|Episode:|at 1:40/.test(copied);
    // Share-Link-Zeile ohne navigator.share: fällt auf die Zwischenablage zurück
    await page.click('[data-testid=share]');
    await page.waitForSelector('[data-testid=share-sheet]');
    await page.click('[data-testid=share-system]');
    c.systemFallsBackToCopy = await waitFor(page, () => document.querySelector('[data-testid=toast]')?.textContent === 'Copied' && !document.querySelector('[data-testid=share-sheet]'), undefined, 3000);

    // Arabisches Audio: Text und Link arabisch, dir rtl, Audio-Datei als src, Folgenseite als url
    await page.click('[data-testid=form-switch] button:has-text("Audio")');
    c.audioTab = await waitFor(page, () => window.__core.moment()?.form === 'audio', undefined, 10000);
    const ids = await page.evaluate(() => window.__core.queue());
    const arId = ids.find((id) => Number(id.slice(4, 11)) >= 12 && Number(id.slice(4, 11)) < 18);
    r.arId = arId;
    if (arId) {
      await page.evaluate((id) => window.__core.arrange([id]), arId);
      await page.evaluate(() => window.__core.next?.());
      c.arabicReached = await waitFor(page, (id) => window.__core.moment()?.id === id, arId, 10000);
    }
    const ma = await page.evaluate(() => window.__core.moment());
    await page.click('[data-testid=share]');
    await page.waitForSelector('[data-testid=share-sheet]');
    const urlA = await page.evaluate(() => document.querySelector('[data-testid=share-url]')?.dataset.url ?? '');
    let pa = null;
    try { pa = decode(urlA.split('#')[1]); } catch {}
    r.payloadAudio = pa;
    c.audioPayload = !!pa && pa.form === 'audio' && pa.src === ma.hls && pa.url === ma.url && pa.hook === ma.hook;
    c.arabicRtl = !!pa && ma.lang === 'ar' ? pa.lang === 'ar' && pa.dir === 'rtl' && /[؀-ۿ]/.test(pa.hook) : true;
    await page.screenshot({ path: `${out}/${name}-2-share-audio.png` });
    await page.click('[data-testid=share-copy]');
    const copiedA = await page.evaluate(() => window.__copied);
    c.arabicTextNotEnglish = ma.lang === 'ar' ? typeof copiedA === 'string' && copiedA.startsWith(ma.hook) && /[؀-ۿ]/.test(copiedA.split('\n')[2]) && !/Context|Channel/.test(copiedA.split('\n\n').slice(0, 3).join()) : true;
    const clipFromApp = urlA;

    // ---- Clip-Seite ----
    const clip = await ctx.newPage();
    const clipErrors = [];
    clip.on('pageerror', (e) => clipErrors.push(String(e)));
    await clip.emulateMedia({ colorScheme: 'dark' });
    await clip.goto(`${url}clip/#${b64url(clipAudio)}`);
    c.clipRenders = await waitFor(clip, () => !!document.querySelector('[data-testid=clip-view]'), undefined, 10000);
    const cv = await clip.evaluate(() => ({
      form: document.querySelector('[data-testid=clip-view]')?.dataset.form, dir: document.documentElement.dir, title: document.title,
      kicker: document.querySelector('.clip-kicker')?.textContent, hook: document.querySelector('.clip-hook')?.textContent,
      caption: [...document.querySelectorAll('.clip-caption p')].map((p) => p.textContent), link: document.querySelector('.clip-link')?.getAttribute('href'),
      audio: !!document.querySelector('[data-testid=clip-audio]'), start: document.querySelector('[data-testid=clip-audio]')?.dataset.start, play: !!document.querySelector('[data-testid=clip-play]'),
      bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color, nothingLocked: !document.body.innerText.includes('locked'),
    }));
    r.clip = cv;
    c.clipHook = cv.hook === clipAudio.hook && cv.title.startsWith(clipAudio.hook);
    c.clipChannelEpisode = cv.kicker === `${clipAudio.channel} · ${clipAudio.episode}`;
    c.clipCaption = cv.caption.join('|') === 'Caption line one.|Caption line two.';
    c.clipEpisodeLink = cv.link === clipAudio.url;
    c.clipAudioElement = cv.audio && cv.start === '3' && cv.play && cv.form === 'audio' && cv.dir === 'ltr' && cv.nothingLocked;
    await clip.screenshot({ path: `${out}/${name}-3-clip-dark.png` });
    await clip.emulateMedia({ colorScheme: 'light' });
    // Die Farben blenden über (Tokens mit @property, 400 ms), darum erst nach der Überblendung lesen
    await clip.waitForTimeout(700);
    const light = await clip.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color }));
    c.clipLightDiffers = light.bg !== cv.bg && light.fg !== cv.fg;
    await clip.screenshot({ path: `${out}/${name}-3-clip-light.png` });
    await clip.emulateMedia({ colorScheme: 'dark' });
    // Play: Audio springt auf start und hält bei end
    await clip.click('[data-testid=clip-play]');
    c.audioJumpsToStart = await waitFor(clip, () => { const a = document.querySelector('[data-testid=clip-audio]'); return !!a && Math.abs(a.currentTime - 3) < 0.6 || (a && a.currentTime >= 3 && a.currentTime <= 5.5); }, undefined, 8000);
    const t0 = await clip.evaluate(() => document.querySelector('[data-testid=clip-audio]')?.currentTime);
    r.audioT0 = t0;
    c.audioStopsAtEnd = await waitFor(clip, () => { const a = document.querySelector('[data-testid=clip-audio]'); return !!a && a.paused && a.currentTime >= 4.5 && document.querySelector('[data-testid=clip-player]')?.dataset.phase === 'done'; }, undefined, 12000);
    r.audioT1 = await clip.evaluate(() => document.querySelector('[data-testid=clip-audio]')?.currentTime);
    c.audioNeverBeforeStart = typeof t0 === 'number' && t0 >= 2.9;

    // Arabisch: rechtsläufig, arabische Schrift
    await clip.goto(`${url}clip/#${b64url(clipAr)}`);
    await clip.waitForSelector('[data-testid=clip-view]');
    const ar = await clip.evaluate(() => ({ dir: document.querySelector('[data-testid=clip-view]')?.getAttribute('dir'), html: document.documentElement.dir, lang: document.documentElement.lang, font: getComputedStyle(document.querySelector('.clip-caption p')).fontFamily, phase: document.querySelector('[data-testid=clip-player]')?.dataset.phase }));
    r.ar = ar;
    c.clipRtl = ar.dir === 'rtl' && ar.html === 'rtl' && ar.lang === 'ar' && /Arabic|Geeza/.test(ar.font);
    // Neuer Link in derselben Seite: der Player beginnt frisch, nicht am Ende des vorigen Clips
    c.clipFreshPlayer = ar.phase === 'idle';
    await clip.screenshot({ path: `${out}/${name}-4-clip-rtl.png` });

    // YouTube: IFrame mit start und end, ohne Cookies
    await clip.goto(`${url}clip/#${b64url(clipYt)}`);
    await clip.waitForSelector('[data-testid=clip-view]');
    const yt = await clip.evaluate(() => ({ src: document.querySelector('[data-testid=clip-youtube]')?.getAttribute('src'), link: document.querySelector('.clip-link')?.getAttribute('href') }));
    r.yt = yt;
    c.clipYoutube = !!yt.src && yt.src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?') && yt.src.includes('start=61') && yt.src.includes('end=95') && yt.link === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=61';

    // Text: Passage, kein Medium
    await clip.goto(`${url}clip/#${b64url(clipText)}`);
    await clip.waitForSelector('[data-testid=clip-view]');
    const tx = await clip.evaluate(() => ({ n: document.querySelectorAll('.clip-passage p').length, media: !!document.querySelector('.clip-media'), link: document.querySelector('.clip-link')?.getAttribute('href') }));
    c.clipText = tx.n === 3 && !tx.media && tx.link === clipText.src;
    await clip.screenshot({ path: `${out}/${name}-5-clip-text.png` });

    // Host spielt nicht: Link zur Folge mit Zeitstempel. Der Fehler kommt je nach Browser schon beim Laden oder erst beim Tipp auf Play.
    await clip.goto(`${url}clip/#${b64url(clipFail)}`);
    await clip.waitForSelector('[data-testid=clip-play], [data-testid=clip-fail]');
    if (await clip.$('[data-testid=clip-play]')) await clip.click('[data-testid=clip-play]').catch(() => {});
    c.clipFailShowsLink = await waitFor(clip, () => document.querySelector('[data-testid=clip-fail] a')?.getAttribute('href') === 'https://nohost.test/ep.m3u8#t=3', undefined, 10000);
    await clip.screenshot({ path: `${out}/${name}-6-clip-fail.png` });

    // Kaputter Hash
    await clip.goto(`${url}clip/#kaputt!`);
    c.clipBadHash = await waitFor(clip, () => !!document.querySelector('[data-testid=clip-empty]'), undefined, 5000);

    // Der Link aus der App selbst öffnet die Seite mit dem Moment
    await clip.goto(clipFromApp);
    c.appLinkOpens = await waitFor(clip, (h) => document.querySelector('.clip-hook')?.textContent === h, ma.hook, 10000);
    await clip.screenshot({ path: `${out}/${name}-7-clip-from-app.png` });

    c.pageErrors = errors.length + clipErrors.length;
    r.errors = [...errors, ...clipErrors].slice(0, 3);
  } catch (e) {
    r.error = String(e);
  }
  await browser?.close();
  r.ok = !r.error && Object.entries(c).every(([key, v]) => (key === 'pageErrors' ? v === 0 : v === true));
  console.log(JSON.stringify(r));
}
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
if (results.runs.some((x) => !x.ok)) process.exit(1);
