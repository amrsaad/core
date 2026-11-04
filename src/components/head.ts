import { AREA_ORDER, LANG_LABEL, LANGS, type Focus } from '../moments/focus';
import { AREA_LABEL } from '../lib/labels';

/** Restzeit des Fokus für die Kopfzeile: "session", "52 min", "2 h" (abgerundet auf volle Stunden ab 2 h) */
export function remainingText(until: Focus['until'], now: number): string {
  if (until === 'session') return 'session';
  const min = Math.max(1, Math.ceil((until - now) / 60_000));
  return min >= 120 ? `${Math.floor(min / 60)} h` : `${min} min`;
}

/** Zusatz am gewählten Reiter bei aktivem Fokus: Bereiche, Sprachen, Restzeit, z. B. "English · 52 min" */
export function focusTabText(f: Focus, now: number): string {
  const parts = [...AREA_ORDER.filter((a) => f.areas.includes(a)).map((a) => AREA_LABEL[a]), ...LANGS.filter((l) => f.langs.includes(l)).map((l) => LANG_LABEL[l])];
  return [...parts, remainingText(f.until, now)].join(' · ');
}
