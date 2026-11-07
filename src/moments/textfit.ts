/**
 * Text-Moment auf einen Bildschirm (Brief 18, Issues 41 und 43, Entscheidung 25 und 22).
 * Reine Regeln ohne DOM, damit sie in Vitest laufen. MomentFeed misst am Container und ruft sie auf.
 *
 *  1. Drei Stufen für den Fließtext (17/27, 16/25, 15/23, arabisch 15/24, 14/23, 13/22). Die Stufe steht als data-step an der Spalte,
 *     die Größen dazu in feed.css. Passt der Text in keiner Stufe, wird er am letzten Satzende geschnitten, das noch sichtbar ist.
 *     Der Rest steht im Blatt mit dem ganzen Text. Kein "Read more" im Text.
 *  2. Arabisch: Koranverse in geschweiften Klammern { } werden als eigenes Stück markiert (Amiri, eine Stufe größer),
 *     der Erklärtext bleibt in Noto Sans Arabic. Backslash-Anführungszeichen aus der Pipeline werden beim Rendern entfernt.
 */

/** Zahl der Schriftstufen, data-step 0 bis TEXT_STEPS - 1 */
export const TEXT_STEPS = 3;

/** Escape-Reste der Pipeline (\" und \') werden zu normalen Anführungszeichen, bis die Pipeline sie selbst entfernt (Issue 43) */
export const cleanText = (t: string): string => t.replace(/\\"/g, '"').replace(/\\'/g, "'");

export interface Piece {
  text: string;
  /** Koranvers in { }: eigene Schrift (Amiri) */
  verse: boolean;
}

/** Zerlegt den Text in Erklärtext und Verse. Die Klammern bleiben Teil des Verses. Zusammengesetzt ergeben die Stücke wieder den Text. */
export function versePieces(t: string): Piece[] {
  const out: Piece[] = [];
  const re = /\{[^{}]*\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push({ text: t.slice(last, m.index), verse: false });
    out.push({ text: m[0], verse: true });
    last = m.index + m[0].length;
  }
  if (last < t.length) out.push({ text: t.slice(last), verse: false });
  return out;
}

/**
 * Satzenden als Zeichenpositionen (Position nach dem Satzzeichen und einem schließenden Zeichen wie " oder ), vor Leerraum oder am Ende).
 * Lateinische und arabische Satzzeichen. Ein Zeilenumbruch gilt ebenfalls als Satzende.
 */
export function sentenceEnds(t: string): number[] {
  const ends: number[] = [];
  const re = /[.!?؟۔…]+["'”’»)\]}]*(?=\s|$)|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const end = m[0] === '\n' ? m.index : m.index + m[0].length;
    if (end > 0 && ends[ends.length - 1] !== end) ends.push(end);
  }
  return ends;
}

/** Größte Satzgrenze, die noch passt. fits(end) sagt, ob das Zeichen vor end sichtbar ist. Keine passende Grenze: null. */
export function fitCut(ends: number[], fits: (end: number) => boolean): number | null {
  for (let i = ends.length - 1; i >= 0; i--) if (fits(ends[i])) return ends[i];
  return null;
}

/** Gekürzter Text bis zur Grenze, ohne Leerraum am Ende */
export const cutText = (t: string, cut: number | null): string => (cut === null ? t : t.slice(0, cut).trimEnd());

/** Ergebnis der Messung: Stufe, Schnitt am Satzende, und ob als Notnagel per Zeilenzahl gekürzt wird (kein Satzende sichtbar) */
export interface TextFit {
  step: number;
  cut: number | null;
  clamp: boolean;
}
export const FIT_FULL: TextFit = { step: 0, cut: null, clamp: false };
export const sameFit = (a: TextFit, b: TextFit): boolean => a.step === b.step && a.cut === b.cut && a.clamp === b.clamp;
/** Der Text ist gekürzt, der Rest steht im Blatt. Erst dort am Ende gilt der Moment als gesehen. */
export const isTruncated = (f: TextFit): boolean => f.cut !== null || f.clamp;
