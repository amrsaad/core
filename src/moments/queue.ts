// Warteschlange über Neustarts und bei Netzwechsel. Reine Funktionen, die Ablage (localStorage) macht der Feed.
// Seit Issue 24 ohne Blöcke: der Cursor zählt Momente, der Verlauf der letzten 10 steht in der Warteschlange selbst.
// Die Warteschlange ist 30 Momente tief, damit der Vorrat etwas hat, das er vorladen kann. Damit sie einen Neustart
// überlebt (der Vorrat der letzten Sitzung bleibt nützlich, auch offline), wird sie pro Form und Tag abgelegt.
import { episodeOf, HISTORY, isNewEpisode, newMomentCursor, nextMoment, TOP_RATE, type MomentCursor, type MomentPrefs } from './mix';
import type { Form } from './form';
import type { Moment } from './types';

export interface SavedQueue {
  /** Lokaler Tag. Ein neuer Tag beginnt mit frischer Mischung (Beat zuerst) */
  day: string;
  ids: string[];
}

export const queueKey = (form: Form) => `core.queue.v1.${form}`;

export function parseSaved(raw: string | null | undefined): SavedQueue | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SavedQueue>;
    if (typeof v.day === 'string' && Array.isArray(v.ids) && v.ids.every((x) => typeof x === 'string')) return { day: v.day, ids: v.ids };
  } catch {
    /* kaputt: wie nicht vorhanden */
  }
  return null;
}

/** Gespeicherte Warteschlange von heute, ohne Gesehenes, Stummes und was nicht mehr im Pool ist */
export function restoreQueue(saved: SavedQueue | null, day: string, pool: Moment[], p: { seen: Record<string, number>; mutedChannels: Record<string, string> }, max: number): Moment[] {
  if (!saved || saved.day !== day) return [];
  const byId = new Map(pool.map((m) => [m.id, m]));
  const out: Moment[] = [];
  const used = new Set<string>();
  for (const id of saved.ids) {
    const m = byId.get(id);
    if (!m || used.has(id) || p.seen[id] || p.mutedChannels[m.channel]) continue;
    used.add(id);
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

/** Cursor, der zur übernommenen Warteschlange passt: schon verplante Momente, Momente je Bereich, Abstand zum letzten Top-Moment, neue Folgen */
export function cursorFor(moments: Moment[], firstOfDay: boolean, now: number = Date.now()): MomentCursor {
  const c = newMomentCursor(firstOfDay);
  for (const m of moments) {
    c.used.add(m.id);
    c.counts[m.area]++;
    if (isNewEpisode(m, now)) c.newCount[episodeOf(m)] = (c.newCount[episodeOf(m)] ?? 0) + 1;
  }
  let since = 0;
  let found = false;
  for (let i = moments.length - 1; i >= 0; i--) {
    if (moments[i].top) {
      found = true;
      break;
    }
    since++;
  }
  c.sinceTop = found ? since : Math.max(c.sinceTop, since);
  return c;
}

/**
 * Der Rest der Warteschlange wird neu geplant: seine Momente zählen im Cursor wieder als frei, danach füllt
 * nextMoment mit den dann gültigen Regeln neu auf. Die Skips der Sitzung (dampen) bleiben.
 */
export function releaseTail(c: MomentCursor, tail: Moment[], now: number = Date.now()): void {
  for (const m of tail) {
    c.used.delete(m.id);
    c.counts[m.area] = Math.max(0, c.counts[m.area] - 1);
    if (isNewEpisode(m, now)) c.newCount[episodeOf(m)] = Math.max(0, (c.newCount[episodeOf(m)] ?? 0) - 1);
  }
  c.sinceTop = Math.min(c.sinceTop, TOP_RATE ** -1);
}

/** Verlauf für die nächste Wahl: die letzten 10 Momente vor der Stelle `from` der Warteschlange, davor der Verlauf aus der letzten Sitzung */
export function historyBefore(queue: readonly Moment[], from: number, seed: readonly Moment[] = []): Moment[] {
  return [...seed, ...queue.slice(0, Math.max(0, from))].slice(-HISTORY);
}

/** Verlauf aus dem Protokoll der letzten Sitzungen: die zuletzt gespielten Momente, die im Pool stehen (ältester zuerst). Beim Start einer Sitzung der Anfang des Verlaufs. */
export function recentFromLog(log: readonly { id: string }[], pool: readonly Moment[], n: number = HISTORY): Moment[] {
  const byId = new Map(pool.map((m) => [m.id, m]));
  const out: Moment[] = [];
  const used = new Set<string>();
  for (let i = log.length - 1; i >= 0 && out.length < n; i--) {
    const m = byId.get(log[i].id);
    if (m && !used.has(m.id)) {
      used.add(m.id);
      out.unshift(m);
    }
  }
  return out;
}

/**
 * Netz wurde schlecht oder gut: der Rest der Warteschlange wird neu gemischt, nur aus seinen eigenen Momenten (es kommt keiner dazu und
 * keiner weg, darum fällt kein Vorrat ins Leere). Der Rang ist ein Gewicht, die harten Regeln der Mischung gelten weiter.
 * Was die Regeln nicht mehr unterbringen, hängt hinten an, in der alten Reihenfolge.
 */
export function remixTail(tail: Moment[], history: readonly Moment[], p: MomentPrefs, rng: () => number = Math.random): Moment[] {
  const c = newMomentCursor(false);
  const out: Moment[] = [];
  while (out.length < tail.length) {
    const m = nextMoment(tail, { ...p, seen: {}, mutedChannels: {} }, c, [...history, ...out], rng);
    if (!m) break;
    out.push(m);
  }
  for (const m of tail) if (!c.used.has(m.id)) out.push(m);
  return out;
}

/**
 * Gescheiterte Momente aus dem Rest hinter idx nehmen (Entscheidung 45). Fehlt dabei einer an idx+1 oder idx+2, wird die Lücke mit dem
 * nächsten Moment aus dem Rest gefüllt, dessen Bereich sich vom Vorgänger und vom Nachfolger unterscheidet. Das ist die Ausnahme zu
 * Entscheidung 42 (die Nachbarn bleiben stehen): ein Nachbar darf wechseln, wenn er sonst den Bereich wiederholen würde.
 * Gibt es keinen Moment mit beiden Unterschieden, genügt der Unterschied zum Vorgänger. Gibt es auch den nicht, bleibt die Reihenfolge.
 */
export function pruneAndHeal(queue: readonly Moment[], idx: number, isBad: (m: Moment) => boolean): Moment[] {
  const from = idx + 1;
  const head = queue.slice(0, from);
  const rest = queue.slice(from);
  const out = rest.filter((m) => !isBad(m));
  if (!rest.slice(0, 2).some(isBad)) return [...head, ...out];
  for (let p = 0; p < 3 && p < out.length; p++) {
    const prev = p === 0 ? queue[idx] : out[p - 1];
    if (!prev || out[p].area !== prev.area) continue;
    const successor = out[p];
    let j = -1;
    for (let k = p + 1; k < out.length && j < 0; k++) if (out[k].area !== prev.area && out[k].area !== successor.area) j = k;
    for (let k = p + 1; k < out.length && j < 0; k++) if (out[k].area !== prev.area) j = k;
    if (j < 0) continue;
    const [m] = out.splice(j, 1);
    out.splice(p, 0, m);
  }
  return [...head, ...out];
}

/** So viele nächste Momente halten verdeckt den Element-Vorrat des Audio-Decks (Entscheidung 52, Brief 14) */
export const POOL_AHEAD = 5;

/**
 * Neuplanen ab `from` (Entscheidung 42). Verdeckt liegen die nächsten fünf Momente im Element-Vorrat, sie bleiben stehen: Neuplanen beginnt frühestens
 * bei idx+6. Sichtbar gilt `from` unverändert.
 */
export const replanStart = (from: number, idx: number, hidden: boolean): number => (hidden ? Math.max(from, idx + 1 + POOL_AHEAD) : from);

/**
 * Verdeckt gescheiterte Momente nur herausnehmen, nie umstellen: pruneAndHeal schiebt Nachbarn nach vorn, und das verschöbe Momente, die schon in einem
 * Element des Vorrats geladen sind (Brief 14, Schritt 3).
 */
export function pruneOnly(queue: readonly Moment[], idx: number, isBad: (m: Moment) => boolean): Moment[] {
  return [...queue.slice(0, idx + 1), ...queue.slice(idx + 1).filter((m) => !isBad(m))];
}
