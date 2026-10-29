/**
 * Lernregeln (Auftrag Max 29.10.2026). Reine Funktionen, gleiche Regeln und Prüfdaten in ios/Core/Learn.swift
 * und ios/CoreTests/LearnTests.swift.
 *
 * Gewichte laufen von 0,2 bis 3, Standard 1. Die Zahlen der negativen Regeln sind Deckel: das Gewicht fällt auf den Wert,
 * steigt aber nie davon. Ein Gewicht unter dem Deckel bleibt, wo es ist.
 *
 * - Skip (weniger als 3 s geschaut, nach vorn weggewischt): Kanal und Thema auf höchstens 0,6.
 *   Zweiter Skip desselben Kanals in Folge: Kanal auf 0,2 für 14 Tage, danach zurück auf 0,6.
 * - Not for me: Thema auf 0,2 für 30 Tage (danach zurück auf das Gewicht davor, höchstens 1), Kanal auf höchstens 0,5.
 * - Wrong: Kanal auf höchstens 0,5.
 * - Known ("Already known"): Thema auf höchstens 0,7.
 * - Weak (Chip Boring): Kanal auf höchstens 0,7.
 * - More, Save, Ende, Zurückwischen, früh oder fast ganz weggewischt: Faktor wie bisher (mix.ts SIGNAL) auf Kanal und Thema,
 *   dazu abgeschwächt auf den Bereich.
 *
 * Abläufe stehen als Zeitstempel in den Gewichten (`until`, Schlüssel c:<Kanal> und t:<Thema>, Wert: Ende in ms und Gewicht danach).
 * Nichts läuft im Hintergrund. Wer Gewichte liest, rechnet mit `settle(weights, now)`, abgelaufene Einträge fallen dort auf ihr
 * Gewicht danach. Beim Zusammenführen der Geräte gilt je Schlüssel der jüngste Zeitstempel, siehe lib/sync/merge.ts.
 * Die Erkundung bleibt bei 20 Prozent (mix.ts EXPLORE).
 */
import type { Weights } from './mix';
import { speakerLine } from './speaker';

export const W_MIN = 0.2;
export const W_MAX = 3;
export const clampW = (w: number) => Math.min(W_MAX, Math.max(W_MIN, Number(w.toFixed(4))));

export const DAY_MS = 86_400_000;
/** Weniger als so viele Sekunden geschaut, dann weggewischt: Skip */
export const SKIP_SEC = 3;

export const RULE = {
  skip: 0.6,
  skipRun: 0.2,
  skipRunDays: 14,
  notForMeTopic: 0.2,
  notForMeDays: 30,
  notForMeChannel: 0.5,
  wrongChannel: 0.5,
  knownTopic: 0.7,
  weakChannel: 0.7,
} as const;

export type Family = 'channel' | 'topic';

/** Ablauf eines Gewichts: bis `at` (ms) gilt der Wert in weights, danach `back` */
export interface Until {
  at: number;
  back: number;
}

/** Schlüssel in weights.until: c:<Kanal> oder t:<Thema> */
export const untilKey = (fam: Family, k: string) => `${fam === 'channel' ? 'c' : 't'}:${k}`;
export function parseUntilKey(key: string): { fam: Family; k: string } {
  return { fam: key.startsWith('c:') ? 'channel' : 'topic', k: key.slice(2) };
}

export const emptyWeights = (): Weights => ({ area: {}, channel: {}, topic: {} });

/** Abgelaufene Einträge einrechnen: Gewicht fällt auf `back`, der Eintrag entfällt. Gleicher Verweis, wenn nichts abgelaufen ist. */
export function settle(w: Weights, now: number): Weights {
  const u = w.until;
  if (!u) return w;
  const keys = Object.keys(u);
  if (!keys.some((k) => u[k].at <= now)) return w;
  const out: Weights = { area: w.area, channel: { ...w.channel }, topic: { ...w.topic } };
  const rest: Record<string, Until> = {};
  for (const key of keys) {
    const e = u[key];
    if (e.at > now) {
      rest[key] = e;
      continue;
    }
    const { fam, k } = parseUntilKey(key);
    out[fam][k] = clampW(e.back);
  }
  if (Object.keys(rest).length) out.until = rest;
  return out;
}

/** Gewicht höchstens auf value. Ein laufender Ablauf behält sein "danach", höchstens aber value. */
function cap(w: Weights, fam: Family, k: string, value: number): Weights {
  const cur = w[fam][k] ?? 1;
  const out: Weights = { ...w, [fam]: { ...w[fam], [k]: clampW(Math.min(cur, value)) } };
  const e = w.until?.[untilKey(fam, k)];
  if (e) out.until = { ...w.until, [untilKey(fam, k)]: { at: e.at, back: clampW(Math.min(e.back, value)) } };
  return out;
}

/** Gewicht auf höchstens value bis `at`, danach zurück auf das Gewicht davor (höchstens backCap). Läuft schon ein Ablauf, gilt der spätere Termin. */
function penalize(w: Weights, fam: Family, k: string, value: number, at: number, backCap: number): Weights {
  const key = untilKey(fam, k);
  const e = w.until?.[key];
  const before = e ? e.back : w[fam][k] ?? 1;
  const out = cap(w, fam, k, value);
  out.until = { ...out.until, [key]: { at: e ? Math.max(e.at, at) : at, back: clampW(Math.min(before, backCap)) } };
  return out;
}

type M = { channel: string; topic: string };

/** Läuft nach Faktor wie bisher: Kanal und Thema, dazu abgeschwächt der Bereich. Läuft ein Ablauf, wächst auch das Gewicht danach mit. */
export function signal(w0: Weights, m: M & { area: string }, factor: number, now: number, opts: { area?: boolean } = {}): Weights {
  const w = settle(w0, now);
  const scale = (fam: Family, k: string, out: Weights) => {
    const e = w.until?.[untilKey(fam, k)];
    if (e) out.until = { ...out.until, [untilKey(fam, k)]: { at: e.at, back: clampW(e.back * factor) } };
  };
  const out: Weights = {
    area: opts.area === false ? w.area : { ...w.area, [m.area]: clampW((w.area[m.area] ?? 1) * Math.sqrt(factor)) },
    channel: { ...w.channel, [m.channel]: clampW((w.channel[m.channel] ?? 1) * factor) },
    topic: { ...w.topic, [m.topic]: clampW((w.topic[m.topic] ?? 1) * factor) },
  };
  if (w.until) out.until = w.until;
  scale('channel', m.channel, out);
  scale('topic', m.topic, out);
  return out;
}

/** Zähler für "zweiter Skip desselben Kanals in Folge". Jede andere Wertung setzt ihn zurück (undefined). */
export interface SkipRun {
  channel: string;
  n: number;
}

export function skip(w0: Weights, run: SkipRun | undefined, m: M, now: number): { weights: Weights; run: SkipRun } {
  const n = run && run.channel === m.channel ? run.n + 1 : 1;
  let w = cap(cap(settle(w0, now), 'channel', m.channel, RULE.skip), 'topic', m.topic, RULE.skip);
  if (n >= 2) w = penalize(w, 'channel', m.channel, RULE.skipRun, now + RULE.skipRunDays * DAY_MS, RULE.skip);
  return { weights: w, run: { channel: m.channel, n } };
}

export function notForMe(w0: Weights, m: M, now: number): Weights {
  const w = penalize(settle(w0, now), 'topic', m.topic, RULE.notForMeTopic, now + RULE.notForMeDays * DAY_MS, 1);
  return cap(w, 'channel', m.channel, RULE.notForMeChannel);
}

export const wrong = (w: Weights, m: M, now: number): Weights => cap(settle(w, now), 'channel', m.channel, RULE.wrongChannel);
export const known = (w: Weights, m: M, now: number): Weights => cap(settle(w, now), 'topic', m.topic, RULE.knownTopic);
export const weak = (w: Weights, m: M, now: number): Weights => cap(settle(w, now), 'channel', m.channel, RULE.weakChannel);

/** Was ein Chip lernt */
export type Effect = 'known' | 'wrong' | 'mute' | 'notForMe' | 'weak';

/** Gewichte nach dem Effekt. Mute ändert die Gewichte nicht, der Sprecher kommt in die Liste der Stummen. */
export function applyEffect(w: Weights, e: Effect, m: M, now: number): Weights {
  switch (e) {
    case 'known':
      return known(w, m, now);
    case 'wrong':
      return wrong(w, m, now);
    case 'notForMe':
      return notForMe(w, m, now);
    case 'weak':
      return weak(w, m, now);
    case 'mute':
      return w;
  }
}

const cap1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Bestätigungszeile am Blatt nach einem Chip. Ohne Effekt (Bad cut, Great): "Noted". */
export function confirmLine(e: Effect | null, m: M): string {
  switch (e) {
    case 'known':
    case 'notForMe':
      return `Less ${cap1(m.topic)}`;
    case 'wrong':
    case 'weak':
      return `Less ${speakerLine(m.channel)}`;
    case 'mute':
      return `${speakerLine(m.channel)} muted`;
    default:
      return 'Noted';
  }
}

export interface Row {
  key: string;
  weight: number;
  /** Ende des Ablaufs in ms, solange einer läuft */
  until?: number;
}
export interface Learned {
  channelUp: Row[];
  channelDown: Row[];
  topicUp: Row[];
  topicDown: Row[];
}

export const LEARNED_N = 5;

/** Karte "What Core learned": je fünf Kanäle und Themen oben (über 1) und unten (unter 1), mit wirksamem Gewicht. Gleichstand nach Name. */
export function learned(w0: Weights, now: number): Learned {
  const w = settle(w0, now);
  const rows = (fam: Family): Row[] =>
    Object.entries(w[fam]).map(([key, weight]) => {
      const e = w.until?.[untilKey(fam, key)];
      return e ? { key, weight, until: e.at } : { key, weight };
    });
  const up = (r: Row[]) => r.filter((x) => x.weight > 1.0005).sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1)).slice(0, LEARNED_N);
  const down = (r: Row[]) => r.filter((x) => x.weight < 0.9995).sort((a, b) => a.weight - b.weight || (a.key < b.key ? -1 : 1)).slice(0, LEARNED_N);
  const c = rows('channel');
  const t = rows('topic');
  return { channelUp: up(c), channelDown: down(c), topicUp: up(t), topicDown: down(t) };
}

/** Anzeige des Gewichts: zwei Stellen, Pfeil nach oben über 1, nach unten unter 1 */
export const weightText = (v: number) => `${v.toFixed(2)} ${v > 1 ? '↑' : '↓'}`;
