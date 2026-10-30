import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clampGain, dbToLinear, gainDbFor, GAIN_MAX_DB, GAIN_MIN_DB, laneFor, loudLine, loudLog, LIMITER, recordLoud, resetLoudLog, TARGET_LUFS, youtubeVolume } from '../src/moments/loudness';
import { validateMoments } from '../src/moments/contract';

const FIX = new URL('./fixtures/media/', import.meta.url).pathname;

describe('Gain-Rechnung (Entscheidung 16)', () => {
  it('Ziel ist -16 LUFS, Grenzen -12 bis +12 dB', () => {
    expect(TARGET_LUFS).toBe(-16);
    expect(GAIN_MIN_DB).toBe(-12);
    expect(GAIN_MAX_DB).toBe(12);
  });

  it('gainDb = -16 minus lufs', () => {
    expect(gainDbFor(-16)).toBe(0);
    expect(gainDbFor(-22)).toBe(6);
    expect(gainDbFor(-10)).toBe(-6);
    expect(gainDbFor(-12)).toBe(-4);
    expect(gainDbFor(-24)).toBe(8);
    expect(gainDbFor(-18.4)).toBe(2.4);
  });

  it('wird auf -12 bis +12 begrenzt', () => {
    expect(gainDbFor(-40)).toBe(12);
    expect(gainDbFor(-28)).toBe(12);
    expect(gainDbFor(-3)).toBe(-12);
    expect(gainDbFor(0)).toBe(-12);
    expect(clampGain(50)).toBe(12);
    expect(clampGain(-50)).toBe(-12);
  });

  it('ohne gültigen Messwert gilt 0 dB, nie NaN und nie -0', () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '-20', {}, []]) {
      expect(gainDbFor(bad)).toBe(0);
      expect(clampGain(bad)).toBe(0);
    }
    expect(Object.is(clampGain(-0), 0)).toBe(true);
    expect(Object.is(gainDbFor(-16), 0)).toBe(true);
  });

  it('Faktor für den GainNode', () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(6)).toBeCloseTo(1.9953, 3);
    expect(dbToLinear(-6)).toBeCloseTo(0.5012, 3);
    expect(dbToLinear(12)).toBeCloseTo(3.981, 3);
  });

  it('Begrenzer: Schwelle -1 dB, Verhältnis 20', () => {
    expect(LIMITER.threshold).toBe(-1);
    expect(LIMITER.ratio).toBe(20);
  });
});

describe('YouTube kann nur absenken', () => {
  it('bei negativem gainDb 100 mal 10 hoch (gainDb durch 20), sonst 100', () => {
    expect(youtubeVolume(-6)).toBe(50);
    expect(youtubeVolume(-12)).toBe(25);
    expect(youtubeVolume(-3)).toBe(71);
    expect(youtubeVolume(-0.1)).toBe(99);
    expect(youtubeVolume(0)).toBe(100);
    expect(youtubeVolume(6)).toBe(100);
    expect(youtubeVolume(12)).toBe(100);
    expect(youtubeVolume(undefined)).toBe(100);
    expect(youtubeVolume(NaN)).toBe(100);
  });
  it('nie unter 1 und nie über 100', () => {
    for (let g = -30; g <= 30; g += 0.5) {
      const v = youtubeVolume(g);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('Spurwahl: Web Audio nur, wo es sicher ist', () => {
  const base = { enabled: true, running: true, gainDb: 4, local: false, url: 'https://cdn.example/a.mp3' };
  it('Standard: geregelte Spur im Versuch', () => expect(laneFor(base)).toEqual({ lane: 'level', why: 'cors trial' }));
  it('bekannter Host mit CORS', () => expect(laneFor({ ...base, host: 'ok' })).toEqual({ lane: 'level', why: 'cors' }));
  it('Host ohne CORS bleibt unverändert, sonst gäbe Web Audio Stille aus', () => expect(laneFor({ ...base, host: 'bad' })).toEqual({ lane: 'plain', why: 'no cors' }));
  it('Ausschnitt aus dem Vorrat (Blob) ist immer sicher, auch bei Host ohne CORS', () => expect(laneFor({ ...base, local: true, url: 'blob:x', host: 'bad' }).lane).toBe('level'));
  it('natives HLS bleibt unverändert', () => {
    expect(laneFor({ ...base, url: 'https://hls.example/m/manifest.m3u8' })).toEqual({ lane: 'plain', why: 'hls' });
    expect(laneFor({ ...base, url: 'https://hls.example/m/manifest.m3u8?x=1' }).lane).toBe('plain');
  });
  it('vor der ersten Berührung (kein Kontext) unverändert', () => expect(laneFor({ ...base, running: false })).toEqual({ lane: 'plain', why: 'no audio context' }));
  it('ohne Messwert oder bei 0 dB unverändert, nichts zu tun', () => expect(laneFor({ ...base, gainDb: 0 })).toEqual({ lane: 'plain', why: 'no value' }));
  it('Schalter aus und Rückfall erzwingen die unveränderte Spur', () => {
    expect(laneFor({ ...base, enabled: false }).lane).toBe('plain');
    expect(laneFor({ ...base, forcePlain: true, local: true })).toEqual({ lane: 'plain', why: 'fallback' });
  });
});

describe('Diagnose-Zeile', () => {
  beforeEach(resetLoudLog);
  it('Format loud: lufs X, gain Y dB', () => {
    expect(loudLine(-18.4, 2.4)).toBe('loud: lufs -18.4, gain +2.4 dB');
    expect(loudLine(-10, -6)).toBe('loud: lufs -10.0, gain -6.0 dB');
    expect(loudLine(undefined, 0)).toBe('loud: lufs none, gain 0.0 dB');
    expect(loudLine(-22, 6, 'web audio')).toBe('loud: lufs -22.0, gain +6.0 dB (web audio)');
  });
  it('Protokoll: eine Zeile je Moment, spätere Zeile ersetzt die frühere', () => {
    recordLoud('a:1', 'loud: lufs -20.0, gain +4.0 dB');
    recordLoud('b:2', 'loud: lufs none, gain 0.0 dB');
    recordLoud('a:1', 'loud: lufs -20.0, gain +0.0 dB (unchanged: fallback)');
    expect(loudLog()).toEqual(['a:1 loud: lufs -20.0, gain +0.0 dB (unchanged: fallback)', 'b:2 loud: lufs none, gain 0.0 dB']);
    expect(loudLog(1)).toEqual(['b:2 loud: lufs none, gain 0.0 dB']);
  });
});

describe('Vertrag: lufs und gainDb im Pool', () => {
  const base = { id: 'x:1', videoId: 'pod-abc', start: 1, end: 60, channel: 'K', hook: 'h', area: 'brain', form: 'audio', hls: 'https://x/a.mp3' };
  it('gültige Werte bleiben, gainDb wird begrenzt', () => {
    const r = validateMoments([{ ...base, lufs: -20.3, gainDb: 4.3 }, { ...base, id: 'x:2', lufs: -60, gainDb: 44 }]);
    expect(r.moments[0]).toMatchObject({ lufs: -20.3, gainDb: 4.3 });
    expect(r.moments[1].gainDb).toBe(12);
  });
  it('falsche Typen werden entfernt, der Moment bleibt und spielt unverändert', () => {
    const r = validateMoments([{ ...base, lufs: '-20', gainDb: 'laut' }, { ...base, id: 'x:3', gainDb: NaN }]);
    expect(r.skipped).toBe(0);
    expect(r.moments[0].gainDb).toBeUndefined();
    expect(r.moments[0].lufs).toBeUndefined();
    expect(r.moments[1].gainDb).toBeUndefined();
  });
});

// Fixture: zwei Dateien mit -12 und -24 LUFS. Der Gain aus der Rechnung wird mit ffmpeg angewendet (statt des GainNode im Browser)
// und die Differenz danach mit ffmpeg gemessen.
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const lufs = (file: string): number => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(r.stderr);
  if (!m) throw new Error(`keine Messung: ${r.stderr.slice(-300)}`);
  return Number(m[1]);
};

describe.skipIf(!hasFfmpeg)('Lautheits-Fixture (ffmpeg)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loud-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const apply = (name: string, db: number) => {
    const out = join(dir, `${name}-leveled.wav`);
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(FIX, `${name}.wav`), '-af', `volume=${db}dB`, '-c:a', 'pcm_s16le', out]);
    expect(r.status).toBe(0);
    return out;
  };

  it('die Testdateien liegen bei -12 und -24 LUFS', () => {
    expect(lufs(join(FIX, 'loud-m12.wav'))).toBeCloseTo(-12, 0);
    expect(lufs(join(FIX, 'loud-m24.wav'))).toBeCloseTo(-24, 0);
  });

  it('nach dem Angleichen liegen beide bei -16 LUFS und die Differenz ist unter 1 dB', () => {
    const loud = lufs(join(FIX, 'loud-m12.wav'));
    const quiet = lufs(join(FIX, 'loud-m24.wav'));
    const gl = gainDbFor(loud);
    const gq = gainDbFor(quiet);
    expect(gl).toBe(-4);
    expect(gq).toBe(8);
    const a = lufs(apply('loud-m12', gl));
    const b = lufs(apply('loud-m24', gq));
    expect(Math.abs(a - TARGET_LUFS)).toBeLessThan(0.5);
    expect(Math.abs(b - TARGET_LUFS)).toBeLessThan(0.5);
    expect(Math.abs(a - b)).toBeLessThan(1);
  });
});
