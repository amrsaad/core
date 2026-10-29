import type { Moment } from './types';

/**
 * Darreichungsform (Bauliste Runde 1, Punkt 3, E4). Mischung und Lernen bleiben gleich.
 * Gleiche Regel für ios/Core.
 */
export type Form = 'video' | 'audio' | 'text';
export const FORMS: Form[] = ['video', 'audio', 'text'];
export const FORM_LABEL: Record<Form, string> = { video: 'Video', audio: 'Audio', text: 'Text' };

/**
 * Die Wahl ist ein Filter, keine Darstellung. Sie trennt nach dem Feld form des Moments.
 * Bis das Feld im Pool ist: audio true heißt audio, sonst video. Text gibt es nur mit form text.
 * Mischung und Lernen laufen danach innerhalb des Filters.
 */
export const formOf = (m: Pick<Moment, 'audio' | 'form'>): Form => m.form ?? (m.audio ? 'audio' : 'video');
export const inForm = (m: Pick<Moment, 'audio' | 'form'>, f: Form): boolean => formOf(m) === f;
export const filterPool = <T extends Pick<Moment, 'audio' | 'form'>>(pool: T[], f: Form): T[] => pool.filter((m) => inForm(m, f));
/** Zeile, wenn der Filter leer ist */
export const emptyFormLine = (f: Form) => (f === 'text' ? 'Text sources coming' : `No ${f} moments yet`);

/** Text eines Moments: der geprüfte Ausschnitt (Zeilenumbrüche an Satzgrenzen bleiben), ohne Ausschnitt die Untertitel */
export function momentText(m: Pick<Moment, 'cues'> & { excerpt?: string }): string {
  if (m.excerpt?.trim()) return m.excerpt.trim();
  return (m.cues ?? [])
    .map(([, t]) => t.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** Im Textmodus zählt "gesehen" erst, wenn das Textende sichtbar war */
export const textEndReached = (scrollTop: number, clientHeight: number, scrollHeight: number) => scrollTop + clientHeight >= scrollHeight - 4;

/**
 * Endseite (Auftrag Max 29.10.2026): Gesehen bleibt gesehen, es gibt nie eine Wiederholung. Ist der Reiter durch, steht eine ruhige Seite
 * mit zwei Knöpfen zu den anderen Reitern und der Zahl ihrer ungesehenen Momente. Kein weiterer Zähler.
 * Gleiche Regeln in ios/Core (Forms).
 */
export const endLine = (f: Form) => `You've seen every ${f} moment.`;
export const END_SUB = 'New ones arrive daily.';
export const otherForms = (f: Form): Form[] => FORMS.filter((x) => x !== f);
/** Ungesehene Momente einer Form: nicht gesehen und nicht von einem stummgeschalteten Sprecher */
export function unseenCount(pool: Pick<Moment, 'id' | 'channel' | 'audio' | 'form'>[], f: Form, seen: Record<string, number>, muted: Record<string, string>): number {
  return pool.filter((m) => inForm(m, f) && !seen[m.id] && !muted[m.channel]).length;
}
/** "Audio, 412 new" */
export const endButtonLabel = (f: Form, n: number) => `${FORM_LABEL[f]}, ${n} new`;
