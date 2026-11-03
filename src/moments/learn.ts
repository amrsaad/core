/**
 * Lernregeln (Auftrag Max 29.10.2026, ersetzt durch Entscheidung 38, 01.11.2026, Issue 28). Reine Funktionen, die Prüfdaten für
 * ios/Core/Learn.swift und ios/CoreTests/LearnTests.swift stehen in tests/moments-learn.test.ts.
 *
 * Jede Rückmeldung wirkt auf die kleinste Einheit, die sie erklärt, und wird erst durch Wiederholung größer.
 * Gewichte laufen von 0,2 bis 3, Standard 1. Die Zahlen der Deckel-Regeln sind Deckel: das Gewicht fällt auf den Wert, steigt aber nie davon.
 *
 * - Not for me: dieser Moment ist weg (abgelehnt, MomentFeed), die Folge 0,3 für 30 Tage, das Thema höchstens 0,9. Dreimal in 30 Tagen
 *   im selben Unterthema heißt Unterthema 0,3 für 30 Tage.
 * - Known ("Already known"): Moment weg, keine Abrufkarte, keine Gewichte. Wissen ist keine Vorliebe.
 * - Weak: Kanal mal 0,9 je Tipp, kumulativ, nie unter 0,5. Der dritte Tipp in 30 Tagen setzt den Kanal auf höchstens 0,5.
 * - Wrong (Transkript oder Schnitt falsch): keine Gewichte, nur die Notiz an die Pipeline.
 * - Mute speaker: Kanal stumm, Gewichte unverändert (MomentFeed).
 * - Skip (weniger als 3 s geschaut, nach vorn weggewischt): Kanal und Thema mal 0,97. Zwei Skips derselben Folge in 7 Tagen: Folge 0,5 für 7 Tage.
 * - Abgelehnt (derselbe Moment zweimal vor 5 s weggewischt, Entscheidung 36): Kanal und Thema mal 0,85.
 * - More, Save, Ende, Zurückwischen, Abruf richtig, früh oder fast ganz weggewischt: Faktor (mix.ts SIGNAL) auf Kanal und Thema, dazu abgeschwächt auf den Bereich.
 *
 * Abläufe stehen als Zeitstempel in den Gewichten (`until`, Schlüssel c:<Kanal>, t:<Thema>, e:<Folge>, s:<Unterthema>, Wert: Ende in ms und Gewicht danach).
 * Nichts läuft im Hintergrund. Wer Gewichte liest, rechnet mit `settle(weights, now)`, abgelaufene Einträge fallen dort auf ihr
 * Gewicht danach. Beim Zusammenführen der Geräte gilt je Schlüssel der jüngste Zeitstempel, siehe lib/sync/merge.ts.
 * Zähler für "dreimal in 30 Tagen" stehen am Gerät (`tapLog`). Die Erkundung bleibt bei 20 Prozent (mix.ts EXPLORE).
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
  /** Skip unter 3 s: Faktor auf Kanal und Thema */
  skipFactor: 0.97,
  /** Zwei Skips derselben Folge in skipEpisodeDays: Folge auf diesen Wert für skipEpisodeDays */
  skipEpisode: 0.5,
  skipEpisodeDays: 7,
  skipEpisodeTaps: 2,
  notForMeEpisode: 0.3,
  notForMeDays: 30,
  notForMeTopic: 0.9,
  /** Dreimal in subtopicDays im selben Unterthema: Unterthema auf subtopicWeight für subtopicDays */
  subtopicTaps: 3,
  subtopicWeight: 0.3,
  subtopicDays: 30,
  weakFactor: 0.9,
  weakFloor: 0.5,
  weakTaps: 3,
  weakDays: 30,
} as const;

export type Family = 'channel' | 'topic' | 'episode' | 'subtopic';

/** Ablauf eines Gewichts: bis `at` (ms) gilt der Wert in weights, danach `back` */
export interface Until {
  at: number;
  back: number;
}

const PREFIX: Record<Family, string> = { channel: 'c', topic: 't', episode: 'e', subtopic: 's' };
const FAMILY_OF: Record<string, Family> = { c: 'channel', t: 'topic', e: 'episode', s: 'subtopic' };

/** Schlüssel in weights.until: c:<Kanal>, t:<Thema>, e:<Folge> oder s:<Unterthema> */
export const untilKey = (fam: Family, k: string) => `${PREFIX[fam]}:${k}`;
export function parseUntilKey(key: string): { fam: Family; k: string } {
  return { fam: FAMILY_OF[key.slice(0, 1)] ?? 'topic', k: key.slice(2) };
}

export const emptyWeights = (): Weights => ({ area: {}, channel: {}, topic: {} });

/** Abgelaufene Einträge einrechnen: Gewicht fällt auf `back`, der Eintrag entfällt. Gleicher Verweis, wenn nichts abgelaufen ist. */
export function settle(w: Weights, now: number): Weights {
  const u = w.until;
  if (!u) return w;
  const keys = Object.keys(u);
  if (!keys.some((k) => u[k].at <= now)) return w;
  const out: Weights = { area: w.area, channel: { ...w.channel }, topic: { ...w.topic } };
  if (w.episode) out.episode = { ...w.episode };
  if (w.subtopic) out.subtopic = { ...w.subtopic };
  const rest: Record<string, Until> = {};
  for (const key of keys) {
    const e = u[key];
    if (e.at > now) {
      rest[key] = e;
      continue;
    }
    const { fam, k } = parseUntilKey(key);
    out[fam] = { ...out[fam], [k]: clampW(e.back) };
  }
  if (Object.keys(rest).length) out.until = rest;
  return out;
}

/** Gewicht höchstens auf value. Ein laufender Ablauf behält sein "danach", höchstens aber value. */
function cap(w: Weights, fam: Family, k: string, value: number): Weights {
  const cur = w[fam]?.[k] ?? 1;
  const out: Weights = { ...w, [fam]: { ...w[fam], [k]: clampW(Math.min(cur, value)) } };
  const e = w.until?.[untilKey(fam, k)];
  if (e) out.until = { ...w.until, [untilKey(fam, k)]: { at: e.at, back: clampW(Math.min(e.back, value)) } };
  return out;
}

/** Gewicht auf höchstens value bis `at`, danach zurück auf das Gewicht davor (höchstens backCap). Läuft schon ein Ablauf, gilt der spätere Termin. */
function penalize(w: Weights, fam: Family, k: string, value: number, at: number, backCap: number): Weights {
  const key = untilKey(fam, k);
  const e = w.until?.[key];
  const before = e ? e.back : w[fam]?.[k] ?? 1;
  const out = cap(w, fam, k, value);
  out.until = { ...out.until, [key]: { at: e ? Math.max(e.at, at) : at, back: clampW(Math.min(before, backCap)) } };
  return out;
}

/** Was eine Wertung vom Moment braucht */
export interface M {
  channel: string;
  topic: string;
  videoId: string;
  subtopic?: string[];
}

/** Läuft nach Faktor wie bisher: Kanal und Thema, dazu abgeschwächt der Bereich. Läuft ein Ablauf, wächst auch das Gewicht danach mit. */
export function signal(w0: Weights, m: Pick<M, 'channel' | 'topic'> & { area: string }, factor: number, now: number, opts: { area?: boolean } = {}): Weights {
  const w = settle(w0, now);
  const scale = (fam: Family, k: string, out: Weights) => {
    const e = w.until?.[untilKey(fam, k)];
    if (e) out.until = { ...out.until, [untilKey(fam, k)]: { at: e.at, back: clampW(e.back * factor) } };
  };
  const out: Weights = {
    ...w,
    area: opts.area === false ? w.area : { ...w.area, [m.area]: clampW((w.area[m.area] ?? 1) * Math.sqrt(factor)) },
    channel: { ...w.channel, [m.channel]: clampW((w.channel[m.channel] ?? 1) * factor) },
    topic: { ...w.topic, [m.topic]: clampW((w.topic[m.topic] ?? 1) * factor) },
  };
  if (w.until) out.until = w.until;
  scale('channel', m.channel, out);
  scale('topic', m.topic, out);
  return out;
}

// ---------- Zähler für "n-mal in k Tagen" ----------

/** Zeitpunkte (ms) je Schlüssel: s:<Unterthema> (Not for me), w:<Kanal> (Weak), k:<Folge> (Skip). Nur am Gerät. */
export type TapLog = Record<string, number[]>;
/** Zeitpunkte, die älter sind, fallen weg */
export const TAP_KEEP_DAYS = 30;

/** Tipp vermerken. n ist die Zahl der Tipps (diesen eingerechnet) innerhalb von `days` Tagen. */
export function tap(log: TapLog | undefined, key: string, now: number, days: number): { log: TapLog; n: number } {
  const keep = now - TAP_KEEP_DAYS * DAY_MS;
  const out: TapLog = {};
  for (const [k, v] of Object.entries(log ?? {})) {
    const kept = v.filter((t) => t > keep);
    if (kept.length) out[k] = kept;
  }
  out[key] = [...(out[key] ?? []), now];
  return { log: out, n: out[key].filter((t) => t > now - days * DAY_MS).length };
}

/** Gewichte und Zähler gehören zusammen, jede Wertung ändert beides */
export interface Learn {
  weights: Weights;
  taps: TapLog;
}

/**
 * Skip unter 3 s: Kanal und Thema mal 0,97. Der zweite Skip derselben Folge in 7 Tagen setzt die Folge auf 0,5 für 7 Tage
 * (Entscheidung 38 f: zwei Skips treffen die Folge, nicht den Kanal).
 */
export function skip(st: Learn, m: M & { area: string }, now: number): Learn {
  const t = tap(st.taps, `k:${m.videoId}`, now, RULE.skipEpisodeDays);
  let w = signal(st.weights, m, RULE.skipFactor, now, { area: false });
  if (t.n >= RULE.skipEpisodeTaps) w = penalize(w, 'episode', m.videoId, RULE.skipEpisode, now + RULE.skipEpisodeDays * DAY_MS, 1);
  return { weights: w, taps: t.log };
}

/** Not for me: Folge 0,3 für 30 Tage, Thema höchstens 0,9, Unterthema nach dem dritten Tipp in 30 Tagen 0,3 für 30 Tage */
export function notForMe(st: Learn, m: M, now: number): Learn {
  let w = penalize(settle(st.weights, now), 'episode', m.videoId, RULE.notForMeEpisode, now + RULE.notForMeDays * DAY_MS, 1);
  w = cap(w, 'topic', m.topic, RULE.notForMeTopic);
  let taps = st.taps;
  for (const tag of m.subtopic ?? []) {
    const t = tap(taps, `s:${tag}`, now, RULE.subtopicDays);
    taps = t.log;
    if (t.n >= RULE.subtopicTaps) w = penalize(w, 'subtopic', tag, RULE.subtopicWeight, now + RULE.subtopicDays * DAY_MS, 1);
  }
  return { weights: w, taps };
}

/** Weak: Kanal mal 0,9 je Tipp, nie unter 0,5. Der dritte Tipp in 30 Tagen setzt den Kanal auf höchstens 0,5. */
export function weak(st: Learn, m: M, now: number): Learn {
  const w0 = settle(st.weights, now);
  const t = tap(st.taps, `w:${m.channel}`, now, RULE.weakDays);
  const cur = w0.channel[m.channel] ?? 1;
  // Ein Gewicht, das schon unter der Untergrenze liegt, bleibt wo es ist
  let next = cur <= RULE.weakFloor ? cur : Math.max(RULE.weakFloor, cur * RULE.weakFactor);
  if (t.n >= RULE.weakTaps) next = Math.min(next, RULE.weakFloor);
  const w: Weights = { ...w0, channel: { ...w0.channel, [m.channel]: clampW(next) } };
  return { weights: w, taps: t.log };
}

/** Was ein Chip lernt */
export type Effect = 'known' | 'wrong' | 'mute' | 'notForMe' | 'weak';

/**
 * Gewichte und Zähler nach dem Effekt. Known, Wrong und Mute ändern die Gewichte nicht: Known und Not for me werfen den Moment aus dem Feed
 * (MomentFeed, momentRejected), Wrong ist nur die Notiz, Mute nimmt den Sprecher in die Liste der Stummen.
 */
export function applyEffect(st: Learn, e: Effect, m: M, now: number): Learn {
  switch (e) {
    case 'notForMe':
      return notForMe(st, m, now);
    case 'weak':
      return weak(st, m, now);
    case 'known':
    case 'wrong':
    case 'mute':
      return st;
  }
}

/** Faktor für Kanal und Thema eines abgelehnten Moments */
export const REJECT = 0.85;
export const reject = (w: Weights, m: Pick<M, 'channel' | 'topic'> & { area: string }, now: number): Weights => signal(w, m, REJECT, now, { area: false });

// ---------- Übergang (Issue 28, Punkt 9) ----------

/** Version der Lernregeln im Stand. Ältere Stände bekommen einmal die Anhebung. */
export const LEARN_VERSION = 2;
/** Auf diesen Wert werden Gewichte unter MIGRATE_BELOW angehoben */
export const MIGRATE_TO = 0.8;
export const MIGRATE_BELOW = 0.5;

/**
 * Einmalig beim Wechsel auf die Regeln von Entscheidung 38: Kanal- und Themagewichte unter 0,5 stammen aus Not for me (Thema 0,2 für 30 Tage) und
 * zwei Skips (Kanal 0,2 für 14 Tage). Sie werden auf 0,8 angehoben, ihre Abläufe entfallen. Gleicher Verweis, wenn nichts anzuheben ist.
 */
export function migrateWeights(w: Weights): Weights {
  const lift = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v < MIGRATE_BELOW ? MIGRATE_TO : v]));
  const low = (r: Record<string, number>) => Object.values(r).some((v) => v < MIGRATE_BELOW);
  const lowUntil = Object.entries(w.until ?? {}).some(([key, e]) => (parseUntilKey(key).fam === 'channel' || parseUntilKey(key).fam === 'topic') && e.back < MIGRATE_BELOW);
  if (!low(w.channel) && !low(w.topic) && !lowUntil) return w;
  const out: Weights = { ...w, channel: lift(w.channel), topic: lift(w.topic) };
  if (w.until) {
    const rest: Record<string, Until> = {};
    for (const [key, e] of Object.entries(w.until)) {
      const { fam, k } = parseUntilKey(key);
      if ((fam === 'channel' || fam === 'topic') && (w[fam][k] ?? 1) < MIGRATE_BELOW) continue;
      rest[key] = fam === 'channel' || fam === 'topic' ? { at: e.at, back: e.back < MIGRATE_BELOW ? MIGRATE_TO : e.back } : e;
    }
    if (Object.keys(rest).length) out.until = rest;
    else delete out.until;
  }
  return out;
}

/**
 * Bestätigungszeile am Blatt nach einem Chip: sagt genau, was sich geändert hat. Ohne Effekt (Bad cut): "Noted".
 * `muted` ist bei Mute die Zahl der Momente des Sprechers, die nun wegfallen.
 */
export function confirmLine(e: Effect | null, m: Pick<M, 'channel'>, muted?: number): string {
  switch (e) {
    case 'known':
      return 'Marked known';
    case 'notForMe':
      return 'Less from this episode for 30 days';
    case 'weak':
      return `Less ${speakerLine(m.channel)}`;
    case 'mute':
      return muted === undefined ? `${speakerLine(m.channel)} muted` : `${speakerLine(m.channel)} muted, ${muted} ${muted === 1 ? 'moment' : 'moments'}`;
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
    Object.entries(w[fam] ?? {}).map(([key, weight]) => {
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
