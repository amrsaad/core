import type { Area } from '../types';

/**
 * Stimmung (Entscheidung 22a, 41): ein Attribut am html-Element, die Farben kommen aus tokens.css.
 * Der Bereich des aktuellen Moments setzt sie (beat, body, brain), ohne Moment gilt die neutrale Palette.
 * Die Überblendung (400 ms) macht tokens.css über @property, hier wird nur das Attribut gesetzt.
 */
export type Mood = Area | null;

export function setMood(mood: Mood, root: HTMLElement = document.documentElement): void {
  if (mood) root.setAttribute('data-mood', mood);
  else root.removeAttribute('data-mood');
}
