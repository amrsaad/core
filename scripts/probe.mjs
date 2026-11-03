// Tägliche Probe gegen die Live-App (Entscheidung 31, Brief 07). Ein künstlicher Nutzer öffnet die ausgelieferte App,
// sieht einen Moment spielen (stummer Ton, nachgebautes Medien-Element), wechselt durch die Reiter und liest Konsolenfehler.
// Gemessen wird der Stand, der wirklich auf GitHub Pages liegt (Bundle, Start, Reiter), nicht der echte Pool.
// Der Pool wird im Browser durch einen eigenen, mit einem Zufallsschlüssel verschlüsselten Pool ersetzt. Der echte Schlüssel kommt nie hierher.
// Kein YouTube und keine fremden Medien-Hosts: die YouTube-API und alle Streams sind nachgebaut (tests/e2e/fakeyt.js), Schriften und ytimg werden blockiert.
// Aufruf: node scripts/probe.mjs <url> <ausgabeordner>
// Ausgabe: <ausgabeordner>/probe.json (ganzer Befund) und <ausgabeordner>/probe-line.md (eine Tabellenzeile für das Probe-Log).
// Exit 0 bei ok, 1 bei Fehler (die Dateien stehen immer).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices } from 'playwright';

const [url = 'https://amrsaad.github.io/core/', out = 'pipeline/out/probe'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('../tests/e2e/fakeyt.js', import.meta.url), 'utf8');
const FAKE_MEDIA = FAKE.slice(FAKE.indexOf('// Eigene Streams'));
const startedAt = new Date();
const res = { startedAt: startedAt.toISOString(), url, browser: 'chromium', ok: false, firstImageMs: null, tabsOk: false, tabs: {}, errors: [], failedRequests: [], pageStatus: null, pageLastModified: null, poolStatus: null, note: '' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s).replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 90);

// ---------- Eigener Pool ----------
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const today = startedAt.toISOString().slice(0, 10);
const base = (i, extra) => ({ start: 100, end: 160, channel: `Probe ${i % 4}`, videoTitle: 'Probe', area: ['brain', 'body', 'beat'][i % 3], topic: 'augen', kind: 'regel', createdAt: `${today}T00:00:00Z`, ...extra });
const moments = [];
for (let i = 0; i < 12; i++) moments.push(base(i, { id: `probevid${String(i).padStart(3, '0')}:100`, videoId: `probevid${String(i).padStart(3, '0')}`, hook: `Probe video ${i}`, cues: [[0, 'Probe caption one'], [2, 'Probe caption two']] }));
for (let i = 0; i < 12; i++) moments.push(base(i, { id: `probeaud${String(i).padStart(3, '0')}:0`, videoId: `probeaud${String(i).padStart(3, '0')}`, start: 0, end: 40, hook: `Probe audio ${i}`, form: 'audio', audio: true, hls: `https://stream.test/probeaud${i}.m3u8` }));
for (let i = 0; i < 12; i++) moments.push(base(i, { id: `probetxt${String(i).padStart(3, '0')}:100`, videoId: `probetxt${String(i).padStart(3, '0')}`, hook: `Probe text ${i}`, form: 'text', excerpt: 'Probe text for the reading view. '.repeat(6), author: 'Probe Author', ref: 'Probe Ref', license: 'CC BY 4.0', sourceUrl: 'https://example.org/probe' }));
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: startedAt.toISOString(), lastRun: startedAt.toISOString(), moments })));
const poolBody = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
const k = Buffer.from(raw).toString('base64url');

// ---------- Echte Auslieferung kurz prüfen (nur die Live-Seite selbst) ----------
try {
  const r = await fetch(url, { redirect: 'follow' });
  res.pageStatus = r.status;
  res.pageLastModified = r.headers.get('last-modified');
} catch (e) {
  res.pageStatus = 0;
  res.note = clean(`page fetch: ${e.message}`);
}
try {
  const r = await fetch(new URL('moments/pool.enc', url), { method: 'HEAD', redirect: 'follow' });
  res.poolStatus = r.status;
} catch {
  res.poolStatus = 0;
}

// ---------- Der künstliche Nutzer ----------
const ABORT = /i\.ytimg\.com|fonts\.g|youtube\.com\/(?!iframe_api)|youtube-nocookie|googlevideo\.com/;
const waitFor = async (page, fn, arg, timeout = 15000) => {
  try {
    return await page.waitForFunction(fn, arg, { timeout, polling: 25 });
  } catch {
    return null;
  }
};
let browser;
try {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'], ...(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {}) });
  const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await cx.route(ABORT, (x) => x.abort());
  const page = await cx.newPage();
  page.on('pageerror', (e) => res.errors.push(clean(`pageerror ${e.message ?? e}`)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Fehler, die aus unseren eigenen Sperren entstehen (Schriften, ytimg), zählen nicht
    if (ABORT.test(m.location().url ?? '')) return;
    res.errors.push(clean(`console ${m.text()}`));
  });
  page.on('requestfailed', (r) => {
    if (ABORT.test(r.url())) return;
    res.failedRequests.push(clean(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  });
  await page.addInitScript(FAKE_MEDIA);
  await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
  await page.goto(`${url}?seed=3#k=${k}`, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Zeit bis erstes Bild: Navigationsstart bis zum ersten spielenden Moment mit sichtbarem Hook (Zeit im Browser gemessen)
  const first = await waitFor(page, () => (window.__core?.state?.() === 1 && document.querySelector('[data-testid=hook]') ? performance.now() : false), undefined, 30000);
  res.firstImageMs = first ? Math.round(await first.jsonValue()) : null;

  // Reiterwechsel: Audio, Text, zurück auf Video. Jeder Wechsel muss den passenden Moment zeigen.
  const switchTo = async (label, ready) => {
    const t = Date.now();
    try {
      await page.click(`[data-testid=form-switch] >> text=${label}`, { timeout: 8000 });
    } catch {
      return { ok: false, ms: null };
    }
    const ok = !!(await waitFor(page, ready, undefined, 12000));
    return { ok, ms: ok ? Date.now() - t : null };
  };
  res.tabs.audio = await switchTo('Audio', () => window.__core?.moment?.()?.audio === true && window.__core.state() === 1);
  res.tabs.text = await switchTo('Text', () => window.__core?.moment?.()?.form === 'text' && !!document.querySelector('[data-testid=text-view]'));
  res.tabs.video = await switchTo('Video', () => {
    const m = window.__core?.moment?.();
    return !!m && m.audio !== true && m.form !== 'text' && window.__core.state() === 1;
  });
  res.tabsOk = Object.values(res.tabs).every((t) => t.ok);
  await sleep(300);
} catch (e) {
  res.note = clean(`probe: ${e.message ?? e}`);
} finally {
  await browser?.close().catch(() => {});
}

// ---------- Ergebnis ----------
const problems = [];
if (res.pageStatus !== 200) problems.push(`page ${res.pageStatus}`);
if (res.poolStatus !== 200) problems.push(`pool ${res.poolStatus}`);
if (res.firstImageMs === null) problems.push('no first image');
if (!res.tabsOk) problems.push(`tabs ${Object.entries(res.tabs).filter(([, t]) => !t.ok).map(([n]) => n).join('/') || 'none'}`);
if (res.errors.length) problems.push(`errors ${res.errors.length}: ${res.errors[0]}`);
if (res.failedRequests.length) problems.push(`failed requests ${res.failedRequests.length}: ${res.failedRequests[0]}`);
if (res.note) problems.push(res.note);
res.ok = problems.length === 0;
res.problems = problems;

const hhmmss = startedAt.toISOString().slice(11, 19);
const line = `| ${today} | ${hhmmss} | ${res.firstImageMs ?? '-'} | ${res.tabsOk ? 'ok' : 'FEHLER'} | ${res.errors.length + res.failedRequests.length} | ${res.ok ? 'ok' : `FEHLER ${clean(problems.join(', '))}`} | ${process.env.GITHUB_ACTIONS ? 'actions' : 'manuell'} |`;
writeFileSync(`${out}/probe.json`, JSON.stringify(res, null, 2) + '\n');
writeFileSync(`${out}/probe-line.md`, line + '\n');
console.log(line);
process.exit(res.ok ? 0 : 1);
