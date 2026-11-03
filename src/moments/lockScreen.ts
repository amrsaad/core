// Sperrbildschirm und Medientasten im Audio-Reiter (Entscheidung 24, Issue 19). Reine Logik, die Media Session selbst setzt der Feed.
// nexttrack = nächster Moment. previoustrack = Save (Titel 2 s "Saved · <Hook>" und kurzer Ton), ein zweiter Druck binnen 1,5 s = More like this.
// seekbackward und seekforward werden nicht registriert: der Sperrbildschirm zeigt dann Weiter und Zurück statt Sprünge um 10 Sekunden.
import type { Area } from '../types';
import { PULL_WITHIN } from './startHead';
import { speakerLine } from './speaker';
import type { Moment } from './types';

/** Der Titel "Saved · <Hook>" bleibt so lange stehen (ms) */
export const SAVED_TITLE_MS = 2000;
/** Zweiter Druck auf Zurück innerhalb dieser Zeit (ms) ist More like this */
export const MORE_WINDOW_MS = 1500;
/** Kantenlängen der Reiterbilder in public/ */
export const ARTWORK_SIZES = [512, 1024] as const;

/** Aktionen, die der Feed registriert */
export const LOCK_ACTIONS = ['play', 'pause', 'nexttrack', 'previoustrack'] as const;
/** Aktionen, die bewusst fehlen (sonst ersetzt iOS Weiter und Zurück durch 10-Sekunden-Sprünge) */
export const LOCK_UNREGISTERED = ['seekbackward', 'seekforward', 'seekto'] as const;

/** Zurück gedrückt: Save beim ersten Druck, More like this beim zweiten innerhalb des Fensters. last = Zeit des letzten Drucks oder null. */
export function previousPress(now: number, last: number | null, windowMs = MORE_WINDOW_MS): 'save' | 'more' {
  return last !== null && now - last >= 0 && now - last <= windowMs ? 'more' : 'save';
}

export const savedTitle = (hook: string) => `Saved · ${hook}`;

/** Pfad des Reiterbilds in public/ (Beat, Body, Brain), base = BASE_URL */
export const tabImage = (area: Area, size: number, base = '/') => `${base}tab-${area}-${size}.png`;

export interface LockMeta {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string; sizes: string; type: string }[];
}

/** Anzeige auf dem Sperrbildschirm: Titel Hook, Künstler Kanal, Album Folge, Bild des Reiters (Bereich) in 512 und 1024 px */
export function lockMeta(m: Pick<Moment, 'hook' | 'channel' | 'videoTitle' | 'area'>, base = '/', origin = ''): LockMeta {
  return {
    title: m.hook,
    artist: speakerLine(m.channel),
    album: m.videoTitle,
    artwork: ARTWORK_SIZES.map((n) => ({ src: `${origin}${tabImage(m.area, n, base)}`, sizes: `${n}x${n}`, type: 'image/png' })),
  };
}

/**
 * Weiter vom Sperrbildschirm oder der Medientaste im Audio-Reiter (Entscheidung 45, Brief 09 Schritt 5): ein Netzstart ist ein Fehler, solange ein
 * Vorrats-Moment erreichbar ist. Liegt der nächste Moment nicht im Vorrat, kommt der erste Vorrats-Moment dahinter an Stelle idx+1.
 * Sichtbar: innerhalb der nächsten PULL_WITHIN. Verdeckt: aus dem ganzen Rest, denn iOS lädt eine Netzquelle bei verdecktem Bildschirm erst weiter,
 * wenn die App wieder sichtbar ist (Brief 09, Ergänzung 14:25).
 * how: held (der nächste liegt im Vorrat), pulled (ein Vorrats-Moment wurde vorgezogen), net (keiner im Vorrat), none (keine Warteschlange).
 */
export function lockNextPlan<T extends { id: string }>(queue: readonly T[], idx: number, held: (m: T) => boolean, hidden: boolean): { queue: T[]; how: 'held' | 'pulled' | 'net' | 'none'; id?: string } {
  const next = queue[idx + 1];
  if (!next) return { queue: [...queue], how: 'none' };
  if (held(next)) return { queue: [...queue], how: 'held', id: next.id };
  const end = hidden ? queue.length : Math.min(queue.length, idx + 1 + PULL_WITHIN);
  for (let j = idx + 2; j < end; j++) {
    if (!held(queue[j])) continue;
    const q = [...queue];
    const [m] = q.splice(j, 1);
    q.splice(idx + 1, 0, m);
    return { queue: q, how: 'pulled', id: m.id };
  }
  return { queue: [...queue], how: 'net', id: next.id };
}
