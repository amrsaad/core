import type { Area } from '../types';
import type { Moment } from './types';
import { clampGain } from './loudness';

/**
 * Vertrag zwischen Pool und App. Reines Modul ohne Browserzugriff.
 * Beim Laden des Pools wird jeder Moment geprüft. Ein ungültiger Moment wird aussortiert und gezählt, nie geworfen,
 * damit ein einzelner Moment nie die ganze App auf eine Fehlerseite bringt ("Invalid video id", 27.10.2026).
 *
 * Regeln (gleich wie core-content/pipeline/moments/build-enc.ts und ios/Core/Vault.swift, PoolContract):
 * - Pflicht für alle: id, videoId, channel, hook als nicht leerer Text, area beat, body oder brain, form (falls gesetzt) video, audio oder text.
 * - form text braucht einen excerpt.
 * - form audio braucht hls und end nach start.
 * - form video braucht hls oder eine echte 11-stellige YouTube-ID und end nach start.
 * - Doppelte id: nur der erste zählt.
 * Ohne Feld form gilt wie in form.ts: audio true heißt audio, sonst video.
 */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
/** Eigene ID-Räume der Pipeline (Podcast, Text). Sie können 11 Zeichen lang sein und sind trotzdem keine YouTube-IDs. */
const OWN_ID = /^(pod|txt)-/;

/** Echte YouTube-ID: genau 11 Zeichen aus A-Z a-z 0-9 _ - und kein Präfix der Pipeline */
export const isYtId = (id: unknown): id is string => typeof id === 'string' && YT_ID.test(id) && !OWN_ID.test(id);

const AREAS: readonly string[] = ['beat', 'body', 'brain'] satisfies Area[];
const FORMS_OK: readonly string[] = ['video', 'audio', 'text'];

/** Optionale Textfelder: ein Feld mit falschem Typ wird entfernt, der Moment bleibt */
const OPTIONAL_TEXT = ['videoTitle', 'topic', 'forYou', 'context', 'thumb', 'url', 'sourceUrl', 'license', 'author', 'ref', 'excerpt', 'hls'] as const;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const validCue = (c: unknown) => Array.isArray(c) && c.length === 2 && isNum(c[0]) && typeof c[1] === 'string';
const validRecall = (r: unknown) =>
  isObj(r) &&
  typeof r.question === 'string' &&
  typeof r.why === 'string' &&
  Array.isArray(r.options) &&
  r.options.length === 3 &&
  r.options.every((o) => typeof o === 'string') &&
  (r.correct === 0 || r.correct === 1 || r.correct === 2);

/** Grund, warum ein Moment nicht in die App darf, oder null wenn er gültig ist */
export function momentViolation(raw: unknown): string | null {
  if (!isObj(raw)) return 'kein Objekt';
  const m = raw;
  if (!isText(m.id)) return 'id fehlt';
  if (!isText(m.videoId)) return 'videoId fehlt';
  if (!isText(m.channel)) return 'channel fehlt';
  if (!isText(m.hook)) return 'hook fehlt';
  if (typeof m.area !== 'string' || !AREAS.includes(m.area)) return 'area ungültig';
  if (m.form !== undefined && (typeof m.form !== 'string' || !FORMS_OK.includes(m.form))) return 'form ungültig';
  const form = (m.form as string | undefined) ?? (m.audio === true ? 'audio' : 'video');
  if (form === 'text') return isText(m.excerpt) ? null : 'text ohne excerpt';
  if (!isNum(m.start) || !isNum(m.end) || !(m.end > m.start)) return 'start oder end ungültig';
  if (form === 'audio') return isText(m.hls) ? null : 'audio ohne hls';
  return isText(m.hls) || isYtId(m.videoId) ? null : 'video ohne hls und ohne YouTube-ID';
}

/** Gültiger Moment ohne falsch typisierte optionale Felder (Untertitel, Abrufkarte, Textfelder) */
function cleaned(m: Record<string, unknown>): Moment {
  const out: Record<string, unknown> = { ...m };
  for (const k of OPTIONAL_TEXT) if (k in out && typeof out[k] !== 'string') delete out[k];
  if ('cues' in out && !(Array.isArray(out.cues) && out.cues.every(validCue))) delete out.cues;
  if ('recall' in out && !validRecall(out.recall)) delete out.recall;
  if ('audio' in out && typeof out.audio !== 'boolean') delete out.audio;
  if ('top' in out && typeof out.top !== 'boolean') delete out.top;
  // Lautheit: ein falscher Wert darf nie einen Moment anheben oder absenken, also entfernen. Gültige Werte werden auf -12 bis +12 dB begrenzt.
  for (const k of ['lufs', 'gainDb'] as const) if (k in out && !isNum(out[k])) delete out[k];
  if ('gainDb' in out) out.gainDb = clampGain(out.gainDb);
  if ('aliases' in out && !(Array.isArray(out.aliases) && out.aliases.every((a) => typeof a === 'string'))) delete out.aliases;
  return out as unknown as Moment;
}

export interface PoolCheck {
  moments: Moment[];
  /** Aussortierte Momente */
  skipped: number;
  /** Gründe mit Anzahl, für die Konsole */
  reasons: Record<string, number>;
}

/** Prüft eine Liste aus dem Pool. Wirft nie, auch nicht bei Müll (null, Zahlen, falsche Typen). */
export function validateMoments(list: unknown): PoolCheck {
  const moments: Moment[] = [];
  const reasons: Record<string, number> = {};
  const ids = new Set<string>();
  let skipped = 0;
  const skip = (why: string) => {
    skipped++;
    reasons[why] = (reasons[why] ?? 0) + 1;
  };
  if (!Array.isArray(list)) return { moments, skipped: 0, reasons };
  for (const raw of list) {
    const why = momentViolation(raw);
    if (why) {
      skip(why);
      continue;
    }
    const m = raw as Record<string, unknown>;
    if (ids.has(m.id as string)) {
      skip('doppelte id');
      continue;
    }
    ids.add(m.id as string);
    moments.push(cleaned(m));
  }
  return { moments, skipped, reasons };
}
