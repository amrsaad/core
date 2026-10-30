// Netzabbruch im Feed (Issue 9): ein Playerfehler ändert nie den Moment, solange er vom Netz kommen kann.
// Der Slot bleibt eine Einheit (Moment-ID, Cover, Untertitel, Quelle, Ton) und versucht an derselben Stelle weiter.

/** Fehler, die am Inhalt liegen und nach einem Neuladen bleiben: YouTube 2 (ungültig), 100 (fehlt), 101 und 150 (Einbettung gesperrt) */
export const PERMANENT_ERRORS: ReadonlySet<number> = new Set([2, 100, 101, 150]);
/** So viele Wiederaufnahmen an derselben Stelle, dann gilt der Moment als nicht abspielbar und wird übersprungen */
export const MAX_RECOVER = 3;

export type ErrorAction = 'wait' | 'recover' | 'skip';

/**
 * wait: kein Netz, der Slot bleibt stehen und wird bei der Rückkehr wieder aufgenommen.
 * recover: Netz da, an derselben Stelle neu ansetzen.
 * skip: Inhaltsfehler oder zu viele Versuche, Moment überspringen (wie bisher).
 */
export function errorAction(code: number, online: boolean, tries: number): ErrorAction {
  if (PERMANENT_ERRORS.has(code)) return 'skip';
  if (!online) return 'wait';
  return tries < MAX_RECOVER ? 'recover' : 'skip';
}

/** Stelle, an der ein Slot weiterläuft: die letzte gute Position, nie vor dem Start und nie am Ende */
export function resumePos(pos: number, m: { start: number; end: number }): number {
  if (!Number.isFinite(pos) || pos < m.start) return m.start;
  return Math.min(pos, Math.max(m.start, m.end - 1));
}
