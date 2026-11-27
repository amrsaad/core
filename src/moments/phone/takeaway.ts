import type { Moment } from '../types';

/**
 * Runde 50: Text-Reiter der iPhone-Ansicht, Takeaway-Momente (kind takeaway).
 * Befund vom Gerät: der Textkörper war der rohe excerpt. Der enthält schon Zitat, Herkunft, die Zeile "Heute anwenden" und den Anwendungssatz. Darunter kamen Herkunft und Anwendung
 * noch einmal aus den Feldern origin und apply (Fuß des Lesebereichs) und die Quellenzeile (Kanal, Nummer) zusätzlich zum Kanal-Chip. Alles stand doppelt.
 * Jetzt: mit Feld quote zeigt der Textkörper nur das Zitat. Ohne quote (ältere Pools) der excerpt, aus dem Herkunft, Anwendungssatz und die Zeile "Heute anwenden" entfernt werden, wenn sie darunter stehen.
 */
const LABEL = /(?:^|\n)\s*(?:heute anwenden|apply today)\s*:?\s*(?=\n|$)/gi;

export interface TakeawayParts {
  /** Text des Zitatblocks */
  body: string;
  /** Metazeile: Herkunft und Nummer, einmal ("" wenn beides fehlt) */
  meta: string;
  /** Anwendungssatz für die Karte "Apply today" ("" wenn keiner) */
  apply: string;
}

export const isTakeaway = (m: Pick<Moment, 'kind'>): boolean => m.kind === 'takeaway';

export function takeawayParts(m: Pick<Moment, 'quote' | 'origin' | 'apply' | 'takeawayNr' | 'excerpt' | 'cues'>, text: string): TakeawayParts {
  const origin = (m.origin ?? '').trim();
  const apply = (m.apply ?? '').trim();
  const nr = typeof m.takeawayNr === 'number' && m.takeawayNr > 0 ? `Nr. ${m.takeawayNr}` : '';
  const meta = [origin, nr].filter(Boolean).join(' · ');
  const quote = (m.quote ?? '').trim();
  if (quote) return { body: quote, meta, apply };
  let t = text;
  for (const part of [apply, origin]) if (part) t = t.split(part).join('');
  t = t.replace(LABEL, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return { body: t || text, meta, apply };
}
