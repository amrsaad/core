// E2E Geräte-Sync (Max, 28.10.2026) mit nachgebauter GitHub Contents API (api.github.com wird im Browser abgefangen).
// Zwei Geräte = zwei Browser-Kontexte mit eigenem Speicher. Prüft: Token in Settings, 10 s Verzögerung, Merge in beide Richtungen,
// Konflikt (SHA weicht ab), Offline sammeln und nachholen, Fehlerzeile, Token im QR-Link, nur erlaubte Hosts.
// Aufruf: node tests/e2e/sync.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-sync'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const TOKEN = 'github_pat_E2ETESTTOKEN0123456789_abcdefghijklmnopqrstuvwxyz';
const STATE_PATH = '/repos/amrsaad/core-content/contents/state/core-state.enc';

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const m = (i) => ({ id: `sy${i}:1`, videoId: `sytest${String(i).padStart(5, '0')}`, thumb: `${url}apple-touch-icon.png`, start: 1, end: 60, channel: 'Test', videoTitle: 'Test', area: 'brain', topic: 'augen', hook: `Sync ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z' });
const iv0 = crypto.getRandomValues(new Uint8Array(12));
const ct0 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv0 }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: null, moments: Array.from({ length: 8 }, (_, i) => m(i)) })));
mkdirSync('dist/moments', { recursive: true });
writeFileSync('dist/moments/pool.enc', JSON.stringify({ v: 1, iv: b64u(iv0), ct: b64u(ct0) }));
const k = b64u(raw);

// Gleiche Sortierung der Schlüssel wie canon() in der App ist für das Lesen nicht nötig, nur für das Schreiben des Rivalen
const decryptFile = async (text) => {
  const j = JSON.parse(text);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(j.iv, 'base64url') }, key, Buffer.from(j.ct, 'base64url'));
  return JSON.parse(new TextDecoder().decode(pt));
};
const encryptFile = async (doc) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(doc)));
  return JSON.stringify({ v: 1, iv: b64u(iv), ct: b64u(ct) });
};
// Token wie vault.encryptToken: base64url(iv + ct)
const encToken = async (t) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(t)));
  return b64u(Buffer.concat([iv, ct]));
};

/** Nachgebaute API: eine Datei, SHA-Prüfung, Protokoll mit Zeitpunkten */
function mockApi() {
  const api = { file: null, n: 0, puts: [], gets: 0, mode: 'ok', beforePut: null, hosts: new Set() };
  api.handle = async (route, request) => {
    if (api.mode === 'offline') return route.abort('internetdisconnected');
    const u = new URL(request.url());
    if (!u.pathname.endsWith(STATE_PATH)) return route.fulfill({ status: 404, body: '{}' });
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, accept, content-type, x-github-api-version', 'access-control-allow-methods': '*' };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const authH = (await request.allHeaders()).authorization;
    if (authH !== `Bearer ${TOKEN}`) { (api.badAuth ??= []).push(String(authH).replace(TOKEN, '<TOKEN>').slice(0, 80)); return json(401, {}); }
    if (api.mode === 'unauthorized') return json(401, {});
    if (request.method() === 'GET') {
      api.gets++;
      if (!api.file) return json(404, {});
      return json(200, { sha: api.file.sha, size: api.file.text.length, encoding: 'base64', content: Buffer.from(api.file.text).toString('base64') });
    }
    if (request.method() === 'PUT') {
      if (api.beforePut) { await api.beforePut(); api.beforePut = null; }
      const body = JSON.parse(request.postData());
      if ((api.file?.sha ?? undefined) !== body.sha) return json(api.file ? 409 : 422, {});
      api.file = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha${++api.n}` };
      api.puts.push({ at: Date.now(), sha: api.file.sha });
      return json(200, { content: { sha: api.file.sha } });
    }
    return json(405, {});
  };
  return api;
}

const APP = url + '?now=2026-10-22';
const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const poll = async (fn, timeout = 20000) => { const t = Date.now(); while (Date.now() - t < timeout) { if (await fn()) return true; await sleep(100); } return false; };
const text = (page, id) => page.textContent(`[data-testid=${id}]`).catch(() => null);

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    const api = mockApi();
    const requested = new Set();
    const errors = [];
    const mkCtx = async () => {
      const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
      await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
      await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
      await ctx.route('https://api.github.com/**', (route, request) => api.handle(route, request));
      ctx.on('request', (q) => requested.add(new URL(q.url()).host));
      ctx.on('weberror', (e) => errors.push(String(e.error())));
      return ctx;
    };
    const settings = async (page) => { await page.click('nav [aria-label=Settings]'); await page.waitForSelector('[data-testid=sync-card]'); };

    // Gerät A: freischalten, Token einfügen
    const ctxA = await mkCtx();
    const A = await ctxA.newPage();
    await A.goto(`${APP}#k=${k}`);
    c.aUnlocked = await waitFor(A, () => !!window.__core?.moment());
    await settings(A);
    c.noTokenFieldShown = (await A.locator('[data-testid=sync-token]').count()) === 1 && (await A.getAttribute('[data-testid=sync-token]', 'type')) === 'password';
    await A.screenshot({ path: `${out}/${name}-1-settings-ohne-token.png`, fullPage: true });
    await A.fill('[data-testid=sync-token]', 'kein token');
    await A.click('[data-testid=sync-save]');
    c.invalidTokenRejected = !!(await text(A, 'sync-error')) && (await A.locator('[data-testid=sync-token]').count()) === 1;
    await A.fill('[data-testid=sync-token]', TOKEN);
    await A.click('[data-testid=sync-save]');
    c.tokenSaved = await waitFor(A, () => !!document.querySelector('[data-testid=sync-last]'));
    c.tokenFieldGone = (await A.locator('[data-testid=sync-token]').count()) === 0;
    c.tokenNotInDom = !(await A.content()).includes(TOKEN);
    // Erster Lauf: keine Datei auf GitHub, A legt sie an
    c.firstFileCreated = await poll(() => api.puts.length === 1);
    c.lastSyncShown = await waitFor(A, () => /Last sync: (just now|\d+ min ago)/.test(document.querySelector('[data-testid=sync-last]')?.textContent ?? ''));
    await A.screenshot({ path: `${out}/${name}-2-token-gespeichert.png`, fullPage: true });
    const doc1 = api.file ? await decryptFile(api.file.text) : null;
    c.fileEncrypted = !!api.file && !api.file.text.includes('captionMode') && doc1?.v === 1;
    c.tokenNotInFile = !!api.file && !JSON.stringify(doc1).includes(TOKEN);

    // 10 Sekunden nach der letzten Änderung, nicht früher
    const putsBefore = api.puts.length;
    const t0 = Date.now();
    await A.selectOption('[data-testid=captions]', 'on');
    await sleep(8000);
    c.noWriteBefore10s = api.puts.length === putsBefore;
    c.writeAfter10s = await poll(() => api.puts.length === putsBefore + 1, 8000);
    const dt = (api.puts.at(-1)?.at ?? 0) - t0;
    r.writeDelayMs = dt;
    // Untergrenze streng (nie früher als 10 s), Obergrenze so weit wie die Wartezeit davor (8 s + 8 s), damit ein langsamer Runner nicht zählt
    c.writeDelayAbout10s = dt >= 9500 && dt <= 16000;
    c.captionInFile = (await decryptFile(api.file.text)).state.settings?.captionMode === 'on';

    // Entprellen: zwei Änderungen im Abstand von 6 s ergeben nur einen Schreibvorgang, 10 s nach der zweiten
    const p2 = api.puts.length;
    await A.selectOption('[data-testid=captions]', 'off');
    await sleep(6000);
    await A.selectOption('[data-testid=captions]', 'auto');
    const t1 = Date.now();
    c.debounceOneWrite = await poll(() => api.puts.length === p2 + 1, 16000);
    c.debounceFromLast = (api.puts.at(-1)?.at ?? 0) - t1 >= 9500;

    // Gerät B: Link mit Token, wie ihn der QR-Code trägt
    const link = `${APP}#k=${k}&t=${await encToken(TOKEN)}`;
    const ctxB = await mkCtx();
    const B = await ctxB.newPage();
    await B.goto(link);
    c.bUnlocked = await waitFor(B, () => !!window.__core?.moment());
    await settings(B);
    c.bHasTokenFromQr = await waitFor(B, () => !!document.querySelector('[data-testid=sync-last]'));
    c.bGotCaptionsFromA = await poll(async () => (await B.inputValue('[data-testid=captions]').catch(() => '')) === 'auto' && api.gets >= 2);
    // B setzt Abdeckung: andere Einstellung, die A noch nicht hat
    await B.selectOption('[data-testid=speed]', '1');
    const p3 = api.puts.length;
    c.bWrites = await poll(() => api.puts.length === p3 + 1, 16000);
    await A.evaluate(() => window.__sync.syncNow());
    c.aGetsSpeedFromB = await poll(async () => (await A.inputValue('[data-testid=speed]').catch(() => '')) === '1');
    await B.screenshot({ path: `${out}/${name}-3-geraet-b.png`, fullPage: true });

    // Konflikt: ein drittes Gerät schreibt zwischen Lesen und Schreiben von A
    await A.click('nav [aria-label=Feed]');
    await A.evaluate(() => window.__core.next());
    const seenId = await A.evaluate(() => window.__core.moment()?.id);
    await settings(A);
    api.beforePut = async () => {
      const d = await decryptFile(api.file.text);
      d.state.momentSeen = { ...d.state.momentSeen, 'rival:1': 1_700_000_000_000 };
      api.file = { text: await encryptFile(d), sha: `sha${++api.n}` };
    };
    const putGetsBefore = api.gets;
    await A.selectOption('[data-testid=captions]', 'on');
    c.conflictResolved = await poll(() => api.beforePut === null && api.gets > putGetsBefore + 1, 25000);
    await sleep(1500);
    const merged = await decryptFile(api.file.text);
    c.conflictMergedBoth = 'rival:1' in merged.state.momentSeen && merged.state.settings?.captionMode === 'on';
    c.conflictNoErrorLine = !(await text(A, 'sync-error'));
    c.seenIdKept = !!seenId;
    await A.screenshot({ path: `${out}/${name}-4-nach-konflikt.png`, fullPage: true });

    // Offline sammeln, bei Netz nachholen
    api.mode = 'offline'; // gefangene Anfragen umgehen setOffline, deshalb bricht die Nachbildung selbst ab
    const p4 = api.puts.length;
    await A.selectOption('[data-testid=captions]', 'off');
    c.offlineError = await waitFor(A, () => /No connection/.test(document.querySelector('[data-testid=sync-error]')?.textContent ?? ''), null, 20000);
    c.offlineNoPut = api.puts.length === p4;
    c.offlineOneLine = !((await text(A, 'sync-error')) ?? '').includes('\n');
    await A.screenshot({ path: `${out}/${name}-5-offline-fehler.png`, fullPage: true });
    api.mode = 'ok';
    await A.evaluate(() => window.dispatchEvent(new Event('online')));
    c.offlineCaughtUp = await poll(() => api.puts.length === p4 + 1, 20000);
    c.offlineErrorGone = await waitFor(A, () => !document.querySelector('[data-testid=sync-error]'));
    c.offlineCaptionInFile = (await decryptFile(api.file.text)).state.settings?.captionMode === 'off';

    // Token abgelehnt: eine Zeile, kein Token im Text
    api.mode = 'unauthorized';
    await A.click('[data-testid=sync-now]');
    c.authError = await waitFor(A, () => /401/.test(document.querySelector('[data-testid=sync-error]')?.textContent ?? ''));
    const errLine = (await text(A, 'sync-error')) ?? '';
    c.authErrorNoToken = !errLine.includes('github_pat') && !errLine.includes('\n');
    await A.screenshot({ path: `${out}/${name}-6-token-abgelehnt.png`, fullPage: true });
    api.mode = 'ok';

    // QR-Code zeigt den Hinweis zum Token
    await A.click('[data-testid=sync-remove]');
    c.removeShowsField = await waitFor(A, () => !!document.querySelector('[data-testid=sync-token]'));
    await A.fill('[data-testid=sync-token]', TOKEN);
    await A.click('[data-testid=sync-save]');
    await waitFor(A, () => !!document.querySelector('[data-testid=sync-last]'));
    await A.click('[data-testid=unlock-device] button:has-text("Show QR code")');
    c.qrShown = await waitFor(A, () => !!document.querySelector('[data-testid=unlock-qr] svg'));
    c.qrNoteAboutToken = /QR code also carries your sync token/.test((await text(A, 'unlock-device')) ?? '');
    await A.screenshot({ path: `${out}/${name}-7-qr-mit-token.png`, fullPage: true });

    // Netz: nur lokaler Ursprung, api.github.com und die bekannten Nachbauten
    const allowed = new Set([new URL(url).host, 'api.github.com', 'www.youtube.com', 'i.ytimg.com']);
    const stray = [...requested].filter((h) => h && !allowed.has(h) && !/^fonts\.g/.test(h));
    r.hosts = [...requested];
    c.onlyAllowedHosts = stray.length === 0;
    r.stray = stray;
    c.noPageErrors = errors.length === 0;
    r.errors = errors;
    await ctxA.close();
    await ctxB.close();
  } catch (e) {
    r.exception = String(e?.stack ?? e);
  } finally {
    await browser?.close();
  }
}
const all = results.runs.flatMap((x) => Object.entries(x.checks).map(([k, v]) => [`${x.browser}.${k}`, v]));
results.failed = all.filter(([, v]) => !v).map(([k]) => k);
results.exceptions = results.runs.filter((x) => x.exception).map((x) => x.browser);
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify({ checks: all.length, failed: results.failed, exceptions: results.exceptions }, null, 1));
for (const x of results.runs) if (x.exception) console.log(x.exception);
process.exit(results.failed.length || results.exceptions.length ? 1 : 0);
