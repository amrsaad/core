/**
 * Temporärer Fokus auf Säulen und Sprachen (Entscheidung 39, Issue 29). Reine Funktionen und ein dünner Speicher am Gerät.
 *
 * - `Focus = { areas, langs, until }`. Leere Listen heißen kein Filter für diese Eigenschaft, ein Fokus ganz ohne Auswahl ist kein Fokus.
 * - Harter Filter auf den Pool vor der Mischung (`focusFilter`). Gewichte, Anteile und Lernen bleiben unberührt. Abrufkarten nehmen nur Momente im Fokus.
 * - Ablauf: `until` (ms) wird bei jedem Wechsel geprüft (`readFocus`, `focusActive`), `'session'` endet mit pagehide.
 * - Gilt für alle drei Reiter zugleich, pro Gerät in localStorage, nicht im Sync.
 * - Blatt und Pille gehören zu Brief 06 und rufen `writeFocus`, `clearFocus`, `readFocus`, `subscribeFocus`, `focusLabel` auf.
 */
import type { Area } from '../types';
import { AREA_LABEL } from '../lib/labels';
import type { Moment } from './types';
import { dashName } from '../lib/ns';

export type Lang = 'ar' | 'de' | 'en';
export type FocusUntil = number | 'session';
/** Wie lange der Fokus gilt, wie im Blatt gewählt: This session, 1 hour, Today. Nur für die Pille. */
export type FocusDur = 'session' | 'hour' | 'today';

export interface Focus {
  areas: Area[];
  langs: Lang[];
  until: FocusUntil;
  dur?: FocusDur;
}

export const FOCUS_KEY = dashName('core-focus');
/** Ereignis am window, wenn sich der Fokus an diesem Gerät ändert (storage meldet das nur anderen Tabs) */
export const FOCUS_EVENT = 'core-focus-changed';

export const AREA_ORDER: Area[] = ['beat', 'body', 'brain'];
export const LANGS: Lang[] = ['ar', 'de', 'en'];
export const LANG_LABEL: Record<Lang, string> = { ar: 'Arabic', de: 'German', en: 'English' };
const DUR_LABEL: Record<FocusDur, string> = { session: 'session', hour: '1 hour', today: 'today' };

const HOUR_MS = 3_600_000;

/** Ende des Fokus für eine Dauer: Sitzung, 1 Stunde ab jetzt, bis Mitternacht lokal */
export function focusUntil(dur: FocusDur, now: number): FocusUntil {
  if (dur === 'session') return 'session';
  if (dur === 'hour') return now + HOUR_MS;
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** Gilt der Fokus gerade? Ohne Auswahl oder nach Ablauf nicht. */
export function focusActive(f: Focus | null | undefined, now: number): f is Focus {
  if (!f || (!f.areas.length && !f.langs.length)) return false;
  return f.until === 'session' || now < f.until;
}

// ---------- Sprache des Moments ----------

const DE = /\b(und|der|die|das|nicht|ist|ein|eine|zu|mit|für|auf|den|dem|von|auch|sich|wir|ich|es|sie|wenn|aber|oder|bei|noch|nur|wird|werden|kann)\b|[äöüß]/gi;
const EN = /\b(the|and|is|of|to|in|that|it|for|with|you|this|are|was|have|not|but|they|what|about|from|your)\b/gi;
const cache = new Map<string, Lang>();

/**
 * Sprache des Sprechers. Das Feld `lang` gilt, wenn die Pipeline es füllt (Brief 04). Bis dahin: arabische Schrift im Text heißt Arabisch,
 * sonst zählen deutsche und englische Funktionswörter in Untertiteln, Auszug und Hook, bei Gleichstand Englisch.
 */
export function langOf(m: Pick<Moment, 'id' | 'lang' | 'cues' | 'excerpt' | 'hook' | 'videoTitle'>): Lang {
  if (m.lang) return m.lang;
  const hit = cache.get(m.id);
  if (hit) return hit;
  const sample = [...(m.cues ?? []).slice(0, 12).map((c) => c[1]), m.excerpt ?? '', m.hook ?? '', m.videoTitle ?? ''].join(' ');
  let out: Lang;
  if ((sample.match(/[؀-ۿ]/g) ?? []).length >= 8) out = 'ar';
  else {
    const de = (sample.match(DE) ?? []).length;
    const en = (sample.match(EN) ?? []).length;
    out = de > en ? 'de' : 'en';
  }
  cache.set(m.id, out);
  return out;
}

/** Liegt der Moment im Fokus? */
export const inFocus = (m: Pick<Moment, 'id' | 'area' | 'lang' | 'cues' | 'excerpt' | 'hook' | 'videoTitle'>, f: Focus): boolean =>
  (!f.areas.length || f.areas.includes(m.area)) && (!f.langs.length || f.langs.includes(langOf(m)));

/** Harter Filter auf den Pool vor der Mischung. Ohne Fokus derselbe Pool (gleicher Verweis). */
export function focusFilter<T extends Parameters<typeof inFocus>[0]>(pool: T[], focus: Focus | null | undefined, now: number): T[] {
  return focusActive(focus, now) ? pool.filter((m) => inFocus(m, focus)) : pool;
}

/** Pille: "Beat · Arabic · today". Säulen in Reihenfolge Beat, Body, Brain, dann Sprachen. */
export function focusLabel(f: Focus): string {
  const parts = [...AREA_ORDER.filter((a) => f.areas.includes(a)).map((a) => AREA_LABEL[a]), ...LANGS.filter((l) => f.langs.includes(l)).map((l) => LANG_LABEL[l])];
  const dur = f.until === 'session' ? DUR_LABEL.session : f.dur ? DUR_LABEL[f.dur] : 'today';
  return [...parts, dur].join(' · ');
}

// ---------- Speicher am Gerät ----------

/** Gespeicherten Text lesen und prüfen. Ungültiges ist kein Fokus. */
export function parseFocus(raw: string | null): Focus | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as Partial<Focus>;
    const areas = (Array.isArray(x.areas) ? x.areas : []).filter((a): a is Area => AREA_ORDER.includes(a as Area));
    const langs = (Array.isArray(x.langs) ? x.langs : []).filter((l): l is Lang => LANGS.includes(l as Lang));
    const until = x.until === 'session' ? 'session' : typeof x.until === 'number' && Number.isFinite(x.until) ? x.until : null;
    if (until === null) return null;
    const out: Focus = { areas: [...new Set(areas)], langs: [...new Set(langs)], until };
    if (x.dur === 'session' || x.dur === 'hour' || x.dur === 'today') out.dur = x.dur;
    return out;
  } catch {
    return null;
  }
}

const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const notify = () => {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(FOCUS_EVENT));
  } catch {
    /* kein window */
  }
};

/** Aktiver Fokus dieses Geräts. Abgelaufene oder leere Fokusse werden gelöscht und geben null. */
export function readFocus(now: number = Date.now(), s: Storage | null = store()): Focus | null {
  if (!s) return null;
  let f: Focus | null = null;
  try {
    f = parseFocus(s.getItem(FOCUS_KEY));
  } catch {
    return null;
  }
  if (focusActive(f, now)) return f;
  if (s.getItem(FOCUS_KEY) !== null) {
    try {
      s.removeItem(FOCUS_KEY);
    } catch {
      /* nichts zu tun */
    }
  }
  return null;
}

/** Fokus setzen. Eine Auswahl ohne Säule und ohne Sprache löscht ihn. */
export function writeFocus(f: Focus, s: Storage | null = store()): void {
  if (!s) return;
  try {
    if (!f.areas.length && !f.langs.length) s.removeItem(FOCUS_KEY);
    else s.setItem(FOCUS_KEY, JSON.stringify(f));
  } catch {
    /* kein Speicher */
  }
  notify();
}

export function clearFocus(s: Storage | null = store()): void {
  if (!s) return;
  try {
    s.removeItem(FOCUS_KEY);
  } catch {
    /* kein Speicher */
  }
  notify();
}

/** Auf Änderungen hören (dieses Gerät, auch andere Tabs). Gibt die Abmeldung zurück. */
export function subscribeFocus(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === FOCUS_KEY) cb();
  };
  window.addEventListener(FOCUS_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(FOCUS_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** Ein Fokus "This session" endet mit pagehide */
export function endSessionFocus(s: Storage | null = store()): boolean {
  if (!s) return false;
  try {
    const f = parseFocus(s.getItem(FOCUS_KEY));
    if (f?.until !== 'session') return false;
    s.removeItem(FOCUS_KEY);
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void endSessionFocus());
