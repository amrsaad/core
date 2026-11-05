/**
 * Blätter schließen (Entscheidung 54, Brief 17, Issue 39). Für alle Blätter gleich: More, Fokus, Share, Kontext.
 * Drei Wege zu: Wisch nach unten ab 80 px, Tipp auf den abgedunkelten Hintergrund, Schließen-Knopf oben rechts (44 px).
 */
export const SHEET_SWIPE_PX = 80;

/** Wisch nach unten schließt ab SHEET_SWIPE_PX, aber nur wenn der Inhalt oben steht (sonst scrollt er) */
export const closesSheet = (dy: number, scrollTop: number): boolean => dy >= SHEET_SWIPE_PX && scrollTop <= 0;
