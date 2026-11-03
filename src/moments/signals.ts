/**
 * Signale für den Digest und die Kontextgewichte (Brief 03, Entscheidung 33, 34 und 35). Reine Funktionen auf dem Zustand.
 *
 * - `days[Tag].mixClump`: Paare aufeinanderfolgender Momente, die der Feed gezeigt hat (pairs), davon gleiche Folge, gleicher Kanal,
 *   gleicher Bereich. Der Digest rechnet daraus die Anteile (`mixClumpShare`).
 * - `days[Tag].byHour[Stunde][Bereich][Form]`: gesehen, fertig, Saves, Skips. Stunde lokal, zweistellig ("07").
 * - `days[Tag].coldNetStarts`: Starts, bei denen der erste Moment ohne Vorrat über das Netz geholt wurde (Brief 02 zählt, `bumpColdNetStart`).
 * - `missed`: Abrufkarten, die falsch beantwortet wurden (Entscheidung 35), höchstens 20, die ältesten fallen raus.
 *
 * Zusammenführen der Geräte: Zähler je Feld und Tag mit Maximum (jede Zahl wächst nur, Maximum ist vertauschbar und wiederholbar),
 * `missed` als Vereinigung je Moment-ID mit dem jüngsten Eintrag.
 */
import type { AppState } from '../lib/state';
import type { Area } from '../types';
import { formOf, type Form } from './form';
import type { Moment } from './types';

export interface MixClump {
  pairs: number;
  episode: number;
  channel: number;
  area: number;
}

export interface HourCell {
  seen: number;
  done: number;
  saves: number;
  skips: number;
}
export type HourField = keyof HourCell;

export type ByHour = Record<string, Partial<Record<Area, Partial<Record<Form, HourCell>>>>>;

export interface DaySignals {
  mixClump?: MixClump;
  byHour?: ByHour;
  coldNetStarts?: number;
}

/** Eine falsch beantwortete Abrufkarte (Entscheidung 35) */
export interface MissedItem {
  /** Moment-ID */
  id: string;
  question: string;
  /** Text der richtigen Option */
  correct: string;
  why: string;
  /** Quelle des Moments (Link), falls vorhanden */
  source?: string;
  videoTitle?: string;
  /** ms, Zeitpunkt der falschen Antwort */
  at: number;
}

export interface Signals {
  days: Record<string, DaySignals>;
  missed?: MissedItem[];
}

/** Wie viele Tage Zähler bleiben (ältere fallen beim Zusammenführen weg) */
export const SIGNAL_DAYS = 90;
export const MISSED_MAX = 20;

export const emptySignals = (): Signals => ({ days: {} });

const zeroCell = (): HourCell => ({ seen: 0, done: 0, saves: 0, skips: 0 });
const zeroClump = (): MixClump => ({ pairs: 0, episode: 0, channel: 0, area: 0 });

export const hourKey = (d: Date): string => String(d.getHours()).padStart(2, '0');

function withDay(s: AppState, day: string, f: (d: DaySignals) => DaySignals): AppState {
  const sig = s.signals ?? emptySignals();
  return { ...s, signals: { ...sig, days: { ...sig.days, [day]: f(sig.days[day] ?? {}) } } };
}

/** Zähler eines Tages und einer Stunde um 1 erhöhen */
export function bumpCell(s: AppState, day: string, hour: string, m: Pick<Moment, 'area' | 'audio' | 'form'>, field: HourField): AppState {
  const form = formOf(m);
  return withDay(s, day, (d) => {
    const byHour = d.byHour ?? {};
    const h = byHour[hour] ?? {};
    const a = h[m.area] ?? {};
    const cell = a[form] ?? zeroCell();
    return { ...d, byHour: { ...byHour, [hour]: { ...h, [m.area]: { ...a, [form]: { ...cell, [field]: cell[field] + 1 } } } } };
  });
}

/** Ein Paar aufeinanderfolgender Momente (prev, dann cur) zählen */
export function bumpPair(s: AppState, day: string, prev: Pick<Moment, 'videoId' | 'channel' | 'area'>, cur: Pick<Moment, 'videoId' | 'channel' | 'area'>): AppState {
  return withDay(s, day, (d) => {
    const c = d.mixClump ?? zeroClump();
    return {
      ...d,
      mixClump: {
        pairs: c.pairs + 1,
        episode: c.episode + (prev.videoId === cur.videoId ? 1 : 0),
        channel: c.channel + (prev.channel === cur.channel ? 1 : 0),
        area: c.area + (prev.area === cur.area ? 1 : 0),
      },
    };
  });
}

/** Schnittstelle zu Brief 02: ein Start, bei dem der erste Moment kalt über das Netz kam */
export function bumpColdNetStart(s: AppState, day: string): AppState {
  return withDay(s, day, (d) => ({ ...d, coldNetStarts: (d.coldNetStarts ?? 0) + 1 }));
}

/** Anteile gleicher Folge, gleichen Kanals, gleichen Bereichs an den Paaren der letzten `days` Tage (alle Tage, wenn nicht angegeben) */
export function mixClumpShare(sig: Signals | undefined, days?: string[]): MixClump & { episodeShare: number; channelShare: number; areaShare: number } {
  const sum = zeroClump();
  for (const [day, d] of Object.entries(sig?.days ?? {})) {
    if (days && !days.includes(day)) continue;
    if (!d.mixClump) continue;
    sum.pairs += d.mixClump.pairs;
    sum.episode += d.mixClump.episode;
    sum.channel += d.mixClump.channel;
    sum.area += d.mixClump.area;
  }
  const r = (n: number) => (sum.pairs ? n / sum.pairs : 0);
  return { ...sum, episodeShare: r(sum.episode), channelShare: r(sum.channel), areaShare: r(sum.area) };
}

// ---------- Missed (Entscheidung 35) ----------

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Je Moment der jüngste Eintrag, neueste zuerst (Gleichstand nach ID), höchstens MISSED_MAX */
export function normalizeMissed(items: readonly MissedItem[]): MissedItem[] {
  const best = new Map<string, MissedItem>();
  for (const it of items) {
    const cur = best.get(it.id);
    if (!cur || it.at > cur.at || (it.at === cur.at && cmpStr(JSON.stringify(it), JSON.stringify(cur)) > 0)) best.set(it.id, it);
  }
  return [...best.values()].sort((a, b) => b.at - a.at || cmpStr(a.id, b.id)).slice(0, MISSED_MAX);
}

/** Falsch beantwortete Abrufkarte vormerken */
export function addMissed(s: AppState, item: MissedItem): AppState {
  const sig = s.signals ?? emptySignals();
  return { ...s, signals: { ...sig, missed: normalizeMissed([...(sig.missed ?? []), item]) } };
}

// ---------- Zusammenführen ----------

const maxN = (a: number | undefined, b: number | undefined) => Math.max(a ?? 0, b ?? 0);

function mergeClump(a?: MixClump, b?: MixClump): MixClump | undefined {
  if (!a) return b;
  if (!b) return a;
  return { pairs: maxN(a.pairs, b.pairs), episode: maxN(a.episode, b.episode), channel: maxN(a.channel, b.channel), area: maxN(a.area, b.area) };
}

function mergeByHour(a?: ByHour, b?: ByHour): ByHour | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: ByHour = {};
  for (const hour of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ha = a[hour] ?? {};
    const hb = b[hour] ?? {};
    const h: NonNullable<ByHour[string]> = {};
    for (const area of new Set([...Object.keys(ha), ...Object.keys(hb)]) as Set<Area>) {
      const aa = ha[area] ?? {};
      const ab = hb[area] ?? {};
      const forms: Partial<Record<Form, HourCell>> = {};
      for (const form of new Set([...Object.keys(aa), ...Object.keys(ab)]) as Set<Form>) {
        const x = aa[form];
        const y = ab[form];
        forms[form] = { seen: maxN(x?.seen, y?.seen), done: maxN(x?.done, y?.done), saves: maxN(x?.saves, y?.saves), skips: maxN(x?.skips, y?.skips) };
      }
      h[area] = forms;
    }
    out[hour] = h;
  }
  return out;
}

function mergeDay(a: DaySignals, b: DaySignals): DaySignals {
  const out: DaySignals = {};
  const mc = mergeClump(a.mixClump, b.mixClump);
  if (mc) out.mixClump = mc;
  const bh = mergeByHour(a.byHour, b.byHour);
  if (bh) out.byHour = bh;
  if (a.coldNetStarts !== undefined || b.coldNetStarts !== undefined) out.coldNetStarts = maxN(a.coldNetStarts, b.coldNetStarts);
  return out;
}

/** Vertauschbar, wiederholbar, zusammenfassbar. undefined, wenn auf beiden Seiten nichts steht (das Feld bleibt dann aus dem Dokument). */
export function mergeSignals(a: Signals | undefined, b: Signals | undefined): Signals | undefined {
  if (!a) return b && normalizeSignals(b);
  if (!b) return normalizeSignals(a);
  const days: Record<string, DaySignals> = {};
  for (const k of new Set([...Object.keys(a.days), ...Object.keys(b.days)])) days[k] = mergeDay(a.days[k] ?? {}, b.days[k] ?? {});
  const out: Signals = { days: capDays(days) };
  const missed = normalizeMissed([...(a.missed ?? []), ...(b.missed ?? [])]);
  if (missed.length) out.missed = missed;
  return out;
}

function capDays(days: Record<string, DaySignals>): Record<string, DaySignals> {
  const keys = Object.keys(days).sort();
  return Object.fromEntries(keys.slice(-SIGNAL_DAYS).map((k) => [k, days[k]]));
}

/** Gemeinsame Form: Tage gekürzt, missed begrenzt */
export function normalizeSignals(x: Signals): Signals {
  const out: Signals = { days: capDays(x.days) };
  const missed = normalizeMissed(x.missed ?? []);
  if (missed.length) out.missed = missed;
  return out;
}

export const signalsEmpty = (x: Signals | undefined): boolean => !x || (!Object.keys(x.days).length && !x.missed?.length);
