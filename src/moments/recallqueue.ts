/**
 * Warteschlange der Abrufkarten (Pfeiler 19, Max 30.10.2026). Eine fällige Karte wird nie gezeigt, solange der Feed nicht im Vordergrund
 * und sichtbar ist (Hintergrund, Settings, Saved, Feedback-Blatt, Übersicht). Sie kommt stattdessen in recallQueue (State, per Sync).
 * Zurück im Feed erscheint eine Karte sofort, vor dem nächsten Wisch, danach je eine pro Wisch, bis die Warteschlange leer ist.
 * Höchstens 3 Einträge: beim vierten wird der älteste um einen Tag verschoben (dueAt plus 1 Tag), nie verworfen.
 * Reine Funktionen, ohne React.
 */
import { DAY_MS, type RecallState } from './recall';

export const QUEUE_MAX = 3;

export interface QueueEntry {
  id: string;
  /** Wiedervorlage (true) oder erste Abfrage (false) */
  review: boolean;
  /** Zeitpunkt, an dem die Karte fällig wurde (ms) */
  dueAt: number;
}

export interface Ctx {
  /** Feed-Reiter ist offen (nicht Settings oder Saved) */
  active: boolean;
  /** Seite sichtbar (nicht im Hintergrund) */
  visible: boolean;
  /** Feedback-Blatt offen */
  note: boolean;
  /** Seitenblatt (Desktop) oder Tastenübersicht offen */
  sheet: boolean;
}

/** Karten nur im Vordergrund und bei sichtbarem Feed */
export const canShowRecall = (c: Ctx): boolean => c.active && c.visible && !c.note && !c.sheet;

/** Ein Eintrag verschoben: Fälligkeit dueAt plus 1 Tag. Der Moment bleibt in der Wiedervorlage, nichts geht verloren. */
export function postpone(recall: RecallState, e: QueueEntry): RecallState {
  const prev = recall[e.id];
  return { ...recall, [e.id]: { id: e.id, due: e.dueAt + DAY_MS, results: prev?.results ?? [] } };
}

/** Eintrag hinten anhängen. Ist die Warteschlange voll, wird der älteste verschoben und geht aus der Warteschlange. */
export function enqueue(queue: QueueEntry[], recall: RecallState, e: QueueEntry): { queue: QueueEntry[]; recall: RecallState } {
  if (queue.some((x) => x.id === e.id)) return { queue, recall };
  let q = [...queue, e];
  let r = recall;
  while (q.length > QUEUE_MAX) {
    r = postpone(r, q[0]);
    q = q.slice(1);
  }
  return { queue: q, recall: r };
}

export interface Step {
  /** Karte, die jetzt gezeigt wird (aus der Warteschlange oder die neue) */
  show: QueueEntry | null;
  /** true: die gezeigte Karte kam aus der Warteschlange */
  fromQueue: boolean;
  queue: QueueEntry[];
  recall: RecallState;
}

/**
 * Ein Wisch nach vorn. pick ist die Karte, die nach der Regel fällig wäre (oder null).
 * Nicht im Vordergrund: die neue Karte geht in die Warteschlange. Im Vordergrund: höchstens eine Karte pro Wisch,
 * die älteste aus der Warteschlange, eine neue Karte reiht sich hinten ein.
 */
export function onSwipe(queue: QueueEntry[], recall: RecallState, pick: { id: string; review: boolean } | null, canShow: boolean, now: number): Step {
  const entry: QueueEntry | null = pick ? { id: pick.id, review: pick.review, dueAt: now } : null;
  if (!canShow) {
    if (!entry) return { show: null, fromQueue: false, queue, recall };
    const r = enqueue(queue, recall, entry);
    return { show: null, fromQueue: false, ...r };
  }
  if (queue.length) {
    const rest = queue.slice(1);
    const r = entry ? enqueue(rest, recall, entry) : { queue: rest, recall };
    return { show: queue[0], fromQueue: true, ...r };
  }
  return { show: entry, fromQueue: false, queue, recall };
}

/** Rückkehr in den Feed (Vordergrund, Settings zu, Blatt zu): eine Karte sofort, vor dem nächsten Wisch */
export function onReturn(queue: QueueEntry[], canShow: boolean): { show: QueueEntry | null; queue: QueueEntry[] } {
  if (!canShow || !queue.length) return { show: null, queue };
  return { show: queue[0], queue: queue.slice(1) };
}

/**
 * Die Seite geht in den Hintergrund, während eine unbeantwortete Karte offen ist (Issue 11, Max 30.10.2026): die Karte hält den Ton an,
 * und im gesperrten Telefon wäre niemand da, sie zu beantworten. Sie geht zurück in die Warteschlange, der Ton läuft weiter, bei der Rückkehr
 * erscheint sie vor dem nächsten Wisch. Bei mehr als QUEUE_MAX Einträgen wird der älteste (kleinstes dueAt) um einen Tag verschoben, nie verworfen.
 */
export function requeueOpen(queue: QueueEntry[], recall: RecallState, e: QueueEntry): { queue: QueueEntry[]; recall: RecallState } {
  let q = [...queue.filter((x) => x.id !== e.id), e].sort((a, b) => a.dueAt - b.dueAt);
  let r = recall;
  while (q.length > QUEUE_MAX) {
    r = postpone(r, q[0]);
    q = q.slice(1);
  }
  return { queue: q, recall: r };
}
