#!/usr/bin/env node
// gate:all (Entscheidung 55): die komplette Reihe aus .github/workflows/daily.yml lokal, vor jedem Push.
// tsc, Unit, Build, danach jede E2E-Suite in der Reihenfolge, mit den Ports, Umgebungsvariablen und Zeitlimits des CI, WebKit und Chromium wie dort.
// Ausgabe: Tabelle (Suite, Browser, Ergebnis, Dauer, rote Befunde), auch in pipeline/out/gate-all/table.md. Exit 1, sobald eine Zeile rot ist.
// Aufruf: npm run gate:all
//   --only moments,layout   nur diese Suiten (Kennungen siehe --list), tsc, Unit und Build laufen immer
//   --skip-build            Build überspringen (dist muss aktuell sein)
//   --list                  Kennungen ausgeben
// Die Ergebnisse landen in pipeline/out/gate-all/<kennung>/, nicht in pipeline/out/e2e-*, damit die vom CI eingecheckten Dateien unberührt bleiben.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
process.chdir(ROOT);
const OUT = 'pipeline/out/gate-all';

const args = process.argv.slice(2);
const only = (args.find((a, i) => args[i - 1] === '--only') ?? '').split(',').filter(Boolean);

/** Reihenfolge, Ports und Umgebung wie in daily.yml (Job e2e). `browsers` ist die Beschriftung des CI, wenn die Ergebnisdatei keine Browser nennt. */
const SUITES = [
  { id: 'moments', port: 4173, script: 'moments', min: 12, browsers: ['WebKit', 'Chromium'], title: 'Momente-Feed' },
  { id: 'desktop', port: 4175, script: 'desktop', min: 10, browsers: ['Chromium'], title: 'Desktop-Modus' },
  { id: 'keyrestore', port: 4174, script: 'keyrestore', min: 8, browsers: ['WebKit', 'Chromium'], env: { RUNS: '3' }, title: 'Schlüsselsicherung' },
  { id: 'sync', port: 4176, script: 'sync', min: 10, browsers: ['WebKit', 'Chromium'], title: 'Geräte-Sync' },
  { id: 'digest', port: 4177, script: 'digest', min: 10, browsers: ['WebKit', 'Chromium'], title: 'Core Digest' },
  { id: 'background', port: 4178, script: 'background', min: 8, browsers: ['WebKit', 'Chromium'], title: 'Hintergrund-Wiedergabe' },
  { id: 'preload', port: 4179, script: 'preload', min: 8, browsers: ['Chromium'], title: 'Offline-Vorrat' },
  { id: 'endpage', port: 4180, script: 'endpage', min: 6, browsers: ['WebKit', 'Chromium'], title: 'Endseite' },
  { id: 'swipe', port: 4181, script: 'swipe', min: 8, browsers: ['WebKit', 'Chromium'], title: 'Wischübergang' },
  { id: 'loudness', port: 4182, script: 'loudness', min: 6, browsers: ['Chromium'], env: { E2E_BROWSERS: 'chromium' }, title: 'Gleiche Lautheit' },
  { id: 'offline', port: 4183, script: 'offline', min: 14, browsers: ['WebKit', 'Chromium'], title: 'Netzabbruch' },
  { id: 'tempo', port: 4184, script: 'tempo', min: 8, browsers: ['WebKit', 'Chromium'], title: 'Tempo' },
  { id: 'tempoperf', port: 4186, script: 'tempoperf', min: 20, browsers: ['Chromium'], env: { E2E_BROWSERS: 'chromium', CHECK: '1' }, title: 'Tempo flüssig' },
  { id: 'recallqueue', port: 4185, script: 'recallqueue', min: 8, browsers: ['WebKit', 'Chromium'], title: 'Abrufkarten-Warteschlange' },
  { id: 'audiotab', port: 4187, script: 'audiotab', min: 12, browsers: ['WebKit', 'Chromium'], title: 'Audio-Reiter' },
  { id: 'video4g', port: 4188, script: 'video4g', min: 15, browsers: ['Chromium'], env: { E2E_BROWSERS: 'chromium' }, title: 'Video-Start unter 4G' },
  { id: 'layout', port: 4189, script: 'layout', min: 45, browsers: ['Chromium', 'WebKit'], extra: ['run'], title: 'Layout-Gate' },
];

if (args.includes('--list')) {
  console.log(SUITES.map((s) => s.id).join('\n'));
  process.exit(0);
}
const unknown = only.filter((id) => !SUITES.some((s) => s.id === id));
if (unknown.length) {
  console.error(`Unbekannte Kennung: ${unknown.join(', ')}. Gültig: ${SUITES.map((s) => s.id).join(', ')}`);
  process.exit(2);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const rows = [];
const fmt = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};
const say = (t) => console.log(`[gate:all ${new Date().toTimeString().slice(0, 8)}] ${t}`);

/** Ein Schritt mit festem Befehl (tsc, Unit, Build): Ausgabe in eine Logdatei, Zeile in die Tabelle */
const step = (name, browser, cmd, argv, logName) => {
  say(`${name} ...`);
  const t0 = Date.now();
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: process.env });
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  writeFileSync(join(OUT, `${logName}.log`), log);
  const ok = r.status === 0;
  rows.push({ suite: name, browser, ok, time: Date.now() - t0, note: ok ? '' : lastLines(log, 3) });
  say(`${name}: ${ok ? 'grün' : 'ROT'} (${fmt(Date.now() - t0)})`);
  return ok;
};
const lastLines = (log, n) => log.trim().split('\n').slice(-n).join(' | ').slice(0, 220);

const waitUp = async (port) => {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/core/`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

/** Ergebnisdatei einer Suite lesen und je Browser zählen, wie viele Prüfungen rot sind. Ohne lesbare Datei bleibt es bei der Beschriftung des CI. */
const perBrowser = (dir, fallback) => {
  const res = [];
  const files = existsSync(dir) ? [...readdirSync(dir), ...(existsSync(join(dir, 'run')) ? readdirSync(join(dir, 'run')).map((f) => join('run', f)) : [])] : [];
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    let j;
    try {
      j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const reds = (checks, bag = []) => {
      for (const [k, v] of Object.entries(checks ?? {})) if (v === false) bag.push(k);
      return bag;
    };
    if (Array.isArray(j.runs) && j.runs.length) {
      for (const r of j.runs) {
        const name = String(r.browser ?? '').replace(/-.*/, '');
        if (!name) continue;
        const bad = reds(r.checks);
        if (r.ok === false && !bad.length) bad.push('ok=false');
        res.push({ browser: name, bad });
      }
    } else if (j.checks && typeof j.checks === 'object') {
      for (const b of ['webkit', 'chromium']) {
        const keys = Object.entries(j.checks).filter(([k]) => k.toLowerCase().includes(b));
        if (keys.length) res.push({ browser: b, bad: keys.filter(([, v]) => v === false).map(([k]) => k) });
      }
      if (!res.length) res.push({ browser: 'alle', bad: reds(j.checks) });
    }
  }
  if (!res.length) return fallback.map((b) => ({ browser: b, bad: null }));
  // Mehrere Läufe desselben Browsers (z. B. 3 Läufe, mehrere Profile) zu einer Zeile zusammenfassen
  const merged = new Map();
  for (const r of res) {
    const key = r.browser[0].toUpperCase() + r.browser.slice(1);
    const cur = merged.get(key) ?? { browser: key, bad: [] };
    cur.bad.push(...r.bad);
    merged.set(key, cur);
  }
  return [...merged.values()];
};

const runSuite = async (s) => {
  const dir = join(OUT, s.id);
  mkdirSync(dir, { recursive: true });
  say(`${s.title} (${s.id}, Port ${s.port}) ...`);
  const t0 = Date.now();
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(s.port), '--strictPort'], { detached: true, stdio: 'ignore' });
  const up = await waitUp(s.port);
  let code = 1;
  let timedOut = false;
  let log = '';
  if (up) {
    const logFile = join(OUT, `${s.id}.log`);
    const stream = createWriteStream(logFile);
    const child = spawn('node', [`tests/e2e/${s.script}.mjs`, `http://127.0.0.1:${s.port}/core/`, dir, ...(s.extra ?? [])], { env: { ...process.env, ...(s.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, s.min * 60 * 1000);
    code = await new Promise((res) => child.on('close', (c) => res(c ?? 1)));
    clearTimeout(timer);
    stream.end();
    log = readFileSync(logFile, 'utf8');
  } else {
    log = `Preview-Server auf Port ${s.port} nicht erreichbar`;
  }
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {}
  const time = Date.now() - t0;
  const found = perBrowser(dir, s.browsers);
  const fails = log.split('\n').filter((l) => /^\s*(FAIL|ROT)\b/.test(l)).map((l) => l.trim());
  const suiteOk = code === 0 && !timedOut && up;
  // Nennt die Ergebnisdatei bei mindestens einem Browser einen Einzelbefund, ist die Suite dort rot und die übrigen Browser stehen nach ihren eigenen Prüfungen.
  // Ist die Suite rot, ohne dass die Datei einen Einzelbefund nennt (Absturz, Zeitlimit, kein Server), steht sie in jeder Zeile rot.
  const anyOwn = found.some((f) => f.bad && f.bad.length);
  for (const f of found) {
    const own = f.bad && f.bad.length ? f.bad : null;
    const ok = anyOwn ? !own && !timedOut && up : suiteOk;
    const note = ok ? '' : own ? own.slice(0, 4).join(', ') + (own.length > 4 ? ` (+${own.length - 4})` : '') : timedOut ? `Zeitlimit ${s.min} min` : !up ? log : fails.slice(0, 2).join(' | ') || `Exit ${code}`;
    rows.push({ suite: s.title, browser: f.browser, ok, time, note });
  }
  say(`${s.title}: ${suiteOk ? 'grün' : 'ROT'} (${fmt(time)})`);
};

const table = () => {
  const head = ['Suite', 'Browser', 'Ergebnis', 'Dauer', 'Rote Befunde'];
  const body = rows.map((r) => [r.suite, r.browser, r.ok ? 'grün' : 'ROT', fmt(r.time), r.note || '']);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (c) => `| ${c.map((x, i) => x.padEnd(w[i])).join(' | ')} |`;
  const red = rows.filter((r) => !r.ok).length;
  return [line(head), `|${w.map((x) => '-'.repeat(x + 2)).join('|')}|`, ...body.map(line), '', `${rows.length - red} grün, ${red} rot`].join('\n');
};

const t0 = Date.now();
let ok = step('tsc', 'Node', 'npx', ['tsc', '-b'], 'tsc');
ok = step('Unit (vitest)', 'Node', 'npx', ['vitest', 'run'], 'unit') && ok;
if (!args.includes('--skip-build')) ok = step('Build', 'Node', 'npm', ['run', 'build'], 'build') && ok;
if (!ok) say('tsc, Unit oder Build rot: die E2E-Reihe läuft trotzdem durch, damit die Tabelle vollständig ist.');
for (const s of SUITES.filter((x) => !only.length || only.includes(x.id))) await runSuite(s);

const out = table();
console.log(`\n${out}\n\nGesamtdauer ${fmt(Date.now() - t0)}`);
writeFileSync(join(OUT, 'table.md'), `${out}\n\nGesamtdauer ${fmt(Date.now() - t0)}\n`);
process.exit(rows.some((r) => !r.ok) ? 1 : 0);
