import type { Area, CardType } from '../types';

export const AREA_LABEL: Record<Area, string> = { beat: 'Beat', body: 'Body', brain: 'Brain' };
export const AREA_COLOR: Record<Area, string> = { beat: '#C9A227', body: '#2FB37A', brain: '#4A8CFF' };
export const TYPE_LABEL: Record<CardType, string> = { fact: 'Wissen', fresh: 'Neu', verse: 'Vers', apply: 'Praxis', recall: 'Abruf' };
export const TOPIC_LABEL: Record<string, string> = {
  glaukom: 'Glaukom', retina: 'Retina', katarakt: 'Katarakt', refraktiv: 'Refraktiv', cornea: 'Cornea', allgemein: 'Augen allgemein',
  'ki-medizin': 'KI Medizin', 'ki-regulierung': 'KI Regulierung', 'ki-allgemein': 'KI', verhandlung: 'Verhandlung', strategie: 'Strategie',
  startup: 'Startup', varia: 'Varia', kraft: 'Strength', ausdauer: 'Endurance', ernaehrung: 'Nutrition', recovery: 'Recovery', schlaf: 'Sleep', koran: 'Quran',
};
export const topicLabel = (t: string) => TOPIC_LABEL[t] ?? t;
export const isArabic = (s: string) => /[؀-ۿ]/.test(s);
export const shortTitle = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')} …` : s);
