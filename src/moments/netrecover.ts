// Netzabbruch im Feed (Issue 9): ein Playerfehler ändert nie den Moment, solange er vom Netz kommen kann.
// Der Slot bleibt eine Einheit (Moment-ID, Cover, Untertitel, Quelle, Ton) und versucht an derselben Stelle weiter.

/** Fehler, die am Inhalt liegen und nach einem Neuladen bleiben: YouTube 2 (ungültig), 100 (fehlt), 101 und 150 (Einbettung gesperrt) */
export const PERMANENT_ERRORS: ReadonlySet<number> = new Set([2, 100, 101, 150]);
/** Wiederaufnahmen an derselben Stelle. Ab dieser Zahl wird der Abstand nicht mehr größer (Deckel 10 s). Ein Netzfehler überspringt nie (Max 02.11., Entscheidung 40). */
export const MAX_RECOVER = 3;
/** Wartezeit vor der nächsten Wiederaufnahme in Sekunden: 1, 2, 3, dann 10 */
export const recoverDelay = (tries: number): number => (tries < MAX_RECOVER ? tries + 1 : 10);

export type ErrorAction = 'wait' | 'recover' | 'skip';

/**
 * wait: kein Netz, der Slot bleibt stehen und wird bei der Rückkehr wieder aufgenommen.
 * recover: Netz da, an derselben Stelle neu ansetzen.
 * skip: Inhaltsfehler oder zu viele Versuche, Moment überspringen (wie bisher).
 */
export function errorAction(code: number, online: boolean, _tries: number): ErrorAction {
  if (PERMANENT_ERRORS.has(code)) return 'skip';
  if (!online) return 'wait';
  // Schlechtes Netz überspringt nie. Jeder Versuch setzt an derselben Stelle an, bis es spielt oder Max wischt.
  return 'recover';
}

/** Stelle, an der ein Slot weiterläuft: die letzte gute Position, nie vor dem Start und nie am Ende */
export function resumePos(pos: number, m: { start: number; end: number }): number {
  if (!Number.isFinite(pos) || pos < m.start) return m.start;
  return Math.min(pos, Math.max(m.start, m.end - 1));
}
