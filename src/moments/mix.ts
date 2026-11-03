// Mix der Momente (Entscheidung 33, Issue 24): jeder Moment wird einzeln gewählt, gegen den Verlauf der letzten 10.
// Harte Regeln: nie dieselbe Folge innerhalb 10, derselbe Kanal höchstens 1 von 4, dasselbe Thema höchstens 2 von 5,
// nie zweimal derselbe Bereich hintereinander (solange ein anderer Bereich Kandidaten hat und der Bereich nicht über die Hälfte
// der Anteile hat), eine neue Folge (jünger als 48 h) höchstens 2 Momente pro Sitzung.
// Fallback, wenn die Regeln den Pool leeren: zuerst das Thema lockern, dann den Kanal, zuletzt die Grenze für neue Folgen.
// Die Folge innerhalb 10 wird nie gelockert (dann null).
// Gewichte (Lernen, Netz, Sitzung, Kontext) sind weich: sie verschieben die Wahrscheinlichkeit, nie eine harte Regel.
// Bereichswahl nach Anteilsdefizit pro Moment, Beat zuerst am Tag, 20 % Unbekanntes, Top-Momente höchstens 1 von 15.
import type { Area } from '../types';
import type { Moment } from './types';
import { clampW, SKIP_SEC, settle, W_MAX, W_MIN, type Until } from './learn';

export { clampW, W_MAX, W_MIN };

export const AREAS: Area[] = ['brain', 'body', 'beat'];
export const MIN_SHARE = 0.1;
export const EXPLORE = 0.2;
export const TOP_RATE = 1 / 15;

/** Verlauf, gegen den jeder Moment geprüft wird */
export const HISTORY = 10;
/** Derselbe Kanal höchstens 1 von 4: unter den 3 Momenten davor darf er nicht vorkommen */
export const CHANNEL_WINDOW = 4;
/** Dasselbe Thema höchstens 2 von 5 */
export const TOPIC_WINDOW = 5;
export const TOPIC_MAX = 2;
/** Neue Folge: jünger als so viele Stunden, dann höchstens NEW_PER_SESSION Momente pro Sitzung */
export const NEW_HOURS = 48;
export const NEW_PER_SESSION = 2;
/** Im schlechten Netz zählt ein vorgeladener Moment (netRank 0) so viel mehr. Kein Filter. */
export const NET_WEIGHT = 3;
/** Zwei Skips unter 3 s beim selben Thema oder Kanal: Gewicht für den Rest der Sitzung */
export const SESSION_DAMPEN = 0.1;
export const SESSION_SKIPS = 2;

export interface Weights {
  area: Record<string, number>;
  channel: Record<string, number>;
  topic: Record<string, number>;
  /** Gewicht je Folge (videoId), Entscheidung 38. Fehlt das Feld, gilt überall 1. */
  episode?: Record<string, number>;
  /** Gewicht je Unterthema, Entscheidung 38. Fehlt das Feld, gilt überall 1. */
  subtopic?: Record<string, number>;
  /** Abläufe (learn.ts): bis zum Zeitstempel gilt das Gewicht oben, danach `back`. Schlüssel c:<Kanal>, t:<Thema>, e:<Folge>, s:<Unterthema>. Fehlt das Feld, läuft nichts ab. */
  until?: Record<string, Until>;
}

export interface MomentPrefs {
  /** Bereichsanteile aus den Einstellungen */
  areaShares: Record<Area, number>;
  weights: Weights;
  seen: Record<string, number>;
  mutedChannels: Record<string, string>;
  /** Jetzt in ms, für die Abläufe der Gewichte und "neue Folge". Fehlt es, gilt die Systemzeit. */
  now?: number;
  /**
   * Optional, nur im schlechten Netz: kleinerer Rang ist besser (0 vorgeladen oder Text, 1 sonstiger Stream, 2 YouTube).
   * Er ist ein Gewicht (NET_WEIGHT für Rang 0), kein Filter. Die harten Regeln gelten unverändert.
   */
  rank?: (m: Moment) => number;
  /** Weiches Zusatzgewicht (Issue 26: Tageszeit, Sitzungsaufmerksamkeit, Netzart), multipliziert mit den übrigen Gewichten. Fehlt es, gilt 1. */
  ctx?: (m: Moment) => number;
}

export interface MomentCursor {
  /** Gewählte Momente je Bereich */
  counts: Record<Area, number>;
  firstOfDay: boolean;
  used: Set<string>;
  /** Picks seit dem letzten Top-Moment */
  sinceTop: number;
  /** Momente je neuer Folge in dieser Sitzung */
  newCount: Record<string, number>;
  /** Skips unter 3 s in dieser Sitzung je Kanal (c:) und Thema (t:) */
  skips: Record<string, number>;
  /** Kanäle und Themen mit zwei Skips: Gewicht SESSION_DAMPEN bis zum Ende der Sitzung */
  dampen: Set<string>;
  /** Wie oft eine Regel gelockert werden musste, weil der Pool sonst leer war (Diagnose und Tests) */
  relaxed: { topic: number; channel: number; newcap: number };
}

export const newMomentCursor = (firstOfDay: boolean): MomentCursor => ({
  counts: { brain: 0, body: 0, beat: 0 },
  firstOfDay,
  used: new Set(),
  sinceTop: TOP_RATE ** -1,
  newCount: {},
  skips: {},
  dampen: new Set(),
  relaxed: { topic: 0, channel: 0, newcap: 0 },
});

/**
 * Faktoren der Signale, die Gewichte wachsen oder schrumpfen lassen. Skip, Not for me, Wrong, Known und Weak sind eigene Regeln (learn.ts).
 * Save und Abruf-Treffer wiegen mehr als Ansehdauer (ended, mostly), Core optimiert nicht auf Verweildauer.
 * back: Zurückspringen oder Wiederholen, starkes Plus.
 */
export const SIGNAL = { ended: 1.1, early: 0.95, mostly: 1.05, back: 1.25, more: 1.3, save: 1.2, recall: 1.2 } as const;

export type Leave = { kind: 'skip' } | { kind: 'factor'; f: number } | null;

/** Wertung beim Weiterwischen nach geschautem Anteil. Skip: unter 3 s. null = neutral. */
export function leaveOf(watchedSec: number, durationSec: number): Leave {
  if (watchedSec < SKIP_SEC) return { kind: 'skip' };
  const f = watchedSec / Math.max(1, durationSec);
  if (f < 0.3) return { kind: 'factor', f: SIGNAL.early };
  if (f >= 0.8) return { kind: 'factor', f: SIGNAL.mostly };
  return null;
}

/** Wirksame Bereichsanteile: Einstellungen mal gelerntes Gewicht, jeder Bereich mindestens 10 % */
export function effectiveShares(p: Pick<MomentPrefs, 'areaShares' | 'weights'>, areas: Area[] = AREAS): Record<Area, number> {
  const raw = Object.fromEntries(areas.map((a) => [a, Math.max(0, p.areaShares[a] ?? 0) * (p.weights.area[a] ?? 1)])) as Record<Area, number>;
  let sum = areas.reduce((s, a) => s + raw[a], 0) || 1;
  const out = Object.fromEntries(areas.map((a) => [a, raw[a] / sum])) as Record<Area, number>;
  // Untergrenze 10 %: anheben und den Rest proportional kürzen
  for (let k = 0; k < 3; k++) {
    const low = areas.filter((a) => out[a] < MIN_SHARE);
    if (!low.length) break;
    const free = 1 - low.length * MIN_SHARE;
    const highSum = areas.filter((a) => !low.includes(a)).reduce((s, a) => s + out[a], 0) || 1;
    for (const a of areas) out[a] = low.includes(a) ? MIN_SHARE : (out[a] / highSum) * free;
    sum = areas.reduce((s, a) => s + out[a], 0);
  }
  return out;
}

/** Die Folge eines Moments: videoId (YouTube-ID, pod-… oder txt-…) */
export const episodeOf = (m: Pick<Moment, 'videoId'>): string => m.videoId;

/** Neue Folge: jünger als NEW_HOURS (publishedAt, sonst createdAt). Ohne gültiges Datum nie neu. */
export function isNewEpisode(m: Pick<Moment, 'publishedAt' | 'createdAt'>, now: number): boolean {
  const t = Date.parse(m.publishedAt ?? m.createdAt ?? '');
  return Number.isFinite(t) && now >= t && now - t < NEW_HOURS * 3_600_000;
}

const known = (w: Weights, m: Moment) => m.channel in w.channel || m.topic in w.topic || !!(w.episode && episodeOf(m) in w.episode) || !!m.subtopic?.some((t) => w.subtopic && t in w.subtopic);

/** Gewicht eines Unterthemen-Tags: der kleinste unter den Tags des Moments */
const subtopicWeight = (w: Weights, m: Moment): number => {
  const tags = m.subtopic;
  if (!tags?.length || !w.subtopic) return 1;
  return Math.min(...tags.map((t) => w.subtopic![t] ?? 1));
};

/** Gelerntes Gewicht eines Moments: Kanal mal Thema mal Folge mal Unterthema */
export const learnedWeight = (w: Weights, m: Moment): number => (w.channel[m.channel] ?? 1) * (w.topic[m.topic] ?? 1) * (w.episode?.[episodeOf(m)] ?? 1) * subtopicWeight(w, m);

/** Wahrscheinlichkeitsgewicht beim Ziehen: gelernt, Netz, Sitzung, Kontext. Immer größer 0. */
function weightOf(p: MomentPrefs, c: MomentCursor, m: Moment): number {
  let x = learnedWeight(p.weights, m);
  if (p.rank && p.rank(m) === 0) x *= NET_WEIGHT;
  if (c.dampen.has(`c:${m.channel}`) || c.dampen.has(`t:${m.topic}`)) x *= SESSION_DAMPEN;
  if (p.ctx) x *= p.ctx(m);
  return Math.max(1e-6, x);
}

/** Skip unter 3 s in der Sitzung. Beim zweiten Skip desselben Kanals oder Themas wird es für den Rest der Sitzung gedämpft. true, wenn neu gedämpft. */
export function sessionSkip(c: MomentCursor, m: Pick<Moment, 'channel' | 'topic'>): boolean {
  let fresh = false;
  for (const k of [`c:${m.channel}`, `t:${m.topic}`]) {
    c.skips[k] = (c.skips[k] ?? 0) + 1;
    if (c.skips[k] >= SESSION_SKIPS && !c.dampen.has(k)) {
      c.dampen.add(k);
      fresh = true;
    }
  }
  return fresh;
}

/** Stufe 0 alle Regeln, 1 ohne Thema, 2 ohne Thema und Kanal, 3 zusätzlich ohne Grenze für neue Folgen. Die Folge innerhalb 10 gilt auf jeder Stufe. */
function allowed(m: Moment, h: readonly Moment[], c: MomentCursor, now: number, level: number): boolean {
  const ep = episodeOf(m);
  if (h.some((x) => episodeOf(x) === ep)) return false;
  if (level < 2 && h.slice(-(CHANNEL_WINDOW - 1)).some((x) => x.channel === m.channel)) return false;
  if (level < 1 && h.slice(-(TOPIC_WINDOW - 1)).filter((x) => x.topic === m.topic).length >= TOPIC_MAX) return false;
  if (level < 3 && isNewEpisode(m, now) && (c.newCount[ep] ?? 0) >= NEW_PER_SESSION) return false;
  return true;
}

function pickArea(cands: Moment[], p: MomentPrefs, c: MomentCursor, last: Moment | undefined): Area {
  const areas = AREAS.filter((a) => cands.some((m) => m.area === a));
  const total = AREAS.reduce((s, a) => s + c.counts[a], 0);
  if (c.firstOfDay && total === 0 && areas.includes('beat')) return 'beat';
  const shares = effectiveShares(p, areas);
  let from = areas;
  // Nie zweimal derselbe Bereich hintereinander, solange ein anderer Kandidaten hat. Hat ein Bereich mehr als die Hälfte der Anteile, geht das
  // rechnerisch nicht, dann entscheidet allein das Anteilsdefizit.
  if (last && areas.length > 1 && (shares[last.area] ?? 0) <= 0.5 + 1e-9) {
    const rest = areas.filter((a) => a !== last.area);
    if (rest.length) from = rest;
  }
  return from.reduce((best, a) => (shares[a] * (total + 1) - c.counts[a] > shares[best] * (total + 1) - c.counts[best] ? a : best), from[0]);
}

/**
 * Nächster Moment. `history` sind die zuletzt gewählten Momente (ältester zuerst), höchstens die letzten 10 zählen.
 * Verändert den Cursor. null, wenn nichts mehr verfügbar ist oder nur noch Momente einer Folge aus dem Verlauf.
 */
export function nextMoment(pool: Moment[], p0: MomentPrefs, c: MomentCursor, history: readonly Moment[], rng: () => number = Math.random): Moment | null {
  const now = p0.now ?? Date.now();
  // Abgelaufene Fristen der Gewichte einrechnen, dann arbeiten alle Regeln unten mit dem wirksamen Gewicht
  const p: MomentPrefs = { ...p0, weights: settle(p0.weights, now) };
  const free = pool.filter((m) => !p.seen[m.id] && !c.used.has(m.id) && !p.mutedChannels[m.channel]);
  if (!free.length) return null;
  const h = history.slice(-HISTORY);
  let cands: Moment[] = [];
  let used = 0;
  for (let level = 0; level <= 3; level++) {
    cands = free.filter((m) => allowed(m, h, c, now, level));
    used = level;
    if (cands.length) break;
  }
  if (!cands.length) return null;
  const area = pickArea(cands, p, c, h[h.length - 1]);
  const inArea = cands.filter((m) => m.area === area);
  const tops = inArea.filter((m) => m.top);
  const normal = inArea.filter((m) => !m.top);
  let pick: Moment | undefined;
  // Top-Momente selten und unvorhersehbar: höchstens 1 von 15
  if (tops.length && c.sinceTop >= 1 / TOP_RATE && rng() < TOP_RATE * 2) pick = tops[Math.floor(rng() * tops.length)];
  if (!pick) {
    const pool2 = normal.length ? normal : inArea;
    const fresh = pool2.filter((m) => !known(p.weights, m));
    const old = pool2.filter((m) => known(p.weights, m));
    // Unbekanntes bekommt mindestens 20 %. Sonst entscheidet allein das Gewicht, Bekanntes wird nie ausgesperrt und nie bevorzugt, nur weil es bekannt ist:
    // ein Gewicht unter 1 macht seltener, nicht unsichtbar (Issue 28).
    const wf = fresh.map((m) => ({ m, w: weightOf(p, c, m) }));
    const wo = old.map((m) => ({ m, w: weightOf(p, c, m) }));
    const sum = (a: { w: number }[]) => a.reduce((s, x) => s + x.w, 0);
    const pFresh = wf.length && wo.length ? Math.max(EXPLORE, sum(wf) / (sum(wf) + sum(wo))) : wf.length ? 1 : 0;
    const weighted = rng() < pFresh ? wf : wo;
    let r = rng() * weighted.reduce((s, x) => s + x.w, 0);
    pick = weighted.find((x) => (r -= x.w) <= 0)?.m ?? weighted[weighted.length - 1]?.m;
  }
  if (!pick) return null;
  if (used >= 1) c.relaxed.topic++;
  if (used >= 2) c.relaxed.channel++;
  if (used >= 3) c.relaxed.newcap++;
  c.sinceTop = pick.top ? 0 : c.sinceTop + 1;
  c.counts[pick.area]++;
  c.used.add(pick.id);
  if (isNewEpisode(pick, now)) c.newCount[episodeOf(pick)] = (c.newCount[episodeOf(pick)] ?? 0) + 1;
  return pick;
}

/**
 * Die nächsten n Momente hinter Stelle idx der Warteschlange, in der Reihenfolge der Mischung. Verbraucht nichts.
 * skip: Momente, die übergangen werden (z.B. gescheiterte). Schnittstelle für den Vorrat (Brief 02).
 */
export function upcoming(queue: readonly Moment[], idx: number, n: number, skip?: (m: Moment) => boolean): Moment[] {
  const out: Moment[] = [];
  for (let j = Math.max(0, idx + 1); j < queue.length && out.length < n; j++) if (!skip?.(queue[j])) out.push(queue[j]);
  return out;
}
