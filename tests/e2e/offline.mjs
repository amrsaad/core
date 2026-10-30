// E2E Netzabbruch mitten im Abspielen (Issue 9, Max 30.10.2026). Nach 5, 20 und 60 s ohne Netz und der Rückkehr muss der sichtbare Zustand
// derselbe sein: Moment, Cover-src, Untertitel, Player-Quelle, Mute-Zustand, Token und Last sync. Der Sync läuft nach der Rückkehr weiter.
// Zwei Pools: Streams (eigener <video>-Player) und YouTube (nachgebaute API). Fehler ohne Netz stellt fakeyt.js mit window.__netFaults nach:
// YouTube puffert, der Stream meldet nach 4 s einen endgültigen Netzfehler (MEDIA_ERR_NETWORK), wie Chromium und WebKit es tun.
// Aufruf: node tests/e2e/offline.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-offline'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const TOKEN = 'github_pat_E2ETESTTOKEN0123456789_abcdefghijklmnopqrstuvwxyz';
const DURATIONS = (process.env.OFFLINE_SECONDS ?? '5,20,60').split(',').map(Number);

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const k = b64u(raw);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: b64u(iv), ct: b64u(ct) });
};
// Lange Momente (900 s), damit keiner während der Prüfung zu Ende läuft
const mk = (i, hls) => ({
  id: `of${String(i).padStart(9, '0')}:100`, videoId: `of${String(i).padStart(9, '0')}`, thumb: `${url}apple-touch-icon.png?m=${i}`, start: 100, end: 1000,
  channel: `Kanal ${i % 4}`, videoTitle: 'Testvideo', area: 'brain', topic: ['augen', 'retina', 'linse'][i % 3], hook: `Offline ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z',
  cues: [[0, `Erste Zeile ${i}`], [30, `Zweite Zeile ${i}`]], ...(hls ? { hls: `https://stream.test/of${String(i).padStart(9, '0')}.m3u8` } : {}),
});
const POOLS = { stream: await encPool(Array.from({ length: 16 }, (_, i) => mk(i, true))), youtube: await encPool(Array.from({ length: 16 }, (_, i) => mk(100 + i, false))) };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);

/** Einfache GitHub-Nachbildung: keine Datei, Schreiben erlaubt. Zählt Anfragen, Token wird geprüft. */
const github = () => {
  const api = { gets: 0, puts: 0, file: null, n: 0 };
  api.handle = async (route, request) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, accept, content-type, x-github-api-version', 'access-control-allow-methods': '*' };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if ((await request.allHeaders()).authorization !== `Bearer ${TOKEN}`) return json(401, {});
    if (request.method() === 'GET') {
      api.gets++;
      if (!new URL(request.url()).pathname.endsWith('core-state.enc') || !api.file) return json(404, {});
      return json(200, { sha: api.file.sha, size: api.file.text.length, encoding: 'base64', content: Buffer.from(api.file.text).toString('base64') });
    }
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData());
      if ((api.file?.sha ?? undefined) !== body.sha) return json(409, {});
      api.puts++;
      api.file = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha${++api.n}` };
      return json(200, { content: { sha: api.file.sha } });
    }
    return json(405, {});
  };
  return api;
};

/** Alles, was der Mensch sieht oder hört, in einem Objekt */
const snap = (page) =>
  page.evaluate(() => {
    const c = window.__core;
    const m = c.moment();
    const cur = document.querySelector('.vslot:not(.vghost)[aria-hidden="false"]');
    const img = cur?.querySelector('img.vposter, img.vaudio-art');
    const info = c.slotInfo ? c.slotInfo() : [];
    const s = info.find((x) => x.index === c.idx());
    return {
      id: m?.id, idx: c.idx(), cover: img?.getAttribute('src') ?? null, coverOk: !!img && img.complete && img.naturalWidth > 0,
      caption: document.querySelector('[data-testid=caption] span')?.textContent ?? '', hook: document.querySelector('[data-testid=hook]')?.textContent ?? '',
      st: c.state(), sound: c.sound(), mid: s?.mid ?? null, muted: s?.muted ?? null, t: s?.t ?? c.time(),
      neighbors: info.filter((x) => x.index !== c.idx()).map((x) => `${x.index}:${x.mid}`).sort().join(','),
    };
  });
const syncStatus = (page) => page.evaluate(() => window.__sync?.status() ?? null);

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  for (const [kind, poolBody] of Object.entries(POOLS)) {
    const r = { browser: name, pool: kind, checks: {}, notes: {} };
    results.runs.push(r);
    const c = r.checks;
    let browser;
    try {
      browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
      const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
      const api = github();
      await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
      await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
      await ctx.route('https://api.github.com/**', (route, request) => api.handle(route, request));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript(() => {
        window.__ytSlow = true; window.__netFaults = true;
        // Copy diagnostics: Text abfangen (kein Teilen-Blatt, keine Zwischenablage-Rechte nötig)
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true });
      });
      await page.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body: poolBody }));
      await page.goto(`${url}?now=2026-10-22&seed=3#k=${k}`);
      c.feedUp = await waitFor(page, () => !!window.__core?.moment());
      c.playing = await waitFor(page, () => window.__core.state() === 1);
      // Ton an: ein Tipp, danach bleibt er an
      await page.mouse.click(190, 420);
      c.soundOn = await waitFor(page, () => window.__core.sound() === true, null, 5000);
      // Token einlegen (Settings), erster Lauf legt die Datei an. Danach zurück in den Feed.
      await page.click('nav [aria-label=Settings]');
      await page.waitForSelector('[data-testid=sync-card]');
      await page.fill('[data-testid=sync-token]', TOKEN);
      await page.click('[data-testid=sync-save]');
      c.tokenSaved = await waitFor(page, () => !!document.querySelector('[data-testid=sync-last]'), null, 8000);
      if (!c.tokenSaved) {
        // Das Feld kann beim ersten Öffnen noch leer gewesen sein: einmal wiederholen
        await page.fill('[data-testid=sync-token]', TOKEN).catch(() => {});
        await page.click('[data-testid=sync-save]').catch(() => {});
        c.tokenSaved = await waitFor(page, () => !!document.querySelector('[data-testid=sync-last]'));
      }
      c.firstSync = await waitFor(page, () => !!window.__sync?.status().lastSync);
      await page.selectOption('[data-testid=captions]', 'on');
      await page.click('nav [aria-label=Feed]');
      c.backInFeed = await waitFor(page, () => window.__core.state() === 1);
      for (const sec of DURATIONS) {
        const key = `off${sec}`;
        const before = await snap(page);
        const syncBefore = await syncStatus(page);
        const getsBefore = api.gets;
        // Etwas Synchronisiertes ändern, damit während der Pause ein Lauf fällig wird (10 s später)
        await page.click('[data-testid=save]');
        await ctx.setOffline(true);
        await sleep(sec * 1000);
        const during = await snap(page);
        await ctx.setOffline(false);
        // Rückkehr: Zeit zum Erholen (Player, Sync, Cover)
        await sleep(6000);
        const after = await snap(page);
        const syncAfter = await syncStatus(page);
        r.notes[key] = { before, during, after, syncBefore, syncAfter };
        c[`${key}_sameMoment`] = after.id === before.id && after.idx === before.idx;
        c[`${key}_sameCover`] = after.cover === before.cover && after.coverOk;
        c[`${key}_sameHook`] = after.hook === before.hook;
        c[`${key}_sameSource`] = after.mid === before.mid && after.neighbors === before.neighbors;
        c[`${key}_playingAgain`] = after.st === 1;
        c[`${key}_positionKept`] = after.t >= before.t && after.t < before.t + sec + 30;
        c[`${key}_soundKept`] = after.sound === true && after.muted === false && before.muted === false;
        c[`${key}_captionMatchesMoment`] = after.caption !== '' && after.caption === before.caption;
        c[`${key}_tokenKept`] = !!syncAfter?.hasToken;
        c[`${key}_lastSyncKept`] = !!syncAfter?.lastSync && syncAfter.lastSync >= (syncBefore?.lastSync ?? 0);
        // Der Sync läuft nach der Rückkehr weiter: ein neuer erfolgreicher Kontakt innerhalb von 20 s
        c[`${key}_syncResumes`] = await waitFor(page, (t) => (window.__sync?.status().lastSync ?? 0) > t && !window.__sync.status().error, syncBefore?.lastSync ?? 0, 20000);
        c[`${key}_gitHubReachedAgain`] = api.gets > getsBefore;
        // Zurück auf Ausgangslage für die nächste Dauer (Save wieder aus)
        await page.click('[data-testid=save]');
      }
      // Settings: Token und Last sync stehen noch, Copy diagnostics enthält den Wechsel
      await page.click('nav [aria-label=Settings]');
      await page.waitForSelector('[data-testid=sync-card]');
      c.settingsTokenField = (await page.locator('[data-testid=sync-token]').count()) === 0;
      c.settingsLastSync = /^Last sync: (just now|\d+ min ago)/.test((await page.textContent('[data-testid=sync-last]')) ?? '');
      await page.click('[data-testid=copy-diagnostics]');
      await waitFor(page, () => !!window.__copied, null, 5000);
      const diag = await page.evaluate(() => window.__copied ?? '');
      // Die Wiederaufnahme steht nur im Stream-Pool im Protokoll: der YouTube-Player läuft nach der Rückkehr von selbst weiter
      c.diagLines = /net: offline/.test(diag) && /net: online/.test(diag) && (kind === 'youtube' || /net: recover slot\d+ \S+ ok/.test(diag));
      c.noPageErrors = errors.length === 0;
      r.notes.errors = errors;
      await page.screenshot({ path: `${out}/${name}-${kind}-settings.png`, fullPage: true });
    } catch (e) {
      c.crashed = String(e).slice(0, 300);
    } finally {
      await browser?.close();
    }
    const bad = Object.entries(c).filter(([, v]) => v !== true);
    console.log(`${name}/${kind}: ${bad.length ? 'ROT ' + bad.map(([a, v]) => (v === false ? a : `${a}=${v}`)).join(', ') : 'grün'}`);
  }
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
const failed = results.runs.flatMap((r) => Object.entries(r.checks).filter(([, v]) => v !== true).map(([kk]) => `${r.browser}/${r.pool}/${kk}`));
console.log(failed.length ? `FAIL ${failed.length}` : 'ALL GREEN');
process.exit(failed.length ? 1 : 0);
