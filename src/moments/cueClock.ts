// Untertitel-Uhr (Issue 15). Die Cue-Auswahl liest ausschließlich currentTime des Elements, das gerade Ton ausgibt
// (Deck im Audio-Reiter, Slot im Video-Reiter, bei YouTube der Player). Gelesen wird bei jedem timeupdate, dazwischen rechnet requestAnimationFrame
// mit playbackRate weiter. Die Zeitmarke dient nur der Interpolation zwischen zwei Messungen des Elements, die Basis ist immer die Elementzeit.
// Nie Date.now, nie die Zeit, die seit dem Start des Moments vergangen ist.

/** Länger als so viele Wanduhr-Sekunden ohne neue Messung wird nicht weitergerechnet (hängendes Element, Hintergrund) */
export const MAX_EXTRAPOLATE_S = 0.6;
/** Vorlauf: Eine Cue gilt kurz vor ihrer Zeit schon als aktuell (Lesezeit) */
export const CUE_LEAD_S = 0.1;

export class CueClock {
  private t = 0;
  private at = 0;
  private rate = 1;
  private playing = false;
  private known = false;

  /** Messung am Element: Elementzeit in Quellsekunden, Zeitmarke (performance.now), Tempo, spielt es */
  sample(t: number, at: number, rate: number, playing: boolean): void {
    if (!Number.isFinite(t)) return;
    this.t = t;
    this.at = at;
    this.rate = rate > 0 ? rate : 1;
    this.playing = playing;
    this.known = true;
  }

  /** Das Element wechselt die Quelle (Spurwechsel, Rückfall): die Zeit bleibt stehen, bis die nächste Messung kommt */
  hold(t: number, at: number): void {
    this.sample(t, at, this.rate, false);
  }

  get seen(): boolean {
    return this.known;
  }

  /** Elementzeit zur Zeitmarke at (Millisekunden), höchstens MAX_EXTRAPOLATE_S Wanduhr-Sekunden hinter der letzten Messung */
  now(at: number): number {
    if (!this.playing) return this.t;
    const dt = Math.min(MAX_EXTRAPOLATE_S, Math.max(0, (at - this.at) / 1000));
    return this.t + dt * this.rate;
  }

  reset(): void {
    this.known = false;
    this.playing = false;
    this.t = 0;
  }
}

/** Index der Cue, die bei rel (Sekunden seit Start des Moments) gilt, -1 vor der ersten. cues sind nach Zeit sortiert. */
export function cueIndexAt(cues: readonly (readonly [number, string])[] | undefined, rel: number, lead = CUE_LEAD_S): number {
  if (!cues) return -1;
  let idx = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i][0] <= rel + lead) idx = i;
    else break;
  }
  return idx;
}
