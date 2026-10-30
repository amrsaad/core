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
