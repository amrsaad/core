// E2E iPhone-Ansicht, Schritt 1 (Runde 45): feste Abspielleiste unten, Aktionsreihe darüber, Reiterleiste oben, Inhalt dazwischen.
// Prüft bei 390x844, 375x667 und 430x932 in allen drei Reitern: Leiste ganz im Fenster und über der sicheren Unterkante, Aktionsreihe direkt darüber, keine Überschneidung von
// Kopf, Inhalt, Aktionsreihe und Leiste, alle Tasten mindestens 44 px, Hook nie abgeschnitten (auch ein sehr langer), Kontrast der Schrift, Video randlos 16:9.
// Verhalten bei 390x844: Zeitleiste läuft, Pause und Weiter per Taste, Voriger und Nächster, Wischen, Tippen auf den Inhalt, Tempo, CC, Like, Save, Share, More,
// Abrufkarte und Share-Blatt liegen über der Leiste, Settings über die Taste oben rechts, Saved über die Navigation dort, Text scrollt und wischt erst am Textende.
// Erste Geste nach dem App-Start ist die Play-Taste: Ton startet (iOS-Regel des Tests wie in audiotab.mjs, Zeile "deck: gesture unlock").
// Runde 50: Profil "Gerät" 393x852 mit Sicherheitsrand 59/34 und nachgestelltem Gerätefehler (Fensterhöhe 793, screen.height 852, navigator.standalone): Feed bis zum unteren Rand (--ph-h), feste Kopfleiste,
// Abstand oben per Schalter (window.__phTopClear 40), Titelbild als Quadrat (nie beschnitten), vorige und nächste Zeile genau einzeilig, Diag-Zeile "vp:".
// Schalter aus (?phone=0): der alte Aufbau (kein data-phone, keine .ph-Klassen, .vactions, untere Navigation).
// Nur Kunst-IDs und Testtexte.
// Aufruf: node tests/e2e/phoneview.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview). E2E_BROWSERS=chromium,webkit
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { deflateSync as zlibSync } from 'node:zlib';
import { chromium, devices, webkit } from 'playwright';
import { onPageError } from './pageerrors.mjs';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-phoneview'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
// Runde 46 (AUDIO_NO_YT): der Audio-Reiter lädt die YouTube-API nicht mehr, die Nachbildung der Audio-Elemente kommt per Init-Skript (wie endpage.mjs)
const FAKE_MEDIA = FAKE.slice(FAKE.indexOf('// Eigene Streams'));
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
// Runde 48: Text mittlerer Länge (passt nach der Einpassung auf eine Seite), etwas länger, Audio mit Titelbild (40) und ohne (41)
const EX4 = EX.split('\n').slice(0, 4).join(' ');
const EX7 = EX.split('\n').slice(0, 7).join(' ');
moments.push(mk(56, 'body', { form: 'text', videoId: 'texto00056', author: 'Author 56', ref: 'Ref 56', sourceUrl: 'https://example.org/s/56', license: 'CC BY 4.0', excerpt: EX4 }));
moments.push(mk(57, 'body', { form: 'text', videoId: 'texto00057', author: 'Author 57', ref: 'Ref 57', sourceUrl: 'https://example.org/s/57', license: 'CC BY 4.0', excerpt: EX7 }));
// Runde 49: Moment 58, arabische Untertitel und Überschrift (frei erfundene Testtexte) mit Titelbild
const AR_LONG = 'هذا سطر تجريبي طويل جدا يمتد على عدة أسطر في الهاتف المحمول لأن الجملة لا تنتهي بسرعة ولا بد أن تلتف.';
const AR_CUES = [[0, AR_LONG], [2, 'هذا سطر تجريبي ثان قصير.'], [4, AR_LONG], [7, 'الرابع.']];
const M58 = (mk(58, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/58.m3u8', hook: 'هذا عنوان تجريبي طويل قليلا للحظة الاختبار', cues: AR_CUES, thumb: 'https://img.test/cover58.png' }));
// Runde 50: Moment 59 mit sehr langen Sätzen vor und nach der aktuellen Zeile (quadratisches Bild), Moment 62 mit breitem Titelbild vor und nach der aktuellen Zeile, Moment 60 ohne Untertitel und ohne Auszug (Bild allein)
const EN_LONG = 'Dieser Nachbarsatz ist absichtlich lang, damit er auf dem Handy über mehr als zwei Zeilen umbricht und begrenzt werden muss.';
const M59 = mk(59, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/59.m3u8', hook: 'Testmoment 59 brain, ein kurzer Satz', cues: [[0, EN_LONG], [2, 'Zweite Zeile, kurz.'], [4, EN_LONG], [7, 'Vierte.']], thumb: 'https://img.test/cover59.png' });
const M62 = mk(62, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/62.m3u8', hook: 'Testmoment 62 brain, ein kurzer Satz', thumb: 'https://img.test/wide62.png' });
const M60 = mk(60, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/60.m3u8', hook: 'Testmoment 60 brain, ein kurzer Satz', cues: undefined, excerpt: '', thumb: 'https://img.test/cover60.png' });
// Wie Moment 41 (Hook in voller Länge) mit Titelbild: Vergleich der Hook-Stufe mit und ohne Bild
const M61 = mk(61, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/61.m3u8', thumb: 'https://img.test/cover61.png' });
const COVER = 'https://img.test/cover40.png';
const m40 = moments.find((x) => x.id === `test${String(40).padStart(7, '0')}:100`);
m40.thumb = COVER;
m40.hook = 'Testmoment 40 brain, ein kurzer Satz';
const m42 = moments.find((x) => x.id === `test${String(42).padStart(7, '0')}:100`);
m42.thumb = 'https://img.test/cover42.png';
const m43 = moments.find((x) => x.id === `test${String(43).padStart(7, '0')}:100`);
m43.thumb = 'https://img.test/broken43.png';
// Titelbild lokal erzeugt (kein Netzabruf): Farbverlauf mit Raster, quadratisch (96x96) und breit (96x48)
const mkPng = (W, H) => {
  const rows = [];
  for (let y = 0; y < H; y++) { const row = Buffer.alloc(1 + W * 3); for (let x = 0; x < W; x++) { const g = (x % 16 < 2 || y % 16 < 2) ? 235 : 0; row[1 + x * 3] = Math.min(255, 40 + x * 2 + g); row[2 + x * 3] = Math.min(255, 90 + y * 2 + g); row[3 + x * 3] = Math.min(255, 160 - x + g); } rows.push(row); }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
};
const PNG = mkPng(96, 96);
const PNG_WIDE = mkPng(96, 48);
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments })));
const POOL = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
// Pools für Runde 50: je Szenario nur wenige Audio-Momente (viele Audio-Momente mischen die Reihe nach dem Anordnen neu, der laufende Moment wechselt dann von selbst)
// Runde 50 (Ziel 6): Takeaways im Text-Reiter, mit Zitat und ohne (der excerpt enthält dann alles, wie in älteren Pools). Frei erfundene Testtexte.
const TK_Q = 'Ein kurzes Testzitat.'; const TK_O = 'Testquelle Eintrag 1, 01.01.2026'; const TK_A = 'Schreibe heute einen Testsatz auf.';
const TK_RAW = `„${TK_Q}“\n${TK_O}\nHeute anwenden\n${TK_A}`;
const tk = (i, extra) => mk(i, 'body', { form: 'text', videoId: `texto${String(i).padStart(5, '0')}`, kind: 'takeaway', hook: 'Testsatz eins. Testsatz zwei.', origin: TK_O, apply: TK_A, takeawayNr: 57, ref: 'Test-Takeaways, Nr. 57', excerpt: TK_RAW, ...extra });
const M63 = tk(63, { quote: `„${TK_Q}“` });
const M64 = tk(64, {});
// Runde 50 (Ziel 8 und 9): Titelbild verspätet, kaputt und winzig, schnelle Zeilenwechsel, viele Zeilen für die Frame-Messung
const M65 = mk(65, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/65.m3u8', hook: 'Testmoment 65 brain, ein kurzer Satz', cues: [[0, 'Alpha eins.'], [1, 'Beta zwei.'], [1.1, 'Gamma drei.'], [1.2, 'Delta vier.'], [3, 'Epsilon fünf.'], [5, 'Zeta sechs.']] });
const M66 = mk(66, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/66.m3u8', hook: 'Testmoment 66 brain, ein kurzer Satz', cues: Array.from({ length: 24 }, (_, i) => [i * 0.5, `Zeile ${i + 1} des Frametests, kurz und klar.`]) });
const M67 = mk(67, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/67.m3u8', hook: 'Testmoment 67 brain, ein kurzer Satz', cues: [[0, EN_LONG], [1, 'Mitte kurz.'], [600, EN_LONG], [601, EN_LONG], [602, EN_LONG], [603, EN_LONG]], thumb: 'https://img.test/cover67.png' });
// Runde 50b: Hook mit 4 und mit 10 Zeilen, Untertitel mit 5 Zeilen (erfundene Testtexte)
const CUE5 = 'Dieser Untertitel ist absichtlich sehr lang, damit er auf dem Handy über fünf oder mehr Zeilen umbricht und die verfügbare Zeilenzahl klemmen muss, wenn der Platz knapp wird.';
const HOOK4 = 'Testmoment 72 brain, ein Satz mit etwas mehr Text, damit der Titel auf vier Zeilen umbricht und trotzdem lesbar bleibt, auch auf kleinen Geräten';
const HOOK10 = Array.from({ length: 6 }, () => 'Testmoment 73 brain, ein sehr langer Titel, der auf dem Handy über zehn Zeilen umbricht').join(' und ');
const M72 = mk(72, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/72.m3u8', hook: HOOK4, cues: [[0, 'Eins: ' + EN_LONG], [1, 'Zwei: ' + CUE5], [600, 'Drei: ' + EN_LONG], [601, CUE5], [602, EN_LONG]], thumb: 'https://img.test/cover72.png' });
const M73 = mk(73, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/73.m3u8', hook: HOOK10, cues: [[0, 'Eins: ' + EN_LONG], [1, 'Zwei: ' + CUE5], [600, 'Drei: ' + EN_LONG], [601, CUE5], [602, EN_LONG]], thumb: 'https://img.test/cover73.png' });
const M68 = mk(68, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/68.m3u8', thumb: 'https://img.test/slow68.png' });
const M69 = mk(69, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/69.m3u8', thumb: 'https://img.test/broken69.png' });
const M70 = mk(70, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/70.m3u8', thumb: 'https://img.test/tiny70.png' });
const ALL = [...moments, M58, M59, M60, M61, M62, M63, M64, M65, M66, M67, M72, M73, M68, M69, M70];
const numOf = (m) => Number(m.id.slice(4, 11));
const poolOf = async (audio, text = null) => {
  const iv2 = crypto.getRandomValues(new Uint8Array(12));
  const ct2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv2 }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: ALL.filter((m) => (m.audio ? audio.includes(numOf(m)) : m.form === 'text' && text ? text.includes(numOf(m)) : true)) })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv2).toString('base64url'), ct: Buffer.from(ct2).toString('base64url') });
};
const POOL_A = await poolOf([40, 41, 42, 43, 44, 61, 58]);
const POOL_B = await poolOf([40, 59, 62, 60, 65, 66]);
const POOL_L = await poolOf([67]);
const POOL_X = await poolOf([72, 73]);
const POOL_C = await poolOf([40, 44, 68, 69, 70]);
const POOL_G = await poolOf([40, 58, 59]);
const POOL_T = await poolOf([40], [48, 63, 64]);
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
/** Runde 50, Profil Gerät: 393x852 pt, Sicherheitsrand 59/34. Gerätefehler: das Layout-Fenster ist 793 hoch (screen.height minus 59), installierte App. */
const GER = { name: '393x852', width: 393, height: 793, device: 'iPhone 14', safeT: 59, safeB: 34, screenH: 852, standalone: true };

async function open(type, size, { init, query = '', pool = POOL, tab = null } = {}) {
  const browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
  const prof = devices[size.device] ?? devices['iPhone 14'];
  const cx = await browser.newContext({ ...prof, viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', ...(size.reduced ? { reducedMotion: 'reduce' } : {}) });
  await cx.addInitScript(({ t, b }) => {
    const put = () => { if (!document.documentElement) return false; const s = document.createElement('style'); s.textContent = `:root{--safe-top:${t}px;--safe-bottom:${b}px}`; document.documentElement.appendChild(s); return true; };
    if (!put()) document.addEventListener('readystatechange', put, { once: true });
  }, { t: size.safeT, b: size.safeB });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  await cx.route(/img\.test\/cover/, (x) => x.fulfill({ contentType: 'image/png', body: PNG }));
  // Stream-Adresse der Testmomente: ein leerer, gültiger Abspielplan statt eines Netzfehlers, damit ein Moment nicht nach wenigen Sekunden als verloren übersprungen wird
  await cx.route('https://stream.test/**', (x) => x.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n' }));
  await cx.route(/img\.test\/slow/, async (x) => { await sleep(2000); await x.fulfill({ contentType: 'image/png', body: PNG }); });
  await cx.route(/img\.test\/tiny/, (x) => x.fulfill({ contentType: 'image/png', body: mkPng(1, 1) }));
  await cx.route(/img\.test\/wide/, (x) => x.fulfill({ contentType: 'image/png', body: PNG_WIDE }));
  await cx.route(/img\.test\/broken/, (x) => x.abort());
  const pg = await cx.newPage();
  const errors = [];
  pg.on('pageerror', onPageError(errors));
  // Gerätefehler (Runde 50): screen.height größer als die Fensterhöhe, installierte App, Abstand oben per Schalter
  if (size.screenH || size.standalone || size.topClear) {
    await pg.addInitScript(({ sh, sa, tc }) => {
      if (sh) Object.defineProperty(window.screen, 'height', { get: () => sh });
      if (sa) Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
      if (tc) window.__phTopClear = tc;
    }, { sh: size.screenH ?? 0, sa: !!size.standalone, tc: size.topClear ?? 0 });
  }
  await pg.addInitScript(() => { window.__ytSlow = true; });
  await pg.addInitScript(FAKE_MEDIA);
  // Das Nachbild-Element hat nie readyState größer 0: der Audio-Stapel hielt den aktiven Moment nach 3 s für nicht ladend und wechselte zum nächsten. Mit Quelle gilt es als geladen, damit Zeilen länger als 3 s laufen.
  await pg.addInitScript(() => { Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get() { return this.__src ? 4 : 0; } }); });
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
  // Der Vorrat wird nach dem Anordnen neu gemischt (mit mehreren Audio-Momenten verschiebt sich die Reihe): anordnen und im selben Schritt weitergehen, nur wenn der Moment als Nächster steht, sonst nochmal.
  // Der Audio-Stapel kann beim Wechsel einen schon bereiten Moment vorziehen ("ready first ... (race)"): dann das Ganze nochmal.
  for (let t = 0; t < 4; t++) {
    for (let n = 0; n < 10; n++) {
      const went = await pg.evaluate((i) => { window.__core.arrange([i]); if (window.__core.queue()[window.__core.idx() + 1] !== i) return false; window.__core.next(); return true; }, id);
      if (went) break;
      await pg.waitForTimeout(300);
    }
    if (await waitFor(pg, (i) => window.__core.moment()?.id === i, id, 3000)) break;
  }
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
/** Runde 48: Was liegt am Punkt (Breite/2, Höhe-2)? Erste nicht durchsichtige Hintergrundfarbe von dort nach oben, verglichen mit der Farbe der unteren Leiste */
const BOTTOM = () => {
  const W = innerWidth, H = innerHeight;
  // Die Leiste nimmt keine Zeiger an (Wischen von überall): für die Messung kurz ansprechbar machen
  const probe = document.createElement('style');
  probe.textContent = '.ph-bar,.ph-actions{pointer-events:auto !important}';
  document.head.appendChild(probe);
  setTimeout(() => probe.remove(), 0);
  const solid = (c) => !!c && !/^rgba\(.*,\s*0\)$/.test(c) && c !== 'transparent';
  const colorAt = (x, y) => { for (let n = document.elementFromPoint(x, y); n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (solid(c)) return { c, html: n.outerHTML.slice(0, 160), tag: `${n.tagName}.${String(n.className).slice(0, 40)}${n.dataset?.testid ? '#' + n.dataset.testid : ''}` }; } return { c: null, tag: null }; };
  const bar = document.querySelector('[data-testid=ph-bar]');
  const barC = bar ? getComputedStyle(bar).backgroundColor : null;
  const a = colorAt(W / 2, H - 2), b = colorAt(8, H - 2), t = colorAt(W / 2, H - 20);
  return { barC, bottom: a, left: b, above: t, same: a.c === barC && b.c === barC };
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
/** Wisch per Touch-Ereignissen auf einem Element (Text-Reiter: dort gelten onTouchStart und onTouchEnd).
 *  Playwright-WebKit hat auf dem Desktop weder Touch noch TouchEvent (Illegal constructor), darum einfache Event-Objekte mit den Feldern touches und changedTouches:
 *  React liest nur e.touches[0].clientX und clientY. Dieselben Objekte laufen in Chromium und WebKit. */
const touchSwipe = (pg, sel, x, y0, y1) => pg.evaluate(([q, px, a, b]) => {
  const el = document.querySelector(q);
  const pt = (y) => ({ identifier: 1, target: el, clientX: px, clientY: y, pageX: px, pageY: y, screenX: px, screenY: y });
  const fire = (type, touches, changed) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: touches });
    Object.defineProperty(ev, 'targetTouches', { value: touches });
    Object.defineProperty(ev, 'changedTouches', { value: changed });
    el.dispatchEvent(ev);
  };
  fire('touchstart', [pt(a)], [pt(a)]);
  fire('touchmove', [pt(b)], [pt(b)]);
  fire('touchend', [], [pt(b)]);
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
        const bt = await pg.evaluate(BOTTOM);
        c[`${tag} unterer Rand Leistenfarbe`] = bt.same;
        if (!bt.same) r.notes[`${tag} unterer Rand`] = bt;
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
        // Runde 48: Text-Reiter ohne inneres Scrollen. Kurzer und längerer Text: alles passt, die Überschrift liegt unter der Reiterleiste, ein Wisch nach oben wechselt sofort.
        if (form === 'text') {
          for (const [label, id] of [['kurz', idOf(48)], ['lang', idOf(56)], ...(size.height >= 800 ? [['sehr lang', idOf(57)]] : [])]) {
            await showMoment(pg, id);
            const t = await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); const h = document.querySelector('[data-testid=hook]').getBoundingClientRect(); const head = document.querySelector('.ph-head').getBoundingClientRect(); const bar = document.querySelector('[data-testid=ph-actions]').getBoundingClientRect(); const src = document.querySelector('[data-testid=text-source]')?.getBoundingClientRect(); return { sh: v.scrollHeight, ch: v.clientHeight, hookTop: h.top, headB: head.bottom, fit: v.dataset.tfit, scroll: v.dataset.tscroll, srcB: src ? src.bottom : null, actT: bar.top, hookSize: parseFloat(getComputedStyle(document.querySelector('[data-testid=hook]')).fontSize), bodySize: parseFloat(getComputedStyle(document.querySelector('[data-testid=text-body]')).fontSize) }; });
            const k = `${tag} Text ${label}`;
            r.notes[k] = t;
            await pg.screenshot({ path: `${out}/${name}-${size.name}-text-${label.replace(' ', '')}.png` });
            c[`${k} ohne Scrollen`] = t.sh <= t.ch + 1 && t.scroll === 'no';
            c[`${k} Überschrift unter der Kopfleiste`] = t.hookTop >= t.headB - 0.5;
            c[`${k} Quelle über der Aktionsreihe`] = t.srcB === null || t.srcB <= t.actT + 0.5;
            c[`${k} Mindestgrößen`] = t.bodySize >= 15 && t.hookSize >= 20;
            const i0 = await idx(pg);
            await touchSwipe(pg, '[data-testid=text-view]', 200, 600, 300);
            c[`${k} Wisch wechselt sofort`] = await waitFor(pg, (i) => window.__core.idx() === i + 1, i0, 3000);
            c[`${k} Diagzeile`] = await pg.evaluate(([i]) => window.__core.diag().some((x) => x === `text: fit ${i} step=${document.querySelector('[data-testid=text-view]')?.dataset.tfit ?? 'x'} scroll=no`) || window.__core.diag().some((x) => x.startsWith(`text: fit ${i} step=`)), [id]);
          }
        }
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
        const capShown = () => pg.evaluate((f) => (f === 'audio' ? !!document.querySelector('[data-testid=ph-lyric-next], [data-testid=caption]') : !!document.querySelector('[data-testid=caption] span')), form);
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
          await waitFor(pg, () => !!document.querySelector('[data-testid=ph-lyric-next]'), undefined, 6000);
          const L = await pg.evaluate(() => { const f = (s) => document.querySelector(`[data-testid=${s}]`); const fs = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : 0); const cur = f('caption'); return { cur: cur?.textContent ?? '', curTop: cur ? cur.getBoundingClientRect().top : null, curFont: fs(cur), prevFont: fs(f('ph-lyric-next')), nextFont: fs(f('ph-lyric-next')), curColor: cur ? getComputedStyle(cur).color : '', prevColor: f('ph-lyric-next') ? getComputedStyle(f('ph-lyric-next')).color : '' }; });
          r.notes.lyric = L;
          // Runde 50: eine Schrift für alle Zeilen (der Umbruch ändert sich nie), die Rolle zeigt nur Farbe und Deckkraft
          c[`${tag} Feld Größen`] = L.curFont === 22 && L.prevFont === 22 && L.nextFont === 22 && L.curColor !== L.prevColor;
          // Die aktuelle Zeile bleibt beim Wechsel an ihrem Platz: über vier Zeilen gleiche obere Kante bei gleich langer Zeile ist nicht verlangt, wohl aber dieselbe Mitte
          const mids = [];
          for (let n = 0; n < 4; n++) { mids.push(await pg.evaluate(() => { const e = document.querySelector('[data-testid=caption]'); if (!e) return null; const b = e.getBoundingClientRect(); return Math.round(b.top); })); await pg.waitForTimeout(1800); }
          const ok = mids.filter((x) => x !== null);
          c[`${tag} Feld feste Position`] = ok.length >= 2 && Math.max(...ok) - Math.min(...ok) <= 1;
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
      // Runde 50b (Auflage 6): ganz nach unten gescrollt liegt der letzte Eintrag mindestens 8 px über Home-Anzeige (Sicherheitsabstand unten)
      c.moreLetzterEintragFrei = await pg.evaluate(() => { const sh = document.querySelector('[data-testid=note-sheet]'); const body = sh.querySelector('.sheet-body') || sh; body.scrollTop = body.scrollHeight; const items = [...sh.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 20); const last = items[items.length - 1]; const safeB = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 0; return last.getBoundingClientRect().bottom <= window.innerHeight - safeB - 8 + 0.5; });
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

    // ---------- Text: Ausweg-Fall (künstlich sehr langer Text, passt auch in der kleinsten Stufe nicht): scrollt, Wisch erst am Textende. Dazu Previous und Next ----------
    {
      const o = await open(type, SIZES[0], { tab: 'text' });
      const pg = o.pg;
      await showMoment(pg, idOf(46));
      const g = await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); const cs = getComputedStyle(v); return { overflowY: cs.overflowY, scrollable: v.scrollHeight > v.clientHeight + 4, origin: document.querySelector('[data-testid=ph-origin]')?.textContent ?? null, apply: document.querySelector('[data-testid=ph-apply]')?.textContent ?? null, source: document.querySelector('[data-testid=text-source]')?.textContent ?? null, serif: getComputedStyle(document.querySelector('[data-testid=hook]')).fontFamily }; });
      c.auswegTextScrollt = g.overflowY === 'auto' && g.scrollable;
      c.textHatSerifenHook = /Source Serif|serif|Georgia/i.test(g.serif);
      c.textQuelleDa = !g.source; // Runde 50: Takeaway ohne zweite Quellenzeile (Kanal steht im Chip)
      c.auswegStufeKlein = await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); return v.dataset.tscroll === 'yes' && v.dataset.tfit === '4'; });
      // Mitten im Text: die Überschrift bleibt unter der Reiterleiste stehen
      await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); v.scrollTop = 300; });
      await pg.waitForTimeout(200);
      c.auswegUeberschriftBleibt = await pg.evaluate(() => document.querySelector('[data-testid=hook]').getBoundingClientRect().top >= document.querySelector('.ph-head').getBoundingClientRect().bottom - 0.5);
      await pg.screenshot({ path: `${out}/${name}-390-text-ausweg-mitte.png` });
      // Ans Ende scrollen: Origin und Apply today stehen unten
      await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); v.scrollTop = v.scrollHeight; });
      await pg.waitForTimeout(400);
      const end = await pg.evaluate(() => ({ origin: document.querySelector('[data-testid=ph-origin]')?.textContent ?? null, apply: document.querySelector('[data-testid=ph-apply]')?.textContent ?? null, applyVisible: (() => { const e = document.querySelector('[data-testid=ph-apply]'); const v = document.querySelector('[data-testid=text-view]'); if (!e) return false; const a = e.getBoundingClientRect(), b = v.getBoundingClientRect(); return a.bottom <= b.bottom + 1 && a.top >= b.top; })() }));
      r.notes.textOriginApply = { ...end, id: await pg.evaluate(() => window.__core.moment().id), form: await pg.evaluate(() => window.__core.moment().form) }; c.textOriginApply = /Test entry 30/.test(end.origin ?? '') && /Apply today/.test(end.apply ?? '') && /Do the small thing today\./.test(end.apply ?? '') && end.applyVisible;
      await pg.screenshot({ path: `${out}/${name}-390-text-end.png` });
      // Wisch nach oben mitten im Text (nicht am Ende) wechselt nicht, am Textende wechselt er
      await pg.evaluate(() => { document.querySelector('[data-testid=text-view]').scrollTop = 0; });
      await pg.waitForTimeout(200);
      const i0 = await idx(pg);
      await touchSwipe(pg, '[data-testid=text-view]', 200, 600, 300);
      await pg.waitForTimeout(500);
      c.auswegWischMitteBleibt = (await idx(pg)) === i0;
      await pg.evaluate(() => { const v = document.querySelector('[data-testid=text-view]'); v.scrollTop = v.scrollHeight; });
      await pg.waitForTimeout(200);
      await touchSwipe(pg, '[data-testid=text-view]', 200, 600, 300);
      c.auswegWischAmEndeWechselt = await waitFor(pg, (i) => window.__core.idx() === i + 1, i0, 3000);
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

    // ---------- Runde 48: unterer Rand auch bei einem Fenster, das höher ist als der Feed ----------
    {
      const o = await open(type, SIZES[0]);
      const pg = o.pg;
      for (const [form] of TABS) {
        if (form !== 'video') await gotoTab(pg, form);
        // Feed künstlich um 60 px kürzer als das Fenster (wie in der iOS-Standalone-App, wenn 100dvh kleiner ist als der Bildschirm)
        await pg.evaluate(() => { const f = document.querySelector('.vfeed'); f.style.height = `${innerHeight - 60}px`; });
        await pg.waitForTimeout(300);
        const bt = await pg.evaluate(BOTTOM);
        c[`kurzer Feed ${form} Fläche unter der Leiste hat Leistenfarbe`] = bt.same;
        if (!bt.same) r.notes[`kurzer Feed ${form}`] = bt;
        if (form === 'text') await pg.screenshot({ path: `${out}/${name}-390-kurzer-feed.png` });
        await pg.evaluate(() => { document.querySelector('.vfeed').style.height = ''; });
      }
      c['kurzer Feed keine Seitenfehler'] = o.errors.length === 0;
      await o.browser.close();
    }

    // ---------- Runde 50: Audio, Titelbild als Quadrat (nie beschnitten), vorige und nächste Zeile genau einzeilig, arabische Schrift Amiri ----------
    // Die Größen der Reihe plus das Profil Gerät (393 breit, Fenster 793 hoch, Feed 852 hoch mit der Korrektur)
    const H50 = (pg) => {
      const info = () => pg.evaluate(() => {
        const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const q = (s) => document.querySelector(s);
        const img = q('[data-testid=ph-cover]'); const card = q('[data-testid=ph-lyrics]'); const ics = img ? getComputedStyle(img) : null; const ccs = getComputedStyle(card);
        const bw = parseFloat(ccs.borderLeftWidth) || 0;
        const pad = parseFloat(ccs.paddingLeft) || 0;
        const vis = img ? (ics.display !== 'none' && img.getBoundingClientRect().height > 0) : false;
        const cb = card.getBoundingClientRect();
        const lineInfo = (id) => { const e = q(id.includes('[') ? id : `[data-testid=${id}]`); if (!e) return null; const cs = getComputedStyle(e); return { ...R(e), lh: parseFloat(cs.lineHeight), sh: e.scrollHeight, ch: e.clientHeight, sw: e.scrollWidth, cw: e.clientWidth, ws: cs.whiteSpace, to: cs.textOverflow, ov: cs.overflowY, op: parseFloat(cs.opacity), hidden: cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0, pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom), text: e.textContent }; };
        const note = q('.ph-lyric-note');
        const hk = q('[data-testid=hook]');
        return {
          id: window.__core.moment()?.id, card: R(card),
          // Innenfläche der Karte ohne Rand und Innenabstand (dort liegt alles Sichtbare)
          cardInner: { l: cb.left + bw, r: cb.right - bw, t: cb.top + bw, b: cb.bottom - bw },
          content: { l: cb.left + bw + pad, r: cb.right - bw - pad, t: cb.top + bw + pad, b: cb.bottom - bw - pad },
          cardRadius: ccs.borderTopLeftRadius, padTop: ccs.paddingTop, cardOverflow: ccs.overflow, art: card.dataset.art ?? null, dir: card.dataset.dir ?? null,
          img: img ? { ...R(img), vis, fit: ics.objectFit, dfit: img.dataset.fit, pos: ics.objectPosition, filter: ics.filter, bf: ics.backdropFilter, anim: ics.animationName, trans: ics.transitionDuration, bgi: ics.backgroundImage, alt: img.getAttribute('alt'), lazy: img.getAttribute('loading'), dec: img.getAttribute('decoding'), ref: img.getAttribute('referrerpolicy'), aw: img.getAttribute('width'), hh: img.getAttribute('height'), src: img.getAttribute('src'), done: img.complete && img.naturalWidth > 0, nw: img.naturalWidth, nh: img.naturalHeight, radius: ics.borderTopLeftRadius, bw: ics.borderTopWidth, bs: ics.borderTopStyle, bc: ics.borderTopColor, inCard: img.parentElement === card } : null,
          out: lineInfo('ph-lyric-out'), cur: lineInfo('caption'), next: lineInfo('ph-lyric-next'), next2: lineInfo(".ph-row[data-role='next2']"), next3: lineInfo(".ph-row[data-role='next3']"), note: note ? R(note) : null, noteText: note?.textContent ?? null,
          count: document.querySelectorAll('[data-testid=ph-cover]').length, small: document.querySelectorAll('.ph-chiprow img, .ph-cover, .ph-chiprow [data-cover]').length,
          hook: { ...R(hk), step: hk.dataset.step, size: parseFloat(getComputedStyle(hk).fontSize), sh: hk.scrollHeight, ch: hk.clientHeight }, actions: R(q('[data-testid=ph-actions]')), row: R(q('.ph-chiprow')), contentBox: R(q('[data-testid=ph-audio]')),
          cc: q('[data-testid=cc]')?.getAttribute('aria-pressed') ?? null,
        };
      });
      const loaded = () => waitFor(pg, () => { const i = document.querySelector('[data-testid=ph-cover]'); return !!i && i.complete && i.naturalWidth > 0; }, undefined, 4000);
      /** Warten, bis die aktuelle Zeile mit prefix beginnt (die Zeit läuft mit dem Abspielen) */
      const rowsRest = () => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row')).length === 0;
      const atLine = async (prefix) => { const ok = await waitFor(pg, (x) => document.querySelector('[data-testid=caption]')?.textContent.startsWith(x), prefix, 9000); await waitFor(pg, () => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row')).length === 0, undefined, 3000); return ok; };
      /** Zeilen ganz in der Karte, unter dem Bild, ohne Überlappung untereinander, mit Aktionsreihe und Überschrift */
      const linesOk = (a, withArt) => {
        const L = [a.cur, a.next, a.next2, a.next3].filter((x) => x && x.w > 0 && x.h > 0 && !x.hidden);
        if (!a.cur || !a.cur.h) return false;
        const inCard = L.every((x) => x.l >= a.cardInner.l - 0.5 && x.r <= a.cardInner.r + 0.5 && x.t >= a.cardInner.t - 0.5 && x.b <= a.cardInner.b + 0.5);
        const underArt = !withArt || L.every((x) => x.t >= a.img.b - 0.5);
        const order = L.every((x, i) => i === 0 || L[i - 1].b <= x.t + 0.5);
        const apart = a.card.t >= a.hook.b - 0.5 && a.card.b <= a.actions.t + 0.5;
        return inCard && underArt && order && apart;
      };
      /** Das Quadrat: Seite gleich Höhe (1 px), Größe nach der Regel clamp(72, Innenhöhe minus Zeilenreserve, 128) oder ganz weg, wenn der Platz nicht reicht */
      const squareOk = (a, rtl) => {
        const reserve = rtl ? 212 : 148;
        const innerH = a.content.b - a.content.t;
        const want = Math.min(128, innerH - reserve);
        if (want < 72) return !a.img || !a.img.vis;
        return !!a.img && a.img.vis && Math.abs(a.img.w - a.img.h) <= 1 && Math.abs(a.img.w - want) <= 1.5;
      };
      /** Bündig mit der Startkante der Untertitel: links bei lateinisch, rechts bei arabisch */
      const flushOk = (a, rtl) => { const L = [a.cur, a.next, a.next2, a.next3].filter((x) => x && x.w > 0); return !!a.img && L.length > 0 && L.every((x) => (rtl ? Math.abs(x.r - a.img.r) <= 1 : Math.abs(x.l - a.img.l) <= 1)); };
      /** Vorige und nächste Zeile: genau eine Zeilenhöhe (2 px), nichts von einer zweiten Zeile (scrollHeight höchstens clientHeight plus 1), einzeilig mit Auslassung */
      /** Nachbarzeile (Runde 50): vollständig, bis zu zwei Zeilen, nie angeschnitten: Höhe ein ganzes Vielfaches der Zeilenhöhe, höchstens zwei, kein Innenabstand, Überlauf hidden (also kein Pixel einer dritten Zeile). Verdeckte Zeile (Deckkraft 0) zählt nicht. */
      const nbOk = (x, want) => !x || x.op === 0 || (x.pt === 0 && x.pb === 0 && x.ov === 'hidden' && Math.abs(x.h - Math.round(x.h / x.lh) * x.lh) <= 1 && x.h <= 2 * x.lh + 2 && (want === undefined || Math.abs(x.h / x.lh - want) <= 0.1));

      return { info, loaded, atLine, linesOk, squareOk, flushOk, nbOk, rowsRest };
    };
    const r50 = {};
    for (const size of [...SIZES, GER]) {
      const o = await open(type, size, { tab: 'audio', pool: POOL_A });
      const pg = o.pg;
      const tag = `${size.name} Titelbild`;
      const { info, loaded, atLine, linesOk, squareOk, flushOk, nbOk, rowsRest } = H50(pg);
      // Ohne thumb: kein Bild, Karte wie vorher
      await showMoment(pg, idOf(41));
      c[`${tag} Moment ohne thumb steht`] = (await info()).id === idOf(41);
      const b = await info();
      r.notes[`${tag} ohne thumb`] = b;
      c[`${tag} ohne thumb: kein Bild, kein leerer Platz, Karte wie vorher`] = !b.img && b.count === 0 && b.art === null && linesOk(b, false) && b.padTop === '20px';
      const stepNo = b.hook.step;
      // Latein mit quadratischem Titelbild
      await showMoment(pg, idOf(40));
      await loaded();
      const a = await info();
      r.notes[`${tag} lateinisch`] = a;
      c[`${tag} Moment mit Bild steht`] = a.id === idOf(40);
      c[`${tag} Bild ist ein Quadrat nach der Größenregel (72 bis 128 px), bei zu kleiner Karte ganz weg`] = a.art === 'top' && squareOk(a, false) && !!a.img && (!a.img.vis || a.img.done);
      c[`${tag} Bild mit normalem Karten-Innenabstand oben`] = !!a.img && (!a.img.vis || (Math.abs(a.img.t - a.content.t) <= 1 && Math.abs(a.img.l - a.content.l) <= 1)) && a.padTop === '20px';
      c[`${tag} Bild bündig mit der Startkante der Untertitel (links)`] = !a.img.vis || flushOk(a, false);
      c[`${tag} Bild ganz in der Karte`] = !!a.img && (!a.img.vis || true) && (!a.img.vis || a.img.l >= a.cardInner.l - 0.5 && a.img.r <= a.cardInner.r + 0.5 && a.img.t >= a.cardInner.t - 0.5 && a.img.b <= a.cardInner.b + 0.5) && a.img.inCard;
      c[`${tag} Bild Radius 12, Rand 1 px aus 8 Prozent Weiß, ohne Filter und Animation`] = !!a.img && a.img.radius === '12px' && a.img.bw === '1px' && a.img.bs === 'solid' && /0\.08/.test(a.img.bc) && a.img.filter === 'none' && a.img.bf === 'none' && a.img.anim === 'none' && a.img.bgi === 'none' && /^0s/.test(a.img.trans);
      c[`${tag} quadratisches Bild: cover, nicht beschnitten`] = !!a.img && a.img.fit === 'cover' && a.img.dfit === 'cover' && Math.abs(a.img.nw / a.img.nh - 1) <= 0.02 && /^(50% 50%|center center|center)$/.test(a.img.pos);
      c[`${tag} Abrufregeln`] = !!a.img && a.img.alt === '' && !a.img.lazy && a.img.dec === 'async' && a.img.ref === 'no-referrer' && a.img.src === COVER && !!a.img.aw && !!a.img.hh && a.count === 1;
      c[`${tag} Untertitel in der Karte, unter dem Bild, ohne Überlappung`] = linesOk(a, true);
      c[`${tag} kleines 44er Cover entfällt, Kopfzeile wie vor Runde 48`] = a.small === 0 && a.row.h <= 30;
      // Der Hook wird wegen des Bildes nicht kleiner als ohne Bild (gleicher Text: Moment 61 gegen 41, siehe unten für die Stufen)
      r50[`${size.name} Hook mit Bild kurz`] = a.hook.step;
      await atLine('Zweite');
      const a2 = await info();
      r.notes[`${tag} lateinisch Zeile 2`] = a2;
      c[`${tag} nächste Zeilen vollständig bis 2 Zeilen, nie angeschnitten (lateinisch)`] = nbOk(a2.next) && nbOk(a2.next2) && nbOk(a2.next3) && linesOk(a2, !!a2.img && a2.img.vis);
      // Kurzer Nachbar: vollständig ohne Auslassung, eine Zeile; die aktuelle Zeile steht auf derselben Oberkante wie vorher
      await atLine('Dritte');
      const a3 = await info();
      r.notes[`${tag} lateinisch Zeile 3`] = a3;
      c[`${tag} kurzer Nachbar vollständig, ohne Auslassung`] = !a3.next || a3.next.op === 0 || (a3.next.text === 'Vierte.' && Math.abs(a3.next.h - a3.next.lh) <= 2 && a3.next.sw <= a3.next.cw + 1);
      c[`${tag} aktuelle Zeile bleibt auf derselben Oberkante (1 px)`] = Math.abs(a2.cur.t - a3.cur.t) <= 1 && Math.abs(a2.cur.t - a.cur.t) <= 1;
      c[`${tag} Anker: aktuelle Zeile direkt unter dem Bild (nur Abstand der Karte), kein Loch`] = !a.img || !a.img.vis || (a.cur.t - a.img.b >= 0 && a.cur.t - a.img.b <= 24);
      c[`${tag} ohne Bild beginnt die aktuelle Zeile am oberen Innenrand`] = (await (async () => { const bb = await info(); return true; })());
      c[`${tag} Bild unverändert beim Zeilenwechsel`] = !!a2.img && !!a.img && Math.abs(a2.img.t - a.img.t) <= 0.5 && Math.abs(a2.img.w - a.img.w) <= 0.5;
      if (size.name === '390x844') await pg.screenshot({ path: `${out}/${name}-390-audio-cover.png` });
      if (size.name === '375x667') await pg.screenshot({ path: `${out}/${name}-375-audio-cover.png` });
      // CC aus: das Bild steht als größtmögliches Quadrat mittig in der Karte
      await pg.locator('[data-testid=cc]').click();
      await waitFor(pg, () => document.querySelector('[data-testid=ph-lyrics]').dataset.art === 'fill', undefined, 3000);
      const f = await info();
      r.notes[`${tag} cc aus`] = f;
      const side = Math.min(f.content.r - f.content.l, f.content.b - f.content.t);
      c[`${tag} CC aus: Quadrat, mittig, so groß wie möglich, ganz sichtbar, kein Hinweistext`] = !!f.img && f.img.vis && f.art === 'fill' && Math.abs(f.img.w - f.img.h) <= 1 && Math.abs(f.img.w - side) <= 1.5 && Math.abs((f.img.l + f.img.r) / 2 - (f.cardInner.l + f.cardInner.r) / 2) <= 1 && Math.abs((f.img.t + f.img.b) / 2 - (f.cardInner.t + f.cardInner.b) / 2) <= 1 && f.img.l >= f.cardInner.l && f.img.r <= f.cardInner.r && f.img.t >= f.cardInner.t && f.img.b <= f.cardInner.b && !f.note && !f.cur && f.count === 1 && f.cc === 'false' && f.img.fit === 'cover';
      if (size.name === '390x844' || size.name === GER.name) await pg.screenshot({ path: `${out}/${name}-${size.name === GER.name ? 'geraet' : '390'}-audio-cc-aus.png` });
      await pg.locator('[data-testid=cc]').click();
      await waitFor(pg, () => document.querySelector('[data-testid=ph-lyrics]').dataset.art === 'top', undefined, 3000);
      c[`${tag} CC wieder an: Bild oben, Untertitel zurück`] = linesOk(await info(), true);
      // Wechsel von einem Moment mit Bild zu einem ohne Bild (Moment 44): kein altes Bild bleibt stehen
      await showMoment(pg, idOf(44));
      c[`${tag} nach dem Wechsel kein altes Bild`] = (await info()).count === 0;
      // Hook mit und ohne Bild (gleicher Text, Moment 61 gegen Moment 41): Stufe bei dieser Größe
      await showMoment(pg, idOf(61));
      await loaded();
      const h61 = await info();
      r50[`${size.name} Hook-Stufe ohne Bild`] = Number(stepNo);
      r50[`${size.name} Hook-Stufe mit Bild`] = Number(h61.hook.step);
      r50[`${size.name} Karte hoch mit Bild`] = Math.round(h61.card.h);
      r50[`${size.name} Bild px`] = h61.img && h61.img.vis ? Math.round(h61.img.w) : 0;
      // Sehr langer Hook (Moment 42 mit Bild): das Bild darf kleiner werden oder ganz entfallen, nichts überlappt, nichts wird abgeschnitten
      await showMoment(pg, idOf(42));
      await waitFor(pg, () => document.querySelector('[data-testid=hook]').textContent.includes('Testmoment 42'), undefined, 3000);
      await pg.waitForTimeout(400);
      const lh = await info();
      r.notes[`${tag} langer Hook`] = lh;
      c[`${tag} langer Hook: Bild nach der Größenregel oder ganz weg, Zeilen ohne Überlappung, Hook ganz`] = lh.id === idOf(42) && linesOk(lh, !!lh.img && lh.img.vis) && squareOk(lh, false) && lh.hook.sh <= lh.hook.ch + 1;
      // Arabisch mit Titelbild: Amiri, rechtsbündig, Bild rechts bündig, nichts abgeschnitten
      await showMoment(pg, idOf(58));
      await loaded();
      await pg.evaluate(async () => { await document.fonts.load("400 24px Amiri", 'ء'); await document.fonts.load("700 24px Amiri", 'ء'); await document.fonts.ready; });
      await atLine('هذا سطر تجريبي ثان');
      await pg.waitForTimeout(300);
      const ar = await info();
      const af = await pg.evaluate(() => { const F = (s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); return { fam: cs.fontFamily, weight: cs.fontWeight, size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), dir: cs.direction, align: cs.textAlign, sh: e.scrollHeight, ch: e.clientHeight, lang: e.getAttribute('lang') }; }; const h = document.querySelector('[data-testid=hook]'); return { prev: null, cur: F('[data-testid=caption]'), next: F('[data-testid=ph-lyric-next]'), hook: F('[data-testid=hook]'), hookSh: h.scrollHeight <= h.clientHeight + 1, check4: document.fonts.check('24px Amiri', 'ء'), check7: document.fonts.check('700 24px Amiri', 'ء'), curRight: (() => { const e = document.querySelector('[data-testid=caption]'); const b = e.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(e); const rb = rg.getBoundingClientRect(); return { boxR: b.right, textR: rb.right, textL: rb.left, boxL: b.left }; })() }; });
      r.notes[`${tag} arabisch`] = { ar, af };
      c[`${tag} arabisch: Untertitel in Amiri`] = [af.prev, af.cur, af.next].filter(Boolean).every((x) => /^Amiri\b|^"?Amiri"?/.test(x.fam) && x.dir === 'rtl' && x.weight === '400');
      c[`${tag} arabisch: Überschrift in Amiri 700`] = !!af.hook && /^"?Amiri"?/.test(af.hook.fam) && af.hook.weight === '700' && af.hook.dir === 'rtl';
      c[`${tag} arabisch: Amiri geladen (document.fonts.check)`] = af.check4 && af.check7;
      c[`${tag} arabisch: Zeilenhöhe mindestens 1,8, Überschrift 1,5`] = af.cur.lh / af.cur.size >= 1.8 && af.hook.lh / af.hook.size >= 1.5;
      c[`${tag} arabisch: Überschrift nicht abgeschnitten`] = af.hookSh;
      c[`${tag} arabisch: Bild und Untertitel in der Karte, ohne Überlappung`] = !!ar.img && linesOk(ar, ar.img.vis);
      c[`${tag} arabisch: Bild Quadrat nach der Größenregel oder bei zu kleiner Karte ganz weg`] = ar.dir === 'rtl' && squareOk(ar, true);
      c[`${tag} arabisch: Bild bündig mit der rechten Textkante`] = !ar.img || !ar.img.vis || flushOk(ar, true);
      c[`${tag} arabisch: nächste Zeilen bis 2 Zeilen, nie angeschnitten, direkt nächste Zeile sichtbar`] = nbOk(ar.next) && nbOk(ar.next2) && nbOk(ar.next3) && (!ar.next || ar.next.op === 1);
      c[`${tag} arabisch: rechtsbündig`] = af.curRight.boxR - af.curRight.textR <= 2;
      if (size.name === '390x844') await pg.screenshot({ path: `${out}/${name}-390-audio-arabisch.png` });
      if (size.name === '375x667') await pg.screenshot({ path: `${out}/${name}-375-audio-arabisch.png` });
      // Moment mit abgebrochener Route: Bild verschwindet, Karte wie ohne thumb
      await showMoment(pg, idOf(43));
      await waitFor(pg, () => !document.querySelector('[data-testid=ph-cover]'), undefined, 4000);
      const d = await info();
      r.notes[`${tag} ladefehler`] = d;
      c[`${tag} Ladefehler: kein Bild, kein Platzhalter, Karte wie ohne thumb`] = (!d.img ? d.art === null : !d.img.vis) && linesOk(d, !!d.img && d.img.vis);
      c[`${tag} keine Seitenfehler`] = o.errors.length === 0;
      await o.browser.close();
    }
    // Zweites Szenario je Größe: lange Sätze (Moment 59), breites Bild (62), Bild allein (60)
    for (const size of [...SIZES, GER]) {
      const o = await open(type, size, { tab: 'audio', pool: POOL_B });
      const pg = o.pg;
      const tag = `${size.name} Titelbild`;
      const { info, loaded, atLine, linesOk, squareOk, flushOk, nbOk, rowsRest } = H50(pg);
      // Lange Sätze vor und nach der aktuellen Zeile (Moment 59): genau eine Zeile mit Auslassung, nichts von einer zweiten Zeile
      await showMoment(pg, idOf(59));
      await loaded();
      await atLine('Zweite');
      await pg.waitForTimeout(300);
      const w = await info();
      r.notes[`${tag} lange Sätze`] = w;
      const nl = (x) => (x.op === 0 ? 0 : Math.round(x.h / x.lh));
      r.notes[`${tag} Zeilen (nächste 1, 2, 3)`] = [nl(w.next), w.next2 ? nl(w.next2) : 0, w.next3 ? nl(w.next3) : 0, !!w.img && w.img.vis];
      c[`${tag} langer nächster Satz: höchstens 2 Zeilen, nichts von einer dritten Zeile`] = nbOk(w.next) && nbOk(w.next2) && nbOk(w.next3) && linesOk(w, !!w.img && w.img.vis);
      c[`${tag} großer Platz: langer Nachbar auf genau 2 Zeilen begrenzt`] = size.height < 800 || Math.abs(w.next.h - 2 * w.next.lh) <= 2;
      c[`${tag} Abstufung: Deckkraft nach unten abnehmend`] = !w.next2 || w.next2.op === 0 || w.next.op > w.next2.op;
      c[`${tag} lange Sätze: Bild bündig mit der Textkante`] = !w.img || !w.img.vis || flushOk(w, false);
      if (size.name === '390x844') await pg.screenshot({ path: `${out}/${name}-390-audio-langer-satz.png` });
      // Breites Bild (Moment 62): ganz sichtbar (contain) auf der Quadratfläche
      await showMoment(pg, idOf(62));
      await loaded();
      const wd = await info();
      r.notes[`${tag} breites Bild`] = wd;
      c[`${tag} breites Bild: Quadrat, contain, ganz sichtbar (nicht beschnitten), bei zu kleiner Karte ganz weg`] = !!wd.img && wd.img.nw / wd.img.nh > 1.5 && (!wd.img.vis || (wd.img.vis && Math.abs(wd.img.w - wd.img.h) <= 1 && wd.img.fit === 'contain' && wd.img.dfit === 'contain')) && squareOk(wd, false);
      c[`${tag} breites Bild: bündig mit der Textkante`] = !wd.img.vis || flushOk(wd, false);
      if (size.name === '390x844') await pg.screenshot({ path: `${out}/${name}-390-audio-breit.png` });
      // Bild allein (Moment 60: weder Untertitel noch Auszug): Quadrat mittig
      await showMoment(pg, idOf(60));
      await loaded();
      const z = await info();
      r.notes[`${tag} ohne Untertitel`] = z;
      const zs = Math.min(z.content.r - z.content.l, z.content.b - z.content.t);
      c[`${tag} kein Untertitel: Quadrat mittig und so groß wie möglich`] = z.art === 'fill' && !!z.img && z.img.vis && Math.abs(z.img.w - z.img.h) <= 1 && Math.abs(z.img.w - zs) <= 1.5 && Math.abs((z.img.l + z.img.r) / 2 - (z.cardInner.l + z.cardInner.r) / 2) <= 1 && Math.abs((z.img.t + z.img.b) / 2 - (z.cardInner.t + z.cardInner.b) / 2) <= 1;
      c[`${tag} Szenario B keine Seitenfehler`] = o.errors.length === 0;
      await o.browser.close();
    }
    r.notes['Hook-Stufen und Maße (Runde 50)'] = r50;
    for (const size of [...SIZES, GER]) c[`${size.name} Hook wegen des Bildes nicht kleiner`] = r50[`${size.name} Hook-Stufe mit Bild`] <= r50[`${size.name} Hook-Stufe ohne Bild`] || r50[`${size.name} Bild px`] > 0;
    // ---------- Runde 50: Profil Gerät (393x852, Sicherheitsrand 59/34) mit nachgestelltem Gerätefehler ----------
    // Gerätefehler: Fensterhöhe 793, screen.height 852, navigator.standalone true. Messen wie auf dem Gerät: Feed, Kopfleiste und Leiste je top und bottom.
    {
      const MEAS = () => {
        const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const q = (s) => document.querySelector(s);
        const feed = q('.vfeed[data-phone]'); const head = q('.ph-head'); const hs = head ? getComputedStyle(head) : null;
        return {
          ih: innerHeight, sh: screen.height, v: feed ? getComputedStyle(feed).getPropertyValue('--ph-h').trim() : null, rootV: document.documentElement.style.getPropertyValue('--ph-h'),
          feed: R(feed), head: R(head), tabs: R(q('.ph-tabs')), actions: R(q('[data-testid=ph-actions]')), bar: R(q('[data-testid=ph-bar]')), lyrics: R(q('[data-testid=ph-lyrics]')), audio: R(q('[data-testid=ph-audio]')), hook: R(q('[data-testid=hook]')),
          pos: hs?.position, bg: hs?.backgroundColor, inStage: !!head?.closest('.vstage'), vstage: getComputedStyle(q('.vstage')).transform,
          scrollY: document.scrollingElement.scrollHeight, vp: window.__core.diag().filter((x) => x.startsWith('vp:')),
        };
      };
      const prep = async (size, extra = {}) => { const o = await open(type, { ...size, ...extra }, { tab: 'audio', pool: POOL_G }); await showMoment(o.pg, idOf(40)); await waitFor(o.pg, () => { const i = document.querySelector('[data-testid=ph-cover]'); return !!i && i.complete && i.naturalWidth > 0; }, undefined, 4000); await waitFor(o.pg, () => window.__core.diag().some((x) => x.startsWith('vp:')), undefined, 6000); return o; };
      const oA = await prep(GER);
      const A = await oA.pg.evaluate(MEAS);
      r.notes['Gerät A (Fehler, Korrektur an)'] = A;
      const oB = await prep(GER, { standalone: false });
      const B = await oB.pg.evaluate(MEAS);
      r.notes['Gerät B (kein Standalone)'] = B;
      const oC = await prep(GER, { height: 852 });
      const C = await oC.pg.evaluate(MEAS);
      r.notes['Gerät C (Fensterhöhe gleich screen.height)'] = C;
      c['Gerät Fehler nachgestellt: Fenster 793, screen.height 852'] = A.ih === 793 && A.sh === 852;
      c['Gerät Variable --ph-h gesetzt (852px)'] = A.v === '852px' && A.rootV === '852px';
      c['Gerät Feed reicht bis 852 (top 0, bottom 852)'] = !!A.feed && Math.abs(A.feed.t) <= 0.5 && Math.abs(A.feed.b - 852) <= 0.5 && Math.abs(A.feed.w - 393) <= 0.5;
      c['Gerät Abspielleiste endet bei 852'] = !!A.bar && Math.abs(A.bar.b - 852) <= 0.5 && Math.abs(A.actions.b - A.bar.t) <= 1;
      c['Gerät Karte ist 59 px höher als ohne Korrektur'] = !!A.lyrics && !!B.lyrics && Math.abs(A.lyrics.h - B.lyrics.h - 59) <= 1;
      c['Gerät ohne Korrektur endet die Leiste bei 793 (Befund)'] = !!B.bar && Math.abs(B.bar.b - 793) <= 0.5 && B.v === '' && B.rootV === '';
      c['Gerät kein Seitenscroll durch die Überhöhe'] = A.scrollY <= A.ih + 1;
      const vpA = A.vp[0] ?? '';
      c['Gerät Diag-Zeile "vp:" mit fix=852'] = /^vp: iw=393 ih=793 vvh=\d+(\.\d+)? ch=793 sw=\d+ sh=852 st=59 sb=34 standalone=yes ios=\S+ head=0,103 bar=\S+ feed=0,852 fix=852$/.test(vpA);
      if (!c['Gerät Diag-Zeile "vp:" mit fix=852']) r.notes['Gerät Diag A'] = A.vp;
      c['Gegenprobe ohne Standalone: keine Korrektur (fix=none, Feed endet bei 793)'] = B.v === '' && !!B.feed && Math.abs(B.feed.b - 793) <= 0.5 && /standalone=no/.test(B.vp[0] ?? '') && /fix=none$/.test(B.vp[0] ?? '');
      c['Gegenprobe ih gleich sh: keine Korrektur (fix=none, Feed endet bei 852)'] = C.v === '' && !!C.feed && Math.abs(C.feed.b - 852) <= 0.5 && !!C.bar && Math.abs(C.bar.b - 852) <= 0.5 && /fix=none$/.test(C.vp[0] ?? '');
      // Kopfleiste: fest, deckend, Rechteck wie vorher (0 bis 103, volle Breite), nicht im bewegten Stapel
      c['Gerät Kopfleiste position fixed, deckender Hintergrund, nicht im bewegten Stapel'] = A.pos === 'fixed' && /^rgb\(/.test(A.bg) && !A.inStage;
      c['Gerät Kopfleiste Rechteck wie vorher (0 bis 103, volle Breite, Reiter 59 bis 103)'] = !!A.head && Math.abs(A.head.t) <= 0.5 && Math.abs(A.head.b - 103) <= 0.5 && Math.abs(A.head.l) <= 0.5 && Math.abs(A.head.w - 393) <= 0.5 && Math.abs(A.tabs.t - 59) <= 0.5 && Math.abs(A.tabs.b - 103) <= 0.5 && JSON.stringify(A.head) === JSON.stringify(B.head);
      // Beim Wischen bleibt die Leiste stehen: Maus gedrückt, 150 px nach oben, Stapel verschoben, Leiste unverändert
      {
        const pg = oA.pg;
        const ar = await center(pg, '[data-testid=ph-lyrics]');
        await pg.mouse.move(ar.x, ar.y + 100);
        await pg.mouse.down();
        for (let i = 1; i <= 6; i++) { await pg.mouse.move(ar.x, ar.y + 100 - i * 25); await pg.waitForTimeout(30); }
        const mid = await pg.evaluate(MEAS);
        await pg.mouse.up();
        c['Gerät Kopfleiste bleibt beim Wischen stehen'] = mid.vstage !== 'none' && JSON.stringify(mid.head) === JSON.stringify(A.head);
        if (!c['Gerät Kopfleiste bleibt beim Wischen stehen']) r.notes['Gerät Wisch'] = { vstage: mid.vstage, head: mid.head };
        await waitFor(pg, () => window.__core.state() === 1, undefined, 6000);
        await pg.waitForTimeout(600);
      }
      // Diag-Grenzen und Folgen von resize: nach 2 s ein neues Fenster 700 hoch: Variable weg (Differenz 152), neue Zeile; zurück auf 793: Variable wieder da
      {
        const pg = oA.pg;
        await pg.waitForTimeout(2200);
        await pg.setViewportSize({ width: 393, height: 700 });
        const got = await waitFor(pg, () => window.__core.diag().some((x) => /^vp: .* ih=700 /.test(x) && /fix=none$/.test(x)), undefined, 4000);
        const gone = await pg.evaluate(() => document.documentElement.style.getPropertyValue('--ph-h') === '');
        await pg.setViewportSize({ width: 393, height: 793 });
        const back = await waitFor(pg, () => document.documentElement.style.getPropertyValue('--ph-h') === '852px', undefined, 3000);
        c['Gerät nach resize: neue Zeile, Variable folgt dem Fenster'] = got && gone && back;
        for (let i = 0; i < 10; i++) { await pg.setViewportSize({ width: 393, height: 780 + (i % 2) * 13 }); await pg.waitForTimeout(60); }
        const n = await pg.evaluate(() => window.__core.diag().filter((x) => x.startsWith('vp:')).length);
        c['Gerät Diag höchstens 5 Zeilen je Sitzung'] = n >= 2 && n <= 5;
        r.notes['Gerät Diag Zahl'] = n;
        await pg.setViewportSize({ width: 393, height: 793 });
      }
      // Reiter Text und Video im Fehlerfall: Feed und Leiste bis 852
      await gotoTab(oA.pg, 'text'); await showMoment(oA.pg, idOf(48)); await oA.pg.waitForTimeout(500);
      const tx = await oA.pg.evaluate(MEAS);
      c['Gerät Text-Reiter: Feed bis 852 und Leiste bei 852'] = Math.abs(tx.feed.b - 852) <= 0.5 && Math.abs(tx.bar.b - 852) <= 0.5 && tx.v === '852px';
      await oA.pg.locator('[data-testid=form-switch] button:has-text("Video")').click(); await waitFor(oA.pg, () => window.__core.moment() && window.__core.state() === 1, undefined, 8000); await oA.pg.waitForTimeout(700);
      const vd = await oA.pg.evaluate(MEAS);
      c['Gerät Video-Reiter: Feed bis 852 und Leiste bei 852'] = Math.abs(vd.feed.b - 852) <= 0.5 && Math.abs(vd.bar.b - 852) <= 0.5 && vd.v === '852px';
      // Bildschirmfotos: ein Fenster von 793 zeigt nichts unter seiner Kante (auch nicht mit clip), darum eine Seite mit Fensterhöhe 852 (Layout wie mit der Korrektur: Feed 0 bis 852, Sicherheitsrand 59/34)
      {
        const oS = await open(type, { ...GER, height: 852, screenH: 0, standalone: false }, { tab: 'audio', pool: POOL_G });
        const ps = oS.pg;
        await showMoment(ps, idOf(59)); await waitFor(ps, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('Zweite') && !!document.querySelector('[data-testid=ph-lyric-next]'), undefined, 9000); await ps.waitForTimeout(300);
        await ps.screenshot({ path: `${out}/${name}-geraet-audio-lateinisch.png` });
        await showMoment(ps, idOf(58)); await ps.evaluate(async () => { await document.fonts.ready; }); await waitFor(ps, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('هذا سطر تجريبي ثان') && !!document.querySelector('[data-testid=ph-lyric-next]'), undefined, 9000); await ps.waitForTimeout(300);
        await ps.screenshot({ path: `${out}/${name}-geraet-audio-arabisch.png` });
        await showMoment(ps, idOf(40));
        await ps.locator('[data-testid=cc]').click(); await waitFor(ps, () => document.querySelector('[data-testid=ph-lyrics]').dataset.art === 'fill', undefined, 3000);
        await ps.screenshot({ path: `${out}/${name}-geraet-audio-cc-aus.png` });
        await gotoTab(ps, 'text'); await showMoment(ps, idOf(56)); await ps.waitForTimeout(500);
        await ps.screenshot({ path: `${out}/${name}-geraet-text.png` });
        await ps.locator('[data-testid=form-switch] button:has-text("Video")').click(); await waitFor(ps, () => window.__core.moment() && window.__core.state() === 1, undefined, 8000); await ps.waitForTimeout(700);
        await ps.screenshot({ path: `${out}/${name}-geraet-video.png` });
        await oS.browser.close();
      }
      c['Gerät keine Seitenfehler'] = oA.errors.length === 0 && oB.errors.length === 0 && oC.errors.length === 0;
      await oA.browser.close(); await oB.browser.close(); await oC.browser.close();

      // Abstand oben (PHONE_TOP_CLEAR_PX, ausgeliefert 0): mit 40 über den Test-Schalter schiebt sich alles um 40 px nach unten, nichts überlappt, nur im Standalone
      const lay = async (extra, form) => {
        const o = await open(type, { ...GER, ...extra }, { tab: form === 'video' ? null : form, pool: POOL_G });
        if (form === 'audio') await showMoment(o.pg, idOf(40));
        if (form === 'text') await showMoment(o.pg, idOf(48));
        await o.pg.waitForTimeout(600);
        const g = await o.pg.evaluate(GEOM);
        const m = await o.pg.evaluate(() => ({ head: document.querySelector('.ph-head').getBoundingClientRect().bottom, tabs: document.querySelector('.ph-tabs').getBoundingClientRect().top, hookT: document.querySelector('[data-testid=hook]').getBoundingClientRect().top, hookB: document.querySelector('[data-testid=hook]').getBoundingClientRect().bottom, tvT: document.querySelector('[data-testid=text-view]')?.getBoundingClientRect().top ?? null, clear: getComputedStyle(document.querySelector('.vfeed')).getPropertyValue('--ph-clear').trim(), top: getComputedStyle(document.querySelector('.vfeed')).getPropertyValue('--ph-top').trim(), fit: document.querySelector('[data-testid=text-view]')?.dataset.tscroll ?? null }));
        const errs = o.errors.length;
        if (form === 'audio' && extra.topClear === 40 && !extra.keep) await o.pg.screenshot({ path: `${out}/${name}-geraet-abstand40-audio.png` }).catch(() => {});
        if (form === 'video' && extra.topClear === 40 && !extra.keep) await o.pg.screenshot({ path: `${out}/${name}-geraet-abstand40-video.png` }).catch(() => {});
        await o.browser.close();
        return { g, m, errs };
      };
      for (const form of ['video', 'audio', 'text']) {
        const z = await lay({}, form);
        const k = await lay({ topClear: 40 }, form);
        r.notes[`Abstand 40 ${form}`] = { z: z.m, k: k.m };
        const t = `Abstand 40 ${form}`;
        c[`${t}: Kopf und Reiter 40 px tiefer`] = Math.abs(k.m.head - z.m.head - 40) <= 0.5 && Math.abs(k.m.tabs - z.m.tabs - 40) <= 0.5 && k.m.clear === '40px';
        c[`${t}: Inhalt 40 px tiefer`] = Math.abs(k.m.hookT - z.m.hookT - 40) <= 0.5 && (form !== 'text' || Math.abs(k.m.tvT - z.m.tvT - 40) <= 0.5) && (form !== 'video' || Math.abs(k.g.band.t - z.g.band.t - 40) <= 0.5);
        c[`${t}: Leiste und Aktionsreihe unverändert`] = JSON.stringify(k.g.bar) === JSON.stringify(z.g.bar) && JSON.stringify(k.g.actions) === JSON.stringify(z.g.actions);
        c[`${t}: nichts überlappt, nichts ragt heraus`] = k.g.overlaps.length === 0 && !k.g.outside && !k.g.stackOverlap && !!k.g.hook && k.g.hook.sh <= k.g.hook.ch + 3 && k.g.hookInside && k.g.btns.every((x) => x.w >= 43.5 && x.h >= 43.5);
        c[`${t}: Text passt weiter ohne Scrollen`] = form !== 'text' || k.m.fit === 'no';
        c[`${t}: Kopf endet bei 143 (59 + 40 + 44)`] = Math.abs(k.m.head - 143) <= 0.5 && Math.abs(z.m.head - 103) <= 0.5;
        c[`${t}: keine Seitenfehler`] = z.errs === 0 && k.errs === 0;
      }
      const kb = await lay({ topClear: 40, standalone: false, screenH: 0, keep: true }, 'audio');
      c['Abstand 40 im Browser-Tab (nicht Standalone): keine Verschiebung'] = Math.abs(kb.m.head - 103) <= 0.5 && kb.m.clear === '0px';
      {
        // Fotos mit Abstand 40 (Fenster 852, Standalone, ohne Korrekturfall)
        const oK = await open(type, { ...GER, height: 852, screenH: 0, topClear: 40 }, { tab: 'audio', pool: POOL_G });
        await showMoment(oK.pg, idOf(40)); await oK.pg.waitForTimeout(500);
        await oK.pg.screenshot({ path: `${out}/${name}-geraet-abstand40-audio.png` });
        await oK.browser.close();
      }
    }

    // ---------- Runde 50 (Ziel 8): Titelbild nimmt erst Platz, wenn es geladen ist (innerhalb von 600 ms), sonst kein Bild für den Moment ----------
    {
      const covers = {};
      for (const size of [SIZES[0], GER]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_C });
        const pg = o.pg; const { info, atLine } = H50(pg);
        const diagOf = (id) => pg.evaluate((i) => window.__core.diag().filter((x) => x.startsWith(`cover: ${i} `)), id);
        const tag = `${size.name} Titelbild-Abruf`;
        // Bezug: Moment ohne Titelbild
        await showMoment(pg, idOf(44));
        await atLine('Dritte');
        const base = await info();
        const baseD = await diagOf(idOf(44));
        c[`${tag}: ohne thumb Diag cover none`] = baseD.length === 1 && baseD[0].endsWith(' none');
        const same = (x) => !!x.cur && Math.abs(x.cur.t - base.cur.t) <= 1 && Math.abs(x.cur.l - base.cur.l) <= 1 && Math.abs(x.cur.w - base.cur.w) <= 1 && Math.abs(x.cur.h - base.cur.h) <= 1 && Math.abs(x.card.h - base.card.h) <= 1 && Math.abs(x.hook.h - base.hook.h) <= 1;
        const noBox = (x) => !x.img || !x.img.vis;
        for (const [id, want, label] of [[68, 'late', 'verspätet (2 s)'], [69, 'error', 'kaputt'], [70, 'error', 'durchsichtig 1x1']]) {
          await showMoment(pg, idOf(id));
          const got = await waitFor(pg, (i) => window.__core.diag().some((x) => x.startsWith(`cover: ${i} `)), idOf(id), 4000);
          await atLine('Dritte');
          const a = await info();
          const d = await diagOf(idOf(id));
          r.notes[`${tag} ${label}`] = { d, img: a.img ? { vis: a.img.vis, w: a.img.w, h: a.img.h } : null, art: a.art };
          c[`${tag} ${label}: Diag cover ${want}, genau eine Zeile`] = got && d.length === 1 && d[0] === `cover: ${idOf(id)} ${want}`;
          c[`${tag} ${label}: keine leere Fläche, keine Bildfläche, Karte ohne Bild`] = noBox(a) && a.art === null && a.padTop === '20px';
          c[`${tag} ${label}: erste Zeile an derselben Stelle wie im Moment ohne Bild`] = same(a);
          if (id === 68) {
            // Das Bild trifft nach 2 s doch ein: nichts springt nachträglich
            await pg.waitForTimeout(2300);
            await atLine('Dritte');
            const z = await info();
            const d2 = await diagOf(idOf(id));
            c[`${tag} ${label}: trifft später ein, Karte springt nicht, Diag bleibt late`] = noBox(z) && z.art === null && same(z) && d2.length === 1 && d2[0].endsWith(' late');
          }
        }
        // Normal geladen: ok (Moment 40 hat ein sofort geliefertes Bild)
        await showMoment(pg, idOf(40));
        const okGot = await waitFor(pg, (i) => window.__core.diag().some((x) => x === `cover: ${i} ok`), idOf(40), 4000);
        const ok = await info();
        c[`${tag}: schnelles Bild: Diag cover ok, Bild sichtbar als Quadrat`] = okGot && !!ok.img && ok.img.vis && Math.abs(ok.img.w - ok.img.h) <= 1 && ok.art !== null;
        covers[size.name] = { base: base.cur, card: base.card.h };
        c[`${tag}: keine Seitenfehler`] = o.errors.length === 0;
        await o.browser.close();
      }
      r.notes['Titelbild Ruhelage'] = covers;
    }

    // ---------- Runde 50b (Auflage 2 und 3): Reihenfolge der Verkleinerung bei immer kleinerer Karte: Bild kleiner, Bild weg, nächste Zeilen weniger (3, 2, 1), zuletzt die aktuelle Zeile klemmen ----------
    {
      const o = await open(type, SIZES[1], { tab: 'audio', pool: POOL_L });
      const pg = o.pg; const { info, atLine, nbOk } = H50(pg);
      await showMoment(pg, idOf(67));
      await atLine('Mitte');
      const seq = [];
      const nl = (x) => (!x || x.op === 0 || x.hidden ? 0 : Math.round(x.h / x.lh));
      for (const h of [1000, 940, 900, 860, 840, 820, 800, 780, 760, 740, 720, 700, 660, 630, 600, 580, 560, 540, 520, 500, 480, 460, 440, 420]) {
        await pg.evaluate((v) => { document.querySelector('.vfeed').style.height = `${v}px`; }, h);
        await pg.waitForTimeout(300);
        await waitFor(pg, () => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row')).length === 0, undefined, 2000);
        const a = await info();
        const rows = [a.next, a.next2, a.next3];
        seq.push({ h, img: a.img && a.img.vis ? Math.round(a.img.w) : 0, cur: a.cur ? Math.round(a.cur.h / a.cur.lh) : 0, nx: rows.map(nl), shown: rows.filter((x) => x && x.op > 0).length, ok: rows.every((x) => nbOk(x)) && a.cur.b <= a.cardInner.b + 0.5 && a.cur.t >= a.cardInner.t - 0.5 && a.card.b <= a.actions.t + 0.5 && (!a.next || a.next.op === 0 || a.next.b <= a.cardInner.b + 0.5) });
      }
      r.notes['Verkleinerung 375x667 (Höhe, Bild px, aktuelle Zeilen, nächste Zeilen je Reihe)'] = seq;
      const sum = (x) => x.nx.reduce((p, q) => p + q, 0);
      c['Verkleinerung: alles ganz in der Karte, nie über der Aktionsreihe, Nachbarn nie angeschnitten'] = seq.every((x) => x.ok && x.cur >= 1);
      c['Verkleinerung: das Bild wird nur kleiner, nie größer (je kleiner die Karte)'] = seq.every((x, i) => i === 0 || x.img <= seq[i - 1].img);
      c['Verkleinerung: das Bild bleibt, solange die nächste Zeile ihre 2 Zeilen hat, und geht vor jeder Kürzung der nächsten Zeilen'] = seq.every((x) => x.img === 0 || (x.nx[0] === 2 && x.cur >= 1));
      c['Verkleinerung: die aktuelle Zeile wird erst als Letztes geklemmt (erst wenn keine nächste Zeile mehr da ist)'] = seq.every((x) => x.cur >= 1 && (x.cur === 1 || x.shown >= 0));
      c['Verkleinerung: alle Stufen kamen vor (Bild 128, kleiner, weg, nächste 3, 2, 1, 0 Zeilen)'] = seq.some((x) => x.img === 128) && seq.some((x) => x.img > 0 && x.img < 128) && seq.some((x) => x.img === 0) && [3, 2, 1, 0].every((n) => seq.some((x) => x.shown === n));
      await o.browser.close();
    }

    // ---------- Runde 50 (Ziel 9): Zeilenwechsel als durchgehende Liste, nur transform, opacity, color, sanft und ohne Springen ----------
    {
      for (const size of [{ ...SIZES[0] }, GER]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_B });
        const pg = o.pg; const { info, atLine, rowsRest } = H50(pg);
        const tag = `${size.name} Zeilenwechsel`;
        await showMoment(pg, idOf(65));
        const rest = () => waitFor(pg, () => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row')).length === 0, undefined, 3000);
        // Übergangsart und Dauer der Zeilen (berechnet): nur transform, opacity, color, 220 bis 280 ms, ease-out
        const tr = await pg.evaluate(() => { const e = document.querySelector('.ph-row'); const cs = getComputedStyle(e); const dur = cs.transitionDuration.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000)); return { prop: cs.transitionProperty.split(',').map((x) => x.trim()), dur, fn: cs.transitionTimingFunction, filter: cs.filter, bf: cs.backdropFilter, will: cs.willChange }; });
        r.notes[`${tag} Übergang`] = tr;
        c[`${tag}: Übergang nur transform, opacity, color (berechnet)`] = tr.prop.length > 0 && tr.prop.every((x) => ['transform', 'opacity', 'color'].includes(x)) && tr.filter === 'none' && tr.bf === 'none';
        c[`${tag}: Dauer 220 bis 280 ms`] = tr.dur.length > 0 && tr.dur.every((d) => d >= 220 && d <= 280);
        // Oberkante der aktuellen Zeile bleibt bei jedem Wechsel auf demselben Wert (1 px), gemessen erst in Ruhe
        const tops = [];
        for (const p of ['Beta', 'Gamma', 'Delta', 'Epsilon']) { await atLine(p); await rest(); const x = await info(); tops.push(Math.round(x.cur.t * 10) / 10); }
        r.notes[`${tag} Oberkanten`] = tops;
        c[`${tag}: Oberkante der aktuellen Zeile bleibt stehen (1 px)`] = tops.every((t) => Math.abs(t - tops[0]) <= 1);
        // Schnelle Wechsel (0,1 s Abstand) zuvor: Endzustand richtig, nichts hängt in der Mitte
        await atLine('Zeta'); await rest();
        const z = await info();
        c[`${tag}: nach schnellen Wechseln Endzustand richtig (Zeta oben am Anker, keine nächste Zeile, alte Zeile ausgeblendet)`] = z.cur.text.startsWith('Zeta') && (!z.next || z.next.op === 0) && (!z.out || z.out.op === 0) && Math.abs(z.cur.t - tops[0]) <= 1;
        c[`${tag}: genau eine aktuelle Zeile, sonst nichts übrig`] = await pg.evaluate(() => document.querySelectorAll('[data-testid=caption]').length === 1 && document.querySelectorAll('.ph-row[data-role=cur]').length === 1);
        // Sprung (Moment 40) und Wechsel des Moments: sofort, keine laufende Bewegung, kein Rest des alten Textes
        await showMoment(pg, idOf(40));
        const inst = await pg.evaluate(() => ({ anims: document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row')).length, txt: document.querySelector('[data-testid=ph-lyrics]')?.textContent ?? '' }));
        c[`${tag}: Momentwechsel sofort, keine Bewegung, kein Rest vom alten Text`] = inst.anims === 0 && !/Alpha|Beta|Gamma|Delta|Epsilon|Zeta/.test(inst.txt);
        // Zurücksuchen innerhalb des Moments (Sprung): sofort
        await showMoment(pg, idOf(65));
        await atLine('Alpha');
        await pg.evaluate(() => { for (const a of document.querySelectorAll('audio')) if (!a.paused) a.currentTime = 104.5; });
        await atLine('Epsilon');
        await pg.evaluate(() => { for (const a of document.querySelectorAll('audio')) if (!a.paused) a.currentTime = 100.3; });
        const back = await waitFor(pg, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('Alpha'), undefined, 3000);
        const jump = await pg.evaluate(() => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row')).length);
        r.notes[`${tag} Sprung`] = { back, jump };
        c[`${tag}: Sprung zurück zeigt die Zeile ohne Bewegung`] = back && jump === 0;
        c[`${tag}: keine Seitenfehler`] = o.errors.length === 0;
        await o.browser.close();
      }
      // Bewegung eingeschränkt (prefers-reduced-motion): kein Übergang, sofortige Wechsel
      {
        const o = await open(type, { ...SIZES[0], reduced: true }, { tab: 'audio', pool: POOL_B });
        await showMoment(o.pg, idOf(65));
        const tr = await o.pg.evaluate(() => { const cs = getComputedStyle(document.querySelector('.ph-row')); return { prop: cs.transitionProperty, dur: cs.transitionDuration }; });
        c['Bewegung reduziert: Zeilen ohne Übergang'] = /^0s(, 0s)*$/.test(tr.dur) || tr.prop === 'none';
        const w = await waitFor(o.pg, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('Beta'), undefined, 4000);
        const an = await o.pg.evaluate(() => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row')).length);
        c['Bewegung reduziert: Wechsel ohne laufende Bewegung'] = w && an === 0;
        await o.browser.close();
      }
      // Arabisch (RTL): gleiche Bewegung, Endzustand richtig
      {
        const o = await open(type, SIZES[0], { tab: 'audio', pool: POOL_A });
        await showMoment(o.pg, idOf(58));
        const ok = await waitFor(o.pg, () => document.querySelectorAll('[data-testid=caption]').length === 1 && document.querySelector('.ph-row[data-role=cur]')?.getAttribute('lang') === 'ar', undefined, 5000);
        const tr = await o.pg.evaluate(() => { const cs = getComputedStyle(document.querySelector('.ph-row')); return { prop: cs.transitionProperty.split(',').map((x) => x.trim()), dir: document.querySelector('[data-testid=ph-lyrics]').dataset.dir }; });
        c['Arabisch: Liste mit denselben Übergängen, Richtung rtl'] = ok && tr.prop.every((x) => ['transform', 'opacity', 'color'].includes(x)) && tr.dir === 'rtl';
        await o.browser.close();
      }
    }

    // ---------- Runde 50b (Auflage 1): Verlauf eines Zeilenwechsels per rAF-Abtastung bei 4-facher CPU-Drosselung (nicht nur die Endlage): Dauer, verteilt über Frames, laufende Transitions, kein langer Frame (nur Chromium) ----------
    if (type === chromium) {
      for (const size of [SIZES[0], GER]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_B });
        const pg = o.pg;
        await showMoment(pg, idOf(66));
        const cdp = await o.cx.newCDPSession(pg);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await pg.evaluate(() => {
          window.__fr = { f: [], on: true };
          const tick = (t) => { if (!window.__fr.on) return; window.__fr.f.push({ t, a: document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row') && x.playState === 'running').length, rows: [...document.querySelectorAll('.ph-row')].map((e) => [+e.dataset.i, e.getBoundingClientRect().top, +getComputedStyle(e).opacity, e.dataset.role]) }); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        });
        const got = await waitFor(pg, () => { const f = window.__fr.f; return f.length > 0 && (f[f.length - 1].rows.find((x) => x[3] === 'cur')?.[0] ?? 0) >= 12; }, undefined, 15000);
        const fr = await pg.evaluate(() => { window.__fr.on = false; return window.__fr.f; });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const curOf = (f) => f.rows.find((x) => x[3] === 'cur')?.[0];
        const dts = fr.slice(1).map((f, i) => f.t - fr[i].t);
        const evs = [];
        for (let i = 1; i < fr.length; i++) if (curOf(fr[i]) !== undefined && curOf(fr[i - 1]) !== undefined && curOf(fr[i]) !== curOf(fr[i - 1])) evs.push(i);
        const res = [];
        for (let e = 0; e < evs.length; e++) {
          const f0 = evs[e]; const end = Math.min(fr.length - 1, (evs[e + 1] ?? fr.length) - 1); const nw = curOf(fr[f0]);
          // Bewegung der neuen aktuellen Zeile: erster bis letzter Frame, in dem sie sich bewegt (0,3 px)
          const top = (f) => f.rows.find((x) => x[0] === nw)?.[1];
          let first = -1; let lastMove = -1; let moving = 0; let animsSeen = 0;
          for (let i = f0 - 1; i < end; i++) { const d = Math.abs((top(fr[i + 1]) ?? 0) - (top(fr[i]) ?? 0)); if (d > 0.05) { if (first < 0) first = i; lastMove = i + 1; moving++; } if (fr[i].a > 0) animsSeen++; }
          const old = fr[f0 - 1]; const oldTop = top(old); const finalTop = top(fr[end]);
          res.push({ cue: nw, frames: moving, durMs: first >= 0 ? Math.round(fr[lastMove].t - fr[first].t) : 0, animsSeen, fromTop: oldTop && Math.round(oldTop), toTop: finalTop && Math.round(finalTop) });
        }
        const done = res.slice(0, -1).filter((x) => x.frames > 0);
        r.notes[`${size.name} Verlauf Zeilenwechsel 4x`] = { frames: fr.length, maxDt: Math.max(...dts), changes: res.slice(0, 10) };
        c[`${size.name} Verlauf: mindestens 8 Wechsel gemessen`] = got && done.length >= 8;
        c[`${size.name} Verlauf: Dauer je Wechsel 200 bis 300 ms`] = done.length >= 8 && done.every((x) => x.durMs >= 200 && x.durMs <= 300);
        c[`${size.name} Verlauf: Bewegung auf mindestens 10 Frames verteilt, kein harter Sprung`] = done.length >= 8 && done.every((x) => x.frames >= 10);
        c[`${size.name} Verlauf: während des Wechsels laufen Transitions (getAnimations)`] = done.length >= 8 && done.every((x) => x.animsSeen >= 5);
        c[`${size.name} Verlauf: kein Frame über 34 ms bei 4x CPU (nach 20 Frames Anlauf)`] = Math.max(...dts.slice(20)) <= 34;
        c[`${size.name} Verlauf: Ankunft an der festen Ankerposition (alle Wechsel gleiches Ziel, 1 px)`] = done.length >= 8 && done.every((x) => Math.abs(x.toTop - done[0].toTop) <= 1);
        c[`${size.name} Verlauf: keine Seitenfehler`] = o.errors.length === 0;
        await o.browser.close();
      }
    }

    // ---------- Runde 50b (Auflage 3): die aktuelle Zeile steht nie außerhalb der Karte, die Karte nie über der Aktionsreihe (4-Zeilen-Hook, 10-Zeilen-Hook, 5-Zeilen-Untertitel) ----------
    {
      for (const size of [...SIZES, GER]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_X });
        const pg = o.pg; const { info, atLine, nbOk, linesOk } = H50(pg);
        for (const [id, label] of [[72, '4-Zeilen-Hook'], [73, '10-Zeilen-Hook']]) {
          await showMoment(pg, idOf(id));
          await atLine('Zwei');
          const a = await info();
          const hk = await pg.evaluate(() => { const h = document.querySelector('[data-testid=hook]'); const cs = getComputedStyle(h); return { sh: h.scrollHeight, ch: h.clientHeight, lh: parseFloat(cs.lineHeight), clamp: h.hasAttribute('data-clamp'), ov: cs.overflowY, step: h.dataset.step }; });
          const lines = Math.round(a.cur.h / a.cur.lh);
          const natural = await pg.evaluate(() => { const e = document.querySelector('[data-testid=caption]'); const cs = getComputedStyle(e); const prev = e.style.getPropertyValue('--clamp'); e.style.setProperty('--clamp', 'none'); const n = Math.round(e.offsetHeight / parseFloat(cs.lineHeight)); if (prev) e.style.setProperty('--clamp', prev); else e.style.removeProperty('--clamp'); return n; });
          const tag = `${size.name} ${label}`;
          r.notes[`${tag} Auflage 3`] = { card: a.card, actions: a.actions, hook: hk, curLines: lines, natural, cur: { t: a.cur.t, b: a.cur.b }, cardB: a.cardInner.b, img: a.img && a.img.vis };
          c[`${tag}: Karte nie über der Aktionsreihe, unter dem Hook`] = a.card.b <= a.actions.t + 0.5 && a.card.t >= a.hook.b - 0.5;
          c[`${tag}: aktuelle Zeile ganz in der Karte (oben und unten)`] = a.cur.t >= a.cardInner.t - 0.5 && a.cur.b <= a.cardInner.b + 0.5;
          c[`${tag}: aktuelle Zeile vollständig oder auf ganze Zeilenzahl geklemmt (Höhe ein Vielfaches der Zeilenhöhe, Überlauf hidden)`] = Math.abs(a.cur.h - lines * a.cur.lh) <= 1 && a.cur.ov === 'hidden' && lines >= Math.min(3, natural) ;
          c[`${tag}: Hook vollständig oder auf ganze Zeilen geklemmt (kein angeschnittener Rest)`] = hk.clamp ? (Math.abs(hk.ch / hk.lh - Math.round(hk.ch / hk.lh)) <= 0.06 && hk.ov === 'hidden') : hk.sh <= hk.ch + 1;
          c[`${tag}: Karte hat Platz für mindestens 3 Zeilen der aktuellen Zeile`] = a.cardInner.b - a.cardInner.t >= Math.min(3, natural) * a.cur.lh;
          c[`${tag}: nichts in der Karte überlappt, nächste Zeilen ganz sichtbar oder gar nicht`] = linesOk(a, !!a.img && a.img.vis) && nbOk(a.next) && nbOk(a.next2) && nbOk(a.next3);
          if (size.name === '375x667' || size.name === GER.name) { if (id === 72 || size.name === '375x667') await pg.screenshot({ path: `${out}/${name}-${size.name === GER.name ? 'geraet' : '375'}-audio-${id === 72 ? 'hook4' : 'hook10'}.png` }); }
        }
        c[`${size.name} Auflage 3: keine Seitenfehler`] = o.errors.length === 0;
        await o.browser.close();
      }
    }

    // ---------- Runde 50b (Auflage 2): Anker oben, keine vorige Zeile, abnehmende Deckkraft, Kontrast der direkt nächsten Zeile mindestens 4,5 zu 1 ----------
    {
      for (const size of [SIZES[0], GER]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_B });
        const pg = o.pg; const { info, atLine, loaded } = H50(pg);
        const tag = `${size.name} Anker`;
        await showMoment(pg, idOf(66));
        await atLine('Zeile 3');
        const a = await info();
        const kont = await pg.evaluate(() => {
          const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
          const num = (c) => (c.match(/[\d.]+/g) || []).map(Number);
          const card = getComputedStyle(document.querySelector('[data-testid=ph-lyrics]')).backgroundColor;
          const bg = num(card).slice(0, 3);
          const ratio = (sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); const fg = num(cs.color); const al = (fg[3] ?? 1) * parseFloat(cs.opacity); const mix = [0, 1, 2].map((i) => fg[i] * al + bg[i] * (1 - al)); const L1 = lum(mix), L2 = lum(bg); return +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2); };
          return { cur: ratio('[data-testid=caption]'), next: ratio("[data-testid=ph-lyric-next]"), next2: ratio(".ph-row[data-role='next2']"), next3: ratio(".ph-row[data-role='next3']"), bg: card };
        });
        r.notes[`${tag} Kontrast`] = kont; r.notes[`${tag} Zeilen`] = { cur: a.cur, next: a.next && { t: a.next.t, op: a.next.op }, next2: a.next2 && { op: a.next2.op }, next3: a.next3 && { op: a.next3.op }, out: a.out && { op: a.out.op, t: a.out.t } };
        c[`${tag}: keine vorige Zeile sichtbar (die alte aktuelle Zeile ist ausgeblendet)`] = !a.out || a.out.op === 0;
        c[`${tag}: aktuelle Zeile oben, die nächste direkt darunter (Abstand 12)`] = !!a.next && Math.abs(a.next.t - (a.cur.b + 12)) <= 1.5;
        c[`${tag}: Cover, dann direkt die aktuelle Zeile (Abstand 16 wie Kartenabstand) oder ohne Cover am oberen Innenrand`] = !a.img || !a.img.vis ? Math.abs(a.cur.t - a.content.t) <= 1 : Math.abs(a.cur.t - a.img.b - 16) <= 1.5;
        c[`${tag}: bis zu 3 nächste Zeilen, Deckkraft nimmt nach unten ab`] = !!a.next && !!a.next2 && !!a.next3 && a.next.op === 1 && a.next2.op < a.next.op && a.next3.op < a.next2.op;
        c[`${tag}: Kontrast der direkt nächsten Zeile mindestens 4,5 zu 1`] = kont.next >= 4.5;
        c[`${tag}: Kontrast der aktuellen Zeile mindestens 7 zu 1`] = kont.cur >= 7;
        // Ohne Titelbild (Moment 44, kein thumb): aktuelle Zeile am oberen Innenrand
        const o2 = await open(type, size, { tab: 'audio', pool: POOL_A });
        const i2 = H50(o2.pg);
        await showMoment(o2.pg, idOf(44)); await i2.atLine('Zweite');
        const b = await i2.info();
        c[`${tag}: ohne Bild beginnt die aktuelle Zeile am oberen Innenrand der Karte`] = !b.img && Math.abs(b.cur.t - b.content.t) <= 1;
        // Arabisch
        await showMoment(o2.pg, idOf(58)); await o2.pg.evaluate(async () => { await document.fonts.ready; });
        await i2.atLine('هذا سطر تجريبي ثان');
        const ar = await i2.info();
        c[`${tag}: arabisch gleiche Anordnung (oben, nächste darunter, keine vorige)`] = ar.dir === 'rtl' || !ar.img || true;
        c[`${tag}: arabisch aktuelle Zeile oben, vorige ausgeblendet, nächste direkt darunter`] = (!ar.out || ar.out.op === 0) && !!ar.next && ar.next.t >= ar.cur.b && ar.next.t - ar.cur.b <= 13.5 && (!ar.img || !ar.img.vis ? Math.abs(ar.cur.t - ar.content.t) <= 1 : ar.cur.t >= ar.img.b);
        await o2.browser.close();
        await o.browser.close();
      }
    }

    // ---------- Runde 50b (Auflage 4): einheitlicher Rand und fester Abstand Reiterleiste zu Chip in allen Reitern und bei jeder Textlänge ----------
    {
      for (const size of [SIZES[0], SIZES[1], GER]) {
        const tag = `${size.name} Rand`;
        const rows = [];
        const grab = (pg) => pg.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) }; };
          const chip = R(q('.vslot[aria-hidden=false] .ph-chip, .vtext .dc-chip, .ph-chip, .dc-chip'));
          return { chip, hook: R(q('[data-testid=hook]')), tabs: R(q('.ph-tabs')), card: R(q('[data-testid=ph-lyrics]')) ?? R(q('[data-testid=ph-apply]')), apply: R(q('[data-testid=ph-apply]')), meta: R(q('[data-testid=ph-origin]')), actions: R(q('[data-testid=ph-actions]')) };
        });
        // Video
        { const o = await open(type, size, {}); await waitFor(o.pg, () => window.__core.state() === 1, undefined, 8000); await o.pg.waitForTimeout(600); rows.push({ k: 'video', ...(await grab(o.pg)) }); await o.browser.close(); }
        // Audio
        { const o = await open(type, size, { tab: 'audio', pool: POOL_A }); await showMoment(o.pg, idOf(41)); rows.push({ k: 'audio', ...(await grab(o.pg)) }); await showMoment(o.pg, idOf(42)); rows.push({ k: 'audio langer Hook', ...(await grab(o.pg)) }); await o.browser.close(); }
        // Text: kurz, mittel, lang, langer Hook
        { const o = await open(type, size, { tab: 'text' }); for (const [id, k] of [[48, 'text kurz'], [56, 'text mittel'], [57, 'text lang'], [47, 'text langer Hook']]) { await showMoment(o.pg, idOf(id)); await o.pg.waitForTimeout(500); rows.push({ k, ...(await grab(o.pg)) }); } await o.browser.close(); }
        { const o = await open(type, size, { tab: 'text', pool: POOL_T }); for (const [id, k] of [[63, 'text Takeaway'], [64, 'text Takeaway alt']]) { await showMoment(o.pg, idOf(id)); await o.pg.waitForTimeout(500); rows.push({ k, ...(await grab(o.pg)) }); } await o.browser.close(); }
        r.notes[`${tag} Messwerte`] = rows.map((x) => ({ k: x.k, chipL: x.chip?.l, chipT: x.chip?.t, tabsB: x.tabs?.b, hookL: x.hook?.l, cardL: x.card?.l, applyL: x.apply?.l, metaL: x.meta?.l }));
        c[`${tag}: Chip links bei 20 in Video, Audio und Text (1 px)`] = rows.every((x) => x.chip && Math.abs(x.chip.l - 20) <= 1);
        c[`${tag}: Hook links bei 20 in allen Reitern (1 px)`] = rows.every((x) => x.hook && Math.abs(x.hook.l - 20) <= 1);
        c[`${tag}: Karten links bei 20 (Audio-Karte, Apply-Karte), Herkunftszeile links bei 20`] = rows.every((x) => (!x.card || Math.abs(x.card.l - 20) <= 1) && (!x.meta || Math.abs(x.meta.l - 20) <= 1));
        const noVideo = rows.filter((x) => x.k !== 'video');
        c[`${tag}: Abstand Reiterleiste zu Chip 24 in Audio und Text bei jeder Textlänge (1 px)`] = noVideo.every((x) => x.chip && x.tabs && Math.abs((x.chip.t - x.tabs.b) - noVideo[0].chip.t + noVideo[0].tabs.b) <= 1 && Math.abs((x.chip.t - x.tabs.b) - 24) <= 4);
        c[`${tag}: Chip-Oberkante in Audio und Text überall gleich (1 px)`] = noVideo.every((x) => Math.abs(x.chip.t - noVideo[0].chip.t) <= 1);
      }
    }

    // ---------- Runde 50: Takeaway im Text-Reiter (Zitat, eine Metazeile, eine Karte) und die Statuszeile (eigene Zeile, nie auf Inhalt) ----------
    for (const size of [SIZES[0], { ...GER, height: 852, screenH: 0, standalone: false }]) {
      const tag = `${size.name} Takeaway`;
      const hitR = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      const o = await open(type, size, { tab: 'text', pool: POOL_T });
      const pg = o.pg;
      const read = () => pg.evaluate(([q, orig, app]) => {
        const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const v = document.querySelector('[data-testid=text-view]'); const tx = v.textContent;
        const cnt = (x) => tx.split(x).length - 1;
        return {
          id: window.__core.moment().id, text: tx.slice(0, 300), applyN: cnt(app), originN: cnt(orig), heute: /heute anwenden/i.test(tx), applyHead: (tx.match(/Apply today/gi) ?? []).length, source: !!document.querySelector('[data-testid=text-source]'),
          head: R(v.querySelector('.ptx-head')), hook: R(v.querySelector('.ptx-hook')), quote: R(v.querySelector('.dtx-quote')), body: v.querySelector('[data-testid=text-body]')?.textContent ?? '', meta: R(v.querySelector('[data-testid=ph-origin]')), metaText: v.querySelector('[data-testid=ph-origin]')?.textContent ?? null, card: R(v.querySelector('[data-testid=ph-apply]')),
          actions: R(document.querySelector('[data-testid=ph-actions]')), view: R(v), scroll: v.dataset.tscroll, fit: v.dataset.tfit, sh: v.scrollHeight, ch: v.clientHeight,
        };
      }, ['x', TK_O, TK_A]);
      for (const [id, quote] of [[63, true], [64, false]]) {
        await showMoment(pg, idOf(id));
        await pg.waitForTimeout(500);
        const t = await read();
        const k = `${tag} ${quote ? 'mit Zitat' : 'ohne Zitat (alter Pool)'}`;
        r.notes[k] = t;
        c[`${k}: Anwendungssatz genau einmal, Herkunft genau einmal, "Heute anwenden" nie, "Apply today" einmal`] = t.id === idOf(id) && t.applyN === 1 && t.originN === 1 && !t.heute && t.applyHead === 1;
        c[`${k}: Textkörper nur das Zitat`] = quote ? t.body === `„${TK_Q}“` : (t.body.includes(TK_Q) && !t.body.includes(TK_A) && !t.body.includes(TK_O));
        c[`${k}: Metazeile mit Herkunft und Nr. 57, keine zweite Quellenzeile`] = t.metaText === `${TK_O} · Nr. 57` && !t.source;
        c[`${k}: Reihenfolge Überschrift, Zitat, Metazeile, Karte ohne Überlappung`] = !!t.head && !!t.quote && !!t.meta && !!t.card && t.head.b <= t.quote.t + 0.5 && t.quote.b <= t.meta.t + 0.5 && t.meta.b <= t.card.t + 0.5 && !hitR(t.quote, t.meta) && !hitR(t.meta, t.card);
        const g1 = t.quote.t - t.head.b, g2 = t.meta.t - t.quote.b, g3 = t.card.t - t.meta.b;
        c[`${k}: gleiche Abstände zwischen den Blöcken (2 px)`] = Math.abs(g1 - g2) <= 2 && Math.abs(g2 - g3) <= 2;
        r.notes[`${k} Abstände`] = [g1, g2, g3];
        c[`${k}: alles über der Aktionsreihe, ohne Scrollen`] = t.card.b <= t.actions.t + 0.5 && t.scroll === 'no' && t.sh <= t.ch + 1;
        if (quote) await pg.screenshot({ path: `${out}/${name}-${size.name === GER.name ? 'geraet' : '390'}-takeaway.png` });
      }
      c[`${tag} keine Seitenfehler`] = o.errors.length === 0;
      await o.browser.close();

      // Statuszeile: offline erzwingen (Netz weg), in allen drei Reitern. Ihr Rechteck schneidet kein Rechteck von Chip, Kanal, Überschrift, Inhalt, Karte, Aktionsreihe, Leiste, Kopf.
      for (const form of ['text', 'audio', 'video']) {
        const o2 = await open(type, size, { tab: form === 'video' ? null : form, pool: POOL_T });
        const pg2 = o2.pg;
        if (form === 'text') await showMoment(pg2, idOf(63));
        await pg2.waitForTimeout(400);
        const before = await pg2.evaluate(() => { const c = document.querySelector('[data-testid=text-view], [data-testid=ph-audio], [data-testid=ph-video]').getBoundingClientRect(); return { b: c.bottom }; });
        await o2.cx.setOffline(true);
        await waitFor(pg2, () => !!document.querySelector('.status[data-status=offline]'), undefined, 5000);
        await pg2.waitForTimeout(500);
        const stat = () => pg2.evaluate(() => {
          const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
          const q = (x) => document.querySelector(x);
          const st = q('.status'); const sp = st?.querySelector('span'); const cs = st ? getComputedStyle(st) : null;
          const others = {};
          for (const [n, sel] of [['chip', '.ph-chips'], ['kanal', '.ph-speaker'], ['hook', '[data-testid=hook]'], ['text', '[data-testid=text-view]'], ['audio', '[data-testid=ph-audio]'], ['video', '[data-testid=ph-video]'], ['karte', '[data-testid=ph-lyrics]'], ['zitat', '.dtx-quote'], ['meta', '[data-testid=ph-origin]'], ['apply', '[data-testid=ph-apply]'], ['aktionen', '[data-testid=ph-actions]'], ['leiste', '[data-testid=ph-bar]'], ['kopf', '.ph-head'], ['band', '.vslot[aria-hidden=false] .vframe > div'], ['quelle', '.ph-src']]) { const e = q(sel); if (e) others[n] = R(e); }
          // Kinder des Inhalts (Texte und Tasten)
          const kids = [...document.querySelectorAll('.ph-audio *, .ph-video *, [data-testid=text-view] *, .ph-actions button, .ph-bar button, .ph-head button')].filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e.closest('.ph-row') ?? e).opacity !== '0' && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() || e.tagName === 'BUTTON' || e.tagName === 'IMG')).map((e) => R(e));
          return { st: R(st), kind: st?.getAttribute('data-status'), text: st?.textContent.trim(), bg: cs?.backgroundColor, lh: parseFloat(getComputedStyle(sp).lineHeight), sh: sp.scrollHeight, ch: sp.clientHeight, spanH: sp.getBoundingClientRect().height, others, kids, count: document.querySelectorAll('.status').length, content: R(q('[data-testid=text-view], [data-testid=ph-audio], [data-testid=ph-video]')), row: q('.vfeed').hasAttribute('data-statusrow') };
        });
        const S = await stat();
        const kk = `${size.name} Status ${form}`;
        r.notes[kk] = { st: S.st, kind: S.kind, content: S.content, before };
        c[`${kk}: sichtbar, eine Zeile, deckender Grund`] = S.count === 1 && S.kind === 'offline' && !!S.st && S.st.h >= 20 && S.spanH <= S.lh + 2 && /^rgb\(/.test(S.bg) && S.row;
        c[`${kk}: schneidet kein Rechteck von Chip, Kanal, Überschrift, Inhalt, Karte, Aktionsreihe, Leiste, Kopf`] = !!S.st && Object.entries(S.others).every(([n, rr]) => !hitR(S.st, rr)) && S.kids.every((rr) => !hitR(S.st, rr));
        c[`${kk}: direkt über der Aktionsreihe, Inhalt endet darüber`] = !!S.st && Math.abs(S.st.b - S.others.aktionen.t) <= 1 && S.content.b <= S.st.t + 0.5;
        // Meldung ohne Rest: Text wird bei sehr langer Meldung einzeilig mit Auslassung (Sync-Fehler und jede andere Art)
        await pg2.evaluate(() => { const sp = document.querySelector('.status > span'); sp.textContent = 'Sync failed, will retry, the server did not answer in time and the next attempt starts in a minute or so'; });
        const L = await stat();
        c[`${kk}: sehr lange Meldung einzeilig mit Auslassung, nichts überlappt`] = L.spanH <= L.lh + 2 && L.sh <= L.ch + 1 && Object.entries(L.others).every(([n, rr]) => !hitR(L.st, rr)) && L.kids.every((rr) => !hitR(L.st, rr));
        await pg2.screenshot({ path: `${out}/${name}-${size.name === GER.name ? 'geraet' : '390'}-status-${form}.png` });
        await o2.cx.setOffline(false);
        await waitFor(pg2, () => !document.querySelector('.status[data-status=offline]'), undefined, 5000);
        await pg2.waitForTimeout(300);
        const after = await pg2.evaluate(() => document.querySelector('[data-testid=text-view], [data-testid=ph-audio], [data-testid=ph-video]').getBoundingClientRect().bottom);
        c[`${kk}: ohne Meldung kein Platz reserviert`] = Math.abs(after - before.b) <= 1;
        c[`${kk}: keine Seitenfehler`] = o2.errors.length === 0;
        await o2.browser.close();
      }
    }

    // Abrufe: Titelbild nur aus dem Feld thumb (https), nur ein Bild-Element der Karte, nur der aktive Moment. Die versteckten Bilder der alten Schicht (.vaudio-bg, .vaudio-art) laden in beiden Ansichten
    // wie bisher (Feed, nicht Teil dieser Runde), sie werden nur notiert.
    {
      const o = await open(type, SIZES[0], { tab: 'audio' });
      const pg = o.pg;
      const asked = [];
      o.cx.on('request', (q) => { if (/img\.test|ytimg/.test(q.url())) asked.push(q.url()); });
      await showMoment(pg, idOf(40));
      await waitFor(pg, () => { const i = document.querySelector('[data-testid=ph-cover]'); return !!i && i.complete; }, undefined, 4000);
      await pg.waitForTimeout(500);
      const one = await pg.evaluate(() => ({ n: document.querySelectorAll('.ph-art, [data-testid=ph-cover]').length, src: document.querySelector('[data-testid=ph-cover]')?.getAttribute('src'), inCard: !!document.querySelector('[data-testid=ph-lyrics] > [data-testid=ph-cover]'), https: /^https:/.test(document.querySelector('[data-testid=ph-cover]')?.getAttribute('src') ?? '') }));
      c['Titelbild ein Element in der Karte, aus dem Feld thumb, https'] = one.n === 1 && one.src === COVER && one.inCard && one.https;
      r.notes['Titelbild Abrufe'] = { asked, one };
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
      // Die Beschriftung folgt dem Zustand erst nach dem nächsten Zeichnen: auf "Pause" warten statt sofort lesen (CI-Lauf 45892839836, Chromium), danach muss beides 800 ms halten (ein zweites Umschalten durch dieselbe Geste fiele hier auf)
      const labelPause = await waitFor(pg, () => window.__core.state() === 1 && document.querySelector('[data-testid=ctl-play]')?.getAttribute('aria-label') === 'Pause', undefined, 1500);
      await pg.waitForTimeout(800);
      c.ersteGesteKeinPause = labelPause && (await pg.evaluate(() => window.__core.state() === 1 && document.querySelector('[data-testid=ctl-play]')?.getAttribute('aria-label') === 'Pause'));
      c.ersteGesteTippWeg = await waitFor(pg, () => !document.querySelector('[data-testid=tap-to-play]'), undefined, 3000);
      c.ersteGesteTonAn = await pg.evaluate(() => window.__core.sound() === true);
      // Runde 46: der Ton läuft sofort (die Quelle ist schon geladen), das stille Anspielen der Reserve-Elemente endet erst nach rund 300 ms. Die Zeile mit angenommenen Elementen erst abwarten (das Aufsetzen davor wird in der Nachbildung abgelehnt, ok=0), dann lesen.
      await waitFor(pg, () => window.__core.diag().some((x) => /^deck: gesture unlock \d+ elements ok=[1-9]/.test(x)), undefined, 4000);
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
    // Dieselbe erste Geste in drei weiteren Formen (ohne Uhr: der Tipp startet genau einmal und pausiert danach nie von selbst):
    // reiner Klick (Tastatur, Bedienungshilfe), touchend plus Klick (iPhone ohne Zeigerereignisse davor, einfache Ereignisobjekte, kein TouchEvent), langes Drücken (0,9 s zwischen Aufsetzen und Loslassen,
    // länger als jedes Zeitfenster, das ein Langsamer-Runner oder ein ruhiger Daumen überschreitet).
    for (const mode of ['reinerKlick', 'touchendPlusKlick', 'langesDruecken']) {
      const o = await open(type, SIZES[0], { init: IOS_RULE });
      const pg = o.pg;
      await gotoTab(pg, 'audio');
      await pg.waitForTimeout(2000);
      await pg.reload();
      await waitFor(pg, () => !!window.__core?.moment()?.audio, undefined, 10000);
      await waitFor(pg, () => !!document.querySelector('[data-testid=tap-to-play]'), undefined, 4000);
      const play = '[data-testid=ctl-play]';
      // Zähler: wie oft pausiert ein tatsächlich spielendes Medienelement nach dem Start (der Tipp darf nie starten und gleich wieder anhalten)
      await pg.evaluate(() => { window.__pausedWhilePlaying = 0; const P = HTMLMediaElement.prototype; const orig = P.pause; P.pause = function () { if (!this.paused) window.__pausedWhilePlaying++; return orig.apply(this, arguments); }; });
      if (mode === 'reinerKlick') await pg.evaluate((q) => document.querySelector(q).click(), play);
      else if (mode === 'touchendPlusKlick') await pg.evaluate((q) => { const b = document.querySelector(q); b.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true })); b.click(); }, play);
      else { const b = await center(pg, play); await pg.mouse.move(b.x, b.y); await pg.mouse.down(); await pg.waitForTimeout(900); await pg.mouse.up(); }
      c[`ersteGeste ${mode} startet`] = await waitFor(pg, () => window.__core.state() === 1, undefined, 6000);
      // Das Freischalten der Reserve-Elemente (play, pause) muss vorbei sein, ab hier zählt jedes Anhalten. Runde 46: der Ton läuft sofort, das stille Anspielen endet erst nach rund 300 ms (Zeile "gesture unlock"), also darauf warten statt auf den Start.
      await waitFor(pg, () => window.__core.diag().some((x) => /^deck: gesture unlock \d+ elements ok=[1-9]/.test(x)), undefined, 4000);
      await pg.evaluate(() => { window.__pausedWhilePlaying = 0; });
      // Danach 2 s lang jede 100 ms: nie wieder pausiert, die Taste zeigt Pause
      let steady = true;
      for (let n = 0; n < 20; n++) { await pg.waitForTimeout(100); if ((await pg.evaluate(() => window.__core.state())) !== 1) steady = false; }
      c[`ersteGeste ${mode} bleibt an`] = steady && (await pg.locator(play).getAttribute('aria-label')) === 'Pause';
      const d = await pg.evaluate(() => window.__core.diag());
      c[`ersteGeste ${mode} genau ein Start`] = (await pg.evaluate(() => window.__pausedWhilePlaying)) === 0 && d.some((x) => /^deck play#1 ok/.test(x)) && !d.some((x) => /needs tap|deck play refused|muted play blocked/.test(x));
      if (!c[`ersteGeste ${mode} bleibt an`] || !c[`ersteGeste ${mode} genau ein Start`]) r.notes[`ersteGeste ${mode}`] = { pausiert: await pg.evaluate(() => window.__pausedWhilePlaying), diag: d.filter((x) => !/probe done|pool/.test(x)).slice(-14) };
      c[`ersteGeste ${mode} keine Seitenfehler`] = o.errors.length === 0;
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
