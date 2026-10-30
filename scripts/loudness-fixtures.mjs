// Erzeugt die Lautheits-Fixtures tests/fixtures/media/loud-m12.wav und loud-m24.wav (Rosa Rauschen, 4 s, 16 kHz, mono).
// Pegel werden mit ffmpeg ebur128 auf -12 und -24 LUFS integriert eingestellt. Aufruf: node scripts/loudness-fixtures.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../tests/fixtures/media/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

export function measure(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(r.stderr);
  if (!m) throw new Error(`keine Messung für ${file}\n${r.stderr.slice(-400)}`);
  return Number(m[1]);
}

const make = (name, target) => {
  const raw = `${out}.raw-${name}.wav`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=4:sample_rate=16000:seed=7:amplitude=0.2', '-ac', '1', '-c:a', 'pcm_s16le', raw]);
  const db = target - measure(raw);
  const file = `${out}${name}.wav`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', `volume=${db.toFixed(3)}dB`, '-c:a', 'pcm_s16le', file]);
  execFileSync('rm', [raw]);
  console.log(`${name}.wav: ${measure(file)} LUFS (Ziel ${target})`);
};
make('loud-m12', -12);
make('loud-m24', -24);
