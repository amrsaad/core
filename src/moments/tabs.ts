/**
 * Reiterwechsel setzt nichts zurück (Entscheidung 36, Issue 27). Reine Funktionen auf dem Zustand.
 *
 * - Jeder Reiter merkt sich seine Position (`tabCursor[form]`, die ID des Moments, bei dem der Reiter verlassen wurde, mit Tag).
 *   Zurück im Reiter beginnt die Warteschlange dort, nicht beim Anfang der alten Ablage.
 * - Ein Moment, der zweimal weggewischt wurde, bevor er 5 Sekunden lief, gilt als abgelehnt: er zählt wie gesehen, `momentRejected`
 *   merkt den Grund, Kanal und Thema bekommen ein Minus (learn.ts `reject`). Er kommt nie wieder.
 * - Ein Moment ist höchstens zweimal der Startmoment eines Reiters (`startShown`). Danach folgt der nächste Kandidat.
 */
import type { AppState } from '../lib/state';
import { reject as rejectRule } from './learn';
import type { Form } from './form';
import type { SavedQueue } from './queue';
import type { Moment } from './types';

/** Wischt man einen Moment vor Ablauf dieser Sekunden weg, zählt es als schneller Skip */
export const QUICK_SKIP_SEC = 5;
/** So viele schnelle Skips desselben Moments, dann ist er abgelehnt */
export const REJECT_AFTER = 2;
/** Höchstens so oft ist ein Moment Startmoment eines Reiters */
export const START_MAX = 2;

export interface TabPos {
  id: string;
  day: string;
}

export const isQuickSkip = (watchedSec: number): boolean => watchedSec < QUICK_SKIP_SEC;

/** Position des Reiters merken */
export function setTabCursor(s: AppState, form: Form, id: string, day: string): AppState {
  const cur = s.tabCursor?.[form];
  if (cur && cur.id === id && cur.day === day) return s;
  return { ...s, tabCursor: { ...s.tabCursor, [form]: { id, day } } };
}

/** Gespeicherte Warteschlange ab der Position des Reiters. Fehlt die Position oder steht sie nicht in der Ablage, bleibt die Ablage wie sie ist. */
export function resumeSaved(saved: SavedQueue | null, pos: TabPos | undefined, day: string): SavedQueue | null {
  if (!saved || !pos || pos.day !== day || saved.day !== day) return saved;
  const k = saved.ids.indexOf(pos.id);
  return k > 0 ? { ...saved, ids: saved.ids.slice(k) } : saved;
}

/** Vorn stehende Momente weglassen, die schon zweimal Startmoment waren. Sie bleiben im Pool, nur nicht ganz vorn. */
export function dropOverStarted<T extends Pick<Moment, 'id'>>(queue: T[], startShown: Record<string, number> | undefined): T[] {
  let i = 0;
  while (i < queue.length && (startShown?.[queue[i].id] ?? 0) >= START_MAX) i++;
  return i ? queue.slice(i) : queue;
}

/** Der Moment ist jetzt Startmoment des Reiters */
export function bumpStart(s: AppState, id: string): AppState {
  return { ...s, startShown: { ...s.startShown, [id]: (s.startShown?.[id] ?? 0) + 1 } };
}

/** Moment ist weg: gilt als gesehen (früherer Zeitpunkt bleibt) und steht in momentRejected. Keine Gewichte, keine Abrufkarte (Known, Not for me, Ablehnung). */
export function markRejected(s: AppState, id: string, now: number): AppState {
  return { ...s, momentSeen: s.momentSeen[id] ? s.momentSeen : { ...s.momentSeen, [id]: now }, momentRejected: { ...s.momentRejected, [id]: now } };
}

export interface QuickSkipResult {
  state: AppState;
  /** true, wenn der Moment mit diesem Wisch abgelehnt wurde */
  rejected: boolean;
}

/**
 * Schneller Skip eines Moments (vor QUICK_SKIP_SEC weggewischt). Beim zweiten schnellen Skip desselben Moments ist er abgelehnt:
 * gesehen (mit frühestem Zeitpunkt), Grund `momentRejected`, Minus für Kanal und Thema.
 */
export function quickSkip(s: AppState, m: Pick<Moment, 'id' | 'channel' | 'topic' | 'area'>, now: number): QuickSkipResult {
  if (s.momentRejected?.[m.id]) return { state: s, rejected: true };
  const n = (s.momentSkips?.[m.id] ?? 0) + 1;
  const out: AppState = { ...s, momentSkips: { ...s.momentSkips, [m.id]: n } };
  if (n < REJECT_AFTER) return { state: out, rejected: false };
  return { state: { ...markRejected(out, m.id, now), momentWeights: rejectRule(s.momentWeights, m, now) }, rejected: true };
}
