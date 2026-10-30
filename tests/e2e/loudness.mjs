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
      // Host-Probe (cors-Range-Abruf): stream.test antwortet mit Freigabe. nocors.test: Playwright ergänzt bei fulfill selbst die Freigabe, darum
      // scheitert der cors-Abruf (mit Range) per abort und der no-cors-Abruf ist lesbar-opak. trial.test: jeder Abruf bricht ab (kein Urteil).
      // Medienanfragen der Elemente antworten bei allen Hosts, damit das ungeregelte Element laden kann.
      const media = { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-0/10' }, body: 'x' };
      await cx.route(/^https:\/\/stream\.test\//, (x) => x.fulfill({ ...media, headers: { ...media.headers, 'access-control-allow-origin': '*' } }));
      await cx.route(/^https:\/\/nocors\.test\//, (x) => (x.request().resourceType() === 'fetch' && x.request().headers().range ? x.abort() : x.fulfill(media)));
      await cx.route(/^https:\/\/trial\.test\//, (x) => (x.request().resourceType() === 'fetch' ? x.abort() : x.fulfill(media)));
      const pg = await cx.newPage();
      pg.on('pageerror', (e) => errors.push(String(e)));
      // Angleichen ist seit 30.10.2026 standardmäßig aus (Issue 13), der Test schaltet es ein
      await pg.addInitScript(() => { window.__ytSlow = true; try { if (!sessionStorage.getItem('t.off')) localStorage.setItem('core.level.on', '1'); } catch {} });
      // Nachbau der CORS-Absage von Anfang an (seit Issue 11 entsteht der AudioContext schon mit dem Tipp auf den Reiter, der erste Moment läuft sofort geregelt):
      // ein Element mit crossOrigin bekommt für nocors.test und trial.test einen Fehler statt loadedmetadata. Die Nachbauten der Elemente (fakeyt.js)
      // setzen P.load erst später, darum hängt der Wächter an der Zuweisung.
      await pg.addInitScript(() => {
        const P = HTMLMediaElement.prototype;
        let wrapped = P.load;
        const wrap = (f) => function () {
          if (this.crossOrigin === 'anonymous' && /(nocors|trial)\.test/.test(this.src)) {
            setTimeout(() => {
              Object.defineProperty(this, 'error', { configurable: true, get: () => ({ code: 4 }) });
              this.dispatchEvent(new Event('error'));
            }, 20);
            return;
          }
          return f.call(this);
        };
        wrapped = wrap(wrapped);
        Object.defineProperty(P, 'load', { configurable: true, get: () => wrapped, set: (f) => { wrapped = wrap(f); } });
      });
      const body = await encPool(list);
      await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body }));
      await pg.goto(`${url}${query}#k=${k}`);
      return { cx, pg };
    };
    const gainNow = (pg) => pg.evaluate(() => {
      const g = window.__core.gain().find((x) => x.index === window.__core.idx());
      return g?.loud ?? null;
    });
    const storeOf = (pg) => pg.evaluate(() => localStorage.getItem('core.level.cors') ?? '');
    const copyDiag = async (pg) => {
      await pg.click('nav [aria-label=Settings]');
      await pg.waitForSelector('[data-testid=copy-diagnostics]');
      await pg.click('[data-testid=copy-diagnostics]');
      return pg.evaluate(() => navigator.clipboard.readText());
    };
    const startAudio = async (list) => {
      const o = await open(list);
      await o.pg.waitForSelector('[data-testid=form-switch]');
      await o.pg.click('[data-testid=form-switch] >> text=Audio');
      await waitFor(o.pg, () => window.__core.state() === 1);
      return o;
    };
    const tap = (pg) => pg.mouse.click(vp.width / 2, vp.height / 2);
    const vp = { width: 390, height: 664 };
    const byId = new Map([...moments, ...ytMoments].map((m) => [m.id, m]));
    // Erwartete Spur eines Moments im Audio-Reiter, wenn der Kontext läuft: geregelt bei Messwert auf einem Host mit Freigabe, sonst unverändert
    const laneOk = (m, loud) => {
      if (!m || !loud) return false;
      const level = !!m.gainDb && m.gainDb !== 0 && /stream\.test/.test(m.hls);
      return level ? loud.how === 'web audio' && loud.db === m.gainDb : loud.how.startsWith('unchanged') && loud.db === 0 && loud.linear === undefined;
    };

    // ---------- Podcast-Reiter (Audio): GainNode ----------
    const { cx, pg: page } = await open(moments);
    await page.waitForSelector('[data-testid=form-switch]');
    // Ohne Geste gibt es keinen AudioContext (kein Kontext im Audio-Reiter, bevor jemand getippt hat)
    c.noContextBeforeGesture = !(await page.evaluate(() => !!window.__core.ctx()));
    await page.click('[data-testid=form-switch] >> text=Audio');
    c.audioStarted = await waitFor(page, () => window.__core.state() === 1);
    // Die erste Geste im Dokument ist der Tipp auf den Reiter (Issue 13): er schaltet das Deck-Element frei und legt den AudioContext an.
    // Ein Moment mit Messwert auf einem Host mit Freigabe läuft ab dem ersten Ton geregelt, über das Element der geregelten Spur des Decks.
    const first = await page.evaluate(() => {
      const m = window.__core.moment();
      const g = window.__core.gain().find((x) => x.index === window.__core.idx());
      return { id: m.id, loud: g?.loud ?? null };
    });
    c.tabTapStartsLevelled = laneOk(byId.get(first.id), first.loud);
    r.deckEls = await page.evaluate(() => [...document.querySelectorAll('audio[data-core=audio-deck]')].map((a) => ({ lane: a.dataset.lane, paused: a.paused, src: !!(a.currentSrc || a.src), cross: a.crossOrigin })));
    c.levelElementPlays = r.deckEls.some((e) => e.lane === 'level' && e.cross === 'anonymous' && !e.paused);
    c.tempoOneByDefault = (await page.evaluate(() => window.__core.rate())) === 1;
    c.atMostThreeMedia = (await page.evaluate(() => window.__core.media())) <= 3;
    c.deckSrcLine = await page.evaluate(() => window.__core.diag().some((x) => /^deck: src (local|net) /.test(x)));
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
    c.settingsShowsLoudLines = lines.length >= 3 && lines.every((l) => /^\S+ loud: (skipped cors, )?lufs (-?\d+\.\d|none), gain [+-]?\d+\.\d dB( \([a-z: ]+\))?$/.test(l));
    if (type === chromium) {
      await page.click('[data-testid=copy-diagnostics]');
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      r.copied = copied.split('\n').slice(0, 12);
      c.copyDiagnosticsHasLoud = /loud: (skipped cors, )?lufs -?\d+\.\d, gain [+-]?\d+\.\d dB/.test(copied) && copied.includes('loudness leveling on');
    }
    await page.screenshot({ path: `${out}/${name}-settings-loudness.png` });
    // Schalter aus: wirkt ab dem nächsten Laden
    await page.click('[data-testid=level-toggle]');
    c.toggleStored = (await page.evaluate(() => localStorage.getItem('core.level.on'))) !== '1';
    await cx.close();

    // ---------- Schalter aus: alles unverändert ----------
    const off = await open(moments);
    await off.pg.evaluate(() => { sessionStorage.setItem('t.off', '1'); localStorage.removeItem('core.level.on'); });
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
    c.switchOffUnchanged = offSeen.filter(Boolean).length > 0 && offSeen.filter(Boolean).every((l) => l.db === 0 && l.how.startsWith('unchanged') && l.linear === undefined);
    c.switchOffNoContext = !(await off.pg.evaluate(() => !!window.__core.ctx()));
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

    // ---------- Erster Tipp: der laufende Moment wird sofort angebunden (nicht erst der nächste) ----------
    const sm = [audio(0, 'stream.test', -22), audio(1, 'stream.test', -10), audio(2, 'stream.test', -18.4)];
    const A = await startAudio(sm);
    const a0 = await gainNow(A.pg);
    const curId = await A.pg.evaluate(() => window.__core.moment().id);
    c.tapA_levelAtStart = laneOk(sm.find((m) => m.id === curId), a0);
    await tap(A.pg);
    const wantDb = sm.find((m) => m.id === curId).gainDb;
    c.firstTapKeepsRunningMomentLevelled = await waitFor(A.pg, (db) => {
      const g = window.__core.gain().find((x) => x.index === window.__core.idx())?.loud;
      return g?.how === 'web audio' && g.db === db;
    }, wantDb, 6000);
    r.firstTapGain = await gainNow(A.pg);
    c.firstTapStillPlaying = await waitFor(A.pg, () => window.__core.state() === 1, undefined, 3000);
    // Hintergrund: sichtbar zu versteckt und zurück schreibt Diag-Zeilen mit dem Zustand des Kontexts
    await A.pg.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await A.pg.waitForTimeout(1200);
    await A.pg.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // iOS-Unterbrechung nachstellen: Kontext suspended, der Ton wechselt selbst auf das ungeregelte Element
    await A.pg.evaluate(() => window.__core.ctx().suspend());
    c.suspendFallsBack = await waitFor(A.pg, () => {
      const g = window.__core.gain().find((x) => x.index === window.__core.idx())?.loud;
      return !!g && g.how.startsWith('unchanged') && g.db === 0;
    }, undefined, 6000);
    r.afterSuspendGain = await gainNow(A.pg);
    c.suspendKeepsPlaying = await waitFor(A.pg, () => window.__core.state() === 1 || window.__core.state() === 5, undefined, 3000);
    if (type === chromium) {
      const dA = await copyDiag(A.pg);
      r.diagA = dA.split('\n').filter((l) => /loud:/.test(l));
      c.diagHiddenLine = /loud: audiocontext running \(app hidden\)/.test(dA);
      c.diagSuspendedLine = /loud: audiocontext suspended \(app visible\)/.test(dA);
      c.diagAbandonedLine = /loud: level lane abandoned \(context suspended\), playing unchanged/.test(dA);
      c.diagHeaderContext = /loudness leveling on.*audio context (running|suspended)/.test(dA);
    }
    await A.cx.close();

    // ---------- Host ohne CORS: die Probe urteilt vor dem Abspielen, kein Fehlversuch, Diag "skipped cors" ----------
    const nm = [audio(8, 'nocors.test', -21), audio(9, 'nocors.test', -23), audio(10, 'nocors.test', -19)];
    const B = await startAudio(nm);
    c.probeMarksBeforeTap = await waitFor(B.pg, () => (localStorage.getItem('core.level.cors') ?? '').includes('"nocors.test":"bad"'), undefined, 8000);
    await tap(B.pg);
    await B.pg.waitForTimeout(800);
    await B.pg.evaluate(() => window.__core.next());
    await waitFor(B.pg, () => window.__core.state() === 1 || window.__core.state() === 5, undefined, 6000);
    await B.pg.waitForTimeout(400);
    const bg0 = await gainNow(B.pg);
    c.blockedHostSkipped = !!bg0 && bg0.db === 0 && bg0.how === 'unchanged: skipped cors';
    if (type === chromium) {
      const dB = await copyDiag(B.pg);
      c.noFailedTrialForBlocked = !/level lane failed/.test(dB);
      c.diagSkippedCors = /loud: skipped cors, lufs -?\d+\.\d, gain \+?0\.0 dB \(unchanged: skipped cors\)/.test(dB);
    }
    await B.cx.close();

    // ---------- Host ohne Urteil (Probe bricht ab): der Versuch scheitert beim Start in der geregelten Spur, Position bleibt, Moment spielt unverändert weiter ----------
    const tm = [audio(11, 'trial.test', -21), audio(12, 'trial.test', -23)];
    const T = await startAudio(tm);
    c.trialFallsBack = await waitFor(T.pg, () => {
      const g = window.__core.gain().find((x) => x.index === window.__core.idx())?.loud;
      return g?.how === 'unchanged: skipped cors';
    }, undefined, 8000);
    c.trialHostMarked = await waitFor(T.pg, () => (localStorage.getItem('core.level.cors') ?? '').includes('"trial.test":"bad"'), undefined, 6000);
    r.trialStore = await storeOf(T.pg);
    c.trialNeverOk = !r.trialStore.includes('"trial.test":"ok"');
    c.trialStillPlaying = await waitFor(T.pg, () => window.__core.state() === 1 || window.__core.state() === 5, undefined, 3000);
    await T.cx.close();
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
