// Gleiche Lautheit über alle Momente (Entscheidung 16, Max 30.10.2026). Reines Modul ohne Browserzugriff.
// Die Pipeline misst die integrierte Lautheit pro Moment (ffmpeg ebur128) und veröffentlicht lufs und gainDb.
// Dieselbe Rechnung steht in core-content/pipeline/moments/loudness.ts. Beide müssen gleich bleiben.

/** Ziel in LUFS, integriert über den Ausschnitt */
export const TARGET_LUFS = -16;
/** Grenzen der Anpassung in dB. Mehr Anhebung verstärkt vor allem Rauschen, mehr Absenkung macht den Moment unhörbar. */
export const GAIN_MIN_DB = -12;
export const GAIN_MAX_DB = 12;

/** Begrenzer hinter dem Gain: fängt Spitzen ab, wenn ein leiser Moment angehoben wird */
export const LIMITER = { threshold: -1, ratio: 20, knee: 0, attack: 0.003, release: 0.1 } as const;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Gain in dB für eine gemessene Lautheit. Ohne gültigen Messwert 0 (Moment spielt unverändert). */
export function gainDbFor(lufs: unknown): number {
  if (!isNum(lufs)) return 0;
  return clampGain(TARGET_LUFS - lufs);
}

/** Gain auf den erlaubten Bereich begrenzen, eine Dezimalstelle. Müll (kein Zahlenwert) wird 0. */
export function clampGain(db: unknown): number {
  if (!isNum(db)) return 0;
  // + 0 macht aus -0 eine 0
  return round1(Math.min(GAIN_MAX_DB, Math.max(GAIN_MIN_DB, db))) + 0;
}

/** Faktor für den Web-Audio-GainNode */
export const dbToLinear = (db: number): number => 10 ** (db / 20);

/**
 * Lautstärke 0 bis 100 für setVolume des YouTube-Players. YouTube kann nur absenken, darum bei Anhebung 100.
 * 100 mal 10 hoch (gainDb durch 20), ganzzahlig. Mindestens 1, damit der Player nie ganz verstummt.
 */
export function youtubeVolume(gainDb: unknown): number {
  const g = clampGain(gainDb);
  if (g >= 0) return 100;
  return Math.max(1, Math.round(100 * 10 ** (g / 20)));
}

export type Lane = 'plain' | 'level';
export type HostState = 'ok' | 'bad';

/**
 * Welche Spur ein Moment bekommt. Die geregelte Spur ("level") läuft über Web Audio, die unveränderte ("plain") wie bisher.
 * Ein Element, das einmal an Web Audio hängt, gibt Quellen ohne CORS-Freigabe nur als Stille aus, und das lässt sich nicht
 * mehr lösen. Darum bekommt die geregelte Spur nur Quellen, bei denen das ausgeschlossen ist, alles andere läuft unverändert.
 */
export function laneFor(o: { enabled: boolean; running: boolean; gainDb: number; local: boolean; url: string; host?: HostState; forcePlain?: boolean; rate?: number }): { lane: Lane; why: string } {
  if (!o.enabled) return { lane: 'plain', why: 'off' };
  // Tempo ungleich 1x: nie über Web Audio, das Stottern auf dem iPhone (Issue 13, Max 30.10.2026)
  if (o.rate !== undefined && o.rate !== 1) return { lane: 'plain', why: 'tempo' };
  if (o.gainDb === 0) return { lane: 'plain', why: 'no value' };
  if (o.forcePlain) return { lane: 'plain', why: 'fallback' };
  if (!o.running) return { lane: 'plain', why: 'no audio context' };
  // Ausschnitt aus dem Vorrat: Blob-URL derselben Herkunft, nie ein CORS-Problem
  if (o.local) return { lane: 'level', why: 'local' };
  // Natives HLS (iOS) liefert über Web Audio keinen Ton
  if (/\.m3u8(\?|#|$)/i.test(o.url)) return { lane: 'plain', why: 'hls' };
  if (o.host === 'bad') return { lane: 'plain', why: 'skipped cors' };
  return { lane: 'level', why: o.host === 'ok' ? 'cors' : 'cors trial' };
}

/** Was auf einem Moment wirklich angewendet wird, für Diagnose und Tests */
export interface LoudInfo {
  /** angewendete Anpassung in dB (bei YouTube nie über 0) */
  db: number;
  /** web audio, youtube volume oder unchanged: Grund */
  how: string;
  /** Faktor am GainNode, nur bei web audio */
  linear?: number;
}

/** Zeile für Diagnose und Copy diagnostics */
export function loudLine(lufs: unknown, gainDb: unknown, path?: string): string {
  const l = isNum(lufs) ? lufs.toFixed(1) : 'none';
  const g = clampGain(gainDb);
  // Quelle ohne CORS-Freigabe: Web Audio würde Stille ausgeben, der Moment läuft unverändert (Max, 30.10.2026)
  const skipped = path?.includes('skipped cors') ? 'skipped cors, ' : '';
  return `loud: ${skipped}lufs ${l}, gain ${g > 0 ? '+' : ''}${g.toFixed(1)} dB${path ? ` (${path})` : ''}`;
}

/** Wiedergegebene Momente der Sitzung, neueste zuletzt. Settings liest daraus. */
const LOG_MAX = 60;
const log: { id: string; line: string }[] = [];

export function recordLoud(id: string, line: string): void {
  const have = log.find((e) => e.id === id);
  if (have) {
    have.line = line;
    return;
  }
  log.push({ id, line });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

/** Letzte n Zeilen, neueste zuletzt, je mit Moment-ID davor */
export const loudLog = (n = LOG_MAX): string[] => log.slice(-n).map((e) => `${e.id} ${e.line}`);
export const resetLoudLog = (): void => void (log.length = 0);
