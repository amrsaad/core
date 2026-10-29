// E2E Core Digest (fundament.md Entscheidung 12 in core-content): die Wochenkarte oben im Saved-Reiter.
// Nachgebaute GitHub Contents API (api.github.com wird im Browser abgefangen). Prüft: Karte erscheint erst, wenn state/digest-latest.enc
// da ist, Zahlen je Art, Actions mit Done und Drop, Widerspruch mit Option A und B, Taps landen verschlüsselt im Sync-Dokument
// (so liest sie pipeline/digest/extract.ts), zweites Gerät sieht dieselben Taps, neue Woche ersetzt die Karte,
// Einstellungen zeigen "Last digest: <date>, N actions open", nur erlaubte Hosts, kein Token im DOM.
// Aufruf: node tests/e2e/digest.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-digest'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const TOKEN = 'github_pat_E2ETESTTOKEN0123456789_abcdefghijklmnopqrstuvwxyz';
const STATE_PATH = '/repos/amrsaad/core-content/contents/state/core-state.enc';
const DIGEST_PATH = '/repos/amrsaad/core-content/contents/state/digest-latest.enc';

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const m = (i) => ({ id: `dg${i}:1`, videoId: `dgtest${String(i).padStart(5, '0')}`, thumb: `${url}apple-touch-icon.png`, start: 1, end: 60, channel: 'Test', videoTitle: 'Test', area: 'brain', topic: 'augen', hook: `Digest ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z' });
const iv0 = crypto.getRandomValues(new Uint8Array(12));
const ct0 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv0 }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: null, moments: Array.from({ length: 8 }, (_, i) => m(i)) })));
mkdirSync('dist/moments', { recursive: true });
writeFileSync('dist/moments/pool.enc', JSON.stringify({ v: 1, iv: b64u(iv0), ct: b64u(ct0) }));
const k = b64u(raw);

const encryptJson = async (value) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({ v: 1, iv: b64u(iv), ct: b64u(ct) });
};
const decryptFile = async (text) => {
  const j = JSON.parse(text);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(j.iv, 'base64url') }, key, Buffer.from(j.ct, 'base64url'));
  return JSON.parse(new TextDecoder().decode(pt));
};
const encToken = async (t) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(t)));
  return b64u(Buffer.concat([iv, ct]));
};

// Wochenkarte wie apply.ts sie schreibt (docs/digest/latest.json)
const GENERATED = '2026-10-29T17:19:16.379Z';
const latest = (week, over = {}) => ({
  v: 1,
  week,
  generatedAt: GENERATED,
  saves: 13,
  counts: { action: 2, habit: 0, rule: 4, know: 9, research: 1, content: 1, script: 1, source: 1, contradiction: 1 },
  actions: [
    { id: 'ted-2034:278.2', title: 'Record a short talk opening twice, once from the chest', metric: 'Both recordings exist and one note says which voice sounds weightier', due: '2026-11-09', url: 'https://www.ted.com/talks/julian_treasure_how_to_speak_so_that_people_want_to_listen' },
    { id: 'pod-jama-ai-conversation-6b6cec6d:769.2', title: 'Check whether the PatientEd AI disclosure can be removed by users', metric: 'One yes or no answer is written down', due: '2026-11-16', url: null },
  ],
  contradictions: [{ id: 'pod-nejm-ai-grand-rounds-75155fa9:1901.9', otherId: 'pod-practical-ai-in-heal-eb3d64d6:1101.1', question: 'Does agreement from an AI tool count as confirmation?', a: 'No, check for a reason against it', b: 'Yes, if the system is auditable' }],
  ...over,
});
const A0 = 'a:ted-2034:278.2';
const A1 = 'a:pod-jama-ai-conversation-6b6cec6d:769.2';
const C0 = 'c:pod-nejm-ai-grand-rounds-75155fa9:1901.9';

/** Nachgebaute API: Sync-Datei mit SHA-Prüfung, Wochenkarte nur lesbar */
function mockApi() {
  const api = { file: null, digest: null, n: 0, puts: [], gets: 0, digestGets: 0, hosts: new Set(), badAuth: [], digestWrites: 0 };
  api.handle = async (route, request) => {
    const u = new URL(request.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, accept, content-type, x-github-api-version', 'access-control-allow-methods': '*' };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const isState = u.pathname.endsWith(STATE_PATH);
    const isDigest = u.pathname.endsWith(DIGEST_PATH);
    if (!isState && !isDigest) return route.fulfill({ status: 404, headers: cors, body: '{}' });
    const authH = (await request.allHeaders()).authorization;
    if (authH !== `Bearer ${TOKEN}`) { api.badAuth.push(String(authH).replace(TOKEN, '<TOKEN>').slice(0, 80)); return json(401, {}); }
    if (isDigest) {
      if (request.method() !== 'GET') { api.digestWrites++; return json(405, {}); }
      api.digestGets++;
      if (!api.digest) return json(404, {});
      return json(200, { sha: api.digest.sha, size: api.digest.text.length, encoding: 'base64', content: Buffer.from(api.digest.text).toString('base64') });
    }
    if (request.method() === 'GET') {
      api.gets++;
      if (!api.file) return json(404, {});
      return json(200, { sha: api.file.sha, size: api.file.text.length, encoding: 'base64', content: Buffer.from(api.file.text).toString('base64') });
    }
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData());
      if ((api.file?.sha ?? undefined) !== body.sha) return json(api.file ? 409 : 422, {});
      api.file = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha${++api.n}` };
      api.puts.push({ at: Date.now(), sha: api.file.sha });
      return json(200, { content: { sha: api.file.sha } });
    }
    return json(405, {});
  };
  api.setDigest = async (value) => { api.digest = { text: await encryptJson(value), sha: `dsha${++api.n}` }; };
  return api;
}

const APP = url + '?now=2026-10-30';
const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const poll = async (fn, timeout = 20000) => { const t = Date.now(); while (Date.now() - t < timeout) { if (await fn()) return true; await sleep(100); } return false; };
const text = (page, id) => page.textContent(`[data-testid=${id}]`).catch(() => null);
const pressed = (page, id) => page.getAttribute(`[data-testid=${id}]`, 'aria-pressed').catch(() => null);

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
    const saved = async (page) => { await page.click('nav [aria-label=Saved]'); await page.waitForSelector('h1:has-text("Saved")'); };
    const settings = async (page) => { await page.click('nav [aria-label=Settings]'); await page.waitForSelector('[data-testid=sync-card]'); };
    const link = `${APP}#k=${k}&t=${await encToken(TOKEN)}`;

    // Gerät A: Token per Link, noch keine Wochenkarte auf GitHub
    const ctxA = await mkCtx();
    const A = await ctxA.newPage();
    await A.goto(link);
    c.aUnlocked = await waitFor(A, () => !!window.__core?.moment());
    c.aFirstSync = await poll(() => api.puts.length >= 1 && api.digestGets >= 1);
    await saved(A);
    c.noCardWithoutFile = (await A.locator('[data-testid=digest-card]').count()) === 0;
    await settings(A);
    c.settingsLineNone = /Last digest: none yet/.test((await text(A, 'digest-line')) ?? '');

    // Die Aufgabe legt die Wochenkarte ab, der nächste Sync holt sie
    await api.setDigest(latest('2026-W44'));
    await A.evaluate(() => window.__sync.syncNow());
    await saved(A);
    c.cardAppears = await waitFor(A, () => !!document.querySelector('[data-testid=digest-card]'));
    c.cardTitle = /This week/.test((await text(A, 'digest-card')) ?? '');
    c.weekLine = /2026-W44 · 13 saves/.test((await text(A, 'digest-week')) ?? '');
    const counts = (await text(A, 'digest-counts')) ?? '';
    c.countsPerKind = ['action 2', 'rule 4', 'know 9', 'research 1', 'content 1', 'script 1', 'source 1', 'contradiction 1'].every((s) => counts.includes(s)) && !counts.includes('habit');
    c.twoActions = (await A.locator('[data-testid^=digest-action-]').count()) === 2;
    c.actionText = /Record a short talk opening twice, once from the chest/.test((await text(A, 'digest-action-0')) ?? '') && /due Nov 9/.test((await text(A, 'digest-action-0')) ?? '');
    c.actionSourceLink = (await A.locator('[data-testid=digest-action-0] a[href^="https://www.ted.com/"]').count()) === 1 && (await A.locator('[data-testid=digest-action-1] a').count()) === 0;
    c.contradictionText = /Does agreement from an AI tool count as confirmation\?/.test((await text(A, 'digest-contra-0')) ?? '') && /Option A/.test((await text(A, 'digest-a-0')) ?? '') && /Option B/.test((await text(A, 'digest-b-0')) ?? '');
    c.cardOnTopOfList = await A.evaluate(() => { const h = document.querySelector('h1'); const card = document.querySelector('[data-testid=digest-card]'); return !!h && !!card && h.compareDocumentPosition(card) === Node.DOCUMENT_POSITION_FOLLOWING; });
    c.noTapYet = [await pressed(A, 'digest-done-0'), await pressed(A, 'digest-drop-0'), await pressed(A, 'digest-a-0'), await pressed(A, 'digest-b-0')].every((v) => v === 'false');
    c.buttonsTouchSize = await A.evaluate(() => [...document.querySelectorAll('[data-testid^=digest-done-],[data-testid^=digest-drop-],[data-testid^=digest-a-],[data-testid^=digest-b-]')].every((b) => b.getBoundingClientRect().height >= 44));
    await A.screenshot({ path: `${out}/${name}-1-wochenkarte.png`, fullPage: true });

    // Settings: zwei offene Actions
    await settings(A);
    c.settingsLineOpen = /Last digest: Oct 29, 2 actions open/.test((await text(A, 'digest-line')) ?? '');

    // Taps
    await saved(A);
    await A.click('[data-testid=digest-done-0]');
    await A.click('[data-testid=digest-drop-1]');
    await A.click('[data-testid=digest-b-0]');
    c.tapsShown = (await pressed(A, 'digest-done-0')) === 'true' && (await pressed(A, 'digest-drop-0')) === 'false' && (await pressed(A, 'digest-drop-1')) === 'true' && (await pressed(A, 'digest-b-0')) === 'true' && (await pressed(A, 'digest-a-0')) === 'false';
    await A.screenshot({ path: `${out}/${name}-2-taps.png`, fullPage: true });
    await settings(A);
    c.settingsLineZero = /Last digest: Oct 29, 0 actions open/.test((await text(A, 'digest-line')) ?? '');

    // Tap ändern: Done wird Drop, ein Tap an derselben Stelle zählt als neuer Stand
    await saved(A);
    await A.click('[data-testid=digest-drop-0]');
    c.tapChanged = (await pressed(A, 'digest-drop-0')) === 'true' && (await pressed(A, 'digest-done-0')) === 'false';

    // Landet im Sync-Dokument, verschlüsselt, so wie extract.ts es liest
    const putsBefore = api.puts.length;
    c.tapsWritten = await poll(async () => {
      if (!api.file || api.puts.length <= putsBefore) return false;
      const d = await decryptFile(api.file.text);
      return d.state.digestTaps?.[A0]?.choice === 'drop';
    }, 25000);
    const doc = await decryptFile(api.file.text);
    const taps = doc.state.digestTaps ?? {};
    c.tapShape = taps[A0]?.choice === 'drop' && taps[A1]?.choice === 'drop' && taps[C0]?.choice === 'b' && Object.values(taps).every((t) => Number.isFinite(t.at) && t.at > 1_700_000_000_000);
    c.tapsHaveTimestamps = [A0, A1, C0].every((id) => Number.isFinite(doc.ts[`digest:${id}`]));
    c.fileStillEncrypted = !api.file.text.includes('digestTaps') && !api.file.text.includes(A0);
    c.cardNotInSyncFile = !JSON.stringify(doc).includes('2026-W44') && !JSON.stringify(doc).includes('digestLatest');
    c.digestFileNeverWritten = api.digestWrites === 0;

    // Gerät B: gleicher Link, bekommt Karte und Taps
    const ctxB = await mkCtx();
    const B = await ctxB.newPage();
    await B.goto(link);
    c.bUnlocked = await waitFor(B, () => !!window.__core?.moment());
    await saved(B);
    c.bGetsCard = await waitFor(B, () => !!document.querySelector('[data-testid=digest-card]'), null, 20000);
    c.bGetsTaps = await poll(async () => (await pressed(B, 'digest-drop-0')) === 'true' && (await pressed(B, 'digest-drop-1')) === 'true' && (await pressed(B, 'digest-b-0')) === 'true', 20000);
    await B.screenshot({ path: `${out}/${name}-3-geraet-b.png`, fullPage: true });

    // B ändert den Widerspruch auf Option A, A holt es
    await B.click('[data-testid=digest-a-0]');
    const p2 = api.puts.length;
    c.bWrites = await poll(() => api.puts.length > p2, 25000);
    await A.evaluate(() => window.__sync.syncNow());
    c.aGetsBsTap = await poll(async () => (await pressed(A, 'digest-a-0')) === 'true' && (await pressed(A, 'digest-b-0')) === 'false', 15000);

    // Neue Woche: untapped Actions und Widersprüche werden übernommen, getippte fallen heraus (so schreibt apply.ts latest.json)
    const next = latest('2026-W45', { generatedAt: '2026-11-05T05:48:00.000Z', saves: 4, counts: { action: 1, habit: 0, rule: 0, know: 3, research: 0, content: 0, script: 0, source: 0, contradiction: 0 }, actions: [{ id: 'new-1:10', title: 'Order the new reading glasses', metric: 'Glasses are ordered', due: '2026-11-20', url: null }], contradictions: [] });
    await api.setDigest(next);
    await A.evaluate(() => window.__sync.syncNow());
    c.newWeekReplacesCard = await waitFor(A, () => /2026-W45 · 4 saves/.test(document.querySelector('[data-testid=digest-week]')?.textContent ?? ''));
    c.oneActionNow = (await A.locator('[data-testid^=digest-action-]').count()) === 1 && (await A.locator('[data-testid^=digest-contra-]').count()) === 0;
    await settings(A);
    c.settingsLineNewWeek = /Last digest: Nov 5, 1 action open/.test((await text(A, 'digest-line')) ?? '');
    await A.screenshot({ path: `${out}/${name}-4-neue-woche.png`, fullPage: true });
    // Alte Taps bleiben im Zustand, damit der Lauf sie einsammeln kann
    c.oldTapsKept = (await decryptFile(api.file.text)).state.digestTaps?.[A0]?.choice === 'drop';

    // Kaputte Datei: Karte bleibt, wie sie ist, keine Fehlerzeile
    api.digest = { text: 'kaputt', sha: `dsha${++api.n}` };
    await A.evaluate(() => window.__sync.syncNow());
    await sleep(800);
    await saved(A);
    c.brokenFileKeepsCard = /2026-W45/.test((await text(A, 'digest-week')) ?? '') && !(await text(A, 'sync-error'));

    // Netz: nur lokaler Ursprung, api.github.com und die bekannten Nachbauten, kein Token im DOM
    const allowed = new Set([new URL(url).host, 'api.github.com', 'www.youtube.com', 'i.ytimg.com']);
    const stray = [...requested].filter((h) => h && !allowed.has(h) && !/^fonts\.g/.test(h));
    r.hosts = [...requested];
    r.stray = stray;
    c.onlyAllowedHosts = stray.length === 0;
    c.tokenNotInDom = !(await A.content()).includes(TOKEN) && !(await B.content()).includes(TOKEN);
    c.noBadAuth = api.badAuth.length === 0;
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
