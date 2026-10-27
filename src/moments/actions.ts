/**
 * Bedienung (Auftrag 26.10.2026, Aufgabe 3). Reine Regeln, gleiche Werte in ios/Core/Round1.swift (Actions).
 * Doppeltipp = "More like this" mit Herz an der Tippstelle, Spalte rechts: More, Save, Source.
 * Wisch nach links öffnet die Rückmeldung (27.10.2026), das "…"-Menü entfällt.
 */
export const HEART_MS = 400;
export const CONFIRM_MS = 150;
/** Ziel: Tipp bis Füllung unter 100 ms */
export const TAP_TARGET_MS = 100;
export const TAP_MAX = 60;
/** Zielgröße der Knöpfe in Punkt */
export const TARGET_PT = 48;

export type Action = 'more' | 'save' | 'source' | 'known' | 'wrong' | 'mute';
/** Toast nur bei Mute und Wrong, alles andere bestätigt sich am Knopf */
export const toastFor = (a: Action): boolean => a === 'mute' || a === 'wrong';

export interface TapSample {
  ms: number;
  at: number;
}
export const addTap = (list: TapSample[] | undefined, s: TapSample): TapSample[] => [...(list ?? []), s].slice(-TAP_MAX);

export interface TapStats {
  n: number;
  median: number | null;
  p90: number | null;
  underTarget: number | null;
}
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
export function tapStats(list: TapSample[] | undefined): TapStats {
  const ms = (list ?? []).map((x) => x.ms).sort((a, b) => a - b);
  if (!ms.length) return { n: 0, median: null, p90: null, underTarget: null };
  return { n: ms.length, median: quantile(ms, 0.5), p90: quantile(ms, 0.9), underTarget: ms.filter((x) => x < TAP_TARGET_MS).length / ms.length };
}

/** Wirkung "More like this": Herz an. Doppeltipp setzt nur (bleibt gefüllt), der Knopf schaltet um. */
export function nextLiked(liked: boolean, via: 'double' | 'button'): boolean {
  return via === 'double' ? true : !liked;
}

/** Wischweg in Pixeln, ab dem eine Geste zählt */
export const SWIPE_PX = 60;
export type Swipe = 'next' | 'prev' | 'note' | null;
/**
 * Welche Wischgeste ist es? Waagerecht gewinnt, wenn der Weg dort länger ist. Nach links öffnet die Rückmeldung,
 * nach rechts passiert nichts. Senkrecht: nach oben der nächste Moment, nach unten der vorige.
 */
export function swipeOf(dx: number, dy: number): Swipe {
  if (Math.abs(dx) > Math.abs(dy)) return dx < -SWIPE_PX ? 'note' : null;
  return dy < -SWIPE_PX ? 'next' : dy > SWIPE_PX ? 'prev' : null;
}
