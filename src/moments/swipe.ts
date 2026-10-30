/**
 * Wischübergang wie bei Instagram Reels (Auftrag Max 29.10.2026). Reine Regeln (Web). ios/Core blättert mit dem
 * System-Paging des ScrollView, dessen Feder gehört dem System, siehe docs/handoff-app.md.
 *
 *  1. Der Moment folgt dem Finger 1:1 (Verschiebung y in px, negativ = nach oben = nächster Moment).
 *  2. Loslassen: Strecke (25 Prozent der Höhe) oder Geschwindigkeit (0,4 px/ms) entscheidet, der Rest ist eine Feder mit
 *     Geschwindigkeitsübernahme. Keine feste Dauer, keine Kurve.
 *  3. Am Anfang und Ende des Feeds Gummiband.
 */

/** Anteil der Höhe, ab dem ein Wisch auch ohne Tempo zählt */
export const COMMIT_FRACTION = 0.25;
/** px/ms, ab dem ein Wisch auch über kurze Strecke zählt */
export const COMMIT_VELOCITY = 0.4;
/** Kürzester Weg für einen Wisch über Tempo, damit Zittern nie blättert */
export const MIN_FLICK_PX = 10;
/** Gummiband: Apple-Formel, Konstante 0,55 */
export const RUBBER = 0.55;
/** Tempo aus den letzten 100 ms der Fingerbewegung. Steht der Finger vor dem Loslassen 80 ms still, ist es 0. */
export const VELOCITY_WINDOW_MS = 100;
export const STALE_MS = 80;

/** Feder mit Masse 1: Antwortzeit in s (2π/ω) und Dämpfungsgrad (1 = kritisch, kein Überschwingen) */
export interface Spring {
  response: number;
  damping: number;
}
/** Seitenwechsel: kritisch gedämpft, nie über das Ziel hinaus */
export const SPRING_COMMIT: Spring = { response: 0.28, damping: 1 };
/** Zurückschnappen und Gummiband: leichtes Nachschwingen */
export const SPRING_BACK: Spring = { response: 0.36, damping: 0.86 };
/** Ruhe: unter 0,4 px Abstand und 30 px/s Tempo */
export const REST_PX = 0.4;
export const REST_V = 30;
/** Ein Zeitschritt wird nie größer als 50 ms (Tab im Hintergrund, Stocken), sonst springt die Feder */
export const MAX_DT = 0.05;

/** Gummiband: wächst mit dem Zug, strebt gegen die Höhe. d ist der rohe Zug in px, h die Höhe. */
export function rubber(d: number, h: number): number {
  const a = Math.abs(d);
  const r = (1 - 1 / ((a * RUBBER) / h + 1)) * h;
  return d < 0 ? -r : r;
}

/**
 * Verschiebung beim Ziehen. raw ist der Weg des Fingers seit dem Aufsetzen (plus Übernahme), negativ = nach oben.
 * Mit nächstem bzw. vorigem Moment 1:1 (höchstens eine Höhe), sonst Gummiband.
 */
export function dragY(raw: number, h: number, canNext: boolean, canPrev: boolean): number {
  if (raw < 0) return canNext ? Math.max(raw, -h) : rubber(raw, h);
  if (raw > 0) return canPrev ? Math.min(raw, h) : rubber(raw, h);
  return 0;
}

export type Release = 'next' | 'prev' | 'stay';

/**
 * Loslassen: y ist die gezeigte Verschiebung, v das Tempo in px/ms (negativ = nach oben). Nach oben blättert vor, wenn der Weg
 * mindestens 25 Prozent der Höhe beträgt oder das Tempo mindestens 0,4 px/ms nach oben zeigt (und der Weg 10 px erreicht).
 * Zeigt das Tempo gegen die Zugrichtung, bleibt der Moment. Ohne nächsten bzw. vorigen Moment bleibt er immer.
 */
export function release(y: number, v: number, h: number, canNext: boolean, canPrev: boolean): Release {
  if (y === 0 && v === 0) return 'stay';
  const up = y < 0 || (y === 0 && v < 0);
  const dist = Math.abs(y) / h;
  const toward = up ? -v : v; // Tempo in Zugrichtung
  const away = up ? v : -v; // Tempo gegen die Zugrichtung
  if (away >= COMMIT_VELOCITY) return 'stay';
  const goes = dist >= COMMIT_FRACTION || (toward >= COMMIT_VELOCITY && Math.abs(y) >= MIN_FLICK_PX);
  if (!goes) return 'stay';
  if (up) return canNext ? 'next' : 'stay';
  return canPrev ? 'prev' : 'stay';
}

/** Tempo des Fingers aus den letzten Messpunkten. Zeit in ms, y in px, Ergebnis px/ms. */
export class Velocity {
  private s: { t: number; y: number }[] = [];
  reset() {
    this.s = [];
  }
  push(t: number, y: number) {
    this.s.push({ t, y });
    if (this.s.length > 12) this.s.shift();
  }
  /** now: Zeitpunkt des Loslassens */
  at(now: number): number {
    const n = this.s.length;
    if (n < 2) return 0;
    const last = this.s[n - 1];
    if (now - last.t > STALE_MS) return 0;
    let k = n - 2;
    while (k > 0 && last.t - this.s[k - 1].t <= VELOCITY_WINDOW_MS) k--;
    const first = this.s[k];
    const dt = last.t - first.t;
    return dt > 0 ? (last.y - first.y) / dt : 0;
  }
}

/** Zustand der Feder: x ist der Abstand zum Ziel in px, v das Tempo in px/s */
export interface SpringState {
  x: number;
  v: number;
}

/**
 * Ein Zeitschritt der gedämpften Feder, geschlossene Lösung (unabhängig von der Schrittweite). Masse 1,
 * ω = 2π/Antwortzeit, Dämpfung c = 2ζω.
 */
export function stepSpring(s: SpringState, dtIn: number, sp: Spring): SpringState {
  const dt = Math.min(Math.max(dtIn, 0), MAX_DT);
  if (dt === 0) return s;
  const w = (2 * Math.PI) / sp.response;
  const z = sp.damping;
  const { x: d0, v: v0 } = s;
  if (Math.abs(z - 1) < 1e-9) {
    const e = Math.exp(-w * dt);
    const b = v0 + w * d0;
    return { x: e * (d0 + b * dt), v: e * (v0 - w * b * dt) };
  }
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w * dt);
    const c = Math.cos(wd * dt);
    const sn = Math.sin(wd * dt);
    const c2 = (v0 + z * w * d0) / wd;
    return { x: e * (d0 * c + c2 * sn), v: e * (v0 * c - ((w * w * d0 + z * w * v0) / wd) * sn) };
  }
  const q = w * Math.sqrt(z * z - 1);
  const r1 = -z * w + q;
  const r2 = -z * w - q;
  const c1 = (v0 - r2 * d0) / (r1 - r2);
  const c2 = d0 - c1;
  const e1 = Math.exp(r1 * dt);
  const e2 = Math.exp(r2 * dt);
  return { x: c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 };
}

export const atRest = (s: SpringState): boolean => Math.abs(s.x) < REST_PX && Math.abs(s.v) < REST_V;

/**
 * Anfangstempo für den Seitenwechsel: das Tempo des Fingers wird übernommen, aber so begrenzt, dass die kritisch gedämpfte Feder
 * das Ziel nie überschreitet (sonst zeigt der Feed unter der nächsten Seite die übernächste). Tempo weg vom Ziel bleibt.
 * d0 ist der Abstand zum Ziel (Vorzeichen: Ziel minus Position negiert, also x = Position minus Ziel), v0 in px/s.
 */
export function commitVelocity(d0: number, v0: number, sp: Spring = SPRING_COMMIT): number {
  const w = (2 * Math.PI) / sp.response;
  if (d0 > 0) return Math.max(v0, -w * d0);
  if (d0 < 0) return Math.min(v0, -w * d0);
  return 0;
}

// ---------- Messung: verlorene Frames während der Wische ----------

/** Zielwert: unter 2 Prozent verlorene Frames bei 60 Hz */
export const DROP_TARGET_PCT = 2;
export const FRAME_SAMPLE_MAX = 60;

export interface FrameSample {
  /** gezeigte Frames im Messfenster (ohne verlorene) */
  frames: number;
  /** verlorene Frames im Messfenster */
  lost: number;
  /** Bildwiederholrate, aus dem Takt des Geräts bestimmt (60 oder 120) */
  hz: number;
  at: number;
}

/** Takt des Geräts aus den Abständen der Frames: unter 12,5 ms heißt 120 Hz, sonst 60 Hz */
export function hzOf(deltas: number[]): number {
  if (!deltas.length) return 60;
  const s = [...deltas].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] < 12.5 ? 120 : 60;
}

/** Verlorene Frames: je Abstand zweier Frames round(Abstand / Takt) - 1, nie negativ */
export function lostFrames(deltas: number[], hz: number): number {
  const frame = 1000 / hz;
  let lost = 0;
  for (const d of deltas) lost += Math.max(0, Math.round(d / frame) - 1);
  return lost;
}

export function frameSample(deltas: number[], at: number): FrameSample {
  const hz = hzOf(deltas);
  return { frames: deltas.length, lost: lostFrames(deltas, hz), hz, at };
}

export const addFrames = (list: FrameSample[] | undefined, s: FrameSample): FrameSample[] => [...(list ?? []), s].slice(-FRAME_SAMPLE_MAX);

export interface FrameStats {
  n: number;
  frames: number;
  lost: number;
  /** Prozent verlorene Frames über alle Wische, eine Nachkommastelle */
  lostPct: number | null;
  worstPct: number | null;
  hz: number | null;
}
export function frameStats(list: FrameSample[] | undefined): FrameStats {
  const l = list ?? [];
  if (!l.length) return { n: 0, frames: 0, lost: 0, lostPct: null, worstPct: null, hz: null };
  const frames = l.reduce((a, s) => a + s.frames, 0);
  const lost = l.reduce((a, s) => a + s.lost, 0);
  const pct = (a: number, b: number) => (a + b ? (a / (a + b)) * 100 : 0);
  return {
    n: l.length,
    frames,
    lost,
    lostPct: Math.round(pct(lost, frames) * 10) / 10,
    worstPct: Math.round(Math.max(...l.map((s) => pct(s.lost, s.frames))) * 10) / 10,
    hz: l[l.length - 1].hz,
  };
}
