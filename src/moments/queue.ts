// Warteschlange über Neustarts und bei Netzwechsel. Reine Funktionen, die Ablage (localStorage) macht der Feed.
// Die Warteschlange ist 30 Momente tief, damit der Vorrat etwas hat, das er vorladen kann. Damit sie einen Neustart
// überlebt (der Vorrat der letzten Sitzung bleibt nützlich, auch offline), wird sie pro Form und Tag abgelegt.
import type { Area } from '../types';
import { AREAS, BLOCK, newMomentCursor, TOP_RATE, type MomentCursor } from './mix';
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

/** Cursor, der zur übernommenen Warteschlange passt: schon verplante Momente, Blockzahl je Bereich, Abstand zum letzten Top-Moment */
export function cursorFor(moments: Moment[], firstOfDay: boolean): MomentCursor {
  const c = newMomentCursor(firstOfDay);
  for (const m of moments) c.used.add(m.id);
  for (const a of AREAS) c.counts[a] = Math.round(moments.filter((m) => m.area === a).length / BLOCK);
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
 * Der Rest der Warteschlange wird neu geplant: seine Momente und Blöcke zählen im Cursor wieder als frei, danach füllt
 * nextMomentBlock mit den dann gültigen Regeln neu auf.
 */
export function releaseTail(c: MomentCursor, tail: Moment[]): void {
  for (const m of tail) c.used.delete(m.id);
  for (const a of AREAS) c.counts[a] = Math.max(0, c.counts[a] - Math.round(tail.filter((m) => m.area === a).length / BLOCK));
  c.sinceTop = Math.min(c.sinceTop, TOP_RATE ** -1);
}

/**
 * Netz wurde schlecht: Vorgeladenes und Text rücken im Rest der Warteschlange nach vorn, YouTube nach hinten.
 * Die Folge der Bereiche bleibt exakt wie sie ist (also Blöcke à 3, Bereichsanteile, Beat zuerst), getauscht wird nur
 * innerhalb eines Bereichs, stabil nach Rang. Es kommt kein Moment dazu und keiner weg, darum fällt kein Vorrat ins Leere.
 */
export function reorderByRank(tail: Moment[], rank: (m: Moment) => number): Moment[] {
  const lists = new Map<Area, Moment[]>();
  for (const m of tail) (lists.get(m.area) ?? lists.set(m.area, []).get(m.area)!).push(m);
  for (const l of lists.values()) l.sort((a, b) => rank(a) - rank(b));
  const at = new Map<Area, number>();
  return tail.map((m) => {
    const i = at.get(m.area) ?? 0;
    at.set(m.area, i + 1);
    return lists.get(m.area)![i];
  });
}
