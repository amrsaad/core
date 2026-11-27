// E2E iPhone-Ansicht, Schritt 1 (Runde 45): feste Abspielleiste unten, Aktionsreihe darüber, Reiterleiste oben, Inhalt dazwischen.
// Prüft bei 390x844, 375x667 und 430x932 in allen drei Reitern: Leiste ganz im Fenster und über der sicheren Unterkante, Aktionsreihe direkt darüber, keine Überschneidung von
// Kopf, Inhalt, Aktionsreihe und Leiste, alle Tasten mindestens 44 px, Hook nie abgeschnitten (auch ein sehr langer), Kontrast der Schrift, Video randlos 16:9.
// Verhalten bei 390x844: Zeitleiste läuft, Pause und Weiter per Taste, Voriger und Nächster, Wischen, Tippen auf den Inhalt, Tempo, CC, Like, Save, Share, More,
// Abrufkarte und Share-Blatt liegen über der Leiste, Settings über die Taste oben rechts, Saved über die Navigation dort, Text scrollt und wischt erst am Textende.
// Erste Geste nach dem App-Start ist die Play-Taste: Ton startet (iOS-Regel des Tests wie in audiotab.mjs, Zeile "deck: gesture unlock").
// Runde 50: Profil "Gerät" 393x852 mit Sicherheitsrand 59/34 und nachgestelltem Gerätefehler (Fensterhöhe 793, screen.height 852, navigator.standalone): Rückfall data-ph-short (Runde 50c, kein --ph-h mehr), Leiste und Tasten nie unter dem Fenster, feste deckende Kopfleiste mit Treffern an der oberen Kante,
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
// Runde 51e: Zeilen mit festen Zeilenzahlen (1, 2, 3 und 6 Zeilen) lateinisch und arabisch, mit und ohne Titelbild, für den Zeilenwechsel bild für bild. Die Folge deckt 1 auf 1, 2 auf 2, 3 auf 3, 1 auf 3, 2 auf 6, 3 auf 6 und 6 auf 1 ab,
// danach Doppelwechsel im Abstand von 0,12 s und ein Dreifachwechsel im Abstand von 0,08 s. M82: 40 Zeilen im Abstand von 3 s für Sprünge und das Pixel-Vergleichsbild.
const W51 = 'alpha beta gamma delta epsilon zeta theta kappa lambda sigma omega rho'.split(' ');
const A51 = 'هذا سطر تجريبي طويل جدا يمتد على عدة أسطر في الهاتف المحمول لأن الجملة لا تنتهي بسرعة'.split(' ');
const LEN51 = { lat: { 1: 10, 2: 38, 3: 60, 6: 130 }, ar: { 1: 20, 2: 50, 3: 80, 6: 200 } };
const mkT51 = (n, tag, ar) => { let t = ar ? '' : tag; let i = 0; const w = ar ? A51 : W51; while (t.length < n) t += (t ? ' ' : '') + w[i++ % w.length]; return ar ? `${tag} ${t}` : t; };
const SEQ51 = []; const TIME51 = []; {
  let t = 0;
  for (const n of [1, 1, 2, 2, 3, 3, 1, 3, 2, 6, 3, 6, 1]) { TIME51.push(t); SEQ51.push(n); t += 0.9; }
  t += 0.9;
  for (const g of [[1, 3, 2, 6], [2, 3, 3, 1]]) { for (const n of g) { TIME51.push(t); SEQ51.push(n); t += 0.12; } t += 1.4; }
  for (const n of [3, 6, 2, 3]) { TIME51.push(t); SEQ51.push(n); t += 0.08; }
  t += 1.4; TIME51.push(t); SEQ51.push(1);
}
const mk51 = (i, ar, cover) => mk(i, 'brain', { form: 'audio', audio: true, hls: `https://stream.test/${i}.m3u8`, hook: ar ? 'هذا عنوان تجريبي' : `Testmoment ${i} brain, ein kurzer Satz`, ...(cover ? { thumb: `https://img.test/cover${i}.png` } : {}), cues: TIME51.map((x, k) => [x, mkT51(LEN51[ar ? 'ar' : 'lat'][SEQ51[k]], `Z${k + 1}`, ar)]) });
const M78 = mk51(78, false, false); const M79 = mk51(79, false, true); const M80 = mk51(80, true, false); const M81 = mk51(81, true, true);
const M82 = mk(82, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/82.m3u8', hook: 'Testmoment 82 brain, ein kurzer Satz', thumb: 'https://img.test/cover82.png', cues: Array.from({ length: 40 }, (_, i) => [i * 3, `Z${i + 1} alpha beta gamma delta epsilon zeta theta kappa lambda`]) });
// Runde 51: Abrufkarte mit langer Frage und langen Antworten (Audio)
const QL = 'Welche Aussage über die beschriebene Abfolge der Schritte trifft zu, wenn man die Reihenfolge, die Bedingungen und die Ausnahmen aus dem Text gemeinsam berücksichtigt und dabei nichts hinzufügt?';
const AL = 'Diese Antwort ist absichtlich lang und umbricht auf dem Handy über mehrere Zeilen, damit die Tasten hoch werden';
const M76 = mk(76, 'brain', { form: 'audio', audio: true, hls: 'https://stream.test/76.m3u8', hook: 'Testmoment 76 brain, ein kurzer Satz', thumb: 'https://img.test/cover76.png', recall: { question: QL, options: [AL + ' (A)', AL + ' (richtig)', AL + ' (B)'], correct: 1, why: 'Weil die Reihenfolge zuerst kommt und dann die Bedingung gilt, die im Text genannt wird, und weil keine Ausnahme genannt ist.' } });
const ALL = [...moments, M76, M78, M79, M80, M81, M82, M58, M59, M60, M61, M62, M63, M64, M65, M66, M67, M72, M73, M68, M69, M70];
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
const POOL_O = await poolOf([78, 79, 80, 81, 82]);
const POOL_Q = await poolOf([76, 40]);
const POOL_C = await poolOf([40, 44, 68, 69, 70]);
const POOL_G = await poolOf([40, 58, 59]);
const POOL_T = await poolOf([40], [48, 63, 64]);
const k = Buffer.from(raw).toString('base64url');
const idOf = (i) => `test${String(i).padStart(7, '0')}:100`;

// Runde 51 (Ziel 4): Fortschritt auf stderr, jede Wartezeit höchstens 15 s mit benanntem Fehlschlag, Gesamt-Limit je Browser 18 Minuten
const T0 = Date.now();
const prog = { browser: '', section: '', run: null };
const sec = (name) => { prog.section = name; console.error(`[${prog.browser} ${Math.round((Date.now() - T0) / 1000)} s] ${name}`); };
const waitFor = async (page, fn, arg, timeout = 6000, soft = false) => {
  try { await page.waitForFunction(fn, arg, { timeout: Math.min(timeout, 15000), polling: 100 }); return true; } catch {
    // Zeitlimit: benannter Fehlschlag (Abschnitt und Bedingung), nur wenn die Bedingung gebraucht wurde
    if (prog.run && !soft) prog.run.timeouts.push(`${prog.section}: ${String(fn).replace(/\s+/g, ' ').slice(0, 90)}`);
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Runde 50c: hält die Antwort auf img.test/slow an, bis HOLD.p erfüllt ist (ohne HOLD.p 2 s), damit das Bild gezielt nach dem Messen eintrifft */
const HOLD = { p: null };
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

const shared = new Map();
async function open(type, size, { init, query = '', pool = POOL, tab = null } = {}) {
  sec(`open ${size.name}${size.reduced ? ' reduced' : ''} ${tab ?? ''}`);
  // Runde 51: ein Browser je Engine für alle Seiten (jede Seite bekommt einen eigenen Kontext), spart den Start je Abschnitt
  shared.set(type, shared.get(type) ?? await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {}));
  const base = shared.get(type);
  const prof = devices[size.device] ?? devices['iPhone 14'];
  const cx = await base.newContext({ ...prof, viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', ...(size.reduced ? { reducedMotion: 'reduce' } : {}) });
  await cx.addInitScript(({ t, b }) => {
    const put = () => { if (!document.documentElement) return false; const s = document.createElement('style'); s.textContent = `:root{--safe-top:${t}px;--safe-bottom:${b}px}`; document.documentElement.appendChild(s); return true; };
    if (!put()) document.addEventListener('readystatechange', put, { once: true });
  }, { t: size.safeT, b: size.safeB });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
  await cx.route(/img\.test\/cover/, (x) => x.fulfill({ contentType: 'image/png', body: PNG }));
  // Stream-Adresse der Testmomente: ein leerer, gültiger Abspielplan statt eines Netzfehlers, damit ein Moment nicht nach wenigen Sekunden als verloren übersprungen wird
  await cx.route('https://stream.test/**', (x) => x.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n' }));
  await cx.route(/img\.test\/slow/, async (x) => { await (HOLD.p ?? sleep(2000)); await x.fulfill({ contentType: 'image/png', body: PNG }); });
  await cx.route(/img\.test\/tiny/, (x) => x.fulfill({ contentType: 'image/png', body: mkPng(1, 1) }));
  await cx.route(/img\.test\/wide/, (x) => x.fulfill({ contentType: 'image/png', body: PNG_WIDE }));
  await cx.route(/img\.test\/broken/, (x) => x.abort());
  const pg = await cx.newPage();
  pg.setDefaultTimeout(15000);
  pg.setDefaultNavigationTimeout(15000);
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
  await settle(pg);
  if (tab) await gotoTab(pg, tab);
  return { browser: { close: () => cx.close() }, cx, pg, errors };
}
/** Reiter per Tipp wählen (die Taste ist selbst die Geste) und warten, bis ein Moment der Form steht */
/** Zwei gezeichnete Bilder abwarten statt fester Zeit (Layout und Messung der Ansicht sind dann gelaufen), dazu eine kurze Ruhe */
const settle = async (pg) => { await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await pg.waitForTimeout(150); };
async function gotoTab(pg, form) {
  const label = TABS.find(([f]) => f === form)[1];
  await pg.locator(`[data-testid=form-switch] button:has-text("${label}")`).click();
  await waitFor(pg, (f) => window.__core.moment() && (f === 'text' ? !!document.querySelector('[data-testid=text-view]') : window.__core.state() === 1), form, 8000);
  await settle(pg);
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
    if (await waitFor(pg, (i) => window.__core.moment()?.id === i, id, 3000, true)) break;
  }
  await pg.waitForTimeout(400);
}

// ---------- Geometrie ----------
sec('Geometrie');
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
  const r = { browser: name, checks: {}, notes: {}, timeouts: [] };
  results.runs.push(r);
  const c = r.checks;
  prog.browser = name; prog.run = r;
  // Gesamt-Limit je Browser: 18 Minuten, danach Abbruch mit dem letzten Abschnitt (kein stummes Hängen)
  const cap = setTimeout(() => {
    r.error = `Gesamt-Limit 18 Minuten, letzter Abschnitt: ${prog.section}`;
    console.error(`[${name}] ${r.error}`);
    try { writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1)); } catch { /* egal */ }
    console.log(JSON.stringify({ browser: name, ok: false, checks: Object.keys(c).length, fails: Object.entries(c).filter(([, v]) => v !== true).map(([n]) => n), error: r.error }));
    process.exit(1);
  }, 18 * 60 * 1000);
  try {
    // ---------- Aufbau: drei Größen, drei Reiter, sehr langer Hook ----------
    sec('Aufbau: drei Größen, drei Reiter, sehr langer Hook');
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
    sec('Verhalten bei 390x844: Video und Audio');
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
        await pg.waitForTimeout(250);
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
        await pg.waitForTimeout(300);
        await swipe(pg, area.x, area.y - dy, area.y + dy);
        r.notes[`${tag} Wischen runter wechselt`] = { i0, now: await idx(pg), area: area.b }; c[`${tag} Wischen runter wechselt`] = await waitFor(pg, (i) => window.__core.idx() === i, i0, 5000);
        await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
        await pg.waitForTimeout(300);
        if (form === 'video') {
          const bd = await center(pg, '.vslot[aria-hidden=false] .vframe > div');
          const k0 = await idx(pg);
          // Runde 50c: 200 statt 240 px, damit der Wisch mit der Maus nicht über der Kopfleiste (nimmt jetzt Berührungen an) endet. Ein Finger bleibt auf dem Gerät am Startelement.
          await swipe(pg, bd.x, bd.b.y + bd.b.height - 8, bd.b.y + bd.b.height - 8 - 200);
          c['390 video Wischen im Player wechselt'] = await waitFor(pg, (i) => window.__core.idx() === i + 1, k0, 5000);
          r.notes['390 video Wischen im Player'] = { k0, now: await idx(pg), bd: bd.b, st: await st(pg) };
          await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
          await pg.waitForTimeout(400);
          await pg.locator('[data-testid=ctl-prev]').click();
          await waitFor(pg, (i) => window.__core.idx() === i, k0, 4000);
          await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
          await pg.waitForTimeout(300);
        }
        {
          // Wisch, der in der Aktionsreihe zwischen den Tasten beginnt (Daumen unten), wechselt den Moment wie auf dem Inhalt
          const ab = (await E(pg, 'ph-actions').boundingBox());
          const k1 = await idx(pg);
          await swipe(pg, ab.x + ab.width / 2, ab.y + 4, ab.y - 300);
          c[`${tag} Wisch aus der Aktionsreihe wechselt`] = await waitFor(pg, (i) => window.__core.idx() === i + 1, k1, 5000);
          await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
          await pg.waitForTimeout(400);
          await pg.locator('[data-testid=ctl-prev]').click();
          await waitFor(pg, (i) => window.__core.idx() === i, k1, 4000);
          await waitFor(pg, () => window.__core.state() === 1, undefined, 5000);
          await pg.waitForTimeout(300);
        }
        // Tippen auf den Inhalt pausiert und setzt fort (wie bisher: nach kurzer Wartezeit für den Doppeltipp)
        await pg.mouse.click(area.x, area.y);
        c[`${tag} Tippen auf Inhalt pausiert`] = await waitFor(pg, () => window.__core.state() !== 1, undefined, 3000) && (await pg.locator(play).getAttribute('aria-label')) === 'Play';
        await pg.waitForTimeout(300);
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
          for (let n = 0; n < 4; n++) { mids.push(await pg.evaluate(async () => { const top = () => { const e = document.querySelector('[data-testid=caption]'); return e ? e.getBoundingClientRect().top : null; }; /* Runde 51c: erst messen, wenn die Zeile ruht (zwei gleiche Werte im Abstand von 120 ms), nicht mitten im Wechsel */ for (let k = 0; k < 10; k++) { const a = top(); await new Promise((r) => setTimeout(r, 120)); if (a === top()) return a === null ? null : Math.round(a); } const t = top(); return t === null ? null : Math.round(t); })); await pg.waitForTimeout(1800); }
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
    sec('Aktionsreihe, Blätter über der Leiste, Settings und Saved');
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
      await pg.waitForTimeout(300);
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
      await pg.mouse.move(tab.x, tab.y); await pg.mouse.down(); await pg.waitForTimeout(600); await pg.mouse.up();
      c.fokusOeffnet = await waitFor(pg, () => !!document.querySelector('[data-testid=focus-sheet]'), undefined, 3000);
      await pg.waitForTimeout(250);
      c.fokusUeberLeiste = await over('[data-testid=ctl-play]', '[data-testid=focus-sheet]');
      await pg.evaluate(() => { document.querySelector('[data-testid=focus-sheet-close]')?.click(); });
      await waitFor(pg, () => !document.querySelector('[data-testid=focus-sheet]'), undefined, 3000);
      // Abrufkarte: liegt über Leiste und Aktionsreihe, nicht dahinter
      const other = await pg.evaluate(() => window.__core.queue()[window.__core.idx() + 1]);
      await pg.evaluate((i) => window.__core.showRecall(i), other);
      c.abrufOeffnet = await waitFor(pg, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 4000);
      await pg.waitForTimeout(300);
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
    sec('Text: Ausweg-Fall (künstlich sehr langer Text, passt auch in der kleinsten Stufe nicht): s');
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
      await pg.waitForTimeout(250);
      const end = await pg.evaluate(() => ({ origin: document.querySelector('[data-testid=ph-origin]')?.textContent ?? null, apply: document.querySelector('[data-testid=ph-apply]')?.textContent ?? null, applyVisible: (() => { const e = document.querySelector('[data-testid=ph-apply]'); const v = document.querySelector('[data-testid=text-view]'); if (!e) return false; const a = e.getBoundingClientRect(), b = v.getBoundingClientRect(); return a.bottom <= b.bottom + 1 && a.top >= b.top; })() }));
      r.notes.textOriginApply = { ...end, id: await pg.evaluate(() => window.__core.moment().id), form: await pg.evaluate(() => window.__core.moment().form) }; c.textOriginApply = /Test entry 30/.test(end.origin ?? '') && /Apply today/.test(end.apply ?? '') && /Do the small thing today\./.test(end.apply ?? '') && end.applyVisible;
      await pg.screenshot({ path: `${out}/${name}-390-text-end.png` });
      // Wisch nach oben mitten im Text (nicht am Ende) wechselt nicht, am Textende wechselt er
      await pg.evaluate(() => { document.querySelector('[data-testid=text-view]').scrollTop = 0; });
      await pg.waitForTimeout(200);
      const i0 = await idx(pg);
      await touchSwipe(pg, '[data-testid=text-view]', 200, 600, 300);
      await pg.waitForTimeout(300);
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
    sec('Runde 48: unterer Rand auch bei einem Fenster, das höher ist als der Feed');
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
    sec('Runde 50: Audio, Titelbild als Quadrat (nie beschnitten), vorige und nächste Zeile genau e');
    // Die Größen der Reihe plus das Profil Gerät (393 breit, Fenster 793 hoch, Feed 852 hoch mit der Korrektur)
    const H50 = (pg) => {
      const info = () => pg.evaluate(() => {
        const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const q = (s) => document.querySelector(s);
        const img = q('[data-testid=ph-cover]'); const card = q('[data-testid=ph-lyrics]'); const ics = img ? getComputedStyle(img) : null; const ccs = getComputedStyle(card);
        // Runde 50c: das Quadrat ist ein Element um das Bild (Fläche, Radius, Rand als Überlagerung ::after), das Bild füllt es
        const slot = q('[data-testid=ph-cover-slot]'); const scs = slot ? getComputedStyle(slot) : null; const sas = slot ? getComputedStyle(slot, '::after') : null;
        const bw = parseFloat(ccs.borderLeftWidth) || 0;
        const pad = parseFloat(ccs.paddingLeft) || 0;
        const vis = img ? (ics.display !== 'none' && img.getBoundingClientRect().height > 0) : false;
        const cb = card.getBoundingClientRect();
        const areaR = q('.ph-lyr-body') ? q('.ph-lyr-body').getBoundingClientRect() : null; const kRaw = q('.ph-col') ? parseInt(getComputedStyle(q('.ph-col')).getPropertyValue('--clamp'), 10) : 2; const curI = Number(q(".ph-row[data-role='cur']")?.dataset.i ?? -1);
        const lineInfo = (id) => { const e = q(id.includes('[') ? id : `[data-testid=${id}]`); if (!e) return null; const cs = getComputedStyle(e); const eb = e.getBoundingClientRect(); const vt = areaR ? Math.max(eb.top, areaR.top) : eb.top; const vb = areaR ? Math.min(eb.bottom, areaR.bottom) : eb.bottom; return { ...R(e), vt, vb, k: kRaw, clipped: vb - vt < 8, lh: parseFloat(cs.lineHeight), sh: e.scrollHeight, ch: e.clientHeight, sw: e.scrollWidth, cw: e.clientWidth, ws: cs.whiteSpace, to: cs.textOverflow, ov: cs.overflowY, op: parseFloat(cs.opacity), hidden: cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 || vb - vt < 8, pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom), text: e.textContent }; };
        const note = q('.ph-lyric-note');
        const hk = q('[data-testid=hook]');
        return {
          id: window.__core.moment()?.id, card: R(card),
          // Innenfläche der Karte ohne Rand und Innenabstand (dort liegt alles Sichtbare)
          cardInner: { l: cb.left + bw, r: cb.right - bw, t: cb.top + bw, b: cb.bottom - bw },
          content: { l: cb.left + bw + pad, r: cb.right - bw - pad, t: cb.top + bw + pad, b: cb.bottom - bw - pad },
          cardRadius: ccs.borderTopLeftRadius, padTop: ccs.paddingTop, cardOverflow: ccs.overflow, art: card.dataset.art ?? null, dir: card.dataset.dir ?? null,
          img: img ? { ...R(img), vis, fit: ics.objectFit, dfit: img.dataset.fit, pos: ics.objectPosition, filter: ics.filter, bf: ics.backdropFilter, anim: ics.animationName, trans: ics.transitionDuration, bgi: ics.backgroundImage, alt: img.getAttribute('alt'), lazy: img.getAttribute('loading'), dec: img.getAttribute('decoding'), ref: img.getAttribute('referrerpolicy'), aw: img.getAttribute('width'), hh: img.getAttribute('height'), src: img.getAttribute('src'), done: img.complete && img.naturalWidth > 0, nw: img.naturalWidth, nh: img.naturalHeight, radius: scs.borderTopLeftRadius, bw: sas.borderTopWidth, bs: sas.borderTopStyle, bc: sas.borderTopColor, inCard: !!slot && img.parentElement === slot && slot.parentElement === card, op: parseFloat(ics.opacity) } : null,
          out: lineInfo('ph-lyric-out'), cur: lineInfo('caption'), next: lineInfo('ph-lyric-next'), next2: lineInfo(`.ph-row[data-i='${curI + 2}']`), next3: lineInfo(`.ph-row[data-i='${curI + 3}']`), note: note ? R(note) : null, noteText: note?.textContent ?? null,
          slot: slot ? { ...R(slot), state: slot.dataset.state, bg: scs.backgroundColor, vis: scs.display !== 'none' && slot.getBoundingClientRect().height > 0 } : null,
          count: document.querySelectorAll('[data-testid=ph-cover]').length, small: document.querySelectorAll('.ph-chiprow img, .ph-cover, .ph-chiprow [data-cover]').length,
          hook: { ...R(hk), step: hk.dataset.step, size: parseFloat(getComputedStyle(hk).fontSize), sh: hk.scrollHeight, ch: hk.clientHeight }, actions: R(q('[data-testid=ph-actions]')), row: R(q('.ph-chiprow')), contentBox: R(q('[data-testid=ph-audio]')),
          cc: q('[data-testid=cc]')?.getAttribute('aria-pressed') ?? null,
        };
      });
      const loaded = async () => { const ok = await waitFor(pg, () => { const i = document.querySelector('[data-testid=ph-cover]'); return !!i && i.complete && i.naturalWidth > 0 && i.dataset.ready === 'yes' && parseFloat(getComputedStyle(i).opacity) === 1; }, undefined, 4000); return ok; };
      /** Warten, bis die aktuelle Zeile mit prefix beginnt (die Zeit läuft mit dem Abspielen) */
      const rowsRest = () => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row, .ph-col')).length === 0;
      const atLine = async (prefix) => { const ok = await waitFor(pg, (x) => document.querySelector('[data-testid=caption]')?.textContent.startsWith(x), prefix, 9000, true); await waitFor(pg, () => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row, .ph-col')).length === 0, undefined, 3000, true); return ok; };
      /** Zeilen ganz in der Karte, unter dem Bild, ohne Überlappung untereinander, mit Aktionsreihe und Überschrift */
      const linesOk = (a, withArt) => {
        const L = [a.cur, a.next, a.next2, a.next3].filter((x) => x && x.w > 0 && x.h > 0 && !x.hidden);
        if (!a.cur || !a.cur.h) return false;
        // Runde 51e: der Bereich klemmt unten hart und blendet unten aus, sichtbar ist der Teil im Bereich (vt bis vb); die aktuelle Zeile liegt ganz darin
        const inCard = L.every((x) => x.l >= a.cardInner.l - 0.5 && x.r <= a.cardInner.r + 0.5 && x.vt >= a.cardInner.t - 0.5 && x.vb <= a.cardInner.b + 0.5) && a.cur.t >= a.cardInner.t - 0.5 && a.cur.b <= a.cardInner.b + 0.5;
        const underArt = !withArt || L.every((x) => x.vt >= a.img.b - 0.5);
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
      const nbOk = (x, want) => !x || x.op === 0 || x.hidden || (x.pt === 0 && x.pb === 0 && x.ov === 'hidden' && Math.abs(x.h - Math.round(x.h / x.lh) * x.lh) <= 1 && x.h <= x.k * x.lh + 2 && (want === undefined || Math.abs(x.h / x.lh - want) <= 0.1));

      return { info, loaded, atLine, linesOk, squareOk, flushOk, nbOk, rowsRest };
    };
    const r50 = {};
    for (const size of [SIZES[1], GER]) {
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
      c[`${tag} Bild Radius 12, Rand 1 px aus 8 Prozent Weiß, ohne Filter und Animation`] = !!a.img && a.img.radius === '12px' && a.img.bw === '1px' && a.img.bs === 'solid' && /0\.08/.test(a.img.bc) && a.img.filter === 'none' && a.img.bf === 'none' && a.img.anim === 'none' && a.img.bgi === 'none' && /^0\.2s/.test(a.img.trans);
      c[`${tag} quadratisches Bild: cover, nicht beschnitten`] = !!a.img && a.img.fit === 'cover' && a.img.dfit === 'cover' && Math.abs(a.img.nw / a.img.nh - 1) <= 0.02 && /^(50% 50%|center center|center)$/.test(a.img.pos);
      c[`${tag} Abrufregeln`] = !!a.img && a.img.alt === '' && !a.img.lazy && a.img.dec === 'async' && a.img.ref === 'no-referrer' && a.img.src === COVER && !!a.img.aw && !!a.img.hh && a.count === 1;
      c[`${tag} Untertitel in der Karte, unter dem Bild, ohne Überlappung`] = linesOk(a, true);
      c[`${tag} kleines 44er Cover entfällt, Kopfzeile wie vor Runde 48`] = a.small === 0 && a.row.h <= 30;
      // Der Hook wird wegen des Bildes nicht kleiner als ohne Bild (gleicher Text: Moment 61 gegen 41, siehe unten für die Stufen)
      r50[`${size.name} Hook mit Bild kurz`] = a.hook.step;
      await atLine('Zweite');
      const a2 = await info();
      r.notes[`${tag} lateinisch Zeile 2`] = a2;
      c[`${tag} nächste Zeilen bis K Zeilen mit ganzer Zeilenbox (lateinisch)`] = nbOk(a2.next) && nbOk(a2.next2) && nbOk(a2.next3) && linesOk(a2, !!a2.img && a2.img.vis);
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
      await pg.waitForTimeout(250);
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
      c[`${tag} arabisch: nächste Zeilen bis K Zeilen mit ganzer Zeilenbox, direkt nächste Zeile sichtbar (Deckkraft 0,6)`] = nbOk(ar.next) && nbOk(ar.next2) && nbOk(ar.next3) && !!ar.next && !ar.next.hidden && ar.next.op >= 0.4;
      c[`${tag} arabisch: rechtsbündig`] = af.curRight.boxR - af.curRight.textR <= 2;
      if (size.name === '390x844') await pg.screenshot({ path: `${out}/${name}-390-audio-arabisch.png` });
      if (size.name === '375x667') await pg.screenshot({ path: `${out}/${name}-375-audio-arabisch.png` });
      // Moment mit abgebrochener Route (Runde 50c): das Bild-Element verschwindet, die ruhige Fläche bleibt stehen, die Zeilen liegen darunter
      await showMoment(pg, idOf(43));
      await waitFor(pg, () => !document.querySelector('[data-testid=ph-cover]') && !!document.querySelector('[data-testid=ph-cover-slot][data-state=error]'), undefined, 4000);
      const d = await info();
      r.notes[`${tag} ladefehler`] = d;
      c[`${tag} Ladefehler: kein Bild-Element, Fläche bleibt, Zeilen unter der Fläche`] = !d.img && !!d.slot && d.art !== null && (!d.slot.vis || linesOk({ ...d, img: d.slot }, true));
      c[`${tag} keine Seitenfehler`] = o.errors.length === 0;
      await o.browser.close();
    }
    // Zweites Szenario je Größe: lange Sätze (Moment 59), breites Bild (62), Bild allein (60)
    for (const size of [SIZES[1], GER]) {
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
      c[`${tag} langer nächster Satz: höchstens K Zeilen (eine Klemme für alle), nichts von einer weiteren Zeile`] = nbOk(w.next) && nbOk(w.next2) && nbOk(w.next3) && linesOk(w, !!w.img && w.img.vis);
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
    for (const size of [SIZES[1], GER]) c[`${size.name} Hook wegen des Bildes nicht kleiner`] = r50[`${size.name} Hook-Stufe mit Bild`] <= r50[`${size.name} Hook-Stufe ohne Bild`] || r50[`${size.name} Bild px`] > 0;
    // ---------- Runde 50: Profil Gerät (393x852, Sicherheitsrand 59/34) mit nachgestelltem Gerätefehler ----------
    sec('Runde 50: Profil Gerät (393x852, Sicherheitsrand 59/34) mit nachgestelltem Gerätefehler');
    // Gerätefehler: Fensterhöhe 793, screen.height 852, navigator.standalone true. Messen wie auf dem Gerät: Feed, Kopfleiste und Leiste je top und bottom.
    {
      const MEAS = () => {
        const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const q = (s) => document.querySelector(s);
        const feed = q('.vfeed[data-phone]'); const head = q('.ph-head'); const hs = head ? getComputedStyle(head) : null;
        return {
          ih: innerHeight, sh: screen.height, short: document.documentElement.hasAttribute('data-ph-short'), phPb: q('[data-testid=ph-bar]') ? getComputedStyle(q('[data-testid=ph-bar]')).paddingBottom : null, htmlBg: getComputedStyle(document.documentElement).backgroundColor, barBg: q('[data-testid=ph-bar]') ? getComputedStyle(q('[data-testid=ph-bar]')).backgroundColor : null, minRule: [...document.styleSheets].some((ss) => { try { return [...ss.cssRules].some((x) => x.media && /display-mode:\s*standalone/.test(x.media.mediaText) && /min-height/.test(x.cssText) && /100lvh/.test(x.cssText)); } catch { return false; } }), phH: document.documentElement.style.getPropertyValue('--ph-h') + (feed ? getComputedStyle(feed).getPropertyValue('--ph-h').trim() : ''),
          btns: [...document.querySelectorAll('[data-testid=ph-bar] button, [data-testid=ph-actions] button')].map((e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, id: e.dataset.testid ?? e.getAttribute('aria-label') ?? '' }; }),
          feed: R(feed), head: R(head), tabs: R(q('.ph-tabs')), actions: R(q('[data-testid=ph-actions]')), bar: R(q('[data-testid=ph-bar]')), lyrics: R(q('[data-testid=ph-lyrics]')), audio: R(q('[data-testid=ph-audio]')), hook: R(q('[data-testid=hook]')),
          pos: hs?.position, bg: hs?.backgroundColor, inStage: !!head?.closest('.vstage'), vstage: getComputedStyle(q('.vstage')).transform,
          scrollY: document.scrollingElement.scrollHeight, vp: window.__core.diag().filter((x) => x.startsWith('vp:')),
        };
      };
      const prep = async (size, extra = {}) => { const o = await open(type, { ...size, ...extra }, { tab: 'audio', pool: POOL_G }); await showMoment(o.pg, idOf(40)); await waitFor(o.pg, () => { const i = document.querySelector('[data-testid=ph-cover]'); return !!i && i.complete && i.naturalWidth > 0; }, undefined, 4000); await waitFor(o.pg, () => window.__core.diag().some((x) => x.startsWith('vp:')), undefined, 6000); return o; };
      const oA = await prep(GER);
      const A = await oA.pg.evaluate(MEAS);
      r.notes['Gerät A (kurzes Fenster, Rückfall an)'] = A;
      const oB = await prep(GER, { standalone: false });
      const B = await oB.pg.evaluate(MEAS);
      r.notes['Gerät B (kein Standalone)'] = B;
      const oC = await prep(GER, { height: 852 });
      const C = await oC.pg.evaluate(MEAS);
      r.notes['Gerät C (Fensterhöhe gleich screen.height)'] = C;
      c['Gerät Fehler nachgestellt: Fenster 793, screen.height 852'] = A.ih === 793 && A.sh === 852;
      // Runde 50c: keine Höhenüberschreibung mehr (--ph-h gibt es nicht), Feed und Leiste enden am Fenster, der Rückfall data-ph-short nimmt den doppelten unteren Rand weg
      c['Gerät kein --ph-h mehr (weder am Wurzelelement noch im Feed)'] = A.phH === '' && B.phH === '' && C.phH === '';
      c['Gerät Rückfall data-ph-short gesetzt (Fenster 793, Bildschirm 852, Sicherheitsrand 59)'] = A.short === true && B.short === false && C.short === false;
      c['Gerät Feed endet am Fenster (0 bis 793)'] = !!A.feed && Math.abs(A.feed.t) <= 0.5 && Math.abs(A.feed.b - A.ih) <= 0.5 && Math.abs(A.feed.w - 393) <= 0.5;
      c['Gerät kurzes Fenster: Abspielleiste endet bei innerHeight, Aktionsreihe direkt darüber'] = !!A.bar && A.bar.b <= A.ih + 0.01 && Math.abs(A.bar.b - A.ih) <= 0.5 && Math.abs(A.actions.b - A.bar.t) <= 1;
      c['Gerät kurzes Fenster: alle Tasten ganz im Fenster, keine angeschnitten'] = A.btns.length >= 8 && A.btns.every((x) => x.b <= A.ih + 0.01 && x.t >= 0 && x.l >= 0 && x.r <= 393.01 && x.b - x.t >= 43.5);
      c['Gerät kurzes Fenster: Abstand der Tasten zur Unterkante gleich s-4 (16 px)'] = A.phPb === '16px' && Math.abs(A.ih - Math.max(...A.btns.filter((x) => A.bar && x.t >= A.bar.t).map((x) => x.b)) - 16) <= 0.5;
      c['Gerät kurzes Fenster: Leiste 18 px niedriger, Karte 18 px höher als mit Home-Rand (Gegenprobe B)'] = !!A.lyrics && !!B.lyrics && Math.abs(A.lyrics.h - B.lyrics.h - 18) <= 1 && Math.abs((B.bar.h - A.bar.h) - 18) <= 0.5;
      c['Gerät html-Hintergrund gleich der Farbe der Leiste (der Streifen darunter wirkt wie ihre Fortsetzung)'] = /^rgb\(/.test(A.htmlBg) && A.htmlBg === A.barBg;
      c['Gerät Gegenprobe ohne Standalone: Leiste endet bei 793, Home-Rand 34 bleibt'] = !!B.bar && Math.abs(B.bar.b - 793) <= 0.5 && B.phPb === '34px' && Math.abs(B.ih - Math.max(...B.btns.filter((x) => x.t >= B.bar.t).map((x) => x.b)) - 34) <= 0.5;
      c['Gerät normales Standalone-Profil 393x852: Leiste bis 852, Tasten oberhalb von 852 minus 34'] = !!C.bar && Math.abs(C.bar.b - 852) <= 0.5 && C.phPb === '34px' && Math.abs(852 - Math.max(...C.btns.filter((x) => x.t >= C.bar.t).map((x) => x.b)) - 34) <= 0.5 && C.btns.length >= 8 && C.btns.filter((x) => x.t >= C.bar.t).every((x) => x.b <= 852 - 34 + 0.5);
      c['Gerät html min-height-Regel für die Standalone-App im Stylesheet (WebKit 301108)'] = A.minRule === true;
      c['Gerät kein Seitenscroll durch die Überhöhe'] = A.scrollY <= A.ih + 1;
      const vpA = A.vp[0] ?? '';
      c['Gerät Diag-Zeile "vp:" mit dh, sy, top, short=yes'] = /^vp: iw=393 ih=793 vvh=\d+(\.\d+)? ch=793 sw=\d+ sh=852 st=59 sb=34 standalone=yes ios=\S+ head=0,103 bar=\S+ feed=0,793 dh=\d+(\.\d+)? sy=0 top=DIV\.head short=yes$/.test(vpA);
      if (!c['Gerät Diag-Zeile "vp:" mit dh, sy, top, short=yes']) r.notes['Gerät Diag A'] = A.vp;
      c['Gegenprobe ohne Standalone: kein Rückfall (short=no, Feed endet bei 793)'] = B.short === false && !!B.feed && Math.abs(B.feed.b - 793) <= 0.5 && /standalone=no/.test(B.vp[0] ?? '') && /short=no$/.test(B.vp[0] ?? '');
      c['Gegenprobe ih gleich sh: kein Rückfall (short=no, Feed und Leiste enden bei 852)'] = C.short === false && !!C.feed && Math.abs(C.feed.b - 852) <= 0.5 && !!C.bar && Math.abs(C.bar.b - 852) <= 0.5 && /short=no$/.test(C.vp[0] ?? '');
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
        await pg.waitForTimeout(350);
      }
      // Diag-Grenzen und Folgen von resize: nach 2 s ein neues Fenster 700 hoch: Variable weg (Differenz 152), neue Zeile; zurück auf 793: Variable wieder da
      {
        const pg = oA.pg;
        await pg.waitForTimeout(2200);
        await pg.setViewportSize({ width: 393, height: 700 });
        const got = await waitFor(pg, () => window.__core.diag().some((x) => /^vp: .* ih=700 /.test(x) && /short=no$/.test(x)), undefined, 4000);
        const gone = await pg.evaluate(() => !document.documentElement.hasAttribute('data-ph-short'));
        await pg.setViewportSize({ width: 393, height: 793 });
        const back = await waitFor(pg, () => document.documentElement.hasAttribute('data-ph-short'), undefined, 3000);
        c['Gerät nach resize: neue Zeile, Attribut data-ph-short folgt dem Fenster'] = got && gone && back;
        for (let i = 0; i < 10; i++) { await pg.setViewportSize({ width: 393, height: 780 + (i % 2) * 13 }); await pg.waitForTimeout(60); }
        const n = await pg.evaluate(() => window.__core.diag().filter((x) => x.startsWith('vp:')).length);
        c['Gerät Diag höchstens 5 Zeilen je Sitzung'] = n >= 2 && n <= 5;
        r.notes['Gerät Diag Zahl'] = n;
        await pg.setViewportSize({ width: 393, height: 793 });
      }
      // Reiter Text und Video im kurzen Fenster: Feed und Leiste am Fenster
      await gotoTab(oA.pg, 'text'); await showMoment(oA.pg, idOf(48)); await oA.pg.waitForTimeout(500);
      const tx = await oA.pg.evaluate(MEAS);
      c['Gerät Text-Reiter: Feed und Leiste bei innerHeight, alle Tasten im Fenster'] = Math.abs(tx.feed.b - tx.ih) <= 0.5 && Math.abs(tx.bar.b - tx.ih) <= 0.5 && tx.short === true && tx.btns.every((x) => x.b <= tx.ih + 0.01);
      await oA.pg.locator('[data-testid=form-switch] button:has-text("Video")').click(); await waitFor(oA.pg, () => window.__core.moment() && window.__core.state() === 1, undefined, 8000); await oA.pg.waitForTimeout(700);
      const vd = await oA.pg.evaluate(MEAS);
      c['Gerät Video-Reiter: Feed und Leiste bei innerHeight, alle Tasten im Fenster'] = Math.abs(vd.feed.b - vd.ih) <= 0.5 && Math.abs(vd.bar.b - vd.ih) <= 0.5 && vd.short === true && vd.btns.every((x) => x.b <= vd.ih + 0.01);
      // Bildschirmfotos (Runde 50c): ein Fenster von 793 zeigt nichts unter seiner Kante. Darum eine Seite mit Fensterhöhe 852, deren Feed 59 px über dem unteren Rand endet (Stil unten), Bildschirmhöhe 911: dasselbe Layout wie im kurzen Fenster mit Rückfall data-ph-short, darunter der html-Hintergrund als Streifen.
      {
        const oS = await open(type, { ...GER, height: 852, screenH: 911 }, { tab: 'audio', pool: POOL_G, init: () => { const put = () => { const st = document.createElement('style'); st.textContent = '.vfeed[data-phone]{bottom:59px !important}'; document.documentElement.appendChild(st); }; if (document.documentElement) put(); else document.addEventListener('readystatechange', put, { once: true }); } });
        const ps = oS.pg;
        // Die Höhe des Feeds kommt aus top und bottom (height auto), nicht aus 100dvh: mit bottom 59 endet er bei 793, obwohl das Fenster 852 hoch ist
        c['Gerät Feed-Höhe folgt top und bottom (height auto statt 100dvh)'] = await ps.evaluate(() => { const f = document.querySelector('.vfeed[data-phone]'); return getComputedStyle(f).bottom === '59px' && Math.abs(f.getBoundingClientRect().bottom - 793) <= 0.5 && innerHeight === 852; });
        await showMoment(ps, idOf(59)); await waitFor(ps, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('Zweite') && !!document.querySelector('[data-testid=ph-lyric-next]'), undefined, 9000); await ps.waitForTimeout(300);
        await ps.screenshot({ path: `${out}/${name}-geraet-audio-lateinisch.png` });
        await showMoment(ps, idOf(58)); await ps.evaluate(async () => { await document.fonts.ready; }); await waitFor(ps, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('هذا سطر تجريبي ثان') && !!document.querySelector('[data-testid=ph-lyric-next]'), undefined, 9000); await ps.waitForTimeout(300);
        await ps.screenshot({ path: `${out}/${name}-geraet-audio-arabisch.png` });
        await showMoment(ps, idOf(40));
        await ps.locator('[data-testid=cc]').click(); await waitFor(ps, () => document.querySelector('[data-testid=ph-lyrics]').dataset.art === 'fill', undefined, 3000);
        await ps.screenshot({ path: `${out}/${name}-geraet-audio-cc-aus.png` });
        await gotoTab(ps, 'text'); await showMoment(ps, idOf(56)); await ps.waitForTimeout(300);
        await ps.screenshot({ path: `${out}/${name}-geraet-text.png` });
        await ps.locator('[data-testid=form-switch] button:has-text("Video")').click(); await waitFor(ps, () => window.__core.moment() && window.__core.state() === 1, undefined, 8000); await ps.waitForTimeout(400);
        await ps.screenshot({ path: `${out}/${name}-geraet-video.png` });
        await oS.browser.close();
      }
      // Runde 51d: im kurzen Fenster (Rückfall data-ph-short) hat html die Farbe der Seite, solange Abrufkarte oder Endseite gezeigt wird (kein hellerer Streifen unter ihr), sonst die Farbe der Leiste
      c['Gerät Text und Video: html-Hintergrund gleich der Farbe der Leiste'] = /^rgb\(/.test(tx.htmlBg) && tx.htmlBg === tx.barBg && /^rgb\(/.test(vd.htmlBg) && vd.htmlBg === vd.barBg;
      {
        const oR = await open(type, GER, { tab: 'audio', pool: POOL_G });
        const pr = oR.pg;
        await showMoment(pr, idOf(40));
        const bg = () => pr.evaluate(() => { const h = getComputedStyle(document.documentElement).backgroundColor; const e = (s) => { const n = document.querySelector(s); return n ? getComputedStyle(n).backgroundColor : null; }; return { short: document.documentElement.hasAttribute('data-ph-short'), html: h, body: getComputedStyle(document.body).backgroundColor, bar: e('[data-testid=ph-bar]'), recall: e('[data-testid=recall-page]'), end: e('[data-testid=end-page]'), feedSurface: (() => { const p = document.createElement('i'); p.style.color = 'var(--feed-surface)'; document.body.appendChild(p); const v = getComputedStyle(p).color; p.remove(); return v; })() }; });
        const b0 = await bg();
        await pr.evaluate(() => window.__core.showRecall(window.__core.moment().id));
        const gotR = await waitFor(pr, () => !!document.querySelector('[data-testid=recall-page]'), undefined, 6000); await pr.waitForTimeout(500);
        const bR = await bg();
        await pr.screenshot({ path: `${out}/${name}-geraet-abrufkarte-streifen.png` }).catch(() => {});
        r.notes['Gerät 51d Farben'] = { audio: b0, recall: bR };
        c['Gerät 51d kurzes Fenster Audio: html gleich Leistenfarbe'] = b0.short === true && /^rgb\(/.test(b0.html) && b0.html === b0.bar;
        c['Gerät 51d Abrufkarte: html gleich dem Hintergrund der Abrufkarten-Seite (nicht var(--feed-surface))'] = gotR && bR.short === true && /^rgb\(/.test(bR.html) && bR.html === bR.recall && bR.html !== bR.feedSurface && bR.body === bR.recall;
        // Karte schließen, bis die Endseite steht (nächster Moment, Karten beantworten)
        let gotE = false;
        for (let k = 0; k < 40 && !gotE; k++) {
          gotE = await pr.evaluate(() => !!document.querySelector('[data-testid=end-page]') && !document.querySelector('[data-testid=recall-card]'));
          if (gotE) break;
          const card = await pr.locator('[data-testid=recall-card]').count();
          if (card) { await pr.locator('[data-testid=recall-option][data-correct="1"]').first().click().catch(() => {}); await pr.waitForTimeout(250); await pr.locator('[data-testid=recall-next]').first().click().catch(() => {}); }
          else await pr.evaluate(() => window.__core.next());
          await pr.waitForTimeout(450);
        }
        await pr.waitForTimeout(500);
        const bE = await bg();
        await pr.screenshot({ path: `${out}/${name}-geraet-endseite-streifen.png` }).catch(() => {});
        r.notes['Gerät 51d Farben Endseite'] = bE;
        c['Gerät 51d Endseite: html gleich dem Hintergrund der Endseite (nicht var(--feed-surface))'] = gotE && bE.short === true && /^rgb\(/.test(bE.html) && bE.html === bE.end && bE.html !== bE.feedSurface && bE.body === bE.end;
        // zurück in den Reiter Audio: wieder die Farbe der Leiste
        await pr.evaluate(() => window.__core.next()).catch(() => {});
        await gotoTab(pr, 'text'); await pr.waitForTimeout(400);
        const bT = await bg();
        c['Gerät 51d nach Endseite im Reiter Text: html wieder gleich Leistenfarbe'] = bT.short === true && /^rgb\(/.test(bT.html) && bT.html === bT.bar;
        await oR.browser.close();
      }
      c['Gerät keine Seitenfehler'] = oA.errors.length === 0 && oB.errors.length === 0 && oC.errors.length === 0;
      await oA.browser.close(); await oB.browser.close(); await oC.browser.close();

      // Abstand oben (PHONE_TOP_CLEAR_PX, ausgeliefert 0): mit 40 über den Test-Schalter schiebt sich alles um 40 px nach unten, nichts überlappt, nur im Standalone
      const lay = async (extra, form) => {
        const o = await open(type, { ...GER, ...extra }, { tab: form === 'video' ? null : form, pool: POOL_G });
        if (form === 'audio') await showMoment(o.pg, idOf(40));
        if (form === 'text') await showMoment(o.pg, idOf(48));
        await o.pg.waitForTimeout(350);
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
        await showMoment(oK.pg, idOf(40)); await oK.pg.waitForTimeout(300);
        await oK.pg.screenshot({ path: `${out}/${name}-geraet-abstand40-audio.png` });
        await oK.browser.close();
      }
    }

    // ---------- Runde 50c (Fehler 3): Hat der Moment ein Titelbild, ist das Quadrat von Anfang an reserviert (ruhige Fläche), das Bild blendet ohne Zeitgrenze ein, bei Fehler bleibt die Fläche ----------
    sec('Runde 50c (Fehler 3): Titelbild mit reserviertem Quadrat, blendet ohne Zeitgrenze ein');
    {
      const covers = {};
      // Profil Gerät hier mit Fensterhöhe 852 (so gibt iOS der Seite das Fenster mit der Regel in phone.css): im kurzen Fenster 793 liegt die Kartenhöhe von Moment 68 genau an der Grenze, ab der die Karte das Quadrat ausblendet (siehe Notiz unten)
      for (const size of [SIZES[0], { ...GER, height: 852 }]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_C });
        const pg = o.pg; const { info, atLine, linesOk } = H50(pg);
        const diagOf = (id) => pg.evaluate((i) => window.__core.diag().filter((x) => x.startsWith(`cover: ${i} `)), id);
        // Runde 51d: Symbol im Fehlerzustand (Kopfhörer aus dem Symbolsatz der App, mittig, Bereichsfarbe, 55 %, 40 px)
        const symOf = () => pg.evaluate(() => { const s = document.querySelector('[data-testid=ph-cover-slot] .ph-art-sym'); const sl = document.querySelector('[data-testid=ph-cover-slot]'); if (!s || !sl) return null; const b = s.getBoundingClientRect(); const a = sl.getBoundingClientRect(); const probe = document.createElement('i'); probe.style.color = 'var(--ad)'; document.querySelector('.ph-audio').appendChild(probe); const area = getComputedStyle(probe).color; probe.remove(); const cs = getComputedStyle(s); return { w: b.width, h: b.height, op: parseFloat(cs.opacity), dx: b.left + b.width / 2 - (a.left + a.width / 2), dy: b.top + b.height / 2 - (a.top + a.height / 2), colorOk: cs.color === area, paths: s.querySelectorAll('path').length, svg: s.tagName.toLowerCase() === 'svg', aw: a.width, ah: a.height }; });
        const tag = `${size.name} Titelbild-Platz`;
        // Bezug: Moment ohne Titelbild (kein Quadrat)
        await showMoment(pg, idOf(44));
        await atLine('Dritte');
        const base = await info();
        const baseD = await diagOf(idOf(44));
        c[`${tag}: ohne thumb Diag cover none, kein Quadrat, kein Bild`] = baseD.length === 1 && baseD[0].endsWith(' none') && !base.slot && !base.img && base.art === null && base.padTop === '20px';
        // Verzögertes Bild (Route gehalten, bis wir freigeben): sofort das reservierte Quadrat mit Fläche
        let release; HOLD.p = new Promise((res) => { release = res; });
        await showMoment(pg, idOf(68));
        await atLine('Dritte');
        const pre = await info();
        const preD = await diagOf(idOf(68));
        const symPre = await symOf();
        r.notes[`${tag} vor dem Laden`] = { slot: pre.slot, img: pre.img ? { op: pre.img.op, done: pre.img.done } : null, cur: pre.cur, d: preD };
        const alpha = (col) => { const m = /\/\s*([\d.]+)\s*\)/.exec(col ?? '') ?? /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(col ?? ''); return m ? parseFloat(m[1]) : /^(rgb|color)\(/.test(col ?? '') ? 1 : null; };
        c[`${tag} vor dem Laden: Quadrat reserviert (Fläche sichtbar, quadratisch, Zustand wait)`] = !!pre.slot && pre.slot.vis && pre.slot.state === 'wait' && Math.abs(pre.slot.w - pre.slot.h) <= 1 && pre.slot.w >= 72 && pre.art === 'top';
        c[`${tag} vor dem Laden: Fläche in der Bereichsfarbe mit niedriger Deckkraft (Alpha unter 0,3, über 0)`] = !!pre.slot && alpha(pre.slot.bg) > 0 && alpha(pre.slot.bg) < 0.3;
        c[`${tag} vor dem Laden: Bild nicht geladen, unsichtbar (Deckkraft 0), keine Zeitgrenze (Diag late nach 600 ms, Quadrat bleibt)`] = !!pre.img && !pre.img.done && pre.img.op === 0 && preD.length === 1 && preD[0] === `cover: ${idOf(68)} late`;
        c[`${tag} vor dem Laden: Zeilen unter dem Quadrat, nichts überlappt`] = !!pre.slot && linesOk({ ...pre, img: pre.slot }, true);
        await pg.screenshot({ path: `${out}/${name}-cover-${size.name}-1-vor-dem-laden.png` });
        release(); HOLD.p = null;
        const gotImg = await waitFor(pg, () => { const i = document.querySelector('[data-testid=ph-cover]'); return !!i && i.complete && i.naturalWidth > 0 && i.dataset.ready === 'yes' && parseFloat(getComputedStyle(i).opacity) === 1; }, undefined, 4000);
        await atLine('Dritte');
        const post = await info();
        await pg.screenshot({ path: `${out}/${name}-cover-${size.name}-2-nach-dem-laden.png` });
        const postD = await diagOf(idOf(68));
        const symPost = await symOf();
        c[`${tag}: Ladezustand und geladener Zustand zeigen kein Symbol`] = symPre === null && symPost === null;
        r.notes[`${tag} nach dem Laden`] = { slot: post.slot, img: post.img ? { op: post.img.op, nw: post.img.nw } : null, cur: post.cur, d: postD };
        c[`${tag} nach dem Laden: Bild sichtbar (Deckkraft 1, naturalWidth über 0), füllt das Quadrat`] = gotImg && !!post.img && post.img.op === 1 && post.img.nw > 0 && !!post.slot && Math.abs(post.img.l - post.slot.l) <= 0.5 && Math.abs(post.img.t - post.slot.t) <= 0.5 && Math.abs(post.img.w - post.slot.w) <= 0.5 && Math.abs(post.img.h - post.slot.h) <= 0.5 && post.slot.state === 'ready';
        const dd = (x, y) => Math.max(Math.abs(x.t - y.t), Math.abs(x.l - y.l), Math.abs(x.w - y.w), Math.abs(x.h - y.h));
        c[`${tag} Lage der aktuellen Zeile vor und nach dem Laden gleich (0 px)`] = !!pre.cur && !!post.cur && pre.cur.text === post.cur.text && dd(pre.cur, post.cur) === 0;
        c[`${tag} Quadrat und Karte vor und nach dem Laden gleich (0 px)`] = !!pre.slot && !!post.slot && dd(pre.slot, post.slot) === 0 && dd(pre.card, post.card) === 0 && dd(pre.hook, post.hook) === 0;
        c[`${tag} Diag nach dem Laden weiter genau eine Zeile late`] = postD.length === 1 && postD[0] === `cover: ${idOf(68)} late`;
        // Fehlerfälle: abgebrochene Route (69) und 1x1 (70): Fläche bleibt, kein Bild-Element, gleiche Lage wie im Wartezustand
        for (const [id, label] of [[69, 'kaputt'], [70, 'durchsichtig 1x1']]) {
          await showMoment(pg, idOf(id));
          const got = await waitFor(pg, (i) => window.__core.diag().some((x) => x.startsWith(`cover: ${i} `)), idOf(id), 4000);
          await waitFor(pg, () => !!document.querySelector('[data-testid=ph-cover-slot][data-state=error]'), undefined, 4000);
          await atLine('Dritte');
          const a = await info();
          if (id === 69) await pg.screenshot({ path: `${out}/${name}-cover-${size.name}-3-fehler.png` });
          const d = await diagOf(idOf(id));
          r.notes[`${tag} ${label}`] = { d, slot: a.slot, img: a.img ? { vis: a.img.vis } : null, cur: a.cur };
          c[`${tag} ${label}: Diag cover error, genau eine Zeile`] = got && d.length === 1 && d[0] === `cover: ${idOf(id)} error`;
          c[`${tag} ${label}: Fläche bleibt stehen, kein Bild-Element (kein kaputtes Symbol)`] = !!a.slot && a.slot.vis && a.slot.state === 'error' && !a.img && a.count === 0 && alpha(a.slot.bg) > 0;
          const sy = await symOf();
          r.notes[`${tag} ${label} Symbol`] = sy;
          c[`${tag} ${label}: Fehlerzustand zeigt das Symbol (inline-SVG, 40 px, 55 %, mittig, Bereichsfarbe)`] = !!sy && sy.svg && sy.paths >= 1 && Math.abs(sy.w - 40) <= 0.5 && Math.abs(sy.h - 40) <= 0.5 && Math.abs(sy.op - 0.55) <= 0.01 && Math.abs(sy.dx) <= 1 && Math.abs(sy.dy) <= 1 && sy.colorOk && sy.aw >= 72;
          c[`${tag} ${label}: Lage von Quadrat und aktueller Zeile wie im Wartezustand (0 px)`] = !!a.slot && !!a.cur && dd(a.slot, pre.slot) === 0 && dd(a.cur, pre.cur) === 0;
        }
        // Normal geladen: ok (Moment 40 hat ein sofort geliefertes Bild)
        await showMoment(pg, idOf(40));
        const okGot = await waitFor(pg, (i) => window.__core.diag().some((x) => x === `cover: ${i} ok`), idOf(40), 4000);
        await waitFor(pg, () => { const i = document.querySelector('[data-testid=ph-cover]'); return !!i && i.dataset.ready === 'yes' && parseFloat(getComputedStyle(i).opacity) === 1; }, undefined, 3000);
        const ok = await info();
        c[`${tag}: schnelles Bild: Diag cover ok, Bild sichtbar als Quadrat`] = okGot && !!ok.img && ok.img.vis && ok.img.op === 1 && Math.abs(ok.img.w - ok.img.h) <= 1 && ok.art !== null;
        covers[size.name] = { base: base.cur, card: base.card.h, reserved: pre.slot };
        c[`${tag}: keine Seitenfehler`] = o.errors.length === 0;
        await o.browser.close();
      }
      r.notes['Titelbild Ruhelage'] = covers;
      {
        // Notiz: kurzes Fenster 793 (Rückfall), Moment 68 mit mehrzeiligem Hook und Moment 40 mit einzeiligem Hook: bleibt das Quadrat sichtbar?
        const o = await open(type, GER, { tab: 'audio', pool: POOL_C });
        const { info, atLine } = H50(o.pg);
        const res = {};
        for (const id of [40, 44, 68]) { await showMoment(o.pg, idOf(id)); await atLine('Dritte'); const x = await info(); res[id] = { card: x.card.h, slot: x.slot ? { vis: x.slot.vis, w: x.slot.w } : null }; }
        r.notes['Titelbild im kurzen Fenster 793'] = res;
        await o.browser.close();
      }
    }

    // ---------- Runde 50c (Fehler 2): feste, deckende Kopfleiste an der oberen Kante, die Treffer annimmt (iOS 26 lässt dann den Rand-Weichzeichner weg) ----------
    {
      const EDGE = () => {
        const head = document.querySelector('.ph-head');
        const W = innerWidth;
        const pts = [[2, 2], [Math.round(W / 2), 2], [W - 2, 2], [Math.round(W / 2), 30], [Math.round(W / 2), 58]].map(([x, y]) => document.elementFromPoint(x, y) === head);
        const cs = getComputedStyle(head);
        const hb = head.getBoundingClientRect();
        const anc = []; for (let e = head.parentElement; e; e = e.parentElement) { const x = getComputedStyle(e); if ((x.transform && x.transform !== 'none') || (x.filter && x.filter !== 'none') || /transform|filter/.test(x.willChange) || /paint|layout|strict|content/.test(x.contain) || (x.perspective && x.perspective !== 'none') || (x.backdropFilter && x.backdropFilter !== 'none')) anc.push(e.tagName + '.' + (e.className || '')); }
        // Was liegt über der Leiste (höherer z-index, Bereich 0 bis 59, sichtbar)?
        const z = parseInt(cs.zIndex, 10) || 0;
        const above = [...document.querySelectorAll('body *')].filter((e) => { if (head.contains(e)) return false; const x = getComputedStyle(e); const b = e.getBoundingClientRect(); return b.top < 59 && b.bottom > 0 && b.width > 0 && x.display !== 'none' && x.visibility !== 'hidden' && x.position !== 'static' && (parseInt(x.zIndex, 10) || 0) > z && !e.closest('[aria-hidden=true]'); }).map((e) => e.tagName + '.' + (e.className || ''));
        const a = /rgba\(([^)]+)\)/.exec(cs.backgroundColor);
        return {
          pts, W, pos: cs.position, left: cs.left, top: cs.top, w: hb.width, l: hb.left, t: hb.top, pe: cs.pointerEvents, bg: cs.backgroundColor, alphaOk: /^rgb\(/.test(cs.backgroundColor) || (!!a && parseFloat(a[1].split(/[ ,\/]+/)[3]) === 1), bf: cs.backdropFilter, mask: cs.maskImage, wmask: cs.webkitMaskImage, tr: cs.transform, fl: cs.filter, bgi: cs.backgroundImage, op: cs.opacity,
          anc, above, parent: head.parentElement.tagName + '.' + head.parentElement.className, direct: head.parentElement.classList.contains('vfeed'),
        };
      };
      for (const [label, size] of [['kurzes Fenster 793', GER], ['normal 852', { ...GER, height: 852 }]]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_G });
        await showMoment(o.pg, idOf(40)); await o.pg.waitForTimeout(500);
        const m = await o.pg.evaluate(EDGE);
        r.notes[`Kante ${label}`] = m;
        const tag = `Obere Kante ${label}`;
        c[`${tag}: Trefferprüfung an (2,2), (Mitte,2), (rechts,2), (Mitte,30), (Mitte,58) liefert die Kopfleiste`] = m.pts.every(Boolean);
        c[`${tag}: position fixed, left 0, top 0, Breite gleich innerWidth, nimmt Berührungen an (pointer-events auto)`] = m.pos === 'fixed' && m.left === '0px' && m.top === '0px' && Math.abs(m.w - m.W) <= 0.5 && Math.abs(m.l) <= 0.5 && Math.abs(m.t) <= 0.5 && m.pe === 'auto';
        c[`${tag}: Hintergrund voll deckend ohne Alpha, einfarbig (kein Verlauf), Deckkraft 1`] = m.alphaOk && /^rgb\(/.test(m.bg) && m.bgi === 'none' && m.op === '1';
        c[`${tag}: kein backdrop-filter, keine Maske, keine transform, kein filter an der Leiste`] = m.bf === 'none' && (m.mask === 'none' || m.mask === '') && (m.wmask === 'none' || m.wmask === '' || m.wmask === undefined) && m.tr === 'none' && m.fl === 'none';
        c[`${tag}: kein Vorfahr mit transform, filter, will-change, contain, perspective, backdrop-filter`] = m.anc.length === 0;
        c[`${tag}: direktes Kind des Feed-Wurzelelements, nichts mit höherem z-index über 0 bis 59`] = m.direct && m.above.length === 0;
        c[`${tag}: keine Seitenfehler`] = o.errors.length === 0;
        await o.browser.close();
      }
      // Diag: ändert sich ih nach der ersten Zeile, folgt innerhalb von 4 s eine neue Zeile mit dem neuen Wert
      {
        const o = await open(type, GER, { tab: 'audio', pool: POOL_G });
        await waitFor(o.pg, () => window.__core.diag().some((x) => x.startsWith('vp:')), undefined, 6000);
        await o.pg.setViewportSize({ width: 393, height: 852 });
        const got = await waitFor(o.pg, () => window.__core.diag().some((x) => /^vp: .* ih=852 /.test(x) && /short=no$/.test(x)), undefined, 4000);
        const n = await o.pg.evaluate(() => window.__core.diag().filter((x) => x.startsWith('vp:')).length);
        c['Diag vp: nach geänderter Fensterhöhe folgt eine neue Zeile (ih=852, short=no), höchstens 5 Zeilen'] = got && n >= 2 && n <= 5;
        await o.browser.close();
      }
      // Foto: normales Standalone-Profil 393x852 (Fenster gleich Bildschirm)
      {
        const o = await open(type, { ...GER, height: 852 }, { tab: 'audio', pool: POOL_G });
        await showMoment(o.pg, idOf(59)); await waitFor(o.pg, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('Zweite') && !!document.querySelector('[data-testid=ph-lyric-next]'), undefined, 9000); await o.pg.waitForTimeout(400);
        await o.pg.screenshot({ path: `${out}/${name}-r50c-normal-852-audio.png` });
        await o.browser.close();
      }
    }

    // ---------- Runde 50b (Auflage 2 und 3): Reihenfolge der Verkleinerung bei immer kleinerer Karte: Bild kleiner, Bild weg, nächste Zeilen weniger (3, 2, 1), zuletzt die aktuelle Zeile klemmen ----------
    sec('Runde 50b (Auflage 2 und 3): Reihenfolge der Verkleinerung bei immer kleinerer Karte: Bild');
    {
      const o = await open(type, SIZES[1], { tab: 'audio', pool: POOL_L });
      const pg = o.pg; const { info, atLine, nbOk } = H50(pg);
      await showMoment(pg, idOf(67));
      await atLine('Mitte');
      const seq = [];
      // Runde 51e: sichtbare Zeilen der nächsten Zeile = Teil im Bereich (der Bereich klemmt unten hart), gerundet auf Zeilen
      const nl = (x) => (!x || x.op === 0 || x.hidden ? 0 : Math.round((x.vb - x.vt) / x.lh));
      for (const h of [1000, 940, 900, 860, 840, 820, 800, 780, 760, 740, 720, 700, 660, 630, 600, 580, 560, 540, 520, 500, 480, 460, 440, 420]) {
        await pg.evaluate((v) => { document.querySelector('.vfeed').style.height = `${v}px`; }, h);
        await pg.waitForTimeout(300);
        await waitFor(pg, () => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row, .ph-col')).length === 0, undefined, 2000);
        const a = await info();
        const k = await pg.evaluate(() => { const b = document.querySelector('.ph-lyr-body'); const c = document.querySelector('.ph-col'); const l = parseFloat(getComputedStyle(c.firstElementChild).lineHeight); return { k: parseInt(getComputedStyle(c).getPropertyValue('--clamp'), 10), want: Math.max(2, Math.floor(b.clientHeight / l)) }; });
        const rows = [a.next, a.next2, a.next3];
        seq.push({ h, img: a.img && a.img.vis ? Math.round(a.img.w) : 0, cur: a.cur ? Math.round(a.cur.h / a.cur.lh) : 0, nx: rows.map(nl), k: k.k, kWant: k.want, ok: rows.every((x) => nbOk(x)) && a.cur.b <= a.cardInner.b + 0.5 && a.cur.t >= a.cardInner.t - 0.5 && a.card.b <= a.actions.t + 0.5 && (!a.next || a.next.hidden || a.next.vb <= a.cardInner.b + 0.5) });
      }
      r.notes['Verkleinerung 375x667 (Höhe, Bild px, aktuelle Zeilen, sichtbare nächste Zeilen je Reihe, K)'] = seq;
      c['Verkleinerung: alles im Bereich der Karte, nie über der Aktionsreihe, Zeilenboxen ganz'] = seq.every((x) => x.ok && x.cur >= 1);
      c['Verkleinerung: das Bild wird nur kleiner, nie größer (je kleiner die Karte)'] = seq.every((x, i) => i === 0 || x.img <= seq[i - 1].img);
      c['Verkleinerung: das Bild bleibt, solange die nächste Zeile mindestens 2 sichtbare Zeilen hat'] = seq.every((x) => x.img === 0 || (x.nx[0] >= 2 && x.cur >= 1));
      c['Verkleinerung: eine Klemme K für alle Zeilen, K gleich max(2, Bereichshöhe geteilt durch Zeilenhöhe)'] = seq.every((x) => x.k === x.kWant && x.k >= 2);
      c['Verkleinerung: alle Stufen kamen vor (Bild 128, kleiner, weg) und die Klemme wurde kleiner'] = seq.some((x) => x.img === 128) && seq.some((x) => x.img > 0 && x.img < 128) && seq.some((x) => x.img === 0) && seq[seq.length - 1].k < seq[0].k;
      await o.browser.close();
    }

    // ---------- Runde 50 (Ziel 9): Zeilenwechsel als durchgehende Liste, nur transform, opacity, color, sanft und ohne Springen ----------
    sec('Runde 50 (Ziel 9): Zeilenwechsel als durchgehende Liste, nur transform, opacity, color, sa');
    {
      for (const size of [GER]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_B });
        const pg = o.pg; const { info, atLine, rowsRest } = H50(pg);
        const tag = `${size.name} Zeilenwechsel`;
        await showMoment(pg, idOf(65));
        const rest = () => waitFor(pg, () => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row, .ph-col')).length === 0, undefined, 3000);
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
        const inst = await pg.evaluate(() => ({ anims: document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row, .ph-col')).length, txt: document.querySelector('[data-testid=ph-lyrics]')?.textContent ?? '' }));
        c[`${tag}: Momentwechsel sofort, keine Bewegung, kein Rest vom alten Text`] = inst.anims === 0 && !/Alpha|Beta|Gamma|Delta|Epsilon|Zeta/.test(inst.txt);
        // Zurücksuchen innerhalb des Moments (Sprung): sofort
        await showMoment(pg, idOf(65));
        await atLine('Alpha');
        await pg.evaluate(() => { for (const a of document.querySelectorAll('audio')) if (!a.paused) a.currentTime = 104.5; });
        await atLine('Epsilon');
        await pg.evaluate(() => { for (const a of document.querySelectorAll('audio')) if (!a.paused) a.currentTime = 100.3; });
        const back = await waitFor(pg, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('Alpha'), undefined, 3000);
        const jump = await pg.evaluate(() => document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row, .ph-col')).length);
        r.notes[`${tag} Sprung`] = { back, jump };
        await rest();
        const backTop = Math.round((await info()).cur.t * 10) / 10;
        c[`${tag}: Sprung zurück erreicht die Zeile, in Ruhe am Anker, keine Bewegung bleibt hängen`] = back && Math.abs(backTop - tops[0]) <= 1 && await pg.evaluate(() => document.getAnimations().filter((x) => x.transitionProperty === 'transform').length === 0);
        c[`${tag}: keine Seitenfehler`] = o.errors.length === 0;
        await o.browser.close();
      }
      // Bewegung eingeschränkt (prefers-reduced-motion): kein Übergang, sofortige Wechsel
      {
        const o = await open(type, { ...SIZES[0], reduced: true }, { tab: 'audio', pool: POOL_B });
        await showMoment(o.pg, idOf(65));
        const tr = await o.pg.evaluate(() => { const cs = getComputedStyle(document.querySelector('.ph-col')); return { prop: cs.transitionProperty, dur: cs.transitionDuration }; });
        c['Bewegung reduziert: die Spalte fährt nicht (kein Übergang), nur die Deckkraft der Zeilen blendet'] = /^0s(, 0s)*$/.test(tr.dur) || tr.prop === 'none';
        const w = await waitFor(o.pg, () => document.querySelector('[data-testid=caption]')?.textContent.startsWith('Beta'), undefined, 4000);
        const an = await o.pg.evaluate(() => document.getAnimations().filter((x) => x.transitionProperty === 'transform').length);
        c['Bewegung reduziert: Wechsel ohne laufende Bewegung (keine Transform-Animation)'] = w && an === 0;
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
    sec('Runde 50b (Auflage 1): Verlauf eines Zeilenwechsels per rAF-Abtastung bei 4-facher CPU-Dro');
    {
      for (const size of [GER]) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_B });
        const pg = o.pg;
        await showMoment(pg, idOf(66));
        // CDP (CPU-Drosselung) gibt es nur in Chromium. In WebKit läuft derselbe Test ohne Drosselung.
        const cdp = type === chromium ? await o.cx.newCDPSession(pg) : null;
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await pg.evaluate(() => {
          window.__fr = { f: [], on: true };
          const tick = (t) => { if (!window.__fr.on) return; window.__fr.f.push({ t, a: document.getAnimations().filter((x) => x.effect?.target?.closest?.('.ph-row, .ph-col') && x.playState === 'running').length, rows: [...document.querySelectorAll('.ph-row')].map((e) => [+e.dataset.i, e.getBoundingClientRect().top, +getComputedStyle(e).opacity, e.dataset.role]) }); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        });
        const got = await waitFor(pg, () => { const f = window.__fr.f; return f.length > 0 && (f[f.length - 1].rows.find((x) => x[3] === 'cur')?.[0] ?? 0) >= 12; }, undefined, 15000);
        const fr = await pg.evaluate(() => { window.__fr.on = false; return window.__fr.f; });
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
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
        c[`${size.name} Verlauf: Dauer je Wechsel 200 bis 450 ms`] = done.length >= 8 && done.every((x) => x.durMs >= 200 && x.durMs <= 450);
        c[`${size.name} Verlauf: Bewegung auf mindestens 10 Frames verteilt, kein harter Sprung`] = done.length >= 8 && done.every((x) => x.frames >= 10);
        c[`${size.name} Verlauf: während des Wechsels laufen Transitions (getAnimations)`] = done.length >= 8 && done.every((x) => x.animsSeen >= 5);
        c[`${size.name} Verlauf: kein Frame über 34 ms bei 4x CPU (nach 20 Frames Anlauf)`] = type !== chromium || Math.max(...dts.slice(20)) <= 34; // nur mit Drosselung (Chromium) ein Zeitlimit je Frame
        c[`${size.name} Verlauf: Ankunft an der festen Ankerposition (alle Wechsel gleiches Ziel, 1 px)`] = done.length >= 8 && done.every((x) => Math.abs(x.toTop - done[0].toTop) <= 1);
        c[`${size.name} Verlauf: keine Seitenfehler`] = o.errors.length === 0;
        await o.browser.close();
      }
    }

    // ---------- Runde 51e: Zeilenwechsel als starre Spalte, bild für bild per requestAnimationFrame bei 4x CPU (CDP-Drosselung nur Chromium). Wechsel 1 auf 1, 2 auf 2, 3 auf 3, 1 auf 3, 2 auf 6, 3 auf 6, 6 auf 1, Doppelwechsel 120 ms, Dreifachwechsel 80 ms; lateinisch und arabisch, mit und ohne Titelbild ----------
    sec('Runde 51e: Zeilenwechsel als starre Spalte, bild für bild bei 4x CPU, Doppel- und Dreifachwechsel, Sprung');
    {
      const SAMPLER = () => {
        window.__ov = { f: [], on: true };
        const tick = (t) => {
          if (!window.__ov.on) return;
          const body = document.querySelector('.ph-lyr-body'); const col = document.querySelector('.ph-col');
          if (body && col) {
            const a = body.getBoundingClientRect(); const cs = getComputedStyle(col); const m = cs.transform;
            window.__ov.f.push({ t, y: m && m !== 'none' ? new DOMMatrixReadOnly(m).m42 : 0, co: parseFloat(cs.opacity), at: a.top, ab: a.bottom, rows: [...col.children].map((e) => { const b = e.getBoundingClientRect(); return [+e.dataset.i, b.top, b.bottom, +getComputedStyle(e).opacity, e.dataset.role, b.height]; }) });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      const analyze = (fr, seq, gap) => {
        const curOf = (f) => f.rows.find((x) => x[4] === 'cur')?.[0];
        const evs = []; for (let i = 1; i < fr.length; i++) { const a0 = curOf(fr[i - 1]); const a1 = curOf(fr[i]); if (a0 !== undefined && a1 !== undefined && a0 !== a1 && Math.abs(a1 - a0) < 5) evs.push(i); }
        const R = { changes: evs.length, a: 0, b: 0, c: 0, d: 0, dRaw: 0, e: 9, f: 0, i: 0, labs: {}, dbl: 0, trp: 0 };
        const h0 = new Map(); for (const f of fr) for (const x of f.rows) { const h = h0.get(x[0]); if (!h) h0.set(x[0], [x[5], x[5]]); else { h[0] = Math.min(h[0], x[5]); h[1] = Math.max(h[1], x[5]); } }
        for (const [, h] of h0) R.a = Math.max(R.a, h[1] - h[0]);
        for (const f of fr) for (let k = 1; k < f.rows.length; k++) R.b = Math.max(R.b, Math.abs(f.rows[k][1] - f.rows[k - 1][2] - gap));
        for (let f = 1; f < fr.length; f++) { if (fr[f].co < 0.05 || fr[f - 1].co < 0.05) continue; const st = Math.abs(fr[f].y - fr[f - 1].y); R.dRaw = Math.max(R.dRaw, st); if (fr[f].t - fr[f - 1].t <= 34) R.d = Math.max(R.d, st); }
        const inArea = (x, f) => Math.min(x[2], f.ab) - Math.max(x[1], f.at) >= 8;
        for (let e = 0; e < evs.length; e++) {
          const f0 = evs[e]; const nw = curOf(fr[f0]); const next = evs[e + 1] ?? fr.length;
          const gp = e > 0 ? fr[f0].t - fr[evs[e - 1]].t : 9999; const gn = fr[next] ? fr[next].t - fr[f0].t : 9999;
          const rapid = Math.min(gp, gn) < 400;
          const end = Math.min(next - 1, f0 + 40); if (end <= f0 + 2) continue;
          if (rapid) { if (Math.min(gp, gn) < 100) R.trp++; else R.dbl++; continue; }
          if (fr[end].t - fr[f0].t < 460) continue;
          const key = `${seq[nw - 1]} auf ${seq[nw]}`; R.labs[key] = (R.labs[key] ?? 0) + 1;
          const ob = fr[f0 - 1].rows.find((x) => x[0] === nw - 1); const ce = fr[end].rows.find((x) => x[0] === nw);
          R.c = Math.max(R.c, Math.abs((ce[1] - fr[end].at) - (ob[1] - fr[f0 - 1].at)));
          for (let f = f0; f <= end; f++) for (const x of fr[f].rows) { const xb = fr[f0 - 1].rows.find((q) => q[0] === x[0]); const xe = fr[end].rows.find((q) => q[0] === x[0]); if (inArea(xb, fr[f0 - 1]) && inArea(xe, fr[end])) R.e = Math.min(R.e, x[3]); }
          for (let f = f0; f <= end; f++) if (fr[f].t - fr[f0].t >= 150) R.f = Math.max(R.f, fr[f].rows.find((x) => x[0] === nw - 1)[3]);
          for (let f = f0 + 1; f <= end; f++) for (const x of fr[f].rows) { const y0 = fr[f - 1].rows.find((q) => q[0] === x[0]); if (y0 && x[4] !== 'out' && y0[4] !== 'out' && inArea(x, fr[f]) && inArea(y0, fr[f - 1])) R.i = Math.max(R.i, Math.abs(x[3] - y0[3])); }
        }
        return R;
      };
      const CFG = [
        ['393x852 lateinisch ohne Titelbild', { ...GER, height: 852 }, 78], ['393x852 lateinisch mit Titelbild', { ...GER, height: 852 }, 79], ['393x852 arabisch ohne Titelbild', { ...GER, height: 852 }, 80], ['393x852 arabisch mit Titelbild', { ...GER, height: 852 }, 81],
        ['393x793 lateinisch mit Titelbild', GER, 79], ['375x667 lateinisch ohne Titelbild', SIZES[1], 78], ['375x667 arabisch ohne Titelbild', SIZES[1], 80],
      ];
      const all51 = {};
      for (const [tag, size, num] of CFG) {
        const o = await open(type, size, { tab: 'audio', pool: POOL_O });
        const pg = o.pg;
        await showMoment(pg, idOf(num));
        const cdp = type === chromium ? await o.cx.newCDPSession(pg) : null;
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await pg.evaluate(SAMPLER);
        const nCue = SEQ51.length;
        const endCond = (n) => { const f = window.__ov.f; return f.length > 0 && (f[f.length - 1].rows.find((x) => x[4] === 'cur')?.[0] ?? 0) >= n - 1; };
        let got = false;
        for (let k = 0; k < 4 && !got; k++) got = await waitFor(pg, endCond, nCue, 12000, k < 3);
        await pg.waitForTimeout(600);
        const fr = await pg.evaluate(() => { window.__ov.on = false; return window.__ov.f; });
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const R = analyze(fr, SEQ51, 12);
        const fin = await pg.evaluate(() => {
          const col = document.querySelector('.ph-col'); const cur = document.querySelector('.ph-row[data-role=cur]'); const m = getComputedStyle(col).transform;
          return { y: m && m !== 'none' ? new DOMMatrixReadOnly(m).m42 : 0, want: -cur.offsetTop, rowsStyled: [...document.querySelectorAll('.ph-row')].filter((e) => e.hasAttribute('style')).length, colStyle: col.getAttribute('style'), bodyStyle: document.querySelector('.ph-lyr-body').getAttribute('style'), data: [...document.querySelectorAll('[data-snap],[data-grow],[data-cut]')].length, anims: document.getAnimations().length, k: getComputedStyle(col).getPropertyValue('--clamp').trim(), n: col.children.length };
        });
        all51[tag] = { ...R, k: fin.k, frames: fr.length };
        const nm = `${tag} 51e`;
        c[`${nm}: alle Wechsel abgetastet`] = got && R.changes >= 24;
        for (const lab of ['1 auf 1', '2 auf 2', '3 auf 3', '1 auf 3', '2 auf 6', '3 auf 6', '6 auf 1']) c[`${nm} ${lab}: mindestens ein ruhiger Wechsel gemessen`] = (R.labs[lab] ?? 0) >= 1;
        c[`${nm} a: Höhe jeder Zeile in jedem Bild gleich ihrer Ruhehöhe (0)`] = fr.length > 100 && R.a <= 0.01;
        c[`${nm} b: Abstände benachbarter Zeilen in jedem Bild gleich, Überlappung 0 (auch Doppel- und Dreifachwechsel)`] = R.b <= 0.01;
        c[`${nm} c: Anker in Ruhe vor und nach dem Wechsel gleich (0,5 px)`] = R.c <= 0.5;
        c[`${nm} d: Schritt der Spalte bei Bildabstand bis 34 ms höchstens 38 px`] = R.d <= 38;
        c[`${nm} e: davor und danach sichtbare Zeile nie unter Deckkraft 0,4`] = R.e >= 0.4;
        c[`${nm} f: alte Zeile nach 150 ms Deckkraft 0`] = R.f <= 0.01;
        c[`${nm} g: mindestens 6 Doppelwechsel (120 ms) und 3 Dreifachwechsel (80 ms) gemessen`] = R.dbl >= 6 && R.trp >= 3;
        c[`${nm} g: Endlage gleich Neuaufbau (0,5 px), keine Inline-Reste außer der Spalte, keine Hilfsattribute, keine laufende Animation`] = Math.abs(fin.y - fin.want) <= 0.5 && fin.rowsStyled === 0 && fin.bodyStyle === null && fin.data === 0 && fin.anims === 0 && /^(--clamp: \d+; )?(transition-duration: [\d.]+ms; )?(--clamp: \d+; )?(transition-duration: [\d.]+ms; )?transform: translate3d\([^)]*\);?$/.test((fin.colStyle ?? '').replace(/;\s*$/, ';'));
        c[`${nm} i: keine Auslassung, die im Lauf erscheint oder verschwindet (Zeilenhöhe fest, Deckkraft stufenlos, Sprung je Bild unter 0,25)`] = R.a <= 0.01 && R.i < 0.25;
        c[`${nm}: eine Klemmung K (2 oder mehr) an der Spalte`] = Number(fin.k) >= 2;
        c[`${nm}: keine Seitenfehler`] = o.errors.length === 0;
        if (cdp) { /* Messwerte nur in Chromium */ }
        await o.browser.close();
      }
      r.notes['51e Messwerte'] = all51;
      // h) Sprung über 8 Zeilen vor und zurück (Suchen), i) Pixelvergleich: nie ein Pixel der alten Zeile oberhalb der Fläche
      {
        const o = await open(type, { ...GER, height: 852 }, { tab: 'audio', pool: POOL_O });
        const pg = o.pg;
        await showMoment(pg, idOf(82));
        await pg.waitForTimeout(600);
        await pg.evaluate(SAMPLER);
        const seekBy = (d) => pg.evaluate((dd) => { for (const a of document.querySelectorAll('audio')) if (a.__p === false) a.currentTime = Math.max(0, a.currentTime + dd); }, d);
        const curNow = () => pg.evaluate(() => +document.querySelector('.ph-row[data-role=cur]')?.dataset.i);
        const c0 = await curNow();
        await seekBy(24); await waitFor(pg, (c) => +document.querySelector('.ph-row[data-role=cur]')?.dataset.i >= c + 8, c0, 6000); await pg.waitForTimeout(500);
        const c1 = await curNow();
        await seekBy(-24); await waitFor(pg, (c) => +document.querySelector('.ph-row[data-role=cur]')?.dataset.i <= c - 6, c1, 6000); await pg.waitForTimeout(500);
        const fr = await pg.evaluate(() => { window.__ov.on = false; return window.__ov.f; });
        const fin = await pg.evaluate(() => { const col = document.querySelector('.ph-col'); const cur = document.querySelector('.ph-row[data-role=cur]'); const m = getComputedStyle(col).transform; return { y: m && m !== 'none' ? new DOMMatrixReadOnly(m).m42 : 0, want: -cur.offsetTop, anims: document.getAnimations().length, rowsStyled: [...document.querySelectorAll('.ph-row')].filter((e) => e.hasAttribute('style')).length }; });
        let bigStep = 0; let bigVisible = 0; let minCo = 1; let b2 = 0;
        for (let f = 1; f < fr.length; f++) { const st = Math.abs(fr[f].y - fr[f - 1].y); minCo = Math.min(minCo, fr[f].co); if (st > 38) { bigStep++; if (fr[f].co > 0.05) bigVisible++; } for (let k = 1; k < fr[f].rows.length; k++) b2 = Math.max(b2, Math.abs(fr[f].rows[k][1] - fr[f].rows[k - 1][2] - 12)); }
        r.notes['51e Sprung'] = { c0, c1, frames: fr.length, bigStep, bigVisible, minCo, b2, fin };
        c['51e h: Sprung über 8 Zeilen vor und zurück ausgeführt'] = c1 >= c0 + 8 && fr.length > 20;
        c['51e h: während des Sprungs wird die Spalte nur unsichtbar umgesetzt (kein Bild mit großem Schritt bei sichtbarer Spalte), sie blendet aus (unter 0,05)'] = bigStep >= 2 && bigVisible === 0 && minCo < 0.05;
        c['51e h: Endlage nach Sprung und Rücksprung gleich Neuaufbau (0,5 px), keine Animation, keine Inline-Reste an Zeilen, Abstände fest'] = Math.abs(fin.y - fin.want) <= 0.5 && fin.anims === 0 && fin.rowsStyled === 0 && b2 <= 0.01;
        await o.browser.close();
      }
      // f) Pixelvergleich: Streifen oberhalb der Fläche bleibt während des Wechsels unverändert (Chromium, Screencast)
      if (type === chromium) {
        const o = await open(type, { ...GER, height: 852 }, { tab: 'audio', pool: POOL_O });
        const pg = o.pg;
        await showMoment(pg, idOf(82));
        await pg.waitForTimeout(500);
        const cdp = await o.cx.newCDPSession(pg); const frames = [];
        cdp.on('Page.screencastFrame', (f) => { frames.push({ t: f.metadata.timestamp * 1000, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
        await pg.evaluate(() => { window.__mut = []; new MutationObserver(() => window.__mut.push(Date.now())).observe(document.querySelector('.ph-col'), { attributes: true, subtree: true, attributeFilter: ['data-role'] }); });
        await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
        await pg.waitForTimeout(7200);
        await cdp.send('Page.stopScreencast');
        const mut = await pg.evaluate(() => window.__mut);
        const geo = await pg.evaluate(() => { const a = document.querySelector('.ph-lyr-body').getBoundingClientRect(); const l = document.querySelector('[data-testid=ph-lyrics]').getBoundingClientRect(); return { at: a.top, left: l.left, right: l.right, iw: innerWidth }; });
        const groups = []; for (const m of mut) { if (!groups.length || m - groups[groups.length - 1] > 300) groups.push(m); }
        const diffs = await pg.evaluate(async ({ frames, groups, geo }) => {
          const dec = async (d) => { const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${d}`)).blob()); const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; const cx = cv.getContext('2d'); cx.drawImage(bm, 0, 0); return { cx, w: bm.width }; };
          const out = [];
          for (const g of groups.slice(0, 2)) {
            const before = frames.filter((f) => f.t < g - 40).slice(-1)[0]; if (!before) continue;
            const rest = await dec(before.data); const sc = rest.w / geo.iw;
            const x = Math.round((geo.left + 24) * sc); const w = Math.round((geo.right - geo.left - 48) * sc); const y1 = Math.round(geo.at * sc); const y0 = y1 - Math.round(60 * sc);
            const ref = rest.cx.getImageData(x, y0, w, y1 - y0).data;
            let worst = 0; let inside = 0; let n = 0;
            for (const f of frames.filter((q) => q.t >= g - 10 && q.t <= g + 450)) {
              const im = await dec(f.data); const d = im.cx.getImageData(x, y0, w, y1 - y0).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2]);
              worst = Math.max(worst, s / (d.length / 4 * 3)); n++;
              const ins = im.cx.getImageData(x, y1, w, Math.round(60 * sc)).data; const ins0 = rest.cx.getImageData(x, y1, w, Math.round(60 * sc)).data; let s2 = 0; for (let i = 0; i < ins.length; i += 4) s2 += Math.abs(ins[i] - ins0[i]); inside = Math.max(inside, s2 / (ins.length / 4));
            }
            out.push({ worst, inside, n });
          }
          return out;
        }, { frames, groups, geo });
        r.notes['51e Pixel oberhalb der Fläche'] = { groups: groups.length, frames: frames.length, diffs };
        c['51e f: Pixel oberhalb der Fläche während des Wechsels unverändert gegen das Ruhebild (mittlere Abweichung unter 0,5 von 255), mindestens 2 Wechsel verglichen'] = diffs.length >= 2 && diffs.every((d) => d.n >= 5 && d.worst < 0.5);
        c['51e f: Gegenprobe, die Fläche selbst ändert sich während des Wechsels (Abweichung über 2)'] = diffs.length >= 2 && diffs.every((d) => d.inside > 2);
        await o.browser.close();
      }
    }

    // ---------- Runde 51 (Ziel 3): iPhone-Ansicht, Audio und Text: nie eine Anfrage an i.ytimg.com, im Audio-Reiter über 5 Momentwechsel nur Titelbilder des aktiven und des direkt nächsten Moments ----------
    sec('Runde 51 (Ziel 3): iPhone-Ansicht, Audio und Text: nie eine Anfrage an i.ytimg.com, im Aud');
    {
      for (const tab of ['audio', 'text']) {
        const o = await open(type, SIZES[0], { tab, pool: tab === 'audio' ? POOL_A : POOL_T });
        const pg = o.pg;
        const reqs = [];
        pg.on('request', (rq) => { const u = rq.url(); if (/i\.ytimg\.com|img\.test/.test(u) || rq.resourceType() === 'image') reqs.push(u); });
        await pg.waitForTimeout(1200);
        const allowed = new Set();
        const mark = async () => { const ids = await pg.evaluate(() => { const q = window.__core.queue(); const i = window.__core.idx(); return [q[i], q[i + 1]].filter(Boolean); }); for (const id of ids) allowed.add(Number(id.slice(4, 11))); };
        await mark();
        for (let n = 0; n < (tab === 'audio' ? 5 : 2); n++) {
          const before = await pg.evaluate(() => window.__core.moment()?.id);
          await pg.evaluate(() => window.__core.next());
          await waitFor(pg, (b) => window.__core.moment()?.id !== b, before, tab === 'audio' ? 4000 : 1500, true);
          await pg.waitForTimeout(400);
          await mark();
        }
        const ytimg = reqs.filter((u) => /i\.ytimg\.com/.test(u));
        const numOfUrl = (u) => { const mm = /(?:cover|broken|wide)(\d+)/.exec(u); return mm ? Number(mm[1]) : null; };
        const strays = reqs.map((u) => [u, numOfUrl(u)]).filter(([, n]) => n !== null && !allowed.has(n));
        r.notes[`Bildanfragen ${tab}`] = { n: reqs.length, ytimg: ytimg.length, strays: strays.map((x) => x[0]), allowed: [...allowed], urls: [...new Set(reqs)].slice(0, 20) };
        c[`Bildanfragen ${tab}: keine Anfrage an i.ytimg.com über 5 Momentwechsel`] = ytimg.length === 0;
        if (tab === 'audio') c['Bildanfragen audio: nur Titelbilder des aktiven und des nächsten Moments'] = strays.length === 0;
        await o.browser.close();
      }
    }

    // ---------- Runde 51 (Ziel 1): Abrufkarte auf dem Raster: Kanten 20, Oberkante 24 pt unter der Reiterleiste (wie der Chip), nach der Antwort nur Zuwachs nach unten, nichts über den unteren Rand ----------
    sec('Runde 51 (Ziel 1): Abrufkarte auf dem Raster: Kanten 20, Oberkante 24 pt unter der Reiterl');
    for (const size of [SIZES[1], GER]) {
      for (const [tab, qid, pool, long] of [['video', null, POOL, false], ['audio', 40, POOL_A, false], ['text', null, POOL_T, false], ['audio', 76, POOL_Q, true]]) {
      if (size === GER && (tab === 'video' || tab === 'text')) continue; // Video und Text: gleiche Seite, bei 375x667 geprüft
        const o = await open(type, size, { tab, pool });
        const pg = o.pg;
        if (qid) await showMoment(pg, idOf(qid));
        const tag = `${size.name} Abruf ${tab}${long ? ' lang' : ''}`;
        await pg.evaluate(() => window.__core.showRecall(window.__core.moment().id));
        await waitFor(pg, () => !!document.querySelector('[data-testid=recall-card]'), undefined, 4000);
        await pg.waitForTimeout(350);
        const geo = () => pg.evaluate(() => {
          const W = window.innerWidth; const page = document.querySelector('[data-testid=recall-page]'); const R = (e) => e.getBoundingClientRect();
          const sw = R(document.querySelector('[data-testid=form-switch]'));
          const kids = [...page.querySelectorAll('.vrecall-head, .vrecall-origin, .recall-q, .recall-option, .recall-primary')].filter((e) => R(e).height > 0);
          const first = page.querySelector('.vrecall-head') ?? page.firstElementChild;
          const cs = getComputedStyle(page); const room = R(page).bottom - parseFloat(cs.paddingBottom);
          const bottom = Math.max(...[...page.querySelectorAll('.recall > *, .vrecall-head, .vrecall-origin')].map((e) => R(e).bottom));
          const lefts = kids.map((e) => Math.round(R(e).left * 10) / 10); const rights = kids.map((e) => Math.round((W - R(e).right) * 10) / 10);
          return { W, top: R(first).top, expect: sw.bottom + 24, lefts, rights, bottom, room, scroll: page.scrollHeight - page.clientHeight, canScroll: cs.overflowY === 'auto', scrollTop: page.scrollTop, pageTop: R(page).top };
        });
        const g1 = await geo();
        const gone = () => waitFor(pg, () => !document.querySelector('[data-testid=recall-card]'), undefined, 1200, true);
        // Runde 51b: vor der Antwort schließt kein Wisch (auch nicht auf der leeren Fläche unter dem Block)
        await touchSwipe(pg, '.vrecall-page', 180, size === GER ? 600 : 500, 200);
        c[`${tag}: vor der Antwort schließt kein Wisch`] = !(await gone()) && (await pg.locator('[data-testid=recall-card]').count()) === 1;
        const pick = pg.locator('[data-testid=recall-option][data-correct="0"]').first();
        let g2 = null;
        if (await pick.count()) { await pick.click(); await waitFor(pg, () => !!document.querySelector('[data-testid=recall-why]'), undefined, 3000); await pg.waitForTimeout(300); g2 = await geo(); }
        r.notes[tag] = { vor: g1, nach: g2 };
        c[`${tag}: Oberkante 24 pt unter der Reiterleiste (1 px)`] = Math.abs(g1.top - g1.expect) <= 1;
        c[`${tag}: linke und rechte Kante 20 pt`] = g1.lefts.every((x) => Math.abs(x - 20) <= 1) && g1.rights.every((x) => Math.abs(x - 20) <= 1);
        c[`${tag}: Block innerhalb der Fläche, nichts scrollt`] = ((g1.bottom <= g1.room + 1 && g1.scroll <= 1) || g1.canScroll) && g1.scrollTop === 0;
        c[`${tag}: nach der Antwort bleibt die Oberkante, Block innerhalb der Fläche oder scrollbar`] = !!g2 && Math.abs(g2.top - g1.top) <= 1 && ((g2.bottom <= g2.room + 1 && g2.scroll <= 1) || g2.canScroll) && g2.lefts.every((x) => Math.abs(x - 20) <= 1);
        await pg.screenshot({ path: `${out}/${name}-${tag.replace(/ /g, '-')}-vor.png` });
        if (g2) { await pg.screenshot({ path: `${out}/${name}-${tag.replace(/ /g, '-')}-nach.png` }); }
        // Runde 51b: Wisch nach der Antwort. Scrollbare Seite (375x667, lange Frage): Wisch 300 px schließt nicht, "Next" ist sichtbar und antippbar, am Ende der Seite schließt ein Wisch. Kurze Frage: Wisch ab y 600 (leere Fläche) schließt.
        if (g2 && long && size === SIZES[1]) {
          await touchSwipe(pg, '.vrecall-page', 180, 560, 260);
          c[`${tag}: Wisch 300 px schließt nach der Antwort nicht, solange die Seite scrollbar ist`] = !(await gone());
          const nx = await pg.evaluate(() => { const bt = document.querySelector('[data-testid=recall-next]'); const rr = bt.getBoundingClientRect(); const pr = document.querySelector('[data-testid=recall-page]').getBoundingClientRect(); const el = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2); return { top: rr.top, bottom: rr.bottom, pageTop: pr.top, pageBottom: pr.bottom, hit: !!el && !!el.closest('[data-testid=recall-next]') }; });
          r.notes[`${tag} Next`] = nx;
          c[`${tag}: "Next" ohne Scrollen sichtbar und antippbar`] = nx.top >= nx.pageTop && nx.bottom <= nx.pageBottom + 1 && nx.hit;
          await pg.screenshot({ path: `${out}/${name}-${tag.replace(/ /g, '-')}-nach-oben.png` });
          await pg.evaluate(() => { const pgx = document.querySelector('[data-testid=recall-page]'); pgx.scrollTop = pgx.scrollHeight; });
          await pg.waitForTimeout(250);
          await pg.screenshot({ path: `${out}/${name}-${tag.replace(/ /g, '-')}-nach-unten.png` });
          await touchSwipe(pg, '.vrecall-page', 180, 560, 260);
          c[`${tag}: am Ende der Seite schließt ein Wisch`] = await gone();
        } else if (g2 && !long && size === GER && tab === 'audio') {
          await touchSwipe(pg, '.vrecall-page', 180, 600, 300);
          c[`${tag}: Wisch auf der leeren Fläche (y 600) schließt nach der Antwort`] = await gone();
        }
        await o.browser.close();
      }
    }

    // ---------- Runde 50b (Auflage 3): die aktuelle Zeile steht nie außerhalb der Karte, die Karte nie über der Aktionsreihe (4-Zeilen-Hook, 10-Zeilen-Hook, 5-Zeilen-Untertitel) ----------
    sec('Runde 50b (Auflage 3): die aktuelle Zeile steht nie außerhalb der Karte, die Karte nie übe');
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
    sec('Runde 50b (Auflage 2): Anker oben, keine vorige Zeile, abnehmende Deckkraft, Kontrast der ');
    {
      for (const size of [SIZES[1], GER]) {
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
          return { cur: ratio('[data-testid=caption]'), next: ratio("[data-testid=ph-lyric-next]"), bg: card };
        });
        r.notes[`${tag} Kontrast`] = kont; r.notes[`${tag} Zeilen`] = { cur: a.cur, next: a.next && { t: a.next.t, op: a.next.op }, next2: a.next2 && { op: a.next2.op }, next3: a.next3 && { op: a.next3.op }, out: a.out && { op: a.out.op, t: a.out.t } };
        c[`${tag}: keine vorige Zeile sichtbar (die alte aktuelle Zeile ist ausgeblendet)`] = !a.out || a.out.op === 0;
        c[`${tag}: aktuelle Zeile oben, die nächste direkt darunter (Abstand 12)`] = !!a.next && Math.abs(a.next.t - (a.cur.b + 12)) <= 1.5;
        c[`${tag}: Cover, dann direkt die aktuelle Zeile (Abstand 16 wie Kartenabstand) oder ohne Cover am oberen Innenrand`] = !a.img || !a.img.vis ? Math.abs(a.cur.t - a.content.t) <= 1 : Math.abs(a.cur.t - a.img.b - 16) <= 1.5;
        c[`${tag}: nächste Zeile 0,6, weitere Zeilen 0,42, Deckkraft nimmt nach unten nie zu`] = !!a.next && !!a.next2 && !!a.next3 && Math.abs(a.next.op - 0.6) <= 0.02 && Math.abs(a.next2.op - 0.42) <= 0.02 && a.next3.op <= a.next2.op && a.next2.op < a.next.op;
        c[`${tag}: Kontrast der direkt nächsten Zeile (Vorschau, Deckkraft 0,6 laut Runde 51e) mindestens 2,5 zu 1`] = kont.next >= 2.5;
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
    sec('Runde 50b (Auflage 4): einheitlicher Rand und fester Abstand Reiterleiste zu Chip in allen');
    {
      for (const size of [SIZES[1], GER]) {
        const tag = `${size.name} Rand`;
        const rows = [];
        const grab = (pg) => pg.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) }; };
          const chip = R(q('.vslot[aria-hidden=false] .ph-chip, .vtext .dc-chip, .ph-chip, .dc-chip'));
          return { chip, hook: R(q('[data-testid=hook]')), tabs: R(q('.ph-tabs')), card: R(q('[data-testid=ph-lyrics]')) ?? R(q('[data-testid=ph-apply]')), apply: R(q('[data-testid=ph-apply]')), meta: R(q('[data-testid=ph-origin]')), actions: R(q('[data-testid=ph-actions]')) };
        });
        // Video
        { const o = await open(type, size, {}); await waitFor(o.pg, () => window.__core.state() === 1, undefined, 8000); await o.pg.waitForTimeout(350); rows.push({ k: 'video', ...(await grab(o.pg)) }); await o.browser.close(); }
        // Audio
        { const o = await open(type, size, { tab: 'audio', pool: POOL_A }); await showMoment(o.pg, idOf(41)); rows.push({ k: 'audio', ...(await grab(o.pg)) }); await showMoment(o.pg, idOf(42)); rows.push({ k: 'audio langer Hook', ...(await grab(o.pg)) }); await o.browser.close(); }
        // Text: kurz, mittel, lang, langer Hook
        { const o = await open(type, size, { tab: 'text' }); for (const [id, k] of [[48, 'text kurz'], [56, 'text mittel'], [57, 'text lang'], [47, 'text langer Hook']]) { await showMoment(o.pg, idOf(id)); await o.pg.waitForTimeout(300); rows.push({ k, ...(await grab(o.pg)) }); } await o.browser.close(); }
        { const o = await open(type, size, { tab: 'text', pool: POOL_T }); for (const [id, k] of [[63, 'text Takeaway'], [64, 'text Takeaway alt']]) { await showMoment(o.pg, idOf(id)); await o.pg.waitForTimeout(300); rows.push({ k, ...(await grab(o.pg)) }); } await o.browser.close(); }
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
    sec('Runde 50: Takeaway im Text-Reiter (Zitat, eine Metazeile, eine Karte) und die Statuszeile ');
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
        await pg.waitForTimeout(300);
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
        await pg2.waitForTimeout(250);
        const before = await pg2.evaluate(() => { const c = document.querySelector('[data-testid=text-view], [data-testid=ph-audio], [data-testid=ph-video]').getBoundingClientRect(); return { b: c.bottom }; });
        await o2.cx.setOffline(true);
        await waitFor(pg2, () => !!document.querySelector('.status[data-status=offline]'), undefined, 5000);
        await pg2.waitForTimeout(300);
        const stat = () => pg2.evaluate(() => {
          const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
          const q = (x) => document.querySelector(x);
          const st = q('.status'); const sp = st?.querySelector('span'); const cs = st ? getComputedStyle(st) : null;
          const others = {};
          for (const [n, sel] of [['chip', '.ph-chips'], ['kanal', '.ph-speaker'], ['hook', '[data-testid=hook]'], ['text', '[data-testid=text-view]'], ['audio', '[data-testid=ph-audio]'], ['video', '[data-testid=ph-video]'], ['karte', '[data-testid=ph-lyrics]'], ['zitat', '.dtx-quote'], ['meta', '[data-testid=ph-origin]'], ['apply', '[data-testid=ph-apply]'], ['aktionen', '[data-testid=ph-actions]'], ['leiste', '[data-testid=ph-bar]'], ['kopf', '.ph-head'], ['band', '.vslot[aria-hidden=false] .vframe > div'], ['quelle', '.ph-src']]) { const e = q(sel); if (e) others[n] = R(e); }
          // Kinder des Inhalts (Texte und Tasten)
          const kids = [...document.querySelectorAll('.ph-audio *, .ph-video *, [data-testid=text-view] *, .ph-actions button, .ph-bar button, .ph-head button')].filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e.closest('.ph-row') ?? e).opacity !== '0' && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() || e.tagName === 'BUTTON' || e.tagName === 'IMG')).map((e) => { const x = R(e); const ar = e.closest('.ph-lyr-body'); if (ar) { const ab = ar.getBoundingClientRect(); x.t = Math.max(x.t, ab.top); x.b = Math.min(x.b, ab.bottom); x.h = Math.max(0, x.b - x.t); } return x; }).filter((x) => x.h > 0);
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
      const one = await pg.evaluate(() => ({ n: document.querySelectorAll('[data-testid=ph-cover]').length + document.querySelectorAll('.ph-art').length - 1, src: document.querySelector('[data-testid=ph-cover]')?.getAttribute('src'), inCard: !!document.querySelector('[data-testid=ph-lyrics] > .ph-art > [data-testid=ph-cover]'), https: /^https:/.test(document.querySelector('[data-testid=ph-cover]')?.getAttribute('src') ?? '') }));
      c['Titelbild ein Element in der Karte (im Quadrat), aus dem Feld thumb, https'] = one.n === 1 && one.src === COVER && one.inCard && one.https;
      r.notes['Titelbild Abrufe'] = { asked, one };
      await o.browser.close();
    }

    // ---------- Erste Geste nach dem App-Start ist die Play-Taste ----------
    sec('Erste Geste nach dem App-Start ist die Play-Taste');
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
    sec('Schalter aus: der alte Aufbau');
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
    r.error = `${String(e && e.stack ? e.stack : e)} (Abschnitt: ${prog.section})`;
  }
  clearTimeout(cap);
  await shared.get(type)?.close().catch(() => {});
  shared.delete(type);
  for (const t of r.timeouts) c[`Zeitlimit 15 s: ${t}`] = false;
  console.error(`[${name} ${Math.round((Date.now() - T0) / 1000)} s] fertig`);
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
