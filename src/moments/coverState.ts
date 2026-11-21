// Titelbild eines Moments: Zustand je Adresse. Bei neuer Adresse beginnt ein neues Element (kein altes Bild bleibt stehen, bis das neue geladen ist),
// bei einem Ladefehler bleibt die Fläche neutral (leeres alt, keine Bildsymbol), "online" versucht dieselbe Adresse noch einmal.

export interface CoverState {
  src: string;
  /** Zähler der Neuversuche für diese Adresse */
  k: number;
  /** Das Bild kam nicht (Neuversuch bei online) */
  bad: boolean;
}

export const coverStart = (src: string): CoverState => ({ src, k: 0, bad: false });

export type CoverEvent = { type: 'src'; src: string } | { type: 'error' } | { type: 'online' };

export function coverStep(s: CoverState, e: CoverEvent): CoverState {
  if (e.type === 'src') return e.src === s.src ? s : coverStart(e.src);
  if (e.type === 'error') return s.bad ? s : { ...s, bad: true };
  return s.bad ? { ...s, k: s.k + 1, bad: false } : s;
}

/** Schlüssel des img-Elements: neue Adresse oder neuer Versuch bauen es neu auf */
export const coverKey = (s: CoverState): string => `${s.src}|${s.k}`;
