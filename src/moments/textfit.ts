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
export const cleanText = (t: string): string => spaceArabic(t.replace(/\\"/g, '"').replace(/\\'/g, "'"));

/**
 * Arabischer Text: Nach ":" und "؛" fehlt das Leerzeichen (Quran.com liefert "...متفاوتة:</span>قد", der Textauszug fügt die Elemente ohne Trenner zusammen).
 * Ergänzt wird es nur, wenn VOR dem Zeichen ein arabischer Buchstabe, eine Harakat, eine schließende Klammer oder ein Anführungszeichen steht UND danach ein arabischer Buchstabe oder "{" (Versanfang).
 * Nur Leerraum wird ergänzt. Links (https://...:قد), Zahlen (12:قد, 103:2, 10:30) und lateinischer Text vor dem Zeichen bleiben unberührt, ebenso Text ohne arabische Buchstaben.
 */
const AR_LETTER = '\\u0621-\\u064A\\u0671-\\u06D3';
const AR_BEFORE = new RegExp(`([${AR_LETTER}\\u064B-\\u065F\\u0670)\\]}»"'\u201C\u201D\u2018\u2019\u2039\u203A])([:\u061B])(?=[${AR_LETTER}{])`, 'g');
export const spaceArabic = (t: string): string => (new RegExp(`[${AR_LETTER}]`).test(t) ? t.replace(AR_BEFORE, '$1$2 ') : t);

/** Runde 53b: Attribute für ein Textelement, dessen Inhalt arabisch sein kann (rechtsläufig, Sprache ar, Ausrichtung am Zeilenanfang). Lateinischer Text bekommt nichts, bleibt also unverändert. */
export const arAttrs = (t: string): { dir?: 'rtl'; lang?: 'ar' } => (/[\u0600-\u06FF]/.test(t) ? { dir: 'rtl', lang: 'ar' } : {});

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

/**
 * Issue 53: Die Stufen werden von groß nach klein geprüft, die größte, in die der ganze Text passt, gewinnt. fits[i] gilt für Stufe i (0 ist die größte).
 * Passt keine, kommt null, dann entscheidet pickCutStep über den Schnitt.
 */
export function pickStep(fits: boolean[]): number | null {
  const i = fits.indexOf(true);
  return i < 0 ? null : i;
}

/** Anteil der Lesefläche, der unter einem geschnittenen Text höchstens leer bleiben soll (Issue 53: 40 Prozent Leerraum waren der Befund) */
export const MAX_EMPTY = 0.2;

/**
 * Stufe für den Schnitt am Satzende, wenn keine Stufe den ganzen Text fasst. empty[i] ist der Leerraum (px) unter dem letzten sichtbaren Satzende in Stufe i,
 * Infinity, wenn dort kein Satzende sichtbar ist. room ist die Höhe der Lesefläche.
 * Die kleinste Stufe zeigt am meisten Text und gewinnt, solange ihr Leerraum höchstens MAX_EMPTY der Fläche ist. Sonst die größte Stufe innerhalb der Grenze
 * (ein langer Satz ohne Punkt frisst in kleiner Schrift sonst die halbe Fläche). Hält keine die Grenze, die mit dem kleinsten Leerraum, bei Gleichstand die kleinste.
 */
export function pickCutStep(empty: number[], room: number): number {
  const last = empty.length - 1;
  if (last < 0) return 0;
  const within = (i: number) => empty[i] <= room * MAX_EMPTY;
  if (within(last)) return last;
  for (let i = 0; i < last; i++) if (within(i)) return i;
  let best = last;
  for (let i = last - 1; i >= 0; i--) if (empty[i] < empty[best]) best = i;
  return best;
}

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

/** Runde 48: Text-Reiter der iPhone-Ansicht. Stufen 0 bis PHONE_TEXT_STEPS - 1 (Überschrift 32/28/24/22/20 px, Zitat 19/17/16/15/15 px, Abstände je Stufe kleiner, Größen in phone.css). */
export const PHONE_TEXT_STEPS = 5;

/**
 * Stufe für den Text-Reiter am Handy. fits[i] sagt, ob der ganze Inhalt in Stufe i ohne Scrollen in die Fläche passt (von groß nach klein gemessen).
 * Gewählt wird die größte passende Stufe. Passt keine, bleibt die kleinste und die Fläche scrollt (letzter Ausweg).
 */
export function pickPhoneStep(fits: boolean[]): { step: number; scroll: boolean } {
  for (let i = 0; i < fits.length; i++) if (fits[i]) return { step: i, scroll: false };
  return { step: Math.max(0, fits.length - 1), scroll: true };
}

/** Zeile für die Diagnose */
export const phoneFitLine = (id: string, step: number, scroll: boolean): string => `text: fit ${id} step=${step} scroll=${scroll ? 'yes' : 'no'}`;
