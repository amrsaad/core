import type { Moment } from './types';

/**
 * Darreichungsform (Bauliste Runde 1, Punkt 3, E4). Mischung und Lernen bleiben gleich.
 * Gleiche Regel für ios/Core.
 */
export type Form = 'video' | 'audio' | 'text';
export const FORMS: Form[] = ['video', 'audio', 'text'];
export const FORM_LABEL: Record<Form, string> = { video: 'Video', audio: 'Audio', text: 'Text' };

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
