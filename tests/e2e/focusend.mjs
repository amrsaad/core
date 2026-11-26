// E2E Runde 47: Fokus endet oder wechselt auf der Endseite (oder hinter dem letzten Moment): die Warteschlange wird aus dem gültigen Pool neu aufgebaut.
// Audio-Reiter und Text-Reiter am Handy-Viewport.
//  (i)   Fokus auf einen Bereich mit genau 2 freien Momenten, beide durchgespielt: Endseite "Nothing left in your focus.", Fokus löschen: Endseite weg, Moment eines anderen Bereichs, Diag "focus: ... (refill)".
//  (ii)  Auf der Endseite einen anderen Fokus mit freien Momenten setzen: Moment erscheint.
//  (iii) Alles gesehen: Endseite bleibt mit "You've seen every <form> moment." (auch nach Fokus setzen und löschen), Diag "end: ..." nennt free 0.
//  (iv)  pagehide ohne Entladen bei Sitzungs-Fokus: Pille weg, Schlange ungefiltert (Diag "focus: ... (keep)").
// Aufruf: node tests/e2e/focusend.mjs <url> <ausgabeordner>   (E2E_BROWSERS=chromium oder webkit wählt einen)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { chromium, devices, webkit } from 'playwright';
import { onPageError } from './pageerrors.mjs';

const [url = 'http://127.0.0.1:4173/core/', out = 'pipeline/out/e2e-focusend'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const FAKE = readFileSync(new URL('./fakeyt.js', import.meta.url), 'utf8');
// Runde 46 (AUDIO_NO_YT): der Audio-Reiter lädt die YouTube-API nicht mehr, die Nachbildung der Audio-Elemente kommt per Init-Skript
const FAKE_MEDIA = FAKE.slice(FAKE.indexOf('// Eigene Streams'));
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
const k = Buffer.from(raw).toString('base64url');
const encPool = async (list) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ updatedAt: '2026-10-23T00:00:00Z', lastRun: '2026-10-23T00:00:00Z', moments: list })));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') });
};
const waitFor = async (page, fn, arg, timeout = 15000) => { try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); return true; } catch { return false; } };

const topics = ['augen', 'kraft', 'islam', 'retina', 'schlaf', 'linse', 'puls', 'atem', 'ruhe', 'blick', 'wort', 'tag'];
let n = 0;
const mk = (form, area, extra = {}) => {
  const i = n++;
  const vid = `fe${form[0]}${String(i).padStart(8, '0')}`;
  return {
    id: `${vid}:100`, videoId: vid, start: 100, end: 120, channel: `Kanal ${i}`, videoTitle: 'Testvideo', area, topic: topics[i % topics.length] + i, hook: `Fokus ${form} ${area} ${i}`, kind: 'regel', createdAt: '2026-10-20T00:00:00Z',
    cues: [[0, 'Untertitel eins'], [2, 'Untertitel zwei']], excerpt: 'Ein geprüfter Ausschnitt.', form, ...extra,
  };
};
const make = (form, a) => {
  const list = [];
  const ex = form === 'audio' ? (id) => ({ audio: true, hls: `https://stream.test/${id}.m3u8` }) : () => ({ author: 'A', ref: 'R', sourceUrl: 'https://example.org/s', license: 'CC BY 4.0' });
  for (const [area, count] of Object.entries(a)) for (let j = 0; j < count; j++) { const m = mk(form, area); Object.assign(m, ex(m.videoId)); list.push(m); }
  return list;
};
const videos = () => [mk('video', 'brain'), mk('video', 'beat')];
const AREA_OF = (list) => Object.fromEntries(list.map((m) => [m.id, m.area]));

const results = { at: new Date().toISOString(), runs: [] };
let failed = false;
for (const [bname, type] of [['webkit', webkit], ['chromium', chromium]].filter(([nm]) => (process.env.E2E_BROWSERS ?? 'webkit,chromium').split(',').includes(nm))) {
  const r = { variant: bname, checks: {}, notes: {} };
  const c = r.checks;
  results.runs.push(r);
  let browser;
  try {
    browser = await type.launch(process.env.E2E_CHROME && type === chromium ? { executablePath: process.env.E2E_CHROME } : {});
    for (const form of ['audio', 'text']) {
      const label = form === 'audio' ? 'Audio' : 'Text';
      const poolMain = [...videos(), ...make(form, { body: 2, beat: 4, brain: 3 })];
      const poolSmall = [...videos(), ...make(form, { body: 1, beat: 1, brain: 1 })];
      const areaMain = AREA_OF(poolMain);
      const bodyIds = poolMain.filter((m) => m.form === form && m.area === 'body').map((m) => m.id);
      const bodyIdsSmall = poolSmall.filter((m) => m.form === form).map((m) => m.id);
      const bodyPool = await encPool(poolMain);
      const smallPool = await encPool(poolSmall);

      /** Neuer Kontext im Handy-Format, optional mit Fokus von Anfang an, Reiter gewählt */
      const open = async (body, focus) => {
        const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
        await ctx.route('https://www.youtube.com/iframe_api', (x) => x.fulfill({ contentType: 'text/javascript', body: FAKE }));
        await ctx.route(/i\.ytimg\.com|fonts\.g/, (x) => x.abort());
        const pg = await ctx.newPage();
        const errors = [];
        pg.on('pageerror', onPageError(errors));
        await pg.addInitScript(FAKE_MEDIA);
        if (focus) await pg.addInitScript((f) => { try { localStorage.setItem('core-focus', JSON.stringify(f)); } catch {} }, focus);
        await pg.route(/moments\/pool\.enc/, (x) => x.fulfill({ contentType: 'application/json', body }));
        await pg.goto(`${url}?now=2026-10-23&seed=3#k=${k}`);
        await waitFor(pg, () => !!window.__core?.moment());
        await pg.locator('[data-testid=form-switch] button, .head-tabs button').filter({ hasText: label }).first().click();
        await waitFor(pg, (f) => (f === 'text' ? !!document.querySelector('[data-testid=text-view]') : !!window.__core.moment()?.audio), form);
        return { ctx, pg, errors };
      };
      const setFocus = (pg, f) => pg.evaluate((x) => { localStorage.setItem('core-focus', JSON.stringify(x)); window.dispatchEvent(new Event('core-focus-changed')); }, f);
      const SESSION = (areas) => ({ areas, langs: [], until: 'session', dur: 'session' });
      /** Alle Momente der Reihe nach durch bis zur Endseite. Audio läuft im Zeitraffer von selbst weiter, Text wird bis zum Ende gescrollt. Abrufkarten werden beantwortet. */
      const playThrough = async (pg) => {
        for (let guard = 0; guard < 400; guard++) {
          const st = await pg.evaluate(() => ({ id: window.__core?.moment()?.id, card: !!document.querySelector('[data-testid=recall-card]'), end: !!document.querySelector('[data-testid=end-page]'), text: !!document.querySelector('[data-testid=text-view]') }));
          if (st.card) {
            await pg.click('[data-testid=recall-option][data-correct="1"]').catch(() => {});
            await pg.click('[data-testid=recall-next]').catch(() => {});
            continue;
          }
          if (st.end) return true;
          if (st.text && st.id) {
            await pg.evaluate(() => { const el = document.querySelector('[data-testid=text-view]'); if (el) { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); } });
            if (await waitFor(pg, (id) => window.__core.seen(id), st.id, 1500)) await pg.evaluate(() => window.__core.next());
          }
          await pg.waitForTimeout(100);
        }
        return false;
      };
      const endLine = (pg) => pg.evaluate(() => document.querySelector('[data-testid=end-line]')?.textContent ?? null);
      const diag = (pg) => pg.evaluate(() => window.__core.diag());
      const hasDiag = async (pg, re) => (await diag(pg)).some((x) => new RegExp(re).test(x));
      const pill = (pg) => pg.evaluate(() => !!document.querySelector('[data-focus=on]'));
      const noEnd = (pg) => waitFor(pg, () => !document.querySelector('[data-testid=end-page]') && !!window.__core.moment(), undefined, 6000);
      const started = async (pg) => (form === 'audio'
        ? waitFor(pg, () => window.__core.state() === 1 || !!document.querySelector('[data-testid=tap-to-play]'), undefined, 6000)
        : waitFor(pg, () => !!document.querySelector('[data-testid=text-view]'), undefined, 6000));
      const P = `${form}`;

      // (i) Fokus mit genau 2 freien Momenten, durchgespielt, dann gelöscht
      {
        const { ctx, pg, errors } = await open(bodyPool, SESSION(['body']));
        c[`${P} i Pille steht`] = await pill(pg);
        c[`${P} i erster Moment im Fokus`] = (await pg.evaluate(() => window.__core.moment()?.id)) !== undefined && bodyIds.includes(await pg.evaluate(() => window.__core.moment()?.id));
        c[`${P} i Endseite nach den zwei`] = await playThrough(pg);
        c[`${P} i Text im Fokus`] = (await endLine(pg)) === 'Nothing left in your focus.';
        c[`${P} i beide gesehen`] = await pg.evaluate((ids) => ids.every((id) => window.__core.seen(id)), bodyIds);
        c[`${P} i end-Zeile`] = await hasDiag(pg, `^end: ${form} pool 9, seen 2, .*focus Body · session, focus-pool 2, free 0, queue 2 idx 2$`);
        await pg.screenshot({ path: `${out}/${bname}-${form}-1-fokus-leer.png` });
        await pg.click('[data-testid=end-clear-focus]');
        c[`${P} i Endseite weg`] = await noEnd(pg);
        const m1 = await pg.evaluate(() => window.__core.moment()?.id);
        c[`${P} i anderer Bereich`] = !!m1 && areaMain[m1] !== 'body' && areaMain[m1] !== undefined;
        c[`${P} i Pille weg`] = !(await pill(pg));
        c[`${P} i Diag refill`] = await hasDiag(pg, '^focus: Body · session to none, replan from 2 tail 0 \\(refill\\)$');
        c[`${P} i Diag go end`] = await hasDiag(pg, '^go end->2$');
        c[`${P} i spielt oder Tap to play`] = await started(pg);
        r.notes[`${P} i`] = (await diag(pg)).filter((x) => /^(focus|end|go|mix)/.test(x));
        await pg.screenshot({ path: `${out}/${bname}-${form}-2-nach-loeschen.png` });
        c[`${P} i keine Seitenfehler`] = errors.length === 0;
        await ctx.close();
      }
      // (ii) Auf der Endseite anderen Fokus setzen
      {
        const { ctx, pg, errors } = await open(bodyPool, SESSION(['body']));
        c[`${P} ii Endseite`] = await playThrough(pg);
        await setFocus(pg, SESSION(['beat']));
        c[`${P} ii Endseite weg`] = await noEnd(pg);
        const m2 = await pg.evaluate(() => window.__core.moment()?.id);
        c[`${P} ii Moment aus dem neuen Fokus`] = !!m2 && areaMain[m2] === 'beat';
        c[`${P} ii Pille Beat`] = await pg.evaluate(() => (document.querySelector('[data-focus=on]')?.textContent ?? '').includes('Beat'));
        c[`${P} ii Diag refill`] = await hasDiag(pg, '^focus: Body · session to Beat · session, replan from 2 tail 0 \\(refill\\)$');
        c[`${P} ii spielt oder Tap to play`] = await started(pg);
        // Fokus ohne freie Momente auf der Endseite: sie bleibt (Body ist durch)
        c[`${P} ii keine Seitenfehler`] = errors.length === 0;
        await ctx.close();
      }
      // (iii) Alles wirklich gesehen: Endseite bleibt, auch nach Fokus setzen und löschen
      {
        const { ctx, pg, errors } = await open(smallPool, null);
        c[`${P} iii Endseite`] = await playThrough(pg);
        c[`${P} iii alle gesehen`] = await pg.evaluate((ids) => ids.every((id) => window.__core.seen(id)), bodyIdsSmall);
        const want = `You've seen every ${form} moment.`;
        c[`${P} iii Text`] = (await endLine(pg)) === want;
        c[`${P} iii end-Zeile free 0`] = await hasDiag(pg, `^end: ${form} pool 3, seen 3, muted 0, rejected 0, swipe-blocked 0, session bad 0, used 3, focus none, focus-pool 3, free 0, queue 3 idx 3$`);
        await setFocus(pg, SESSION(['body']));
        await pg.waitForTimeout(400);
        c[`${P} iii Fokus ohne freie: Endseite bleibt`] = !!(await pg.$('[data-testid=end-page]')) && (await endLine(pg)) === 'Nothing left in your focus.' && (await pg.evaluate(() => window.__core.moment())) === undefined;
        c[`${P} iii Fokus ohne freie: end-Zeile`] = await hasDiag(pg, `^end: ${form} pool 3, .*focus Body · session, focus-pool 1, free 0, queue 3 idx 3$`);
        await pg.click('[data-testid=end-clear-focus]');
        await pg.waitForTimeout(400);
        c[`${P} iii nach Löschen: Endseite bleibt, richtiger Text`] = !!(await pg.$('[data-testid=end-page]')) && (await endLine(pg)) === want && (await pg.evaluate(() => window.__core.moment())) === undefined;
        c[`${P} iii Diag refill ohne Moment`] = await hasDiag(pg, '^focus: Body · session to none, replan from 3 tail 0 \\(refill\\)$');
        c[`${P} iii Mix null`] = await hasDiag(pg, '^mix: null \\(pool 3, free 0\\)$');
        // einmalig: bei stehender Endseite kommt auch nach weiterem Rendern keine weitere Zeile, und keine zwei gleichen Zeilen hintereinander
        const nulls0 = (await diag(pg)).filter((x) => /^mix: null/.test(x));
        await pg.waitForTimeout(1200);
        const dg = (await diag(pg)).filter((x) => /^mix:/.test(x));
        c[`${P} iii Mix null einmalig`] = dg.filter((x) => /^mix: null/.test(x)).length === nulls0.length && dg.every((x, i) => i === 0 || x !== dg[i - 1]);
        r.notes[`${P} iii`] = (await diag(pg)).filter((x) => /^(focus|end|go|mix)/.test(x));
        await pg.screenshot({ path: `${out}/${bname}-${form}-3-alles-gesehen.png` });
        c[`${P} iii keine Seitenfehler`] = errors.length === 0;
        await ctx.close();
      }
      // (iv) pagehide ohne Entladen: Sitzungs-Fokus endet, Pille weg, Schlange ungefiltert
      {
        const { ctx, pg, errors } = await open(bodyPool, SESSION(['body']));
        c[`${P} iv Pille steht`] = await pill(pg);
        c[`${P} iv Schlange im Fokus`] = await pg.evaluate((ids) => window.__core.queue().every((id) => ids.includes(id)), bodyIds);
        await pg.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        c[`${P} iv Pille weg`] = await waitFor(pg, () => !document.querySelector('[data-focus=on]'), undefined, 4000);
        c[`${P} iv Speicher leer`] = await pg.evaluate(() => localStorage.getItem('core-focus') === null);
        c[`${P} iv Schlange ungefiltert`] = await waitFor(pg, (ids) => window.__core.queue().some((id) => !ids.includes(id)), bodyIds, 4000);
        c[`${P} iv Diag keep`] = await hasDiag(pg, '^focus: Body · session to none, replan from 1 tail 1 \\(keep\\)$');
        c[`${P} iv laufender Moment bleibt`] = bodyIds.includes(await pg.evaluate(() => window.__core.moment()?.id));
        c[`${P} iv keine Seitenfehler`] = errors.length === 0;
        await ctx.close();
      }
    }
  } catch (e) {
    r.error = String(e);
    console.log(`FEHLER ${bname}: ${e?.stack ?? e}`);
  } finally {
    await browser?.close().catch(() => {});
  }
  const fails = Object.entries(r.checks).filter(([, v]) => !v).map(([x]) => x);
  r.ok = !r.error && fails.length === 0;
  if (!r.ok) failed = true;
  console.log(JSON.stringify({ browser: bname, ok: r.ok, checks: Object.keys(r.checks).length, fails, error: r.error }));
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
