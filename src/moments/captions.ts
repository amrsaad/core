import { isArabic, type Moment } from './types';

/**
 * Untertitel-Regel (Bauliste Runde 1, Punkt 4, Fundament R12 und E6).
 * Auto: englische Video-Momente ohne Untertitel (keine wörtlichen Untertitel als Standard),
 * Audio-Momente mit, arabische Momente mit (E6, arabische Untertitel rechtsläufig).
 * Ohne cues nie Untertitel. Gleiche Regel für ios/Core.
 */
export type CaptionMode = 'auto' | 'on' | 'off';

export const hasCues = (m: Pick<Moment, 'cues'>) => !!m.cues?.some(([, t]) => t.trim().length > 0);

export const captionDefault = (m: Pick<Moment, 'cues' | 'audio'>) => hasCues(m) && (!!m.audio || m.cues!.some(([, t]) => isArabic(t)));

export function captionsShown(mode: CaptionMode | undefined, m: Pick<Moment, 'cues' | 'audio'>): boolean {
  if (!hasCues(m)) return false;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return captionDefault(m);
}

const ABBR = /^(?:dr|mr|mrs|ms|prof|vs|etc|e\.g|i\.e|st|fig|approx)$/i;
const INITIAL = /^[A-HJ-Z]$/;

/**
 * Untertitel in Zeilen: ein Zeilenumbruch am Satzende (. ! ? … und das arabische ؟), nie mitten im Satz.
 * Kürzel (Dr., e.g.) und Initialen (J. Smith) beenden keinen Satz. Jede Zeile bekommt ihre Schreibrichtung selbst (siehe isArabic).
 */
export function captionLines(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  let from = 0;
  const re = /([.!?؟…]+)["')\]»”]*\s+(?=\S)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const upto = t.slice(from, m.index + m[0].trimEnd().length);
    const last = upto.split(' ').pop()!.replace(/[.!?؟…"')\]»”]+$/u, '');
    // Punkt nach Kürzel oder Initiale, oder ein Punkt zwischen Ziffern ("3. 5"): kein Satzende
    if (m[1] === '.' && (ABBR.test(last) || INITIAL.test(last) || /^\d+$/.test(last))) continue;
    out.push(upto.trim());
    from = m.index + m[0].length;
  }
  const rest = t.slice(from).trim();
  if (rest) out.push(rest);
  return out;
}
