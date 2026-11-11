/** Issue 49: Im Audio- und Text-Reiter reserviert die Zeile "N notes, send?" eine eigene Reihe unten über der Leiste (data-notes am Feed), nie über Cover, Kicker oder Text. */
export function notesRow(prompt: boolean, form: string, visible: boolean, unsent: number): boolean {
  return prompt && visible && unsent > 0 && (form === 'audio' || form === 'text');
}
