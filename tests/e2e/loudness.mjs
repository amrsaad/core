// E2E Gleiche Lautheit (Entscheidung 16): der GainNode bekommt beim Wechsel des Moments den Wert des neuen Moments,
// Quellen ohne CORS-Freigabe und HLS laufen unverändert, YouTube wird nur abgesenkt, Settings zeigt die Zeilen "loud: lufs X, gain Y dB".
// Echte Wiedergabe ist im Runner nicht möglich. Die <audio>-Elemente verhalten sich wie in fakeyt.js, der AudioContext ist echt.
// Aufruf: node tests/e2e/loudness.mjs <url> <ausgabeordner>   (vorher npm run build, dann vite preview)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-loudness'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
const EX = Array.from({ length: 6 }, (_, i) => `Sentence ${i + 1} of the checked excerpt.`).join('\n');

const base = { start: 100, end: 160, videoTitle: 'Testvideo', topic: 'augen', kind: 'regel', createdAt: '2026-10-20T00:00:00Z', excerpt: EX };
// Podcast-Momente: lufs und gainDb wie build-enc sie veröffentlicht (gainDb = -16 minus lufs, -12 bis +12)
const gainOf = (l) => Math.max(-12, Math.min(12, Math.round((-16 - l) * 10) / 10));
const audio = (i, host, lufs, ext = 'mp3') => ({
  ...base, id: `pod-loud${i}:100`, videoId: `pod-loud${i}`, channel: `Kanal ${i}`, area: ['brain', 'body', 'beat'][i % 3], hook: `Lautheit ${i}`,
  form: 'audio', audio: true, hls: `https://${host}/pod-loud${i}.${ext}`,
  ...(lufs === undefined ? {} : { lufs, gainDb: gainOf(lufs) }),
});
const moments = [
  audio(0, 'stream.test', -22), // +6.0
  audio(1, 'stream.test', -10), // -6.0
  audio(2, 'stream.test', -18.4), // +2.4 (Anzeige im Beispiel der Diagnose)
  audio(3, 'stream.test', undefined), // ohne Messwert: unverändert
  audio(4, 'stream.test', -12.5), // -3.5
  audio(5, 'stream.test', -45), // +12 (begrenzt)
  audio(6, 'stream.test', -2), // -12 (begrenzt)
  audio(7, 'hls.test', -20, 'm3u8'), // natives HLS: unverändert
  audio(8, 'nocors.test', -21), // Host ohne CORS: erst Versuch, dann unverändert
  audio(9, 'nocors.test', -23),
  audio(10, 'stream.test', -19),
  audio(11, 'stream.test', -13.2),
  audio(12, 'stream.test', -26),
  audio(13, 'stream.test', -15),
  audio(14, 'stream.test', -17.5),
  audio(15, 'stream.test', -9),
];
// Video mit YouTube-ID: nur absenken
const yt = (i, lufs) => ({
  ...base, id: `ytloud0000${i}:100`, videoId: `ytloud0000${i}`, channel: `YT ${i}`, area: ['brain', 'body', 'beat'][i % 3], hook: `YouTube ${i}`, form: 'video',
  ...(lufs === undefined ? {} : { lufs, gainDb: gainOf(lufs) }),
});
const ytMoments = [yt(0, -10), yt(1, -22), yt(2, undefined), yt(3, -13), yt(4, -30), yt(5, -16)];

const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
const k = Buffer.from(raw).toString('base64url');
const waitFor = async (page, fn, arg, timeout = 20000) => {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
};

const results = { at: new Date().toISOString(), runs: [] };
const targets = (process.env.E2E_BROWSERS ?? 'chromium').split(',');
for (const [name, type] of [['webkit', webkit], ['chromium', chromium]].filter(([n]) => targets.includes(n))) {
  const r = { browser: name, checks: {} };
  results.runs.push(r);
  const c = r.checks;
  let browser;
  const errors = [];
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    const open = async (list, query = '?now=2026-10-23') => {
      const cx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
      if (type === chromium) await cx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
      await cx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
      await cx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
      const pg = await cx.newPage();
      pg.on('pageerror', (e) => errors.push(String(e)));
      await pg.addInitScript(() => { window.__ytSlow = true; });
      const body = await encPool(list);
      await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body }));
      await pg.goto(`${url}${query}#k=${k}`);
      return { cx, pg };
    };
    const byId = new Map([...moments, ...ytMoments].map((m) => [m.id, m]));

    // ---------- Podcast-Reiter (Audio): GainNode ----------
    const { cx, pg: page } = await open(moments);
    await page.waitForSelector('[data-testid=form-switch]');
    await page.click('[data-testid=form-switch] >> text=Audio');
    c.audioStarted = await waitFor(page, () => window.__core.state() === 1);
    // Vor der ersten Berührung gibt es keinen AudioContext: der Moment spielt unverändert
    const first = await page.evaluate(() => {
      const m = window.__core.moment();
      const g = window.__core.gain().find((x) => x.index === window.__core.idx());
      return { id: m.id, loud: g?.loud ?? null };
    });
    c.beforeTouchUnchanged = !!first.loud && first.loud.how.startsWith('unchanged') && first.loud.db === 0 && first.loud.linear === undefined;
    // Nachbau der CORS-Absage: ein Element mit crossOrigin bekommt für nocors.test einen Fehler statt loadedmetadata
    await page.evaluate(() => {
      const P = HTMLMediaElement.prototype;
      const orig = P.load;
      P.load = function () {
        if (this.crossOrigin === 'anonymous' && /nocors\.test/.test(this.src)) {
          setTimeout(() => {
            Object.defineProperty(this, 'error', { configurable: true, get: () => ({ code: 4 }) });
            this.dispatchEvent(new Event('error'));
          }, 20);
          return;
        }
        return orig.call(this);
      };
    });
    const vp = page.viewportSize();
    await page.mouse.click(vp.width / 2, vp.height / 2); // erste Berührung: Ton an, AudioContext entsteht
    c.contextRunning = await waitFor(page, () => window.__core.sound() === true);
    await page.evaluate(() => { window.__ytSlow = false; });

    const seen = [];
    for (let step = 0; step < 14; step++) {
      // Abrufkarte (nach jedem 4. Moment) ohne Wertung schließen
      if (await page.$('[data-testid=recall-card]')) await page.evaluate(() => window.__core.skipRecall());
      await waitFor(page, () => !document.querySelector('[data-testid=recall-card]'), undefined, 5000);
      // Momentwechsel abwarten, dann dem Slot einen Moment zum Anlaufen geben (Spurwahl und Kette entstehen beim Laden)
      await waitFor(page, () => window.__core.state() === 1 || window.__core.state() === 5, undefined, 8000);
      await page.waitForTimeout(150);
      const cur = await page.evaluate(() => {
        const m = window.__core.moment();
        const g = window.__core.gain().find((x) => x.index === window.__core.idx());
        return { id: m.id, idx: window.__core.idx(), loud: g?.loud ?? null };
      });
      seen.push(cur);
      await page.evaluate(() => window.__core.next());
      await waitFor(page, (j) => window.__core.idx() !== j, cur.idx, 8000);
    }
    r.seen = seen.map((x) => ({ id: x.id, idx: x.idx, ...x.loud }));
    const ours = seen.filter((x) => byId.has(x.id));
    const expectLinear = (db) => 10 ** (db / 20);
    // Nach der ersten Berührung: jeder Stream-Moment mit Messwert, auf CORS-fähigem Host, kein HLS, läuft über den GainNode mit dem Wert des Moments
    const levelled = ours.filter((x) => x.idx >= 1).filter((x) => {
      const m = byId.get(x.id);
      return m.gainDb && m.gainDb !== 0 && /stream\.test/.test(m.hls);
    });
    c.someLevelled = levelled.length >= 4;
    c.gainNodeGetsNewValue = levelled.length > 0 && levelled.every((x) => {
      const m = byId.get(x.id);
      return x.loud?.how === 'web audio' && x.loud.db === m.gainDb && Math.abs(x.loud.linear - expectLinear(m.gainDb)) < 0.001;
    });
    c.valuesDiffer = new Set(levelled.map((x) => x.loud?.linear?.toFixed(3))).size >= 3;
    // Wechsel von einem Moment zum nächsten ändert den Wert: aufeinanderfolgende Momente mit verschiedenem gainDb haben verschiedene Faktoren
    c.changeAtSwitch = levelled.some((x, i) => i > 0 && levelled[i - 1].loud?.linear !== x.loud?.linear);
    // Ohne Messwert: unverändert, 0 dB
    const noValue = ours.filter((x) => byId.get(x.id).gainDb === undefined);
    c.noValueUnchanged = noValue.every((x) => x.loud?.db === 0 && x.loud.how.startsWith('unchanged') && x.loud.linear === undefined);
    // Begrenzung auf -12 bis +12 (Momente mit lufs -45 und -2)
    const clamp = ours.filter((x) => x.idx >= 1 && /pod-loud(5|6):/.test(x.id));
    c.clampedExtremes = clamp.every((x) => x.loud?.db === byId.get(x.id).gainDb && Math.abs(x.loud.db) === 12);
    // HLS (m3u8): nie über Web Audio
    const hls = ours.filter((x) => /hls\.test/.test(byId.get(x.id).hls));
    c.hlsUnchanged = hls.every((x) => x.loud?.how === 'unchanged: hls' && x.loud.db === 0);
    // Host ohne CORS: der Versuch scheitert, der Moment läuft unverändert weiter und wird nie übersprungen, der Host wird gemerkt
    const nc = ours.filter((x) => x.idx >= 1 && /nocors\.test/.test(byId.get(x.id).hls));
    c.noCorsUnchanged = nc.every((x) => x.loud?.db === 0 && x.loud.how.startsWith('unchanged') && x.loud.linear === undefined);
    r.corsStore = await page.evaluate(() => localStorage.getItem('core.level.cors') ?? '');
    c.noCorsHostRemembered = r.corsStore.includes('"nocors.test":"bad"') || nc.length === 0;
    c.reachedPoolEnd = ours.length >= 12;
    c.noPageErrors = errors.length === 0;

    // ---------- Diagnose in Settings ----------
    await page.click('nav [aria-label=Settings]');
    await page.waitForSelector('[data-testid=loudness]');
    const lines = await page.$$eval('[data-testid=loud-line]', (els) => els.map((e) => e.textContent));
    r.settingsLines = lines;
    c.settingsShowsLoudLines = lines.length >= 3 && lines.every((l) => /^\S+ loud: lufs (-?\d+\.\d|none), gain [+-]?\d+\.\d dB( \([a-z: ]+\))?$/.test(l));
    if (type === chromium) {
      await page.click('[data-testid=copy-diagnostics]');
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      r.copied = copied.split('\n').slice(0, 12);
      c.copyDiagnosticsHasLoud = /loud: lufs -?\d+\.\d, gain [+-]\d+\.\d dB/.test(copied) && copied.includes('loudness leveling on');
    }
    await page.screenshot({ path: `${out}/${name}-settings-loudness.png` });
    // Schalter aus: wirkt ab dem nächsten Laden
    await page.click('[data-testid=level-toggle]');
    c.toggleStored = (await page.evaluate(() => localStorage.getItem('core.level.off'))) === '1';
    await cx.close();

    // ---------- Schalter aus: alles unverändert ----------
    const off = await open(moments);
    await off.pg.evaluate(() => localStorage.setItem('core.level.off', '1'));
    await off.pg.reload();
    await off.pg.waitForSelector('[data-testid=form-switch]');
    await off.pg.click('[data-testid=form-switch] >> text=Audio');
    await waitFor(off.pg, () => window.__core.state() === 1);
    await off.pg.mouse.click(vp.width / 2, vp.height / 2);
    await off.pg.waitForTimeout(400);
    for (let i = 0; i < 4; i++) {
      await off.pg.evaluate(() => window.__core.next());
      await off.pg.waitForTimeout(300);
    }
    const offSeen = await off.pg.evaluate(() => window.__core.gain().map((g) => g.loud));
    c.switchOffUnchanged = offSeen.filter(Boolean).every((l) => l.db === 0 && l.how.startsWith('unchanged') && l.linear === undefined);
    await off.cx.close();

    // ---------- Video-Reiter mit YouTube: nur absenken ----------
    const y = await open(ytMoments);
    await y.pg.waitForSelector('[data-testid=hook]');
    await waitFor(y.pg, () => window.__core.state() === 1);
    await y.pg.mouse.click(vp.width / 2, vp.height / 2);
    for (let i = 0; i < 6; i++) {
      if (await y.pg.$('[data-testid=recall-card]')) await y.pg.evaluate(() => window.__core.skipRecall());
      await y.pg.waitForTimeout(250);
      await y.pg.evaluate(() => window.__core.next());
      await y.pg.waitForTimeout(250);
    }
    const log = await y.pg.evaluate(() => window.__ytlog.slice());
    // je load der letzte volume-Eintrag davor
    const vols = new Map();
    let last = null;
    for (const l of log) {
      if (l.startsWith('volume ')) last = Number(l.slice(7));
      else if (l.startsWith('load ytloud')) {
        const id = l.split(' ')[1];
        if (!vols.has(id)) vols.set(id, last);
      }
    }
    r.ytVolumes = Object.fromEntries(vols);
    const wantVol = (m) => (m.gainDb !== undefined && m.gainDb < 0 ? Math.round(100 * 10 ** (m.gainDb / 20)) : 100);
    const ytSeen = [...vols.keys()].filter((id) => byId.has(`${id}:100`));
    c.ytSeenSome = ytSeen.length >= 3;
    c.ytVolumeOnlyLowers = ytSeen.every((id) => vols.get(id) === wantVol(byId.get(`${id}:100`)));
    c.ytHasLowered = ytSeen.some((id) => vols.get(id) < 100);
    c.ytNeverAbove100 = log.filter((l) => l.startsWith('volume ')).every((l) => Number(l.slice(7)) <= 100);
    await y.cx.close();
  } catch (e) {
    c.crashed = String(e);
  } finally {
    await browser?.close();
  }
}

writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
let fail = 0;
for (const run of results.runs) {
  for (const [k2, v] of Object.entries(run.checks)) {
    const ok = v === true;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${run.browser} ${k2}${ok ? '' : ' = ' + JSON.stringify(v)}`);
  }
}
if (fail) {
  console.error(`${fail} Prüfungen fehlgeschlagen`);
  process.exit(1);
}
