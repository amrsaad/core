/**
 * Kontextgewichte der Mischung (Issue 26, Entscheidung 34). Reine Funktionen, drei weiche Faktoren ohne Eingabe und ohne neuen Dienst:
 *
 * (a) Tageszeit: aus `signals.days[Tag].byHour` der letzten 28 Tage, Stunden des laufenden Zeitfensters (± 1 Stunde), nur Tage gleicher Art
 *     (Werktag oder Wochenende, die Zähler tragen den Tag, der Wochentag ergibt sich daraus). Gewicht je Bereich und Form aus dem
 *     Verhältnis Fertighören plus Saves zu Gesehen, geglättet mit Startwert 1 (PRIOR Beobachtungen mit Verhältnis 1), geteilt durch das
 *     geglättete Verhältnis des ganzen Fensters. Ohne Daten ist jedes Gewicht 1. Begrenzt auf TIME_MIN bis TIME_MAX.
 * (b) Sitzung: drei Skips unter 3 s in Folge setzen für die nächsten 10 Momente das Gewicht 0.5 auf Momente über 90 s und auf Text in Brain.
 * (c) Netzart: Mobilfunk heißt Gewicht 1.5 auf Audio und Momente unter 90 s, 0.7 auf Video (ab 90 s). WLAN, Kabel und "nicht verfügbar" sind neutral.
 *
 * Alles geht als `ctx` in `MomentPrefs` und multipliziert nur das Ziehungsgewicht. Die harten Regeln aus Entscheidung 33 bleiben unberührt.
 */
import { formOf, type Form } from './form';
import type { HourCell, Signals } from './signals';
import type { Moment } from './types';

export const CTX_DAYS = 28;
/** Beobachtungen mit Verhältnis 1, die jede Zelle als Startwert mitbringt */
export const PRIOR = 5;
export const TIME_MIN = 0.6;
export const TIME_MAX = 1.6;
export const SHORT_SKIP_SEC = 3;
export const SKIP_RUN = 3;
export const ATTENTION_MOMENTS = 10;
export const ATTENTION_WEIGHT = 0.5;
export const LONG_SEC = 90;
export const NET_PLUS = 1.5;
export const NET_MINUS = 0.7;

const DAY_MS = 86_400_000;
const lenOf = (m: Pick<Moment, 'start' | 'end'>) => m.end - m.start;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ---------- (a) Tageszeit ----------

const isWeekend = (day: string): boolean => {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/** Stunde h liegt im Fenster um `hour` (± 1, rund um Mitternacht) */
const inWindow = (h: number, hour: number): boolean => {
  const d = Math.abs(h - hour);
  return Math.min(d, 24 - d) <= 1;
};

/** Zähler des Zeitfensters je Bereich und Form, nur die letzten 28 Tage und nur Tage gleicher Art wie `today` */
export function windowCells(sig: Signals | undefined, today: string, hour: number): Map<string, HourCell> {
  const out = new Map<string, HourCell>();
  if (!sig) return out;
  const from = new Date(`${today}T12:00:00Z`).getTime() - CTX_DAYS * DAY_MS;
  const weekend = isWeekend(today);
  for (const [day, d] of Object.entries(sig.days)) {
    const t = new Date(`${day}T12:00:00Z`).getTime();
    if (!(t > from) || day > today || !d.byHour || isWeekend(day) !== weekend) continue;
    for (const [hk, areas] of Object.entries(d.byHour)) {
      const h = Number(hk);
      if (!Number.isFinite(h) || !inWindow(h, hour)) continue;
      for (const [area, forms] of Object.entries(areas)) {
        for (const [form, c] of Object.entries(forms ?? {})) {
          if (!c) continue;
          const k = `${area}:${form}`;
          const cur = out.get(k) ?? { seen: 0, done: 0, saves: 0, skips: 0 };
          out.set(k, { seen: cur.seen + c.seen, done: cur.done + c.done, saves: cur.saves + c.saves, skips: cur.skips + c.skips });
        }
      }
    }
  }
  return out;
}

/** Fertig gehört oder gespeichert im Verhältnis zu Gesehen, geglättet. Ohne Beobachtung genau 1. */
const smoothed = (good: number, seen: number): number => (Math.min(seen, good) + PRIOR) / (seen + PRIOR);

/** Gewicht je "Bereich:Form" für die Uhrzeit `hour` am Tag `today`. Fehlende Schlüssel gelten als 1. */
export function timeWeights(sig: Signals | undefined, today: string, hour: number): Map<string, number> {
  const cells = windowCells(sig, today, hour);
  const w = new Map<string, number>();
  let good = 0;
  let seen = 0;
  for (const c of cells.values()) {
    good += c.done + c.saves;
    seen += c.seen;
  }
  if (!seen) return w;
  const base = smoothed(good, seen);
  for (const [k, c] of cells) w.set(k, clamp(smoothed(c.done + c.saves, c.seen) / base, TIME_MIN, TIME_MAX));
  return w;
}

export const timeWeightOf = (w: Map<string, number>, m: Pick<Moment, 'area' | 'audio' | 'form'>): number => w.get(`${m.area}:${formOf(m)}`) ?? 1;

// ---------- (b) Aufmerksamkeit in der Sitzung ----------

export interface Attention {
  /** Skips unter 3 s in Folge */
  run: number;
  /** Position in der Warteschlange, bis zu der (ausschließlich) das Gewicht gilt. 0 heißt aus. */
  until: number;
}

export const newAttention = (): Attention => ({ run: 0, until: 0 });

/**
 * Ein Wisch nach vorn mit gemessener Zeit. `skipped` heißt unter 3 s. Der dritte Skip in Folge schaltet die Dämpfung für die nächsten
 * 10 Momente nach `index` (Position des verlassenen Moments) ein, jeder längere Blick setzt die Folge zurück.
 * Gibt dasselbe Objekt zurück, wenn sich nichts ändert, und `started`, wenn die Dämpfung jetzt neu beginnt.
 */
export function attentionStep(a: Attention, skipped: boolean, index: number): { att: Attention; started: boolean } {
  if (!skipped) return a.run ? { att: { ...a, run: 0 }, started: false } : { att: a, started: false };
  const run = a.run + 1;
  if (run >= SKIP_RUN) return { att: { run: 0, until: index + 1 + ATTENTION_MOMENTS }, started: true };
  return { att: { ...a, run }, started: false };
}

export const attentionOn = (a: Attention, position: number): boolean => position < a.until;

/** Schwere Momente: länger als 90 s oder Text in Brain */
export const isHeavy = (m: Pick<Moment, 'start' | 'end' | 'area' | 'audio' | 'form'>): boolean => lenOf(m) > LONG_SEC || (formOf(m) === 'text' && m.area === 'brain');

// ---------- (c) Netzart ----------

export interface Conn {
  type?: string;
  effectiveType?: string;
  /** Geschätzte Bandbreite in Mbit/s (Chrome, Android). iOS Safari kennt navigator.connection nicht. */
  downlink?: number;
}

/** Unter dieser Bandbreite (Mbit/s) gilt das Netz sofort als schlecht (Brief 09, Schritt 6) */
export const POOR_DOWNLINK = 1.5;
/** Netz schon vor dem ersten langsamen Start als schlecht erkennen: effectiveType 2g, 3g, slow-2g oder downlink unter POOR_DOWNLINK */
export const connPoor = (c: Conn | undefined): boolean => {
  if (!c) return false;
  if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g') return true;
  return typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < POOR_DOWNLINK;
};

/** Mobilfunk: type "cellular". Ohne type (Chrome Android) zählt ein langsamer effectiveType (slow-2g, 2g, 3g). */
export const isCellular = (c: Conn | undefined): boolean => {
  if (!c) return false;
  if (c.type) return c.type === 'cellular';
  return c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g';
};

export function netWeightOf(cellular: boolean, m: Pick<Moment, 'start' | 'end' | 'audio' | 'form'>): number {
  if (!cellular) return 1;
  const f: Form = formOf(m);
  if (f === 'audio' || lenOf(m) < LONG_SEC) return NET_PLUS;
  return f === 'video' ? NET_MINUS : 1;
}

export function readConn(): Conn | undefined {
  try {
    return (navigator as unknown as { connection?: Conn }).connection;
  } catch {
    return undefined;
  }
}

// ---------- zusammen ----------

export interface CtxInput {
  signals: Signals | undefined;
  /** Lokaler Tag (YYYY-MM-DD) und Stunde */
  today: string;
  hour: number;
  attention: Attention;
  /** Position, an der der nächste Moment in die Warteschlange kommt */
  position: () => number;
  conn?: Conn;
}

/** Das Zusatzgewicht für `MomentPrefs.ctx`. Rechnet die Zeitfenster einmal, die Sitzung bei jedem Aufruf neu. */
export function makeCtx(i: CtxInput): (m: Moment) => number {
  const tw = timeWeights(i.signals, i.today, i.hour);
  const cellular = isCellular(i.conn);
  return (m) => {
    let x = timeWeightOf(tw, m) * netWeightOf(cellular, m);
    if (attentionOn(i.attention, i.position()) && isHeavy(m)) x *= ATTENTION_WEIGHT;
    return x;
  };
}
