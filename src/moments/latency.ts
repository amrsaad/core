/**
 * Messung Wisch bis erstes Bild (Bauliste Runde 1, Punkt 1, Fundament R1 und E5).
 * Reine Funktionen, damit ios/Core/Diag.swift dieselbe Regel 1:1 nachziehen kann.
 */
export const LATENCY_TARGET_MS = 300;
export const LATENCY_MAX = 60;

export interface LatencySample {
  /** Millisekunden vom Wisch bis zum ersten PLAYING des neuen Moments */
  ms: number;
  /** Moment lag beim Wisch schon geladen und angehalten im Vorlade-Player */
  buffered: boolean;
  /** Zeitpunkt (ms seit 1970) */
  at: number;
}

export interface LatencyStats {
  n: number;
  median: number | null;
  p90: number | null;
  /** Anteil der Messungen unter dem Ziel, 0 bis 1 */
  underTarget: number | null;
}

export const addSample = (list: LatencySample[] | undefined, s: LatencySample): LatencySample[] => [...(list ?? []), s].slice(-LATENCY_MAX);

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];

export function latencyStats(list: LatencySample[] | undefined, buffered: boolean): LatencyStats {
  const ms = (list ?? []).filter((x) => x.buffered === buffered).map((x) => x.ms).sort((a, b) => a - b);
  if (!ms.length) return { n: 0, median: null, p90: null, underTarget: null };
  return { n: ms.length, median: quantile(ms, 0.5), p90: quantile(ms, 0.9), underTarget: ms.filter((x) => x < LATENCY_TARGET_MS).length / ms.length };
}
