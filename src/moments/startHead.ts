// Start aus dem Vorrat (Brief 02, Issue 11 Kommentar 01.11. und Issue 14): Die nächsten drei Audio-Momente der Mischung überleben das Sitzungsende,
// der erste Moment einer neuen Sitzung kommt aus dem Offline-Vorrat. Reine Funktionen, die Ablage macht der Preloader und der Feed.
import type { Form } from './form';
import type { Moment } from './types';
import { lsKey } from '../lib/ns';

/**
 * So viele Momente bleiben über das Sitzungsende im Vorrat gehalten (nicht verdrängbar). Sechs statt drei (Brief 09, Ergänzung 03.11.):
 * eine Sitzung von zehn Minuten am Sperrbildschirm ohne Netz läuft damit durch.
 */
export const HEADS = 6;
/** Das Deck darf innerhalb dieser Zahl nächster Momente der Mischung einen lokalen vorziehen */
export const PULL_WITHIN = 3;
/** Wie lange das Deck beim Kaltstart auf die Blob-URL aus dem Vorrat wartet, bevor es vom Netz startet (ms) */
export const HOLD_MS = 1200;

export const headsKey = (form: Form) => lsKey(`heads.v1.${form}`);

export interface Head {
  id: string;
  /** localKey(videoId, start, end), gleicher Schlüssel wie im Player */
  key: string;
}

export function parseHeads(raw: string | null | undefined): Head[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is Head => !!x && typeof (x as Head).id === 'string' && typeof (x as Head).key === 'string').slice(0, HEADS);
  } catch {
    return [];
  }
}

/** Die Köpfe der Warteschlange: die nächsten HEADS vorladbaren Momente nach der Stelle idx (der laufende zählt als gesehen) */
export function pickHeads(queue: readonly Moment[], idx: number, isPreloadable: (m: Moment) => boolean, keyOf: (m: Moment) => string): Head[] {
  const out: Head[] = [];
  for (let i = Math.max(0, idx + 1); i < queue.length && out.length < HEADS; i++) if (isPreloadable(queue[i])) out.push({ id: queue[i].id, key: keyOf(queue[i]) });
  return out;
}

/**
 * Reihenfolge für den Start. Ist der erste Moment lokal, bleibt alles. Sonst wird innerhalb der nächsten PULL_WITHIN der Mischung der erste
 * lokale nach vorn gezogen. Gibt es dort keinen, kommt ein gehaltener Kopf der letzten Sitzung (heads) an die erste Stelle, wenn er noch
 * in den Pool gehört (nicht gesehen, Kanal nicht stumm: der Aufrufer reicht nur zulässige Momente in headMoments).
 * Fehlt auch der, kommt irgendein zulässiger Moment aus dem Vorrat (reserve, Entscheidung 45): "none" heißt dann, dass der Vorrat wirklich leer ist.
 */
export function startOrder(queue: readonly Moment[], held: (m: Moment) => boolean, headMoments: readonly Moment[], reserve: readonly Moment[] = []): { queue: Moment[]; how: 'first' | 'pulled' | 'head' | 'reserve' | 'none' } {
  if (!queue.length) return { queue: [], how: 'none' };
  if (held(queue[0])) return { queue: [...queue], how: 'first' };
  const j = queue.slice(0, PULL_WITHIN).findIndex(held);
  if (j > 0) {
    const q = [...queue];
    const [m] = q.splice(j, 1);
    q.unshift(m);
    return { queue: q, how: 'pulled' };
  }
  const h = headMoments.find((m) => held(m) && !queue.slice(0, PULL_WITHIN).some((x) => x.id === m.id));
  if (h) return { queue: [h, ...queue.filter((x) => x.id !== h.id)], how: 'head' };
  const r = reserve.find((m) => held(m));
  if (r) return { queue: [r, ...queue.filter((x) => x.id !== r.id)], how: 'reserve' };
  return { queue: [...queue], how: 'none' };
}

// ---- Zähler coldNetStarts (pro Tag) ----

export const COLD_KEY = lsKey('coldnet.v1');
const COLD_DAYS = 14;

export type ColdLog = Record<string, number>;

export function parseCold(raw: string | null | undefined): ColdLog {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return {};
    const out: ColdLog = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    return out;
  } catch {
    return {};
  }
}

/** Zähler für day um eins erhöhen, nur die letzten COLD_DAYS Tage bleiben */
export function bumpCold(log: ColdLog, day: string): ColdLog {
  const next = { ...log, [day]: (log[day] ?? 0) + 1 };
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-COLD_DAYS));
}

export interface ColdStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function countColdStart(store: ColdStore | null, day: string): number {
  if (!store) return 0;
  try {
    const next = bumpCold(parseCold(store.getItem(COLD_KEY)), day);
    store.setItem(COLD_KEY, JSON.stringify(next));
    return next[day];
  } catch {
    return 0;
  }
}

export function coldToday(store: ColdStore | null, day: string): number {
  if (!store) return 0;
  try {
    return parseCold(store.getItem(COLD_KEY))[day] ?? 0;
  } catch {
    return 0;
  }
}
